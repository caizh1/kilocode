#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs"
import os from "os" // chipmate_change
import path from "path"
import { fileURLToPath } from "url"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { createRequire } from "module" // chipmate_change

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")
const require = createRequire(import.meta.url) // chipmate_change

process.chdir(dir)

const generated = await import("./generate.ts")

import { Script } from "@opencode-ai/script"
import pkg from "../package.json"
// chipmate_change start
import { stageBubblewrap } from "./chipmate/bubblewrap"
import { LanceDBRuntime } from "../src/chipmate/lancedb"
import { ChipMateSandboxWorker } from "./chipmate/chipmate-sandbox-worker"
import { ChipMateSandboxNetwork } from "./chipmate/chipmate-sandbox-network"
// chipmate_change end

const singleFlag = process.argv.includes("--single")
const baselineFlag = process.argv.includes("--baseline")
const skipInstall = process.argv.includes("--skip-install")
const sourcemapsFlag = process.argv.includes("--sourcemaps")
const skipReleaseUpload = process.argv.includes("--skip-release-upload") // chipmate_change
// chipmate_change start - allow internal packaging to build an explicit target subset
const targetsArg =
  process.argv.find((arg) => arg.startsWith("--targets="))?.slice("--targets=".length) ?? process.env.CHIPMATE_BUILD_TARGETS
const requestedTargets = targetsArg
  ? new Set(
      targetsArg
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    )
  : undefined
// chipmate_change end
const plugin = createSolidTransformPlugin()

// chipmate_change start - codebase indexing
function armPtyPlugin() {
  return {
    name: "chipmate-windows-arm64-pty",
    setup(build: { onResolve: (opts: { filter: RegExp }, load: () => { path: string }) => void }) {
      build.onResolve({ filter: /^#pty$/ }, () => ({
        path: path.resolve(dir, "src/chipmate/windows-arm64-pty.ts"),
      }))
    },
  }
}

async function stageArmPty(outputDir: string) {
  const source = path.resolve(dir, "../../node_modules/.bun/node_modules/@lydell/node-pty-win32-arm64")
  const target = path.join(outputDir, "node-pty-arm64")
  if (!fs.existsSync(path.join(source, "package.json"))) {
    throw new Error("Windows ARM64 PTY runtime is missing; run bun install --os='*' --cpu='*' before building")
  }
  await fs.promises.rm(target, { recursive: true, force: true })
  await fs.promises.cp(source, target, { recursive: true, dereference: true })
  const file = path.join(target, "lib", "windowsPtyAgent.js")
  const text = await fs.promises.readFile(file, "utf8")
  const needle = "var inSocketFD = fs.openSync(term.conin, 'w');"
  if (!text.includes(needle)) {
    throw new Error("Windows ARM64 PTY input pipe patch no longer matches the bundled runtime")
  }
  await fs.promises.writeFile(file, text.replace(needle, `${needle}\n        this._input = inSocketFD;`))
  const worker = path.join(target, "lib", "windowsConoutConnection.js")
  const code = await fs.promises.readFile(worker, "utf8")
  const spawn =
    "this._worker = new worker_threads_1.Worker(path_1.join(scriptPath, 'worker/conoutSocketWorker.js'), { workerData: workerData });"
  if (!code.includes(spawn)) {
    throw new Error("Windows ARM64 PTY output worker patch no longer matches the bundled runtime")
  }
  const body = [
    "'use strict';",
    "const { parentPort, workerData } = require('worker_threads');",
    "const net = require('net');",
    "const output = new net.Socket();",
    "output.setEncoding('utf8');",
    "output.connect(workerData.conoutPipeName, () => {",
    "  const server = net.createServer((socket) => output.pipe(socket));",
    "  server.listen(`${workerData.conoutPipeName}-worker`);",
    "  if (!parentPort) throw new Error('worker_threads parentPort is null');",
    "  parentPort.postMessage(1);",
    "});",
  ].join("\n")
  const embedded = `this._worker = new worker_threads_1.Worker(${JSON.stringify(body)}, { eval: true, workerData: workerData });`
  await fs.promises.writeFile(worker, code.replace(spawn, embedded))
  console.log(`copied Windows ARM64 PTY runtime to ${target}`)
}

async function copyTreeSitterWasms(outputDir: string) {
  const runtimeWasmPath = require.resolve("web-tree-sitter/tree-sitter.wasm")
  const languagePackagePath = require.resolve("tree-sitter-wasms/package.json")
  const languageWasmDir = path.join(path.dirname(languagePackagePath), "out")
  const targetDir = path.join(outputDir, "tree-sitter")

  await fs.promises.mkdir(targetDir, { recursive: true })
  await fs.promises.copyFile(runtimeWasmPath, path.join(targetDir, "tree-sitter.wasm"))

  const languageWasmFiles = (await fs.promises.readdir(languageWasmDir)).filter((file) => file.endsWith(".wasm"))

  await Promise.all(
    languageWasmFiles.map((file) => fs.promises.copyFile(path.join(languageWasmDir, file), path.join(targetDir, file))),
  )

  console.log(`copied ${languageWasmFiles.length + 1} tree-sitter wasm files to ${targetDir}`)
}

// chipmate_change start
async function isChipMateConsoleUpToDate(app: string, out: string) {
  const indexHtml = path.join(out, "index.html")
  if (!fs.existsSync(indexHtml)) return false
  const outStat = await fs.promises.stat(indexHtml)
  const inputs = [
    path.join(app, "src"),
    path.join(app, "package.json"),
    path.join(app, "vite.config.ts"),
    path.join(app, "index.html"),
    path.resolve(dir, "../chipmate-web-ui/src"),
    path.resolve(dir, "../chipmate-indexing/src"),
    path.resolve(dir, "../chipmate-ui/src"),
    path.resolve(dir, "../ui/src"),
    path.resolve(dir, "../sdk/js/src"),
    path.resolve(dir, "../../bun.lock"),
  ]
  for (const p of inputs) {
    if (!fs.existsSync(p)) continue
    const st = await fs.promises.stat(p)
    if (st.isDirectory()) {
      const glob = new Bun.Glob("**/*")
      for await (const file of glob.scan({ cwd: p })) {
        const fileStat = await fs.promises.stat(path.join(p, file))
        if (fileStat.mtimeMs > outStat.mtimeMs) return false
      }
    } else if (st.mtimeMs > outStat.mtimeMs) {
      return false
    }
  }
  return true
}

async function buildChipMateConsole() {
  const app = path.resolve(dir, "../chipmate-console")
  const out = path.join(app, "dist")
  if (await isChipMateConsoleUpToDate(app, out)) {
    console.log(`reusing existing ChipMate Console build at ${out}`)
    return out
  }
  console.log("building ChipMate Console")
  const proc = Bun.spawn([process.execPath, "run", "build"], {
    cwd: app,
    env: { ...process.env, CHIPMATE_CONSOLE_BASE: "/console/" },
    stdout: "inherit",
    stderr: "inherit",
    windowsHide: true,
  })
  const code = await proc.exited
  if (code !== 0) throw new Error(`ChipMate Console build failed with exit code ${code}`)
  return out
}
// chipmate_change end

async function copyChipMateConsole(input: string, outputDir: string) {
  const target = path.join(outputDir, "console")
  await fs.promises.rm(target, { recursive: true, force: true })
  await fs.promises.cp(input, target, { recursive: true })
  console.log(`copied ChipMate Console assets to ${target}`)
}

// chipmate_change start - build CodeGraph parser worker as a real sidecar file
async function buildCodeGraphParserWorker(outputDir: string) {
  const result = await Bun.build({
    entrypoints: ["../chipmate-indexing/src/indexing/codegraph/parser/worker.ts"],
    outdir: outputDir,
    naming: {
      entry: "codegraph-parser-worker.mjs",
    },
    format: "esm",
    target: "bun",
    minify: true,
    sourcemap: "none",
  })
  if (!result.success) {
    throw new AggregateError(result.logs, "Failed to build CodeGraph parser worker")
  }
  console.log(`built CodeGraph parser worker at ${path.join(outputDir, "codegraph-parser-worker.mjs")}`)
}
// chipmate_change end

// chipmate_change start - validate compiled binaries load the sidecar models snapshot
function smokeEnv(root: string) {
  const env = { ...process.env }
  delete env.CHIPMATE_MODELS_PATH
  delete env.CHIPMATE_MODELS_URL
  delete env.CHIPMATE_CONFIG
  delete env.CHIPMATE_CONFIG_DIR
  return {
    ...env,
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_STATE_HOME: path.join(root, "state"),
    CHIPMATE_DISABLE_MODELS_FETCH: "1",
    CHIPMATE_DISABLE_PROJECT_CONFIG: "1",
    CHIPMATE_CONFIG_CONTENT: JSON.stringify({ enabled_providers: ["anthropic"] }),
    ANTHROPIC_API_KEY: "dummy",
  }
}

async function smokeModels(binaryPath: string) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "chipmate-models-"))
  try {
    const out = await $`${binaryPath} --pure models anthropic`.env(smokeEnv(root)).text()
    if (out.split(/\r?\n/).some((line) => line.startsWith("anthropic/"))) return
    throw new Error("Compiled binary did not list Anthropic models from the embedded snapshot")
  } finally {
    await fs.promises
      .rm(root, { recursive: true, force: true })
      .catch((err) => console.warn(`Failed to remove smoke test directory ${root}`, err))
  }
}

// ChipMate dropped the packages/app web UI. Kept here as a commented reference so future upstream merges
// can see the deliberate divergence rather than treating a re-add as a clean re-introduction.
// const createEmbeddedWebUIBundle = async () => {
//   console.log(`Building Web UI to embed in the binary`)
//   const appDir = path.join(import.meta.dirname, "../../app")
//   const dist = path.join(appDir, "dist")
//   await $`bun run --cwd ${appDir} build`
//   const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: dist })))
//     .map((file) => file.replaceAll("\\", "/"))
//     .filter((file) => !file.endsWith(".map"))
//     .sort()
//   const imports = files.map((file, i) => {
//     const spec = path.relative(dir, path.join(dist, file)).replaceAll("\\", "/")
//     return `import file_${i} from ${JSON.stringify(spec.startsWith(".") ? spec : `./${spec}`)} with { type: "file" };`
//   })
//   const entries = files.map((file, i) => `  ${JSON.stringify(file)}: file_${i},`)
//   return [
//     `// Import all files as file_$i with type: "file"`,
//     ...imports,
//     `// Export with original mappings`,
//     `export default {`,
//     ...entries,
//     `}`,
//   ].join("\n")
// }
// chipmate_change end

const allTargets: {
  os: string
  arch: "arm64" | "x64"
  abi?: "musl"
  avx2?: false
}[] = [
  {
    os: "linux",
    arch: "arm64",
  },
  {
    os: "linux",
    arch: "x64",
  },
  {
    os: "linux",
    arch: "x64",
    avx2: false,
  },
  {
    os: "linux",
    arch: "arm64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
    avx2: false,
  },
  {
    os: "darwin",
    arch: "arm64",
  },
  {
    os: "darwin",
    arch: "x64",
  },
  {
    os: "darwin",
    arch: "x64",
    avx2: false,
  },
  {
    os: "win32",
    arch: "arm64",
  },
  {
    os: "win32",
    arch: "x64",
  },
  {
    os: "win32",
    arch: "x64",
    avx2: false,
  }, // chipmate_change
] // chipmate_change

// chipmate_change start - reuse target names for explicit internal package selection
function packageNameForTarget(item: (typeof allTargets)[number]) {
  return [
    pkg.name,
    // changing to win32 flags npm for some reason
    item.os === "win32" ? "windows" : item.os,
    item.arch,
    item.avx2 === false ? "baseline" : undefined,
    item.abi === undefined ? undefined : item.abi,
  ]
    .filter(Boolean)
    .join("-")
}

function targetAliases(item: (typeof allTargets)[number]) {
  const name = packageNameForTarget(item)
  return [name, name.replace(`${pkg.name}-`, "")]
}

const baseTargets = singleFlag
  ? allTargets.filter((item) => {
      if (item.os !== process.platform || item.arch !== process.arch) {
        return false
      }

      // When building for the current platform, prefer a single native binary by default.
      // Baseline binaries require additional Bun artifacts and can be flaky to download.
      if (item.avx2 === false) {
        return baselineFlag
      }

      // also skip abi-specific builds for the same reason
      if (item.abi !== undefined) {
        return false
      }

      return true
    })
  : allTargets

const targets = requestedTargets
  ? baseTargets.filter((item) => targetAliases(item).some((alias) => requestedTargets.has(alias)))
  : baseTargets

if (requestedTargets && targets.length === 0) {
  throw new Error(`No build targets matched --targets=${Array.from(requestedTargets).join(",")}`)
}
// chipmate_change end
// chipmate_change start
await $`rm -rf dist`
const [chipmateConsoleDist, chipmateSandboxWorker, chipmateSandboxNetwork] = await Promise.all([
  buildChipMateConsole(),
  ChipMateSandboxWorker.bundle(),
  ChipMateSandboxNetwork.bundle(),
])
// chipmate_change end

const binaries: Record<string, string> = {}
if (!skipInstall) {
  // chipmate_change
  await $`bun install --os="*" --cpu="*" @opentui/core@${pkg.dependencies["@opentui/core"]}`
  await $`bun install --os="*" --cpu="*" @parcel/watcher@${pkg.dependencies["@parcel/watcher"]}`
  await $`bun install --os="*" --cpu="*" @ff-labs/fff-bun@${pkg.dependencies["@ff-labs/fff-bun"]}`
}
for (const item of targets) {
  const name = packageNameForTarget(item) // chipmate_change

  console.log(`building ${name}`)
  await $`mkdir -p dist/${name}/bin`
  // chipmate_change start
  const bwrap =
    item.os === "linux" && process.env.CHIPMATE_SKIP_BUNDLED_BWRAP !== "1"
      ? await stageBubblewrap(item.arch, path.resolve(dir, `dist/${name}/bin`))
      : undefined
  // chipmate_change end

  const localPath = path.resolve(dir, "node_modules/@opentui/core/parser.worker.js")
  const rootPath = path.resolve(dir, "../../node_modules/@opentui/core/parser.worker.js") // chipmate_change
  const parserWorker = fs.realpathSync(fs.existsSync(localPath) ? localPath : rootPath)
  const workerPath = "./src/cli/tui/worker.ts"
  const sessionExportWorkerPath = "./src/chipmate/session-export/worker.ts" // chipmate_change
  const indexingProcessName = item.os === "win32" ? "chipmate-indexer.exe" : "chipmate-indexer" // chipmate_change
  const codeGraphParserWorkerPath = "codegraph-parser-worker.mjs" // chipmate_change
  const compileTarget = name.replace(pkg.name, "bun") as any // chipmate_change

  // Use platform-specific bunfs root path based on target OS
  const bunfsRoot = item.os === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/"
  const workerRelativePath = path.relative(dir, parserWorker).replaceAll("\\", "/")

  // chipmate_change - fail when cross-compilation does not emit the CLI
  const result = await Bun.build({
    conditions: ["bun", "node"], // chipmate_change - port anomalyco/opencode#30873; current form from #31566
    tsconfig: "./tsconfig.json",
    plugins: item.os === "win32" && item.arch === "arm64" ? [armPtyPlugin(), plugin] : [plugin],
    // chipmate_change start - skip sourcemaps for release builds (each .js.map adds ~50 MB per target → ~600 MB total)
    sourcemap: Script.release ? "none" : "external",
    external: ["node-gyp", ...LanceDBRuntime.external],
    // chipmate_change end
    format: "esm",
    minify: true,
    // chipmate_change start - disable code-splitting to avoid a Bun 1.3.14 codegen bug.
    // With splitting:true Bun emits cross-chunk re-exports like `import{vn as G9}` whose
    // binding isn't top-level, so the compiled binary crashes at startup on the baseline
    // target: "SyntaxError: Exported binding 'G9' needs to refer to a top-level declared
    // variable." (Bun oven-sh/bun#25621, #5344, #7265; also opencode#23349). Fixed upstream
    // in Bun#26089, post-1.3.14. Splitting only deduped shared code between the entrypoints;
    // turning it off inlines per entrypoint and produces a valid binary.
    splitting: false,
    // chipmate_change end
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      target: compileTarget,
      outfile: `dist/${name}/bin/chipmate`, // chipmate_change
      execArgv: [`--user-agent=chipmate/${Script.version}`, "--use-system-ca", "--"], // chipmate_change
      windows: {},
    },
    // chipmate_change start - packages/app was removed; no embedded web UI
    files: {},
    entrypoints: ["./src/index.ts", parserWorker, workerPath, sessionExportWorkerPath],
    // chipmate_change end
    define: {
      FFF_LIBC: JSON.stringify(item.abi === "musl" ? "musl" : "gnu"),
      CHIPMATE_VERSION: `'${Script.version}'`, // chipmate_change
      CHIPMATE_MODELS_DEV: generated.modelsData,
      OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + workerRelativePath,
      CHIPMATE_WORKER_PATH: workerPath,
      CHIPMATE_SESSION_EXPORT_WORKER_PATH: sessionExportWorkerPath, // chipmate_change
      CHIPMATE_INDEXING_PROCESS_PATH: `'${indexingProcessName}'`, // chipmate_change
      CHIPMATE_CODEGRAPH_WORKER_PATH: codeGraphParserWorkerPath, // chipmate_change
      CHIPMATE_SANDBOX_MUTATION_WORKER_PATH: JSON.stringify(ChipMateSandboxWorker.filename),
      CHIPMATE_SANDBOX_NETWORK_RELAY_PATH: item.os === "linux" ? JSON.stringify(ChipMateSandboxNetwork.relay) : "undefined",
      CHIPMATE_SANDBOX_SECCOMP_PATH: item.os === "linux" ? JSON.stringify(ChipMateSandboxNetwork.seccomp) : "undefined",
      CHIPMATE_CHANNEL: `'${Script.channel}'`,
      CHIPMATE_LIBC: item.os === "linux" ? `'${item.abi ?? "glibc"}'` : "", // chipmate_change
      CHIPMATE_BUILD_KIND: Script.release ? `'release'` : `'source'`, // chipmate_change
      // chipmate_change start
      CHIPMATE_BWRAP_SHA256: bwrap ? `'${bwrap}'` : "undefined",
      // chipmate_change end
      ...(item.os === "linux" ? { "process.env.OPENTUI_LIBC": JSON.stringify(item.abi ?? "glibc") } : {}),
    },
  })
  // chipmate_change start - Bun.build reports compilation errors in the result instead of throwing
  if (!result.success) throw new AggregateError(result.logs, `Failed to build ${name}`)
  // chipmate_change end

  // chipmate_change start - isolate indexing native allocations from the main CLI process
  const indexing = await Bun.build({
    conditions: ["browser"],
    tsconfig: "./tsconfig.json",
    plugins: [plugin],
    sourcemap: Script.release ? "none" : "external",
    external: ["node-gyp", ...LanceDBRuntime.external],
    format: "esm",
    minify: true,
    splitting: false,
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      target: compileTarget,
      outfile: `dist/${name}/bin/${indexingProcessName}`,
      execArgv: [`--user-agent=chipmate/${Script.version}`, "--use-system-ca", "--"],
      windows: {},
    },
    entrypoints: ["./src/chipmate/indexing-process.ts"],
    define: {
      CHIPMATE_CODEGRAPH_WORKER_PATH: `'${codeGraphParserWorkerPath}'`,
      CHIPMATE_BUILD_KIND: Script.release ? `'release'` : `'source'`,
    },
  })
  if (!indexing.success) throw new AggregateError(indexing.logs, `Failed to build ${indexingProcessName}`)
  // chipmate_change end

  await Bun.write(path.resolve(dir, `dist/${name}/bin/models-snapshot.json`), generated.modelsData) // chipmate_change
  await buildCodeGraphParserWorker(path.resolve(dir, `dist/${name}/bin`)) // chipmate_change
  // chipmate_change start
  await copyTreeSitterWasms(path.resolve(dir, `dist/${name}/bin`))
  await copyChipMateConsole(chipmateConsoleDist, path.resolve(dir, `dist/${name}/bin`))
  if (item.os === "win32" && item.arch === "arm64") {
    await stageArmPty(path.resolve(dir, `dist/${name}/bin`))
  }
  await ChipMateSandboxWorker.copy(chipmateSandboxWorker, path.resolve(dir, `dist/${name}/bin`))
  if (item.os === "linux") {
    await ChipMateSandboxNetwork.copy(chipmateSandboxNetwork, path.resolve(dir, `dist/${name}/bin`), item.arch)
  }

  if (item.os === "linux") {
    const interpreters: Record<string, string> = {
      x64: "/lib64/ld-linux-x86-64.so.2",
      arm64: "/lib/ld-linux-aarch64.so.1",
      "x64-musl": "/lib/ld-musl-x86_64.so.1",
      "arm64-musl": "/lib/ld-musl-aarch64.so.1",
    }
    const key = item.abi === "musl" ? `${item.arch}-musl` : item.arch
    const interpreter = interpreters[key]
    if (interpreter) {
      try {
        await $`patchelf --set-interpreter ${interpreter} dist/${name}/bin/chipmate`
        console.log(`patched interpreter for ${name} -> ${interpreter}`)
      } catch {
        console.warn(`patchelf not available, skipping interpreter fix for ${name}`)
      }
    }
  }
  // chipmate_change end

  // Smoke test: only run if binary is for current platform
  if (item.os === process.platform && item.arch === process.arch && !item.abi) {
    const binaryPath = `dist/${name}/bin/chipmate` // chipmate_change
    console.log(`Running smoke test: ${binaryPath} --version`)
    try {
      const versionOutput = await $`${binaryPath} --version`.text()
      console.log(`Smoke test passed: ${versionOutput.trim()}`)
      // chipmate_change start
      console.log(`Running smoke test: ${binaryPath} --pure models anthropic`)
      await smokeModels(binaryPath)
      console.log("Models snapshot smoke test passed")
      await ChipMateSandboxWorker.smoke(binaryPath)
      console.log("ChipMate sandbox mutation worker smoke test passed")
      // chipmate_change end
      // chipmate_change start
    } catch (e) {
      console.error(`Smoke test failed for ${name}:`, e)
      process.exit(1)
    }
  }
  // chipmate_change end

  await $`rm -rf ./dist/${name}/bin/tui`
  // chipmate_change start
  if (item.os === "linux") {
    const content = await Promise.all([
      Bun.file(path.resolve(dir, "../../LICENSE")).text(),
      Bun.file(path.resolve(dir, `dist/${name}/bin/licenses/sandbox-runtime/LICENSE`)).text(),
      ...(bwrap
        ? ["NOTICE", "COPYING", "MUSL-COPYRIGHT"].map((file) =>
            Bun.file(path.resolve(dir, `dist/${name}/bin/licenses/bubblewrap/${file}`)).text(),
          )
        : []),
    ])
    await Bun.write(`dist/${name}/LICENSE`, content.join("\n\n---\n\n"))
  }
  // chipmate_change end
  await Bun.file(`dist/${name}/package.json`).write(
    JSON.stringify(
      {
        name,
        version: Script.version,
        license: item.os === "linux" ? "SEE LICENSE IN LICENSE" : pkg.license, // chipmate_change
        preferUnplugged: true,
        os: [item.os],
        cpu: [item.arch],
        // chipmate_change start
        keywords: pkg.keywords,
        private: pkg.private,
        repository: {
          type: "git",
          url: "https://github.com/ChipMate-Org/chipmate",
        },
        // chipmate_change end
        ...(item.abi ? { libc: [item.abi] } : {}),
      },
      null,
      2,
    ),
  )
  binaries[name] = Script.version
}

if (Script.release && !skipReleaseUpload) { // chipmate_change
  const archives: string[] = [] // chipmate_change
  for (const key of Object.keys(binaries)) {
    const archive = key.replace(pkg.name, "chipmate") // chipmate_change
    if (key.includes("linux")) {
      // chipmate_change start
      const out = path.resolve("dist", `${archive}.tar.gz`)
      await $`tar -czf ${out} *`.cwd(`dist/${key}/bin`)
      archives.push(out)
      // chipmate_change end
    } else {
      // chipmate_change start
      const out = path.resolve("dist", `${archive}.zip`)
      await $`zip -r ${out} *`.cwd(`dist/${key}/bin`)
      archives.push(out)
      // chipmate_change end
    }
  }
  await $`gh release upload v${Script.version} ${archives} --clobber` // chipmate_change
}

export { binaries }

#!/usr/bin/env node

import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const dir = dirname(fileURLToPath(import.meta.url))
const out = resolve(process.argv[2] ?? join(dir, "fixtures"))
const run = process.argv[3] ?? "manual"

const files = {
  "项目 A 中文/main.cpp": `#include "counter.h"\n#include <iostream>\nint main() { Counter value; value.add(3); std::cout << value.total() << "\\n"; }\n`,
  "项目 A 中文/counter.h": `#pragma once\nclass Counter { public: void add(int value); int total() const; private: int sum = 0; };\n`,
  "项目 A 中文/counter.cpp": `#include "counter.h"\nvoid Counter::add(int value) { sum += value; }\nint Counter::total() const { return sum; }\n`,
  "project B space/main.cpp": `#include "meter.h"\n#include <iostream>\nint main() { Meter value; value.tick(); std::cout << value.read() << "\\n"; }\n`,
  "project B space/meter.h": `#pragma once\nclass Meter { public: void tick(); int read() const; private: int count = 41; };\n`,
  "project B space/meter.cpp": `#include "meter.h"\nvoid Meter::tick() { ++count; }\nint Meter::read() const { return count; }\n`,
  "docs/固定召回文档.md": `# ChipMate QA ${run}\n\n固定召回标记：QA-DOC-${run}.\n\n该文档仅用于隔离测试，不含真实项目数据。\n`,
  "skill/SKILL.md": `---\nname: qa-e2e-${run}\ndescription: Safe deterministic QA fixture.\n---\n\nReturn the literal text QA-SKILL-${run}. Do not read secrets or access the network.\n`,
  "extension/package.json": `${JSON.stringify({ name: `qa-e2e-${run}`, displayName: `QA E2E ${run}`, publisher: "chipmate-qa", version: "0.0.1", engines: { vscode: "^1.90.0" }, main: "extension.js", activationEvents: ["onCommand:qa-e2e.run"], contributes: { commands: [{ command: "qa-e2e.run", title: "QA E2E: Run" }] } }, null, 2)}\n`,
  "extension/extension.js": `const vscode = require("vscode")\nexports.activate = (context) => context.subscriptions.push(vscode.commands.registerCommand("qa-e2e.run", () => "QA-E2E-${run}"))\nexports.deactivate = () => undefined\n`,
}

for (const [name, content] of Object.entries(files)) {
  const path = join(out, name)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

const manifest = Object.entries(files).map(([name, content]) => ({
  path: name,
  bytes: Buffer.byteLength(content),
  sha256: createHash("sha256").update(content).digest("hex"),
}))
writeFileSync(join(out, "fixture-manifest.json"), `${JSON.stringify({ run, root: basename(out), files: manifest }, null, 2)}\n`)
process.stdout.write(`${JSON.stringify({ output: out, files: manifest.length })}\n`)

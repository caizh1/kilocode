import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CODE_GRAPH_SHORT_SNIPPET_MAX_CHARS } from "../../../../src/indexing/codegraph"
import { isCodeGraphSupportedPath, parseCodeGraphFile } from "../../../../src/indexing/codegraph/parser"
import {
  CodeGraphParserWorkerPool,
  resolveCodeGraphParserWorkerPath,
} from "../../../../src/indexing/codegraph/parser/worker-pool"

const source = `
#include <stdint.h>
#include "driver.h"

#define UART0_BASE 0x40000000u
#define UART0_CTRL_REG (*(volatile uint32_t *)(UART0_BASE + 0x00))
#define UART0_STATUS_REG (*(volatile uint32_t *)(UART0_BASE + 0x04))
#define BIT(x) (1u << (x))

typedef struct device {
  int id;
  void (*reset)(void);
} device_t;

struct packet {
  uint32_t len;
};

enum state {
  STATE_IDLE,
  STATE_BUSY,
};

extern int helper(int code);
int declared_only(uint32_t value);

static uint32_t global_count = 1;
static device_t dev = {
  .id = 7,
  .reset = reset_device,
};

static int work(int value)
{
  // fake_call();
  const char *name = "string_call()";
  if (prepare(value)) {
    return finish(value);
  }
err_cleanup:
  cleanup();
  return -1;
}
`

function graph() {
  return parseCodeGraphFile({
    workspacePath: "/tmp/ws",
    filePath: "src/driver.c",
    content: source,
    fileHash: "hash-1",
    updatedAt: "2026-06-10T00:00:00.000Z",
  })
}

describe("C/C++ code graph parser", () => {
  test("extracts includes and macros with line ranges", () => {
    const result = graph()

    expect(result.includes.map((item) => item.target)).toEqual(["stdint.h", "driver.h"])
    expect(result.includes.every((item) => item.startLine > 0 && item.endLine >= item.startLine)).toBe(true)
    expect(result.macros.map((item) => item.name)).toContain("UART0_CTRL_REG")
    expect(result.macros.find((item) => item.name === "BIT")?.parameters).toEqual(["x"])
    expect(result.macros.every((item) => item.startLine > 0 && item.endLine >= item.startLine)).toBe(true)
  })

  test("ignores preprocessor directives inside comments without changing real directive lines", () => {
    const content = [
      '#include "live.h"',
      "#define LIVE_VALUE 1",
      "/*",
      '#include "commented.h"',
      "#define COMMENTED_VALUE 1",
      "*/",
      'const char *raw = R"cfg(',
      "#include <string-only.h>",
      "#define STRING_ONLY_VALUE 1",
      ')cfg";',
      '#include "second.h" // trailing comment',
      '#define LIVE_URL "https://example.com/device"',
      "#define MULTI(a, \\",
      "              b) ((a) + (b))",
      "// #define LINE_COMMENTED_VALUE 1",
      "",
    ].join("\r\n")
    const result = parseCodeGraphFile({
      workspacePath: "/tmp/ws",
      filePath: "src/directives.cpp",
      content,
      fileHash: "hash-directives",
      updatedAt: "2026-06-10T00:00:00.000Z",
    })

    expect(result.includes.map((item) => item.target)).toEqual(["live.h", "second.h"])
    expect(result.includes.map((item) => item.startLine)).toEqual([1, 11])
    expect(result.macros.map((item) => item.name)).toEqual(["LIVE_VALUE", "LIVE_URL", "MULTI"])
    expect(result.macros.map((item) => item.startLine)).toEqual([2, 12, 13])
    expect(result.macros.find((item) => item.name === "MULTI")?.parameters).toEqual(["a", "b"])
    expect(result.includes.map((item) => item.target)).not.toContain("commented.h")
    expect(result.macros.map((item) => item.name)).not.toContain("COMMENTED_VALUE")
    expect(result.macros.map((item) => item.name)).not.toContain("STRING_ONLY_VALUE")
    expect(result.macros.map((item) => item.name)).not.toContain("LINE_COMMENTED_VALUE")
    expect(result.macros.find((item) => item.name === "LIVE_URL")?.shortSnippet).toContain("https://")
  })

  test("extracts functions, declarations, and masked call sites", () => {
    const result = graph()

    expect(result.functions.map((item) => item.name)).toEqual(["work"])
    expect(result.functions[0]?.signature).toContain("static int work")
    expect(result.declarations.map((item) => item.name)).toEqual(["helper", "declared_only"])
    expect(result.calls.map((item) => item.calleeName).sort()).toEqual(["cleanup", "finish", "prepare"])
    expect(result.calls.map((item) => item.calleeName)).not.toContain("fake_call")
    expect(result.calls.map((item) => item.calleeName)).not.toContain("string_call")
    expect(result.calls.every((item) => item.startLine > 0 && item.endLine >= item.startLine)).toBe(true)
  })

  test("extracts types, globals, initializers, labels, and register/MMIO families", () => {
    const result = graph()

    expect(result.types.map((item) => `${item.kind}:${item.name}`)).toContain("struct:device")
    expect(result.types.map((item) => `${item.kind}:${item.name}`)).toContain("typedef:device_t")
    expect(result.types.map((item) => `${item.kind}:${item.name}`)).toContain("struct:packet")
    expect(result.types.map((item) => `${item.kind}:${item.name}`)).toContain("enum:state")
    expect(result.types.map((item) => item.name)).not.toContain("id")
    expect(result.types.find((item) => item.name === "device_t")?.fields?.map((item) => item.name)).toContain("id")
    expect(result.globals.map((item) => item.name)).toContain("global_count")
    expect(result.initializers[0]?.fields).toEqual(["id", "reset"])
    expect(result.labels[0]).toMatchObject({
      name: "err_cleanup",
      kind: "error_label",
      cleanupCalls: ["cleanup"],
    })
    expect(result.registerMacroFamilies.some((item) => item.mmioIdentifiers.includes("UART0_CTRL_REG"))).toBe(true)
  })

  test("keeps snippets short and rejects unsupported extensions", () => {
    const result = graph()

    expect(result.functions[0]?.shortSnippet?.length).toBeLessThanOrEqual(CODE_GRAPH_SHORT_SNIPPET_MAX_CHARS)
    expect(result.functions[0]?.shortSnippet).not.toContain("cleanup();")
    expect(isCodeGraphSupportedPath("src/main.rs")).toBe(false)
    expect(() =>
      parseCodeGraphFile({
        workspacePath: "/tmp/ws",
        filePath: "src/main.rs",
        content: source,
        fileHash: "hash-1",
      }),
    ).toThrow("Unsupported code graph file extension")
  })

  test("parses through the worker pool with synchronous fallback available", async () => {
    const pool = new CodeGraphParserWorkerPool()
    try {
      const result = await pool.parse(
        {
          workspacePath: "/tmp/ws",
          filePath: "src/driver.c",
          content: source,
          fileHash: "hash-1",
          updatedAt: "2026-06-10T00:00:00.000Z",
        },
        2,
      )

      expect(result.graph.functions.map((item) => item.name)).toEqual(["work"])
      expect(typeof result.worker).toBe("boolean")
    } finally {
      pool.dispose()
    }
  })

  test("resolves packaged relative parser worker paths from the binary directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codegraph-worker-"))
    const info = resolveCodeGraphParserWorkerPath({ workerPath: "codegraph-parser-worker.mjs", baseDir: dir })

    expect(info.mode).toBe("packaged")
    expect(info.path).toBe(join(dir, "codegraph-parser-worker.mjs"))
    expect(info.exists).toBe(false)
  })

  test("reports healthy packaged parser workers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codegraph-worker-"))
    await Bun.write(
      join(dir, "codegraph-parser-worker.mjs"),
      [
        'import { parentPort } from "node:worker_threads"',
        'parentPort.on("message", (msg) => {',
        '  if (msg.type === "health") parentPort.postMessage({ id: msg.id, ok: true, data: { healthy: true } })',
        "})",
        "",
      ].join("\n"),
    )
    const pool = new CodeGraphParserWorkerPool({
      workerPath: "codegraph-parser-worker.mjs",
      baseDir: dir,
      timeoutMs: 1_000,
    })
    try {
      const health = await pool.health(1)
      expect(health).toMatchObject({
        healthy: true,
        workers: 1,
        mode: "packaged",
        path: join(dir, "codegraph-parser-worker.mjs"),
      })
    } finally {
      pool.dispose()
    }
  })

  test("falls back once when the packaged parser worker is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codegraph-worker-"))
    const pool = new CodeGraphParserWorkerPool({
      workerPath: "missing-worker.mjs",
      baseDir: dir,
      timeoutMs: 200,
    })
    try {
      const result = await pool.parse(
        {
          workspacePath: "/tmp/ws",
          filePath: "src/driver.c",
          content: source,
          fileHash: "hash-1",
          updatedAt: "2026-06-10T00:00:00.000Z",
        },
        1,
      )
      const first = pool.takeFallbackReason()

      expect(result.worker).toBe(false)
      expect(result.graph.functions.map((item) => item.name)).toEqual(["work"])
      expect(first).toContain("missing-worker.mjs")
      expect(pool.takeFallbackReason()).toBeUndefined()
    } finally {
      pool.dispose()
    }
  })
})

import { describe, expect, test } from "bun:test"
import { CODE_GRAPH_SHORT_SNIPPET_MAX_CHARS } from "../../../../src/indexing/codegraph"
import { isCodeGraphSupportedPath, parseCodeGraphFile } from "../../../../src/indexing/codegraph/parser"

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
})

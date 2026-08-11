import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Config } from "@/config/config"

describe("Config.Info experimental DSML repair", () => {
  test("is absent and disabled by default", () => {
    const cfg = Schema.decodeUnknownSync(Config.Info)({})
    expect(cfg.experimental?.dsml_tool_call_repair).toBeUndefined()
  })

  test("accepts an exact provider and model target", () => {
    const cfg = Schema.decodeUnknownSync(Config.Info)({
      experimental: {
        dsml_tool_call_repair: {
          enabled: true,
          model: "internal/deepseek-v4",
        },
      },
    })
    expect(cfg.experimental?.dsml_tool_call_repair).toEqual({
      enabled: true,
      model: "internal/deepseek-v4",
    })
  })

  test("rejects invalid field types", () => {
    expect(() =>
      Schema.decodeUnknownSync(Config.Info)({
        experimental: { dsml_tool_call_repair: { enabled: "true", model: 1 } },
      }),
    ).toThrow()
  })
})

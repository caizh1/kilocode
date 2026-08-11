import { describe, expect, test } from "bun:test"
import { validateReaderContent } from "@/chipmate/design-doc/reader-validator"

describe("DesignDoc 面向读者内容校验", () => {
  test("拒绝图和正文中的内部流水线术语", () => {
    const issues = validateReaderContent({
      moduleID: "MOD-root",
      title: "NVMe 模块结构",
      nodes: [{ id: "node-1", label: "MOD-a 设计单元" }],
      summary: "该 WorkItem 使用代表性采样。",
    })

    expect(issues.map((item) => item.code)).toEqual(["INTERNAL_PIPELINE_TERM", "INTERNAL_PIPELINE_TERM"])
    expect(issues.map((item) => item.jsonPath)).toEqual(["$.nodes[0].label", "$.summary"])
  })

  test("拒绝人为截断，但不扫描源码内部标识字段", () => {
    const issues = validateReaderContent({
      moduleID: "MOD-root",
      sourceRef: "flow-node...printf(...) ",
      summary: "处理初始化、命令分发与完成上报…",
    })

    expect(issues).toHaveLength(1)
    expect(issues[0]?.code).toBe("TRUNCATED_READER_TEXT")
    expect(issues[0]?.jsonPath).toBe("$.summary")
  })
})

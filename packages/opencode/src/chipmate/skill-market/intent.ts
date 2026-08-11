// chipmate_change - new file
import type { SessionV1 } from "@opencode-ai/core/v1/session"

export namespace SkillMarketIntent {
  export const tools = new Set([
    "skill_market_search",
    "skill_market_install",
    "skill_create",
    "skill_market_publish",
    "skill_transaction",
  ])

  export type ToolID =
    | "skill_market_search"
    | "skill_market_install"
    | "skill_create"
    | "skill_market_publish"
    | "skill_transaction"

  const anchor = /(?:\bskill(?:\s+market)?\b|技能(?:市场)?)/i
  const informative =
    /(?:什么是|如何|怎么(?:样)?|解释|为什么|原理|设计|区别|机制|教程|文档|how\s+(?:do|does|to)|what\s+is|why\b|explain|design|difference|mechanism|tutorial)/i
  const diagnostic = /(?:代码|日志|报错|错误|失败|文档|示例|review|analyse|analyze|log|error|failed|failure)/i
  const request = /(?:帮我|请(?:你)?|给我|替我|我要|我想让你|直接|现在|please|can\s+you|could\s+you|i\s+want\s+you\s+to)/i
  const command =
    /(?:(?:帮我|请(?:你)?|给我|替我|我要(?:你)?|我想让你|直接|现在)\s*(?:在[^\n]{0,20}(?:skill|技能)市场(?:里|中)?\s*)?(?:找|查找|搜索|安装|创建|新建|写|生成|制作|上传|发布|上架|撤销|回退|回滚)|(?:please|can\s+you|could\s+you|i\s+want\s+you\s+to)\s*(?:search|find|install|create|write|generate|publish|upload|undo|rollback|revert)|^(?:请(?:你)?\s*)?(?:找|查找|搜索|安装|创建|新建|写|生成|制作|上传|发布|上架|撤销|回退|回滚|search|find|install|create|write|generate|publish|upload|undo|rollback|revert)|(?:把|将)[^\n]{0,30}(?:skill|技能)[^\n]{0,30}(?:安装|创建|上传|发布|上架|撤销|回退|回滚))/i
  const search = /(?:有没有|是否有|找(?:一下|找)?|查找|搜索|检索|相关|search|find|look\s+for)/i
  const install = /(?:安装|装上|导入|install|add)/i
  const create = /(?:创建|新建|写(?:一个|个)?|生成|制作|create|write|generate|build)/i
  const publish = /(?:上传|发布|上架|同步到.*市场|publish|upload)/i
  const undo = /(?:撤销|回退|回滚|恢复到|删除发布|undo|roll\s*back|rollback|revert)/i
  const transaction = /(?:提交事务|中止事务|事务状态|清理事务|commit|abort|transaction\s+status|purge)/i

  export function classify(text: string, recent = false): Set<ToolID> {
    const value = text.trim()
    if (!value) return new Set()
    const linked = anchor.test(value) || recent
    if (!linked) return new Set()
    if (informative.test(value) && !request.test(value) && !undo.test(value)) return new Set()
    const lookup = anchor.test(value) && search.test(value)
    const execute = command.test(value) || lookup
    if (!execute) return new Set()
    if (diagnostic.test(value) && !command.test(value) && !undo.test(value)) return new Set()

    const result = new Set<ToolID>()
    const searching = search.test(value)
    if (searching) result.add("skill_market_search")
    if (install.test(value)) {
      result.add("skill_market_install")
      result.add("skill_transaction")
    }
    if (create.test(value) && (!searching || /(?:并|然后|and\s+then).*(?:创建|新建|写|生成|制作|create|write|generate|build)/i.test(value))) {
      result.add("skill_create")
      result.add("skill_transaction")
    }
    if (publish.test(value)) {
      result.add("skill_market_publish")
      result.add("skill_transaction")
    }
    if (undo.test(value) || transaction.test(value)) result.add("skill_transaction")
    return result
  }

  export function visible(messages: SessionV1.WithParts[]): Set<ToolID> {
    const user = messages.findLast((message) => message.info.role === "user")
    const text = user?.parts
      .flatMap((part) =>
        part.type === "text" && !part.ignored && !part.synthetic && part.text.trim() ? [part.text] : [],
      )
      .join("\n")
    const recent = messages
      .slice(Math.max(0, messages.length - 6))
      .some((message) => message.parts.some((part) => part.type === "tool" && tools.has(part.tool)))
    return classify(text ?? "", recent)
  }

  export function filter<T extends { id: string }>(items: T[], messages: SessionV1.WithParts[]): T[] {
    const allow = visible(messages)
    return items.filter((item) => !tools.has(item.id) || allow.has(item.id as ToolID))
  }

  export function allows(id: ToolID, messages: SessionV1.WithParts[]): boolean {
    return visible(messages).has(id)
  }
}

import type { CommandIntroductionRequest, CommandIntroductionResponse } from "../shared/command-introduction"

type Storage = { get<T>(key: string): T | undefined; update(key: string, value: boolean): PromiseLike<void> }
const key = "commandIntroduction.spec.seen"
const stores = new WeakMap<Storage, CommandIntroductionStore>()

export class CommandIntroductionStore {
  private seen: boolean
  private pending?: { owner: object; id: string; until: number }

  constructor(
    private readonly storage: Storage,
    private readonly now = () => performance.now(),
  ) {
    this.seen = storage.get<boolean>(key) === true
  }

  async handle(owner: object, message: CommandIntroductionRequest): Promise<CommandIntroductionResponse | undefined> {
    if (message.introduction !== "spec") return
    if (message.action === "claim") {
      const available = !this.pending || this.pending.until <= this.now()
      const granted = available && (message.manual === true || !this.seen)
      if (granted) this.pending = { owner, id: message.requestID, until: this.now() + 15000 }
      return {
        type: "commandIntroductionResult",
        requestID: message.requestID,
        granted,
        // 仅为旧界面保留墙上时钟字段；新界面自行计算请求耗时。
        expiresAt: granted ? Date.now() + 15000 : undefined,
      }
    }
    if (this.pending?.owner !== owner || this.pending.id !== message.requestID) return
    if (message.action === "release") {
      this.pending = undefined
      return
    }
    if (message.action !== "displayed") return
    if (this.pending.until <= this.now()) {
      this.pending = undefined
      return
    }
    this.seen = true
    this.pending = undefined
    try {
      await this.storage.update(key, true)
    } catch (error) {
      // 保存失败仍保留当前宿主内的展示状态，不能影响输入或发送。
      console.warn("[ChipMate New] 流程介绍展示状态保存失败", error instanceof Error ? error.name : "存储错误")
    }
  }

  release(owner: object) {
    if (this.pending?.owner === owner) this.pending = undefined
  }
}

export function introductionStore(storage: Storage) {
  const existing = stores.get(storage)
  if (existing) return existing
  const store = new CommandIntroductionStore(storage)
  stores.set(storage, store)
  return store
}

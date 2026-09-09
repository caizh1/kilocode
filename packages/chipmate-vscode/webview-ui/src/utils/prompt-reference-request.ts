/** 选择器返回前发生编辑、切换或销毁时，旧请求不得改写当前草稿。 */
export function createReferenceRequest() {
  let pending: { id: string; scope: string; text: string; start: number; end: number } | undefined
  return {
    begin(scope: string, text: string, start: number, end: number) {
      pending = { id: crypto.randomUUID(), scope, text, start, end }
      return pending.id
    },
    read(id: string, scope: string, text: string) {
      if (!pending || pending.id !== id || pending.scope !== scope || pending.text !== text) return
      return pending
    },
    clear() {
      pending = undefined
    },
  }
}

// 全部自绘页面共享一次原生 API 获取，避免独立入口重复获取失败。
type Api = {
  postMessage(message: unknown): void
  getState(): unknown
  setState(value: unknown): void
}
const state = globalThis as typeof globalThis & { __chipmateWebviewApi?: Api }
export function acquireAppearanceApi(): Api {
  if (!state.__chipmateWebviewApi) state.__chipmateWebviewApi = acquireVsCodeApi()
  return state.__chipmateWebviewApi
}

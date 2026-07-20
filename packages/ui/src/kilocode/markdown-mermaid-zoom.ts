const MIN = 0.25
const MAX = 6
const STEP = 0.25

export function clampMermaidZoom(value: number) {
  if (!Number.isFinite(value)) return 1
  return Math.min(MAX, Math.max(MIN, Math.round(value / STEP) * STEP))
}

export function fitMermaidZoom(view: { width: number; height: number }, dims: { width: number; height: number }) {
  if (view.width <= 0 || view.height <= 0 || dims.width <= 0 || dims.height <= 0) return 1
  return clampMermaidZoom(Math.min(1, view.width / dims.width, view.height / dims.height))
}

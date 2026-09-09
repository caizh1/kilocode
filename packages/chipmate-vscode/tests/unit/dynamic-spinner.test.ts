import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { cycle, next, sequence, variants } from "../../../chipmate-ui/src/components/spinner-sequence"
import { resolveReducedMotion } from "../../../chipmate-ui/src/hooks/use-reduced-motion"

const root = path.resolve(import.meta.dir, "../../..")
const component = fs.readFileSync(path.join(root, "chipmate-ui/src/components/dynamic-spinner.tsx"), "utf8")
const styles = fs.readFileSync(path.join(root, "chipmate-ui/src/components/dynamic-spinner.css"), "utf8")
const assets = path.join(root, "chipmate-vscode/assets/loading-motion")
const indicator = fs.readFileSync(
  path.join(root, "chipmate-vscode/webview-ui/src/components/shared/WorkingIndicator.tsx"),
  "utf8",
)
const layers = {
  signal: ["capsule", "glint"],
  prism: ["a", "b", "c", "flare"],
} as const

function png(file: string) {
  const data = fs.readFileSync(file)
  expect(data.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a")
  expect([data.readUInt32BE(16), data.readUInt32BE(20)]).toEqual([96, 96])
  expect([4, 6]).toContain(data[25])
  return data.byteLength
}

function webp(file: string) {
  const data = fs.readFileSync(file)
  expect(data.subarray(0, 4).toString()).toBe("RIFF")
  expect(data.subarray(8, 12).toString()).toBe("WEBP")
  const times: number[] = []
  let offset = 12

  while (offset + 8 <= data.byteLength) {
    const kind = data.subarray(offset, offset + 4).toString()
    const size = data.readUInt32LE(offset + 4)
    if (kind === "ANMF") {
      const start = offset + 20
      times.push(data[start] | (data[start + 1] << 8) | (data[start + 2] << 16))
    }
    offset += 8 + size + (size % 2)
  }

  return { size: data.byteLength, times }
}

describe("dynamic spinner sequence", () => {
  it("returns every variant once per bag", () => {
    const next = sequence(() => 0.25)

    for (let cycle = 0; cycle < 4; cycle++) {
      const values = Array.from({ length: variants.length }, next)
      expect(new Set(values)).toEqual(new Set(variants))
    }
  })

  it("does not repeat across bag boundaries", () => {
    const values = [0, 0.9, 0.1, 0.7, 0.2, 0.8]
    let index = 0
    const next = sequence(() => values[index++ % values.length])
    const results = Array.from({ length: variants.length * 8 }, next)

    for (let i = 1; i < results.length; i++) {
      expect(results[i]).not.toBe(results[i - 1])
    }
  })

  it("isolates the working indicator bag from unrelated spinner mounts", () => {
    const scope = "working-indicator-test"
    const results = Array.from({ length: variants.length }, () => {
      next()
      next("unrelated-test")
      return next(scope)
    })

    expect(new Set(results)).toEqual(new Set(variants))
  })

  it("keeps one variant through remounts and advances without an idle release", () => {
    const scope = "working-lifecycle-test"
    const results = variants.map((_, index) => {
      const key = 1000 + index
      const value = cycle(key, scope)
      expect(cycle(key, scope)).toBe(value)
      expect(cycle(key, scope)).toBe(value)
      return value
    })

    expect(new Set(results)).toEqual(new Set(variants))
  })

  it("assigns distinct variants to three concurrent session lifecycles", () => {
    const scope = "parallel-session-test"
    const sessions = [1700000000001, 1700000000002, 1700000000003]
    const results = sessions.map((key) => cycle(key, scope))

    expect(new Set(results).size).toBe(3)
    expect(sessions.map((key) => cycle(key, scope))).toEqual(results)
  })
})

describe("dynamic spinner component contract", () => {
  it("uses the VS Code effective motion preference before the raw OS media query", () => {
    expect(resolveReducedMotion(true, undefined)).toBe(true)
    expect(resolveReducedMotion(false, undefined)).toBe(false)
    expect(resolveReducedMotion(true, false)).toBe(false)
    expect(resolveReducedMotion(false, true)).toBe(true)
  })

  it("keeps existing spinner hooks and supports explicit variants", () => {
    expect(component).toContain('data-component="spinner"')
    expect(component).toContain("data-spinner-variant")
    expect(component).toContain('aria-hidden="true"')
    expect(component).toContain("variant?: SpinnerVariant")
    expect(component).toContain("assetBase?: string")
    expect(component).toContain("scope?: string")
    expect(component).toContain("const variant = local.variant ?? next(local.scope)")
  })

  it("uses image assets in normal flow with accessible fallbacks", () => {
    expect(component).toContain('data-slot="spinner-still"')
    expect(component).toContain('data-slot="spinner-motion"')
    expect(component).toContain("<SystemSpinner")
    expect(component).not.toContain("<svg")
    expect(styles).toContain("display: inline-grid")
    expect(styles).not.toContain("position: absolute")
    expect(styles).toContain("body.vscode-reduce-motion")
    expect(styles).toContain("body:not([data-vscode-theme-id])")
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)")
    expect(styles).toContain("@media (forced-colors: active)")
  })

  it("ships complete 96px dual-theme material assets", () => {
    let total = 0

    for (const theme of ["dark", "light"]) {
      for (const variant of variants) {
        total += png(path.join(assets, theme, `${variant}.png`))
      }

      for (const [variant, names] of Object.entries(layers)) {
        for (const name of names) {
          total += png(path.join(assets, theme, `${variant}-${name}.png`))
        }
      }
    }

    expect(total).toBeLessThanOrEqual(1_000_000)
  })

  it("ships seamless 60fps-class Orbital and Liquid animations", () => {
    for (const theme of ["dark", "light"]) {
      const orbital = webp(path.join(assets, theme, "orbital.webp"))
      expect(orbital.times).toHaveLength(96)
      expect(orbital.times.reduce((sum, value) => sum + value, 0)).toBe(1600)
      expect(Math.max(...orbital.times)).toBeLessThanOrEqual(17)
      expect(orbital.size).toBeLessThanOrEqual(600_000)

      const motion = webp(path.join(assets, theme, "liquid.webp"))
      expect(motion.times).toHaveLength(108)
      expect(motion.times.reduce((sum, value) => sum + value, 0)).toBe(1800)
      expect(Math.max(...motion.times)).toBeLessThanOrEqual(17)
      expect(motion.size).toBeLessThanOrEqual(300_000)
    }
  })

  it("keeps theme, reduced-motion, and resource-error fallbacks wired", () => {
    expect(component).toContain('body.contains("vscode-light")')
    expect(component).toContain('body.contains("vscode-high-contrast")')
    expect(component).toContain('window.matchMedia("(forced-colors: active)")')
    expect(component).toContain("theme() !== \"contrast\"")
    expect(component).toContain("!reduced() && !failed()")
    expect(component).toContain("onError={() => setStillFailed(true)}")
    expect(component).toContain("setFailed(true)")
    expect(component).toContain("failed() && !reduced()")
  })

  it("uses compositor motion for Orbital, Signal, and Prism", () => {
    expect(component).toContain("data-motion={props.variant}")
    expect(component).toContain('props.variant === "liquid" || props.variant === "orbital"')
    expect(component).toContain('data-motion="signal"')
    expect(component).toContain('data-motion="prism"')
    expect(styles).toContain("chipmate-signal-fold")
    expect(styles).toContain("chipmate-prism-a")
    expect(styles).not.toContain("chipmate-orbital-outer")
    expect(styles).toContain("will-change: opacity, transform")
    expect(styles).not.toContain("position: absolute")
  })

  it("uses a larger spinner only in the working status row", () => {
    expect(indicator).toContain('cycle(session.busySince(), "working-indicator")')
    expect(indicator).not.toContain("setTimeout(() => hold")
    expect(indicator).toContain('class="working-spinner"')
    expect(indicator).toContain('style={{ width: "24px", height: "24px" }}')
  })
})

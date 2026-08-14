import { describe, expect, it } from "bun:test"
import { formatWorkingElapsed, tracksElapsed } from "../../webview-ui/src/components/shared/working-indicator-utils"

const dictionaries = {
  en: {
    "session.turn.duration.seconds": "{{seconds}}s",
    "session.turn.duration.minutes": "{{minutes}}m {{seconds}}s",
  },
  zh: {
    "session.turn.duration.seconds": "{{seconds}}秒",
    "session.turn.duration.minutes": "{{minutes}}分{{seconds}}秒",
  },
} as const

function translate(locale: keyof typeof dictionaries) {
  return (key: string, params: Record<string, string | number>) => {
    const template = dictionaries[locale][key as keyof (typeof dictionaries)[typeof locale]]
    return Object.entries(params).reduce((value, [name, replacement]) => {
      return value.replace(`{{${name}}}`, String(replacement))
    }, template)
  }
}

describe("tracksElapsed", () => {
  it("tracks pending submissions before backend status arrives", () => {
    expect(tracksElapsed("idle", true, 1)).toBe(true)
  })

  it("tracks active backend statuses", () => {
    expect(tracksElapsed("busy", false, 1)).toBe(true)
    expect(tracksElapsed("retry", false, 1)).toBe(true)
    expect(tracksElapsed("offline", false, 1)).toBe(true)
  })

  it("stops for idle sessions and missing start times", () => {
    expect(tracksElapsed("idle", false, 1)).toBe(false)
    expect(tracksElapsed("busy", false, undefined)).toBe(false)
    expect(tracksElapsed("idle", true, undefined)).toBe(false)
  })
})

describe("formatWorkingElapsed", () => {
  it("formats Chinese elapsed time from the first second", () => {
    expect(formatWorkingElapsed(1, translate("zh"))).toBe("1秒")
    expect(formatWorkingElapsed(59, translate("zh"))).toBe("59秒")
  })

  it("pads seconds after the minute boundary", () => {
    expect(formatWorkingElapsed(60, translate("zh"))).toBe("1分00秒")
    expect(formatWorkingElapsed(84, translate("zh"))).toBe("1分24秒")
  })

  it("uses the English locale template", () => {
    expect(formatWorkingElapsed(84, translate("en"))).toBe("1m 24s")
  })
})

/**
 * Language context
 * Provides i18n translations for chipmate-ui components.
 * Merges UI translations from @opencode-ai/ui and ChipMate overrides from @chipmate/chipmate-i18n.
 *
 * Locale priority: user override → VS Code display language → browser language → "en"
 */

import { createSignal, createMemo, createEffect, ParentComponent, Accessor } from "solid-js"
import { I18nProvider } from "@chipmate/chipmate-ui/context"
import type { UiI18nKey, UiI18nParams } from "@chipmate/chipmate-ui/context"
import { dict as uiEn } from "@chipmate/chipmate-ui/i18n/en"
import { dict as uiZh } from "@chipmate/chipmate-ui/i18n/zh"
import { dict as uiZht } from "@chipmate/chipmate-ui/i18n/zht"
import { dict as uiKo } from "@chipmate/chipmate-ui/i18n/ko"
import { dict as uiDe } from "@chipmate/chipmate-ui/i18n/de"
import { dict as uiEs } from "@chipmate/chipmate-ui/i18n/es"
import { dict as uiFr } from "@chipmate/chipmate-ui/i18n/fr"
import { dict as uiDa } from "@chipmate/chipmate-ui/i18n/da"
import { dict as uiJa } from "@chipmate/chipmate-ui/i18n/ja"
import { dict as uiPl } from "@chipmate/chipmate-ui/i18n/pl"
import { dict as uiRu } from "@chipmate/chipmate-ui/i18n/ru"
import { dict as uiAr } from "@chipmate/chipmate-ui/i18n/ar"
import { dict as uiNo } from "@chipmate/chipmate-ui/i18n/no"
import { dict as uiBr } from "@chipmate/chipmate-ui/i18n/br"
import { dict as uiTh } from "@chipmate/chipmate-ui/i18n/th"
import { dict as uiBs } from "@chipmate/chipmate-ui/i18n/bs"
import { dict as uiTr } from "@chipmate/chipmate-ui/i18n/tr"
import { dict as uiNl } from "@chipmate/chipmate-ui/i18n/nl"
import { dict as uiUk } from "@chipmate/chipmate-ui/i18n/uk"
import { dict as uiIt } from "@chipmate/chipmate-ui/i18n/it"
import { dict as appEn } from "../i18n/en"
import { dict as appZh } from "../i18n/zh"
import { dict as appZht } from "../i18n/zht"
import { dict as appKo } from "../i18n/ko"
import { dict as appDe } from "../i18n/de"
import { dict as appEs } from "../i18n/es"
import { dict as appFr } from "../i18n/fr"
import { dict as appDa } from "../i18n/da"
import { dict as appJa } from "../i18n/ja"
import { dict as appPl } from "../i18n/pl"
import { dict as appRu } from "../i18n/ru"
import { dict as appAr } from "../i18n/ar"
import { dict as appNo } from "../i18n/no"
import { dict as appBr } from "../i18n/br"
import { dict as appTh } from "../i18n/th"
import { dict as appBs } from "../i18n/bs"
import { dict as appTr } from "../i18n/tr"
import { dict as appNl } from "../i18n/nl"
import { dict as appUk } from "../i18n/uk"
import { dict as appIt } from "../i18n/it"
import { dict as amEn } from "../../agent-manager/i18n/en"
import { dict as amZh } from "../../agent-manager/i18n/zh"
import { dict as amZht } from "../../agent-manager/i18n/zht"
import { dict as amKo } from "../../agent-manager/i18n/ko"
import { dict as amDe } from "../../agent-manager/i18n/de"
import { dict as amEs } from "../../agent-manager/i18n/es"
import { dict as amFr } from "../../agent-manager/i18n/fr"
import { dict as amDa } from "../../agent-manager/i18n/da"
import { dict as amJa } from "../../agent-manager/i18n/ja"
import { dict as amPl } from "../../agent-manager/i18n/pl"
import { dict as amRu } from "../../agent-manager/i18n/ru"
import { dict as amAr } from "../../agent-manager/i18n/ar"
import { dict as amNo } from "../../agent-manager/i18n/no"
import { dict as amBr } from "../../agent-manager/i18n/br"
import { dict as amTh } from "../../agent-manager/i18n/th"
import { dict as amBs } from "../../agent-manager/i18n/bs"
import { dict as amTr } from "../../agent-manager/i18n/tr"
import { dict as amNl } from "../../agent-manager/i18n/nl"
import { dict as amUk } from "../../agent-manager/i18n/uk"
import { dict as amIt } from "../../agent-manager/i18n/it"
import { dict as chipmateEn } from "@chipmate/chipmate-i18n/en"
import { dict as chipmateZh } from "@chipmate/chipmate-i18n/zh"
import { dict as chipmateZht } from "@chipmate/chipmate-i18n/zht"
import { dict as chipmateKo } from "@chipmate/chipmate-i18n/ko"
import { dict as chipmateDe } from "@chipmate/chipmate-i18n/de"
import { dict as chipmateEs } from "@chipmate/chipmate-i18n/es"
import { dict as chipmateFr } from "@chipmate/chipmate-i18n/fr"
import { dict as chipmateDa } from "@chipmate/chipmate-i18n/da"
import { dict as chipmateJa } from "@chipmate/chipmate-i18n/ja"
import { dict as chipmatePl } from "@chipmate/chipmate-i18n/pl"
import { dict as chipmateRu } from "@chipmate/chipmate-i18n/ru"
import { dict as chipmateAr } from "@chipmate/chipmate-i18n/ar"
import { dict as chipmateNo } from "@chipmate/chipmate-i18n/no"
import { dict as chipmateBr } from "@chipmate/chipmate-i18n/br"
import { dict as chipmateTh } from "@chipmate/chipmate-i18n/th"
import { dict as chipmateBs } from "@chipmate/chipmate-i18n/bs"
import { dict as chipmateTr } from "@chipmate/chipmate-i18n/tr"
import { dict as chipmateNl } from "@chipmate/chipmate-i18n/nl"
import { dict as chipmateUk } from "@chipmate/chipmate-i18n/uk"
import { dict as chipmateIt } from "@chipmate/chipmate-i18n/it"
import { useVSCode } from "./vscode"
import { normalizeLocale as _normalizeLocale, resolveTemplate as _resolveTemplate } from "./language-utils"

export type { Locale } from "./language-utils"
export { LOCALES } from "./language-utils"
import type { Locale } from "./language-utils"
import { LOCALES, RTL_LOCALES, localeToBcp47 } from "./language-utils"

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  zh: "简体中文",
  zht: "繁體中文",
  ko: "한국어",
  de: "Deutsch",
  es: "Español",
  fr: "Français",
  da: "Dansk",
  ja: "日本語",
  pl: "Polski",
  ru: "Русский",
  ar: "العربية",
  no: "Norsk",
  br: "Português (Brasil)",
  th: "ภาษาไทย",
  bs: "Bosanski",
  tr: "Türkçe",
  nl: "Nederlands",
  uk: "Українська",
  it: "Italiano",
}

// Merge 4 dict layers: app + ui + chipmate + agent manager (chipmate and agent manager override last)
const base = { ...appEn, ...uiEn, ...chipmateEn }
const dicts: Record<Locale, Record<string, string>> = {
  en: { ...base, ...amEn },
  zh: { ...base, ...appZh, ...uiZh, ...chipmateZh, ...amEn, ...amZh },
  zht: { ...base, ...appZht, ...uiZht, ...chipmateZht, ...amEn, ...amZht },
  ko: { ...base, ...appKo, ...uiKo, ...chipmateKo, ...amEn, ...amKo },
  de: { ...base, ...appDe, ...uiDe, ...chipmateDe, ...amEn, ...amDe },
  es: { ...base, ...appEs, ...uiEs, ...chipmateEs, ...amEn, ...amEs },
  fr: { ...base, ...appFr, ...uiFr, ...chipmateFr, ...amEn, ...amFr },
  da: { ...base, ...appDa, ...uiDa, ...chipmateDa, ...amEn, ...amDa },
  ja: { ...base, ...appJa, ...uiJa, ...chipmateJa, ...amEn, ...amJa },
  pl: { ...base, ...appPl, ...uiPl, ...chipmatePl, ...amEn, ...amPl },
  ru: { ...base, ...appRu, ...uiRu, ...chipmateRu, ...amEn, ...amRu },
  ar: { ...base, ...appAr, ...uiAr, ...chipmateAr, ...amEn, ...amAr },
  no: { ...base, ...appNo, ...uiNo, ...chipmateNo, ...amEn, ...amNo },
  br: { ...base, ...appBr, ...uiBr, ...chipmateBr, ...amEn, ...amBr },
  th: { ...base, ...appTh, ...uiTh, ...chipmateTh, ...amEn, ...amTh },
  bs: { ...base, ...appBs, ...uiBs, ...chipmateBs, ...amEn, ...amBs },
  tr: { ...base, ...appTr, ...uiTr, ...chipmateTr, ...amEn, ...amTr },
  nl: { ...base, ...appNl, ...uiNl, ...chipmateNl, ...amEn, ...amNl },
  uk: { ...base, ...appUk, ...uiUk, ...chipmateUk, ...amEn, ...amUk },
  it: { ...base, ...appIt, ...uiIt, ...chipmateIt, ...amEn, ...amIt },
}

function normalizeLocale(lang: string): Locale {
  return _normalizeLocale(lang)
}

function resolveTemplate(text: string, params?: UiI18nParams) {
  return _resolveTemplate(text, params as Record<string, string | number | boolean | undefined>)
}

interface LanguageProviderProps {
  vscodeLanguage?: Accessor<string | undefined>
  languageOverride?: Accessor<string | undefined>
}

export const LanguageProvider: ParentComponent<LanguageProviderProps> = (props) => {
  const vscode = useVSCode()
  const [userOverride, setUserOverride] = createSignal<Locale | "">("")

  // Initialize from extension-side override
  createEffect(() => {
    const override = props.languageOverride?.()
    if (override !== undefined) setUserOverride(override ? normalizeLocale(override) : "")
  })

  // Resolved locale: user override → VS Code language → browser language → "en"
  const locale = createMemo<Locale>(() => {
    const override = userOverride()
    if (override) {
      return override
    }
    const vscodeLang = props.vscodeLanguage?.()
    if (vscodeLang) {
      return normalizeLocale(vscodeLang)
    }
    if (typeof navigator !== "undefined" && navigator.language) {
      return normalizeLocale(navigator.language)
    }
    return "en"
  })

  const dict = createMemo(() => dicts[locale()] ?? dicts.en)

  // Update <html lang> and <html dir> when locale changes
  createEffect(() => {
    const loc = locale()
    document.documentElement.lang = localeToBcp47(loc)
    document.documentElement.dir = RTL_LOCALES.has(loc) ? "rtl" : "ltr"
  })

  const text = (loc: Locale, key: string, params?: UiI18nParams) => {
    const value = dicts[loc]?.[key] ?? dicts.en[key] ?? key
    return resolveTemplate(value, params)
  }

  const t = (key: UiI18nKey, params?: UiI18nParams) => text(locale(), key, params)

  const setLocale = (next: Locale | "") => {
    setUserOverride(next)
    vscode.postMessage({ type: "setLanguage", locale: next })
  }

  return (
    <LanguageContext.Provider
      value={{ locale, setLocale, userOverride, t: t as (key: string, params?: UiI18nParams) => string, text }}
    >
      <I18nProvider value={{ locale: () => locale(), t }}>{props.children}</I18nProvider>
    </LanguageContext.Provider>
  )
}

// Expose locale + setLocale for the LanguageTab
import { createContext, useContext } from "solid-js"

export interface LanguageContextValue {
  locale: Accessor<Locale>
  setLocale: (locale: Locale | "") => void
  userOverride: Accessor<Locale | "">
  t: (key: string, params?: UiI18nParams) => string
  text: (locale: Locale, key: string, params?: UiI18nParams) => string
}

export const LanguageContext = createContext<LanguageContextValue>()

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) {
    throw new Error("useLanguage must be used within a LanguageProvider")
  }
  return ctx
}

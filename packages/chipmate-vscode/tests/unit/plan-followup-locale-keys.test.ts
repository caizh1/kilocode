import { describe, expect, test } from "bun:test"
import { dict as ar } from "@chipmate/chipmate-i18n/ar"
import { dict as br } from "@chipmate/chipmate-i18n/br"
import { dict as bs } from "@chipmate/chipmate-i18n/bs"
import { dict as da } from "@chipmate/chipmate-i18n/da"
import { dict as de } from "@chipmate/chipmate-i18n/de"
import { dict as en } from "@chipmate/chipmate-i18n/en"
import { dict as es } from "@chipmate/chipmate-i18n/es"
import { dict as fr } from "@chipmate/chipmate-i18n/fr"
import { dict as it } from "@chipmate/chipmate-i18n/it"
import { dict as ja } from "@chipmate/chipmate-i18n/ja"
import { dict as ko } from "@chipmate/chipmate-i18n/ko"
import { dict as nl } from "@chipmate/chipmate-i18n/nl"
import { dict as no } from "@chipmate/chipmate-i18n/no"
import { dict as pl } from "@chipmate/chipmate-i18n/pl"
import { dict as ru } from "@chipmate/chipmate-i18n/ru"
import { dict as th } from "@chipmate/chipmate-i18n/th"
import { dict as tr } from "@chipmate/chipmate-i18n/tr"
import { dict as uk } from "@chipmate/chipmate-i18n/uk"
import { dict as zh } from "@chipmate/chipmate-i18n/zh"
import { dict as zht } from "@chipmate/chipmate-i18n/zht"

const dicts: Record<string, Record<string, string>> = {
  ar,
  br,
  bs,
  da,
  de,
  en,
  es,
  fr,
  it,
  ja,
  ko,
  nl,
  no,
  pl,
  ru,
  th,
  tr,
  uk,
  zh,
  zht,
}

const keys = [
  "plan.followup.header",
  "plan.followup.question",
  "plan.followup.answer.newSession",
  "plan.followup.answer.newSession.description",
  "plan.followup.answer.continue",
  "plan.followup.answer.continue.description",
  "plan.followup.answer.keepRefining",
  "plan.followup.answer.keepRefining.description",
]

describe("plan follow-up i18n keys", () => {
  for (const locale of Object.keys(dicts)) {
    test(`${locale} defines every plan.followup.* key`, () => {
      const d = dicts[locale]!
      for (const key of keys) {
        const value = d[key]
        expect(value, `${locale} is missing ${key}`).toBeDefined()
        expect(value, `${locale} has empty value for ${key}`).toBeTruthy()
      }
    })
  }
})

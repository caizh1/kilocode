export const SKINS = ["default", "night-city"] as const
export const MOTIONS = ["off", "subtle", "immersive"] as const
export type Appearance = { skin: (typeof SKINS)[number]; motion: (typeof MOTIONS)[number] }
export const DEFAULT_APPEARANCE: Appearance = { skin: "default", motion: "immersive" }

export function resolveAppearance(value?: Partial<Appearance>): Appearance {
  return {
    skin: SKINS.includes(value?.skin as Appearance["skin"]) ? value!.skin! : DEFAULT_APPEARANCE.skin,
    motion: MOTIONS.includes(value?.motion as Appearance["motion"]) ? value!.motion! : DEFAULT_APPEARANCE.motion,
  }
}

export function validAppearance(value: unknown): value is Appearance {
  if (!value || typeof value !== "object") return false
  const item = value as Appearance
  return SKINS.includes(item.skin) && MOTIONS.includes(item.motion)
}

export const APPEARANCE_ACTIONS = {
  new: "chipmate.v2.appearance.new",
  history: "chipmate.v2.appearance.history",
  manager: "chipmate.v2.agentManagerOpen",
  marketplace: "chipmate.v2.marketplaceButtonClicked",
  profile: "chipmate.v2.profileButtonClicked",
  settings: "chipmate.v2.settingsButtonClicked",
} as const

export type AppearanceMessage =
  | { type: "appearanceChanged"; appearance: Appearance }
  | { type: "appearanceVisibility"; visible: boolean }
export type AppearanceRequest =
  | { type: "requestAppearance" }
  | { type: "updateAppearance"; appearance: Appearance; requestId: string }
  | { type: "appearanceAction"; action: keyof typeof APPEARANCE_ACTIONS }

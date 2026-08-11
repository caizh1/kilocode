import type { DesktopTheme } from "@opencode-ai/ui/theme/types"
import { DEFAULT_THEMES as UPSTREAM_THEMES } from "@opencode-ai/ui/theme/default-themes"
import chipmateJson from "./themes/chipmate.json"
import chipmateVscodeJson from "./themes/chipmate-vscode.json"

// Re-export all upstream theme constants
export {
  oc2Theme,
  tokyonightTheme,
  draculaTheme,
  monokaiTheme,
  solarizedTheme,
  nordTheme,
  catppuccinTheme,
  ayuTheme,
  oneDarkProTheme,
  shadesOfPurpleTheme,
  nightowlTheme,
  vesperTheme,
  carbonfoxTheme,
  gruvboxTheme,
  auraTheme,
} from "@opencode-ai/ui/theme/default-themes"

export const chipmateTheme = chipmateJson as DesktopTheme
export const chipmateVscodeTheme = chipmateVscodeJson as DesktopTheme

export const CHIPMATE_THEMES: Record<string, DesktopTheme> = {
  chipmate: chipmateTheme,
  "chipmate-vscode": chipmateVscodeTheme,
}

// Override DEFAULT_THEMES: ChipMate themes first, then upstream
export const DEFAULT_THEMES: Record<string, DesktopTheme> = {
  ...CHIPMATE_THEMES,
  ...UPSTREAM_THEMES,
}

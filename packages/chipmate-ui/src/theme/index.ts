export type {
  DesktopTheme,
  ThemeSeedColors,
  ThemeVariant,
  HexColor,
  OklchColor,
  ResolvedTheme,
  ColorValue,
  CssVarRef,
} from "@opencode-ai/ui/theme/types"

export {
  hexToRgb,
  rgbToHex,
  hexToOklch,
  oklchToHex,
  rgbToOklch,
  oklchToRgb,
  generateScale,
  generateNeutralScale,
  generateAlphaScale,
  mixColors,
  lighten,
  darken,
  withAlpha,
} from "@opencode-ai/ui/theme/color"

export { resolveThemeVariant, resolveTheme, themeToCss } from "@opencode-ai/ui/theme/resolve"
export { applyTheme, loadThemeFromUrl, getActiveTheme, removeTheme, setColorScheme } from "@opencode-ai/ui/theme/loader"

// Override: use our context with chipmate default
export { ThemeProvider, useTheme, type ColorScheme } from "./context"

// Override: use our default-themes which includes ChipMate themes
export {
  DEFAULT_THEMES,
  chipmateTheme,
  chipmateVscodeTheme,
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
} from "./default-themes"

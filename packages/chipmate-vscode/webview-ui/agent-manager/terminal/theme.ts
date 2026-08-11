type Theme = {
  background?: string
  foreground: string
  cursor: string
  cursorAccent?: string
  white: string
  brightWhite: string
}

export function contrast<T extends Theme>(theme: T, foreground?: string, background?: string): T {
  if (!foreground && !background) return theme
  return {
    ...theme,
    ...(foreground
      ? {
          foreground,
          cursor: foreground,
          white: foreground,
          brightWhite: foreground,
        }
      : {}),
    ...(background ? { background, cursorAccent: background } : {}),
  }
}

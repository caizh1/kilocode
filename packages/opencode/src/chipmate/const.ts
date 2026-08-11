import { InstallationVersion } from "@opencode-ai/core/installation/version"

export const DEFAULT_HEADERS = {
  "HTTP-Referer": "https://chipmate.ai",
  "X-Title": "ChipMate",
  "User-Agent": `ChipMate-Code/${InstallationVersion}`,
}

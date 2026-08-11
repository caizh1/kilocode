import { isInternalOfflineBuild } from "../shared/internal-offline"

type Msg = { type?: string }
type Post = (message: { type: "profileData"; data: null } | { type: "deviceAuthCancelled" }) => void

const AUTH = new Set(["login", "refreshProfile", "logout", "setOrganization", "cancelLogin"])

export function handleInternalOfflineAuth(message: Msg, post: Post, internal = isInternalOfflineBuild()) {
  if (!internal || !AUTH.has(message.type ?? "")) return false
  if (message.type === "cancelLogin") {
    post({ type: "deviceAuthCancelled" })
    return true
  }
  post({ type: "profileData", data: null })
  return true
}

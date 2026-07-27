import { isInternalOfflineBuild } from "../../../src/shared/internal-offline"

export type GatewayTarget = { view: "profile"; tab?: undefined } | { view: "settings"; tab: "providers" }

export function canUseGatewayUi(internal = isInternalOfflineBuild()) {
  return !internal
}

export function canUseSidebarSessionActions(internal = isInternalOfflineBuild()) {
  return !internal
}

export function gatewayTarget(internal = isInternalOfflineBuild()): GatewayTarget {
  if (internal) return { view: "settings", tab: "providers" }
  return { view: "profile" }
}

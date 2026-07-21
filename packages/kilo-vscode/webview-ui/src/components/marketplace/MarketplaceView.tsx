import { createSignal, createMemo, createEffect, onCleanup, onMount, Show } from "solid-js"
import { Tabs } from "@kilocode/kilo-ui/tabs"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { useVSCode } from "../../context/vscode"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import type {
  MarketplaceItem,
  McpMarketplaceItem,
  AgentMarketplaceItem,
  SkillMarketplaceItem,
  MarketplaceInstalledMetadata,
  MarketplaceIdentityState,
  MarketplaceServerState,
  MarketplaceUser,
  MarketCapabilities,
  MarketStatus,
  InstallationState,
  AnalyticsSeries,
  PublicationRun,
  SkillDetail,
} from "../../types/marketplace"
import type { ExtensionMessage } from "../../types/messages"
import { TelemetryEventName } from "../../../../src/services/telemetry/types"
import { MarketplaceListView } from "./MarketplaceListView"
import { InstallModal } from "./InstallModal"
import { RemoveDialog } from "./RemoveDialog"
import { AlignedSkillMarket } from "./AlignedSkillMarket"
import { LocalSkillImportDialog } from "./LocalSkillImportDialog"
import { MarketplaceDiagnostics } from "./MarketplaceDiagnostics"
import { MarketplaceRuntimeCard } from "./MarketplaceRuntimeCard"
import "./marketplace.css"

const EMPTY_METADATA: MarketplaceInstalledMetadata = { project: {}, global: {} }

export const MarketplaceView = () => {
  const vscode = useVSCode()
  const server = useServer()
  const { t } = useLanguage()
  const dialog = useDialog()

  const [items, setItems] = createSignal<MarketplaceItem[]>([])
  const [metadata, setMetadata] = createSignal<MarketplaceInstalledMetadata>(EMPTY_METADATA)
  const [fetching, setFetching] = createSignal(true)
  const [errors, setErrors] = createSignal<string[]>([])
  const [tab, setTab] = createSignal("agent")
  const [pending, setPending] = createSignal<{ item: MarketplaceItem; scope: "project" | "global" } | null>(null)
  const [localRemove, setLocalRemove] = createSignal<{
    requestId: string
    phase?: "validating" | "removing" | "refreshing" | "reconciling"
    error?: string
  }>()
  const [showMigrationBanner, setShowMigrationBanner] = createSignal(false)
  const [marketplaceUser, setMarketplaceUser] = createSignal<MarketplaceUser | undefined>()
  const [marketplaceBaseUrl, setMarketplaceBaseUrl] = createSignal<string | undefined>()
  const [marketplaceSkillsOnly, setMarketplaceSkillsOnly] = createSignal<boolean | undefined>()
  const [marketplaceMode, setMarketplaceMode] = createSignal<"skills-only" | "full" | undefined>()
  const [publication, setPublication] = createSignal<PublicationRun | undefined>()
  const [protocol, setProtocol] = createSignal<"aligned-v1" | "legacy">("legacy")
  const [capabilities, setCapabilities] = createSignal<MarketCapabilities>()
  const [installations, setInstallations] = createSignal<InstallationState[]>([])
  const [publications, setPublications] = createSignal<PublicationRun[]>([])
  const [status, setStatus] = createSignal<MarketStatus>()
  const [analytics, setAnalytics] = createSignal<AnalyticsSeries[]>([])
  const [detailId, setDetailId] = createSignal<string>()
  const [detail, setDetail] = createSignal<SkillDetail>()
  const [detailError, setDetailError] = createSignal<string>()
  const [runtimeServer, setRuntimeServer] = createSignal<MarketplaceServerState>({
    status: "connecting",
    checkedAt: new Date().toISOString(),
  })
  const [runtimeIdentity, setRuntimeIdentity] = createSignal<MarketplaceIdentityState>({
    status: "verifying",
    checkedAt: new Date().toISOString(),
  })

  const skills = createMemo(() => items().filter((i): i is SkillMarketplaceItem => i.type === "skill"))
  const mcps = createMemo(() => items().filter((i): i is McpMarketplaceItem => i.type === "mcp"))
  const agents = createMemo(() => items().filter((i): i is AgentMarketplaceItem => i.type === "agent"))

  const fetchData = () => {
    setFetching(true)
    vscode.postMessage({ type: "fetchMarketplaceData" })
  }

  const applyRuntime = (msg: {
    marketplaceServerState?: MarketplaceServerState
    marketplaceIdentityState?: MarketplaceIdentityState
  }) => {
    if (msg.marketplaceServerState) setRuntimeServer(msg.marketplaceServerState)
    if (msg.marketplaceIdentityState) {
      setRuntimeIdentity(msg.marketplaceIdentityState)
      setMarketplaceUser(msg.marketplaceIdentityState.user)
    }
    const issues = [
      msg.marketplaceServerState?.status === "degraded" || msg.marketplaceServerState?.status === "failed"
        ? msg.marketplaceServerState.issue?.summary
        : undefined,
      msg.marketplaceIdentityState?.status === "failed" ? msg.marketplaceIdentityState.issue?.summary : undefined,
    ].filter((item): item is string => Boolean(item))
    if (issues.length === 0) return
    setErrors((items) => [...items, ...issues.filter((issue) => !items.includes(issue))])
  }

  const handleLocalRemoveMessage = (msg: ExtensionMessage) => {
    if (msg.type === "skillRemoveProgress") {
      if (localRemove()?.requestId !== msg.requestId) return
      setLocalRemove({ requestId: msg.requestId, phase: msg.phase })
      return
    }
    if (msg.type !== "skillRemoveResult" || localRemove()?.requestId !== msg.requestId) return
    if (msg.success) {
      setLocalRemove(undefined)
      dialog.close()
      fetchData()
      return
    }
    setLocalRemove({ requestId: msg.requestId, error: msg.error ?? t("settings.agentBehaviour.removeSkill.failed") })
  }

  const handleRuntimeMessage = (msg: ExtensionMessage) => {
    if (msg.type === "marketplaceRuntimeState") applyRuntime(msg)
  }

  // Listen for messages
  createEffect(() => {
    const unsub = vscode.onMessage((msg) => {
      handleLocalRemoveMessage(msg)
      handleRuntimeMessage(msg)
      if (msg.type === "marketplaceData") {
        setItems(msg.marketplaceItems ?? [])
        setMetadata(msg.marketplaceInstalledMetadata ?? EMPTY_METADATA)
        setErrors(msg.errors ?? [])
        setFetching(false)
        setShowMigrationBanner(msg.showAgentMigrationBanner ?? false)
        setMarketplaceUser(msg.marketplaceUser)
        setMarketplaceBaseUrl(msg.marketplaceBaseUrl)
        setMarketplaceSkillsOnly(msg.marketplaceSkillsOnly)
        setMarketplaceMode(msg.marketplaceMode)
        setProtocol(msg.marketplaceProtocol ?? "legacy")
        setCapabilities(msg.marketplaceCapabilities)
        setInstallations(msg.marketplaceInstallations ?? [])
        setPublications(msg.marketplacePublications ?? [])
        setStatus(msg.marketplaceStatus)
        setAnalytics(msg.marketplaceAnalytics ?? [])
        applyRuntime(msg)
        if (msg.marketplaceSkillsOnly) setTab("skill")
      }
      if (msg.type === "marketplacePublicationResult") {
        setPublication(msg.run)
        setPublications((items) => [msg.run, ...items.filter((item) => item.id !== msg.run.id)])
      }
      if (msg.type === "marketplaceSync") {
        applySync(msg, setInstallations, setPublications, setAnalytics)
      }
      if (msg.type === "marketplaceCatalog") {
        setItems(msg.marketplaceItems)
        setMetadata(msg.marketplaceInstalledMetadata)
        setErrors(msg.errors ?? [])
      }
      if (msg.type === "marketplaceSkillDetail" && msg.id === detailId()) {
        setDetail(msg.detail)
        setDetailError(msg.error)
      }
      if (msg.type === "marketplaceRemoveResult") {
        const removed = pending()
        setPending(null)
        if (msg.success) {
          if (removed) {
            telemetry(TelemetryEventName.MARKETPLACE_ITEM_REMOVED, {
              itemId: removed.item.id,
              itemType: removed.item.type,
              itemName: removed.item.name,
              target: removed.scope,
            })
          }
          fetchData()
        } else {
          setErrors((prev) => [...prev, msg.error ?? t("marketplace.remove.failed", { name: msg.slug })])
        }
      }
    })
    onCleanup(unsub)
  })

  // Re-fetch when workspace changes
  createEffect(() => {
    server.workspaceDirectory()
    fetchData()
  })

  const telemetry = (event: string, properties?: Record<string, unknown>) => {
    vscode.postMessage({ type: "telemetry", event, properties: properties ?? {} })
  }

  onMount(() => {
    telemetry(TelemetryEventName.MARKETPLACE_TAB_VIEWED)
  })

  const handleInstall = (item: MarketplaceItem) => {
    telemetry(TelemetryEventName.MARKETPLACE_INSTALL_BUTTON_CLICKED, {
      itemId: item.id,
      itemType: item.type,
      itemName: item.name,
    })
    dialog.show(() => (
      <InstallModal
        item={item}
        onClose={() => dialog.close()}
        onInstallResult={(success, scope, extra) => {
          if (success) {
            telemetry(TelemetryEventName.MARKETPLACE_ITEM_INSTALLED, {
              itemId: item.id,
              itemType: item.type,
              itemName: item.name,
              target: scope,
              ...(extra?.hasParameters && { hasParameters: true }),
              ...(extra?.installationMethodName && { installationMethodName: extra.installationMethodName }),
            })
            dialog.close()
            fetchData()
          }
        }}
      />
    ))
  }

  const handleRemove = (item: MarketplaceItem, scope: "project" | "global") => {
    if (item.type === "skill" && item.removeToken && item.localScope === scope) {
      const requestId = crypto.randomUUID()
      setLocalRemove(undefined)
      dialog.show(() => (
        <RemoveDialog
          item={item}
          scope={scope}
          pending={localRemove()?.requestId === requestId && !localRemove()?.error}
          phase={localRemove()?.requestId === requestId ? localRemove()?.phase : undefined}
          error={localRemove()?.requestId === requestId ? localRemove()?.error : undefined}
          onClose={() => dialog.close()}
          onConfirm={() => {
            setLocalRemove({ requestId, phase: "validating" })
            vscode.postMessage({
              type: "removeLocalSkill",
              requestId,
              targetToken: item.removeToken!,
              skillId: item.removeSkillId ?? item.id,
              scope,
            })
          }}
        />
      ))
      return
    }
    if (item.type === "skill" && item.origin !== "market") {
      setErrors((prev) => [...prev, t("marketplace.remove.sourceChanged")])
      fetchData()
      return
    }
    dialog.show(() => (
      <RemoveDialog
        item={item}
        scope={scope}
        onClose={() => dialog.close()}
        onConfirm={() => {
          setPending({ item, scope })
          vscode.postMessage({
            type: "removeInstalledMarketplaceItem",
            mpItem: item,
            mpInstallOptions: { target: scope },
          })
          dialog.close()
        }}
      />
    ))
  }

  const dismissError = (idx: number) => {
    setErrors((prev) => prev.filter((_, i) => i !== idx))
  }

  const dismissMigrationBanner = () => {
    setShowMigrationBanner(false)
    vscode.postMessage({ type: "dismissAgentMigrationBanner" })
  }

  const uploadMarketplaceSkill = (item: SkillMarketplaceItem) => {
    vscode.postMessage({ type: "uploadMarketplaceSkill", mpSkillId: item.id })
  }

  const starMarketplaceSkill = (item: MarketplaceItem) => {
    if (item.type !== "skill") return
    vscode.postMessage({ type: "starMarketplaceSkill", mpSkillId: item.id })
  }

  const unpublishMarketplaceSkill = (id: string) => {
    vscode.postMessage({ type: "unpublishMarketplaceSkill", mpSkillId: id })
  }

  const openSkill = (item: SkillMarketplaceItem) => {
    setDetailId(item.id)
    setDetail(undefined)
    setDetailError(undefined)
    vscode.postMessage({ type: "fetchMarketplaceSkillDetail", mpSkillId: item.id })
  }

  const closeSkill = () => {
    setDetailId(undefined)
    setDetail(undefined)
    setDetailError(undefined)
  }

  const verifyUser = () => {
    setRuntimeIdentity({
      status: "verifying",
      checkedAt: new Date().toISOString(),
      user: marketplaceUser(),
    })
    vscode.postMessage({ type: "verifyMarketplaceUser" })
  }

  const openLocalImport = () => {
    dialog.show(() => <LocalSkillImportDialog onClose={() => dialog.close()} />)
  }

  return (
    <div class="marketplace-view">
      <header class="marketplace-local-header">
        <div class="marketplace-local-header__copy">
          <span class="marketplace-local-header__orb" aria-hidden="true">
            <span class="codicon codicon-sparkle" />
          </span>
          <div>
            <strong>{t("marketplace.local.header")}</strong>
            <span>{t("marketplace.local.headerDescription")}</span>
          </div>
        </div>
        <Button variant="primary" onClick={openLocalImport}>
          <span class="codicon codicon-cloud-upload" aria-hidden="true" />
          {t("marketplace.local.open")}
        </Button>
      </header>
      <Show when={publication()}>
        {(run) => (
          <Card class="marketplace-publication-result">
            <div>
              <strong>{t("marketplace.aligned.publicationValidation", { status: run().status })}</strong>
              <span>{run().stage}</span>
            </div>
            <Show when={run().release}>
              <p>
                {t("marketplace.aligned.immutableRelease", {
                  revision: run().release!.revision,
                  sha: run().release!.sha256.slice(0, 16),
                })}
              </p>
            </Show>
            <Show when={run().report?.changed}>
              <p>{t("marketplace.aligned.snapshotOnly")}</p>
            </Show>
            <div class="marketplace-publication-issues">
              {(run().report?.issues ?? []).map((issue) => (
                <p>
                  <strong>{issue.code}</strong> · {issue.file ?? issue.field ?? "归档"} · {issue.message}
                </p>
              ))}
            </div>
            <Button variant="ghost" size="small" onClick={() => setPublication(undefined)}>
              {t("marketplace.aligned.closeReport")}
            </Button>
          </Card>
        )}
      </Show>
      <Show when={errors().length > 0}>
        {errors().map((err, idx) => (
          <Card variant="error" class="marketplace-error-banner">
            <span>{err}</span>
            <Button variant="ghost" size="small" onClick={() => dismissError(idx)}>
              {t("marketplace.error.dismiss")}
            </Button>
          </Card>
        ))}
      </Show>

      <Tabs value={tab()} onChange={setTab} class="marketplace-tabs-root">
        <Show when={marketplaceSkillsOnly() === false}>
          <Tabs.List>
            <Tabs.Trigger value="agent">{t("marketplace.tab.agents")}</Tabs.Trigger>
            <Tabs.Trigger value="mcp">{t("marketplace.tab.mcp")}</Tabs.Trigger>
            <Tabs.Trigger value="skill">{t("marketplace.tab.skills")}</Tabs.Trigger>
          </Tabs.List>
        </Show>

        <div class="marketplace-content">
          <Tabs.Content value="agent">
            <Show when={showMigrationBanner()}>
              <Card variant="info" class="marketplace-error-banner">
                <span>{t("marketplace.migration.notice")}</span>
                <Button variant="ghost" size="small" onClick={dismissMigrationBanner}>
                  {t("marketplace.error.dismiss")}
                </Button>
              </Card>
            </Show>
            <MarketplaceListView
              items={agents()}
              metadata={metadata()}
              fetching={fetching()}
              type="agent"
              searchPlaceholder={t("marketplace.search")}
              emptyMessage={t("marketplace.empty")}
              onInstall={handleInstall}
              onRemove={handleRemove}
            />
          </Tabs.Content>

          <Tabs.Content value="mcp">
            <MarketplaceListView
              items={mcps()}
              metadata={metadata()}
              fetching={fetching()}
              type="mcp"
              searchPlaceholder={t("marketplace.search")}
              emptyMessage={t("marketplace.empty")}
              onInstall={handleInstall}
              onRemove={handleRemove}
            />
          </Tabs.Content>

          <Tabs.Content value="skill">
            <div class="marketplace-skill-content">
              <MarketplaceRuntimeCard
                server={runtimeServer()}
                identity={runtimeIdentity()}
                onVerify={verifyUser}
                diagnostics={
                  protocol() === "legacy" ? (
                    <MarketplaceDiagnostics
                      status={status()}
                      baseUrl={marketplaceBaseUrl()}
                      protocol="legacy"
                      mode={marketplaceMode()}
                    />
                  ) : undefined
                }
              />
              <Show
                when={protocol() === "aligned-v1"}
                fallback={
                  <>
                    <Card variant="info" class="marketplace-legacy-notice">
                      {t("marketplace.aligned.legacy")}
                    </Card>
                    <MarketplaceListView
                      items={skills()}
                      metadata={metadata()}
                      fetching={fetching()}
                      type="skill"
                      searchPlaceholder={t("marketplace.search")}
                      emptyMessage={t("marketplace.empty")}
                      onInstall={handleInstall}
                      onRemove={handleRemove}
                      onStarMarketplaceSkill={starMarketplaceSkill}
                    />
                  </>
                }
              >
                <AlignedSkillMarket
                  items={skills()}
                  metadata={metadata()}
                  fetching={fetching()}
                  user={marketplaceUser()}
                  baseUrl={marketplaceBaseUrl()}
                  mode={marketplaceMode()}
                  capabilities={capabilities()}
                  installations={installations()}
                  publications={publications()}
                  status={status()}
                  analytics={analytics()}
                  detail={detail()}
                  detailId={detailId()}
                  detailError={detailError()}
                  onOpen={openSkill}
                  onCloseDetail={closeSkill}
                  onInstall={handleInstall}
                  onRemove={handleRemove}
                  onStar={starMarketplaceSkill}
                  onUpload={capabilities()?.features.publications ? uploadMarketplaceSkill : undefined}
                  onUnpublish={unpublishMarketplaceSkill}
                />
              </Show>
            </div>
          </Tabs.Content>
        </div>
      </Tabs>
    </div>
  )
}

function applySync(
  msg: {
    marketplaceInstallations?: InstallationState[]
    marketplacePublications?: PublicationRun[]
    marketplaceAnalytics?: AnalyticsSeries[]
  },
  installations: (items: InstallationState[]) => void,
  publications: (items: PublicationRun[]) => void,
  analytics: (items: AnalyticsSeries[]) => void,
) {
  if (msg.marketplaceInstallations) installations(msg.marketplaceInstallations)
  if (msg.marketplacePublications) publications(msg.marketplacePublications)
  if (msg.marketplaceAnalytics) analytics(msg.marketplaceAnalytics)
}

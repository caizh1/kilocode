import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { Button } from "@chipmate/chipmate-ui/button"
import { Dialog } from "@chipmate/chipmate-ui/dialog"
import { RadioGroup } from "@chipmate/chipmate-ui/radio-group"
import { Spinner } from "@chipmate/chipmate-ui/dynamic-spinner"
import { TextField } from "@chipmate/chipmate-ui/text-field"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import type {
  SkillImportCandidate,
  SkillImportPreview,
  LocalSkillImportProgress,
  SkillImportResult,
} from "../../types/marketplace"

interface Props {
  onClose: () => void
}

interface Scope {
  value: "project" | "global"
  label: string
}

export const LocalSkillImportDialog = (props: Props) => {
  const vscode = useVSCode()
  const { t } = useLanguage()
  const [preview, setPreview] = createSignal<SkillImportPreview>()
  const [result, setResult] = createSignal<SkillImportResult>()
  const [selected, setSelected] = createSignal<Set<string>>(new Set())
  const [replace, setReplace] = createSignal<Set<string>>(new Set())
  const [repairs, setRepairs] = createSignal<Record<string, { name?: string; description?: string }>>({})
  const [scope, setScope] = createSignal<Scope>({ value: "project", label: t("marketplace.local.scope.project") })
  const [installing, setInstalling] = createSignal(false)
  const [progress, setProgress] = createSignal<LocalSkillImportProgress>()
  const [error, setError] = createSignal<string>()

  const scopes = createMemo<Scope[]>(() => {
    if (preview()?.projectAvailable)
      return [
        { value: "project", label: t("marketplace.local.scope.project") },
        { value: "global", label: t("marketplace.local.scope.global") },
      ]
    return [{ value: "global", label: t("marketplace.local.scope.global") }]
  })
  const chosen = createMemo(() =>
    [...selected()].filter((key) => preview()?.candidates.some((item) => item.key === key)),
  )
  const phase = createMemo(() => (result() || installing() ? 6 : preview() ? 3 : 1))

  const unsub = vscode.onMessage((msg) => {
    if (msg.type === "localSkillImportPreview") {
      setPreview(msg.preview)
      const valid = msg.preview.candidates.filter((item) => item.valid).map((item) => item.key)
      setSelected(new Set(valid))
      setRepairs(
        Object.fromEntries(
          msg.preview.candidates.map((item) => [
            item.key,
            {
              name: item.repairs.find((repair) => repair.field === "name")?.after ?? item.name,
              description: item.repairs.find((repair) => repair.field === "description")?.after ?? item.description,
            },
          ]),
        ),
      )
      setScope(
        msg.preview.projectAvailable
          ? { value: "project", label: t("marketplace.local.scope.project") }
          : { value: "global", label: t("marketplace.local.scope.global") },
      )
      setResult(undefined)
      setError(undefined)
      setInstalling(false)
    }
    if (msg.type === "localSkillImportResult" && msg.result.token === preview()?.token) {
      setResult(msg.result)
      setInstalling(false)
    }
    if (msg.type === "localSkillImportProgress" && msg.progress.token === preview()?.token) {
      setProgress(msg.progress)
    }
    if (msg.type === "localSkillImportError") {
      setError(msg.error)
      setInstalling(false)
    }
  })
  onCleanup(unsub)

  const pick = (kind: "file" | "folder") => {
    const token = preview()?.token
    if (token) vscode.postMessage({ type: "cancelLocalSkillImport", importToken: token })
    setError(undefined)
    vscode.postMessage({ type: "pickLocalSkills", localSkillSourceKind: kind })
  }

  const toggle = (key: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  }

  const toggleAll = (checked: boolean) => {
    setSelected(
      new Set(
        checked
          ? (preview()
              ?.candidates.filter((item) => item.valid)
              .map((item) => item.key) ?? [])
          : [],
      ),
    )
  }

  const toggleReplace = (key: string, checked: boolean) => {
    setReplace((current) => {
      const next = new Set(current)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  }

  const setRepair = (key: string, field: "name" | "description", value: string) => {
    setRepairs((current) => ({ ...current, [key]: { ...current[key], [field]: value } }))
  }

  const conflict = (item: SkillImportCandidate) => item.conflicts.find((entry) => entry.scope === scope().value)

  const install = () => {
    const value = preview()
    if (!value || chosen().length === 0) return
    setInstalling(true)
    setError(undefined)
    vscode.postMessage({
      type: "installLocalSkills",
      localSkillSelection: {
        token: value.token,
        candidateIds: chosen(),
        scope: scope().value,
        replaceIds: [...replace()],
        repairs: repairs(),
      },
    })
  }

  const close = () => {
    const token = preview()?.token
    if (token) vscode.postMessage({ type: "cancelLocalSkillImport", importToken: token })
    props.onClose()
  }

  const cancelNext = () => {
    const token = preview()?.token
    if (token) vscode.postMessage({ type: "cancelLocalSkillImport", importToken: token })
  }

  return (
    <Dialog title={t("marketplace.local.title")} size="large" transition>
      <div class="local-skill-import" aria-busy={installing()}>
        <ol class="local-skill-import__steps" aria-label={t("marketplace.local.stepsLabel")}>
          <For each={[1, 2, 3, 4, 5, 6]}>
            {(step) => (
              <li classList={{ active: phase() === step, complete: phase() > step }}>
                <span>{step}</span>
                {t(`marketplace.local.step.${step}`)}
              </li>
            )}
          </For>
        </ol>

        <Show when={error()}>
          {(message) => (
            <div class="local-skill-import__notice error" role="alert">
              <span class="codicon codicon-error" aria-hidden="true" />
              <span>{message()}</span>
            </div>
          )}
        </Show>

        <Show when={!preview() && !result()}>
          <section class="local-skill-import__source">
            <div class="local-skill-import__orb" aria-hidden="true">
              <span class="codicon codicon-package" />
            </div>
            <div>
              <h3>{t("marketplace.local.chooseTitle")}</h3>
              <p>{t("marketplace.local.chooseDescription")}</p>
            </div>
            <div class="local-skill-import__actions">
              <Button variant="primary" onClick={() => pick("folder")}>
                <span class="codicon codicon-folder-opened" aria-hidden="true" />
                {t("marketplace.local.chooseFolder")}
              </Button>
              <Button variant="secondary" onClick={() => pick("file")}>
                <span class="codicon codicon-file-zip" aria-hidden="true" />
                {t("marketplace.local.chooseFile")}
              </Button>
            </div>
            <p class="local-skill-import__hint">{t("marketplace.local.dragHint")}</p>
          </section>
        </Show>

        <Show when={!result() ? preview() : undefined}>
          {(data) => (
            <div class="local-skill-import__body">
              <header class="local-skill-import__summary">
                <div>
                  <span class="local-skill-import__eyebrow">{t("marketplace.local.discovered")}</span>
                  <strong>{t("marketplace.local.found", { count: data().candidates.length })}</strong>
                </div>
                <label class="local-skill-import__check">
                  <input
                    type="checkbox"
                    checked={
                      chosen().length > 0 && chosen().length === data().candidates.filter((item) => item.valid).length
                    }
                    onChange={(event) => toggleAll(event.currentTarget.checked)}
                  />
                  <span>{t("marketplace.local.selectAll")}</span>
                </label>
              </header>

              <div class="local-skill-import__candidates">
                <For each={data().candidates}>
                  {(item) => (
                    <article classList={{ "local-skill-import__candidate": true, invalid: !item.valid }}>
                      <div class="local-skill-import__candidate-head">
                        <label class="local-skill-import__check title">
                          <input
                            type="checkbox"
                            checked={selected().has(item.key)}
                            disabled={!item.valid || installing()}
                            onChange={(event) => toggle(item.key, event.currentTarget.checked)}
                          />
                          <span class="codicon codicon-sparkle" aria-hidden="true" />
                          <span>
                            <strong>{item.name}</strong>
                            <small>{item.description}</small>
                          </span>
                        </label>
                        <span classList={{ "local-skill-import__status": true, valid: item.valid }}>
                          {item.valid ? t("marketplace.local.valid") : t("marketplace.local.blocked")}
                        </span>
                      </div>

                      <div class="local-skill-import__meta">
                        <For each={item.hints}>{(hint) => <span>{hint}</span>}</For>
                        <span>{t("marketplace.local.files", { count: item.fileCount })}</span>
                        <span>{formatBytes(item.totalBytes)}</span>
                        <span>SHA {item.snapshotSha256.slice(0, 12)}…</span>
                      </div>

                      <Show when={item.repairs.length > 0}>
                        <div class="local-skill-import__repair">
                          <span class="local-skill-import__eyebrow">{t("marketplace.local.repairTitle")}</span>
                          <TextField
                            label={t("marketplace.local.name")}
                            value={repairs()[item.key]?.name ?? item.name}
                            onChange={(value: string) => setRepair(item.key, "name", value)}
                          />
                          <TextField
                            label={t("marketplace.local.description")}
                            value={repairs()[item.key]?.description ?? item.description}
                            onChange={(value: string) => setRepair(item.key, "description", value)}
                          />
                        </div>
                      </Show>

                      <Show when={item.issues.length > 0}>
                        <details class="local-skill-import__report">
                          <summary>{t("marketplace.local.report", { count: item.issues.length })}</summary>
                          <ul>
                            <For each={item.issues}>{(issue) => <li class={issue.severity}>{issue.message}</li>}</For>
                          </ul>
                        </details>
                      </Show>

                      <Show when={conflict(item)?.state !== "none" && conflict(item)?.state !== "same"}>
                        <label class="local-skill-import__conflict">
                          <input
                            type="checkbox"
                            checked={replace().has(item.key)}
                            onChange={(event) => toggleReplace(item.key, event.currentTarget.checked)}
                          />
                          <span class="codicon codicon-warning" aria-hidden="true" />
                          <span>
                            {conflict(item)?.state === "managed"
                              ? t("marketplace.local.replaceManaged")
                              : t("marketplace.local.replaceLocal")}
                          </span>
                        </label>
                      </Show>
                      <Show when={conflict(item)?.state === "same"}>
                        <p class="local-skill-import__same">{t("marketplace.local.same")}</p>
                      </Show>
                    </article>
                  )}
                </For>
              </div>

              <section class="local-skill-import__scope">
                <div>
                  <span class="local-skill-import__eyebrow">{t("marketplace.local.scopeTitle")}</span>
                  <p>{t("marketplace.local.scopeDescription")}</p>
                </div>
                <RadioGroup
                  options={scopes()}
                  current={scope()}
                  value={(item: Scope) => item.value}
                  label={(item: Scope) => item.label}
                  onSelect={(item: Scope | undefined) => item && setScope(item)}
                />
              </section>

              <footer class="local-skill-import__footer">
                <Button variant="secondary" onClick={() => pick("file")} disabled={installing()}>
                  {t("marketplace.local.chooseAnother")}
                </Button>
                <Button variant="secondary" onClick={close} disabled={installing()}>
                  {t("marketplace.local.cancel")}
                </Button>
                <Button variant="primary" onClick={install} disabled={installing() || chosen().length === 0}>
                  <Show when={installing()} fallback={t("marketplace.local.install", { count: chosen().length })}>
                    <Spinner /> {t("marketplace.local.installing")}
                  </Show>
                </Button>
              </footer>
              <Show when={installing()}>
                <div class="local-skill-import__live" aria-live="polite">
                  <span>
                    {t("marketplace.local.progress", {
                      current: progress()?.current || "—",
                      completed: progress()?.completed ?? 0,
                      total: progress()?.total ?? chosen().length,
                    })}
                  </span>
                  <button class="local-skill-import__cancel-next" onClick={cancelNext}>
                    {t("marketplace.local.cancelNext")}
                  </button>
                </div>
              </Show>
            </div>
          )}
        </Show>

        <Show when={result()}>
          {(value) => (
            <section class="local-skill-import__result" aria-live="polite">
              <div
                classList={{
                  "local-skill-import__orb": true,
                  success: value().activation?.status !== "failed",
                  warning: value().activation?.status === "failed",
                }}
                aria-hidden="true"
              >
                <span
                  classList={{
                    codicon: true,
                    "codicon-check": value().activation?.status !== "failed",
                    "codicon-warning": value().activation?.status === "failed",
                  }}
                />
              </div>
              <h3>
                {value().activation?.status === "failed"
                  ? t("marketplace.local.activationFailedTitle")
                  : t("marketplace.local.resultTitle")}
              </h3>
              <Show when={activationFailure(value())}>
                {(activation) => (
                  <div class="local-skill-import__notice error activation" role="alert">
                    <span class="codicon codicon-error" aria-hidden="true" />
                    <span>
                      <Show
                        when={activation().phase === "refresh-request"}
                        fallback={
                          <>
                            {t("marketplace.local.activationVerificationFailed", {
                              count: activation().missingIds?.length ?? 0,
                            })}
                            <Show when={activation().missingIds?.length}>
                              <small>{activation().missingIds?.join(", ")}</small>
                            </Show>
                          </>
                        }
                      >
                        {t("marketplace.local.activationRequestFailed", {
                          error: activation().message ?? t("marketplace.local.activationUnknown"),
                        })}
                      </Show>
                      <small>{t("marketplace.local.activationReloadHint")}</small>
                    </span>
                  </div>
                )}
              </Show>
              <div class="local-skill-import__result-list">
                <For each={value().items}>
                  {(item) => (
                    <div>
                      <strong>{item.id}</strong>
                      <span class={item.status}>{t(`marketplace.local.result.${item.status}`)}</span>
                      <Show when={item.error}>
                        <small>{item.error}</small>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
              <p>{t("marketplace.local.publishHint")}</p>
              <div class="local-skill-import__actions">
                <Button variant="primary" onClick={props.onClose}>
                  {t("marketplace.local.done")}
                </Button>
              </div>
            </section>
          )}
        </Show>
      </div>
    </Dialog>
  )
}

function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`
  return `${(bytes / 1_048_576).toFixed(1)} MiB`
}

function activationFailure(result: SkillImportResult) {
  const activation = result.activation
  if (activation?.status !== "failed") return undefined
  return activation
}

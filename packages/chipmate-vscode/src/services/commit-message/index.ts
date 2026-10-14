import * as vscode from "vscode"
import { snapshotRepository } from "./snapshot"
import type { ChipMateConnectionService } from "../cli-backend/connection-service"
import { getErrorMessage } from "../../chipmate-provider-utils"
import { getCommitMessageLanguage } from "../i18n"

let lastGeneratedMessage: string | undefined
let lastWorkspacePath: string | undefined

interface GitRepository {
  inputBox: { value: string }
  rootUri: vscode.Uri
}

interface GitAPI {
  repositories: GitRepository[]
}

interface GitExtensionExports {
  getAPI(version: number): GitAPI
}

function findRepository(repositories: GitRepository[], arg?: vscode.SourceControl): GitRepository | undefined {
  if (!repositories.length) return undefined
  if (arg?.rootUri) {
    const target = arg.rootUri.fsPath
    const match = repositories.find((r) => r.rootUri.fsPath === target)
    if (match) return match
  }
  return repositories[0]
}

export function registerCommitMessageService(
  context: vscode.ExtensionContext,
  connectionService: ChipMateConnectionService,
): vscode.Disposable[] {
  const running = new Set<string>()
  const command = vscode.commands.registerCommand(
    "chipmate.v2.generateCommitMessage",
    async (arg?: vscode.SourceControl) => {
      const extension = vscode.extensions.getExtension<GitExtensionExports>("vscode.git")
      if (!extension) {
        vscode.window.showErrorMessage("Git extension not found")
        return
      }

      if (!extension.isActive) {
        await extension.activate()
      }

      const git = extension.exports?.getAPI(1)
      const repository = findRepository(git?.repositories ?? [], arg)
      if (!repository) {
        vscode.window.showErrorMessage("No Git repository found")
        return
      }

      const path = repository.rootUri.fsPath
      if (running.has(path)) return
      running.add(path)
      try {
        const input = repository.inputBox.value
        const snapshot = await snapshotRepository(path)
        let client
        try {
          client = await connectionService.getClientAsync(path)
        } catch (err) {
          console.error("[ChipMate New] Failed to connect to ChipMate backend:", err)
          vscode.window.showErrorMessage("Failed to connect to ChipMate backend. Please try again.")
          return
        }

        const previousMessage = lastWorkspacePath === path ? lastGeneratedMessage : undefined

        let userCancelled = false
        let timedOut = false
        const controller = new AbortController()

        await vscode.window
          .withProgress(
            {
              location: vscode.ProgressLocation.SourceControl,
              title: "Generating commit message...",
              cancellable: true,
            },
            async (_progress, token) => {
              // Wire VS Code cancellation to abort the HTTP request
              const cancellation = token.onCancellationRequested(() => {
                userCancelled = true
                controller.abort()
              })

              // Client-side safety timeout (35s) — slightly longer than the
              // server-side 30s timeout so the server can respond with a proper
              // error first, but still ensures the spinner never hangs forever.
              const timeout = 35_000
              const timer = setTimeout(() => {
                timedOut = true
                controller.abort()
              }, timeout)

              try {
                const { data } = await client.commitMessage.generate(
                  { path, selectedFiles: undefined, previousMessage, language: getCommitMessageLanguage(vscode) },
                  { throwOnError: true, signal: controller.signal },
                )
                const message = data.message
                if (controller.signal.aborted) return
                if (repository.inputBox.value !== input || (await snapshotRepository(path)) !== snapshot) {
                  vscode.window.showWarningMessage("提交内容或提交说明已变化，已保留当前输入。请重新生成。")
                  return
                }
                // 核对磁盘期间用户仍可能编辑提交说明。
                if (repository.inputBox.value !== input || controller.signal.aborted) return
                repository.inputBox.value = message
                lastGeneratedMessage = message
                lastWorkspacePath = path
                console.log("[ChipMate New] Commit message generated successfully")
              } finally {
                clearTimeout(timer)
                cancellation.dispose()
              }
            },
          )
          .then(undefined, (error: unknown) => {
            if (userCancelled) {
              console.log("[ChipMate New] Commit message generation was cancelled by user")
              return
            }
            if (timedOut) {
              console.log("[ChipMate New] Commit message generation timed out")
              vscode.window.showErrorMessage("Commit message generation timed out. Please try again.")
              return
            }
            const msg = getErrorMessage(error)
            console.error("[ChipMate New] Failed to generate commit message:", msg)
            vscode.window.showErrorMessage(msg || "Failed to generate commit message. Please try again.")
          })
      } catch (error) {
        vscode.window.showErrorMessage(getErrorMessage(error) || "无法核对当前仓库状态")
      } finally {
        running.delete(path)
      }
    },
  )

  context.subscriptions.push(command)
  return [command]
}

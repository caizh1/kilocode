import * as path from "path"
import * as vscode from "vscode"
import type { ChipMateConnectionService, HistoryMigrationProgress } from "../services/cli-backend/connection-service"

const OPEN = "chipmate.v2.openChatHistoryBackupFolder"

function backupFolder(context: vscode.ExtensionContext) {
  return vscode.Uri.file(path.join(context.globalStorageUri.fsPath, "data", "migration-backups"))
}

async function run(connection: ChipMateConnectionService, operation: "migrate" | "restore", archive?: string) {
  const title = operation === "migrate" ? "正在迁移本地聊天记录" : "正在安全恢复聊天记录"
  const output = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title, cancellable: false },
    async (indicator) => {
      let last = 0
      return connection.runHistoryMaintenance(operation, archive, (event: HistoryMigrationProgress) => {
        const percent = event.total > 0 ? Math.floor((event.current / event.total) * 100) : last
        indicator.report({ message: event.message, increment: Math.max(0, percent - last) })
        last = percent
      })
    },
  )
  const result = output.result ?? {}
  if (operation === "migrate" && Number(result.sources ?? 0) === 0) {
    await vscode.window.showInformationMessage("当前 Profile 未发现需要迁移的旧聊天记录。")
    return
  }
  const imported = Number(result.imported ?? 0)
  const skipped = Number(result.skipped ?? 0)
  const failed = Number(result.failed ?? 0)
  const message = `已导入 ${imported} 个会话族，跳过 ${skipped} 个重复项${failed ? `，${failed} 个失败项已记录` : ""}。迁移前备份已保留。`
  if (output.code === 2 || failed > 0) {
    await vscode.window
      .showWarningMessage(message, "打开备份目录")
      .then((choice) => choice && vscode.commands.executeCommand(OPEN))
    return
  }
  await vscode.window
    .showInformationMessage(message, "打开备份目录")
    .then((choice) => choice && vscode.commands.executeCommand(OPEN))
}

export function registerChatHistoryMigration(context: vscode.ExtensionContext, connection: ChipMateConnectionService) {
  context.subscriptions.push(
    vscode.commands.registerCommand("chipmate.v2.migrateLocalChatHistory", async () => {
      try {
        await run(connection, "migrate")
      } catch (error) {
        await vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
      }
    }),
    vscode.commands.registerCommand("chipmate.v2.restoreChatHistoryBackup", async () => {
      const selected = await vscode.window.showOpenDialog({
        title: "选择 ChipMate 聊天记录备份",
        defaultUri: backupFolder(context),
        canSelectMany: false,
        canSelectFiles: true,
        canSelectFolders: false,
        filters: { "ChipMate 聊天记录备份": ["zip"] },
      })
      const archive = selected?.[0]
      if (!archive) return
      try {
        await run(connection, "restore", archive.fsPath)
      } catch (error) {
        await vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
      }
    }),
    vscode.commands.registerCommand("chipmate.v2.openChatHistoryBackupFolder", async () => {
      const folder = backupFolder(context)
      await vscode.workspace.fs.createDirectory(folder)
      await vscode.commands.executeCommand("revealFileInOS", folder)
    }),
  )
}

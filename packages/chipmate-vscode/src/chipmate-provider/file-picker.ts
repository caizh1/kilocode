import * as vscode from "vscode"

type Input = {
  requestId: string
  kind?: "file" | "folder"
  post: (message: unknown) => void
}

export async function handleFilePicker(input: Input): Promise<void> {
  const uri = await vscode.window.showOpenDialog({
    canSelectFiles: input.kind !== "folder",
    canSelectFolders: input.kind === "folder",
    canSelectMany: false,
    openLabel: input.kind === "folder" ? "引用文件夹" : "引用文件",
  })
  input.post({
    type: "filePickerResult",
    path: uri && uri[0] ? uri[0].fsPath : "",
    requestId: input.requestId,
  })
}

import { createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js"
import { showToast } from "@chipmate/chipmate-ui/toast"
import { useVSCode } from "../context/vscode"
import { createReferenceRequest } from "../utils/prompt-reference-request"
import { convertToMentionPath } from "../utils/path-mentions"
import type { FileMention } from "./useFileMention"
import { findMentionRange } from "./file-mention-utils"
import { promptCodeReferences } from "../utils/prompt-code-references"

export function usePromptReferences(input: {
  scope: Accessor<string>
  text: Accessor<string>
  directory: Accessor<string>
  element: () => HTMLTextAreaElement | undefined
  setText: (value: string) => void
  resize: () => void
  mention: FileMention
  addImage: (file: File, valid: () => boolean) => void
}) {
  const vscode = useVSCode()
  const requests = createReferenceRequest()
  const [current, setCurrent] = createSignal<string>()
  createEffect(on([input.scope, input.text], () => requests.clear(), { defer: true }))
  createEffect(on(input.scope, () => setCurrent(undefined), { defer: true }))
  onCleanup(() => requests.clear())
  const begin = () => {
    const element = input.element()
    return requests.begin(input.scope(), input.text(), element?.selectionStart ?? 0, element?.selectionEnd ?? 0)
  }
  const insert = (value: string, start: number, end: number) => {
    const element = input.element()
    if (!element?.isConnected) return
    element.focus({ preventScroll: true })
    element.setSelectionRange(start, end)
    document.execCommand("insertText", false, value)
    input.setText(element.value)
    input.resize()
  }
  const unsubscribe = vscode.onMessage((message) => {
    if (message.type !== "filePickerResult" && message.type !== "editorReferenceResult") return
    const pending = requests.read(message.requestId, input.scope(), input.text())
    if (!pending) return
    requests.clear()
    if (message.type === "editorReferenceResult" && message.error) {
      showToast({ variant: "default", title: message.error })
      return
    }
    if (!message.path) return
    if (message.type === "editorReferenceResult" && message.text) {
      insert(`\n${message.text}\n`, pending.start, pending.end)
      return
    }
    const path = convertToMentionPath(message.path, input.directory())
    input.mention.addPaths([path], input.directory())
    insert(`@${path} `, pending.start, pending.end)
    if (message.type === "editorReferenceResult") setCurrent(path)
  })
  onCleanup(unsubscribe)
  return {
    paths: () => [...input.mention.mentionedPaths()],
    quotes: () => promptCodeReferences(input.text()),
    removeQuote: (quote: ReturnType<typeof promptCodeReferences>[number]) => {
      if (input.text().slice(quote.start, quote.end) !== quote.text) return
      requests.clear()
      insert("", quote.start, quote.end)
    },
    current,
    file: (kind: "file" | "folder") => vscode.postMessage({ type: "requestFilePicker", kind, requestId: begin() }),
    editor: (kind: "file" | "selection") =>
      vscode.postMessage({ type: "requestEditorReference", kind, requestId: begin() }),
    images: (picker: HTMLInputElement) => {
      const id = begin()
      picker.value = ""
      picker.onchange = () => {
        const valid = () => !!requests.read(id, input.scope(), input.text())
        if (!valid()) return
        for (const file of Array.from(picker.files ?? [])) input.addImage(file, valid)
      }
      picker.click()
    },
    remove: (path: string) => {
      const value = input.text()
      let start = value.indexOf(`@${path}`)
      while (start >= 0) {
        const range = findMentionRange(value, start + 1, input.mention.mentionedPaths())
        if (range?.start === start && range.end === start + path.length + 1) break
        start = value.indexOf(`@${path}`, start + path.length + 1)
      }
      if (start < 0) return
      requests.clear()
      insert("", start, start + path.length + 1)
      input.mention.onInput(input.text(), start)
    },
    open: (path: string) => vscode.postMessage({ type: "openFile", filePath: path }),
  }
}

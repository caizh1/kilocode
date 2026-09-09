import * as crypto from "crypto"
import * as vscode from "vscode"
import { readAppearance } from "./appearance"
import { buildCspString } from "./webview-html-utils"

function getNonce(): string {
  return crypto.randomBytes(16).toString("hex")
}

const SIZES = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]

function clamp(size: number) {
  if (!Number.isFinite(size)) return 13
  return Math.min(24, Math.max(10, Math.round(size)))
}

export function getWebviewFontSize(): number {
  const raw = vscode.workspace.getConfiguration("chipmate.v2").get<number>("fontSize", 13)
  return clamp(raw)
}

function fontStyle(): string {
  const base = getWebviewFontSize()
  const vars = SIZES.map((size) => `--chipmate-font-size-${size}: ${(base * size) / 13}px;`).join("\n      ")
  return `:root {
      ${vars}
      --chipmate-font-scale: ${base / 13};
      --font-size-x-small: var(--chipmate-font-size-10);
      --font-size-small: var(--chipmate-font-size-11);
      --font-size-base: var(--chipmate-font-size-13);
      --font-size-large: var(--chipmate-font-size-16);
    }`
}

export function buildWebviewHtml(
  webview: vscode.Webview,
  opts: {
    scriptUri: vscode.Uri
    styleUri: vscode.Uri
    iconsBaseUri: vscode.Uri
    motionBaseUri: vscode.Uri
    workerUri: vscode.Uri
    extensionVersion?: string
    title: string
    port?: number
    allowUnsafeEval?: boolean
    extraStyles?: string
    nativeNavigation?: boolean
  },
): string {
  const appearance = readAppearance()
  const frame = (name: string) => vscode.Uri.joinPath(opts.iconsBaseUri, "..", "appearance", name)
  const nonce = getNonce()
  const csp = buildCspString(webview.cspSource, nonce, opts.port, opts.allowUnsafeEval)
  const markdownWorkerUri = opts.workerUri.toString().replace(/shiki-worker\.js$/, "markdown-shiki-worker.js")

  return `<!DOCTYPE html>
<html lang="en" data-theme="chipmate-vscode" data-chipmate-native-navigation="${opts.nativeNavigation === true}" data-chipmate-skin="${appearance.skin}" data-chipmate-motion="${appearance.motion}"${appearance.skin === "night-city" ? ' data-color-scheme="dark"' : ""}>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <link rel="stylesheet" href="${opts.styleUri}">
  <title>${opts.title}</title>
  <style>
    ${fontStyle()}
    :root {
      --night-city-frame: url("${frame("future-page-frame.png")}");
      --future-page-frame: url("${frame("future-page-frame.png")}");
      --future-composer-frame: url("${frame("future-composer-frame.png")}");
      --future-tab-frame: url("${frame("future-tab-frame.png")}");
      --future-composer-slice: 245 90 250 90;
      --future-tab-slice: 280 70 290 70;
    }
    html {
      scrollbar-color: auto;

      ::-webkit-scrollbar-thumb {
        border: 3px solid transparent !important;
        background-clip: padding-box !important;
      }
    }
    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      overflow: hidden;
    }
    body {
      background-color: var(--vscode-sideBar-background, var(--vscode-editor-background));
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
    }
    #root {
      height: 100%;
    }${opts.extraStyles ? `\n    ${opts.extraStyles}` : ""}
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">window.ICONS_BASE_URI = "${opts.iconsBaseUri}"; window.CHIPMATE_LOADING_MOTION_URI = "${opts.motionBaseUri}"; window.CHIPMATE_SHIKI_WORKER_URI = "${opts.workerUri}"; window.CHIPMATE_MARKDOWN_SHIKI_WORKER_URI = "${markdownWorkerUri}"; window.CHIPMATE_EXTENSION_VERSION = ${JSON.stringify(opts.extensionVersion ?? "")}; window.CHIPMATE_CSP_NONCE = "${nonce}";</script>
  <script nonce="${nonce}" src="${opts.scriptUri}"></script>
</body>
</html>`
}

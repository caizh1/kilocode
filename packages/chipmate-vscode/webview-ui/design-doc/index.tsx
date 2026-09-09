import "../appearance"
import { render } from "solid-js/web"
import "@chipmate/chipmate-ui/styles"
import "@vscode/codicons/dist/codicon.css"
import "./design-doc.css"
import { DesignDocApp } from "./DesignDocApp"

const root = document.getElementById("root")
if (!root) throw new Error("缺少 DesignDoc Webview 根节点")
render(() => <DesignDocApp />, root)

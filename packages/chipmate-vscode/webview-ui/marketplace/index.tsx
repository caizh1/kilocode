import "../appearance"
import { render } from "solid-js/web"
import "@chipmate/chipmate-ui/styles"
import "@vscode/codicons/dist/codicon.css"
import { MarketplaceApp } from "./MarketplaceApp"

const root = document.getElementById("root")
if (!root) throw new Error("Root element not found")
render(() => <MarketplaceApp />, root)

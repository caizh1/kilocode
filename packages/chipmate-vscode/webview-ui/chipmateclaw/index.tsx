import "../appearance"
// ChipMateClaw SolidJS webview entry point

import { render } from "solid-js/web"
import "@chipmate/chipmate-ui/styles"
import "./chipmateclaw.css"
import { ChipMateClawApp } from "./ChipMateClawApp"

const root = document.getElementById("root")
if (root) {
  render(() => <ChipMateClawApp />, root)
}

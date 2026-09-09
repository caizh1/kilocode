import "../appearance"
/** @jsxImportSource solid-js */

import { render } from "solid-js/web"
import "@chipmate/chipmate-ui/styles"
import "./patent-radar.css"
import { PatentRadarApp } from "./PatentRadarApp"

const root = document.getElementById("root")
if (!root) throw new Error("缺少 Patent Radar Webview 根节点")
render(() => <PatentRadarApp />, root)

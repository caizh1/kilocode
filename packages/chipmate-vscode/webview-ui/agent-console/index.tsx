/** @jsxImportSource solid-js */

import { render } from "solid-js/web"
import "@chipmate/chipmate-ui/styles"
import "@vscode/codicons/dist/codicon.css"
import "../src/styles/chat.css"
import "./agent-console.css"
import { AgentConsoleApp } from "./AgentConsoleProviders"

const root = document.getElementById("root")
if (!root) throw new Error("Agent Console root element not found")
render(() => <AgentConsoleApp />, root)

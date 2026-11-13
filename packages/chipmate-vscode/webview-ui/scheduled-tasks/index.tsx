import "../appearance"
import "@chipmate/chipmate-ui/styles"
import "./scheduled-tasks.css"
import { render } from "solid-js/web"
import { SchedulerApp } from "./SchedulerApp"

const root = document.getElementById("root")
if (!root) throw new Error("定时任务界面缺少根节点")
render(() => <SchedulerApp />, root)

/** @jsxImportSource solid-js */

import { type Component, For, Show, createMemo } from "solid-js"
import type { AgentConsoleActivityBlock } from "./activity"
import { terminalLines } from "./output"

const Output: Component<{ data: string }> = (props) => {
  const lines = createMemo(() => terminalLines(props.data))

  return (
    <pre data-slot="agent-console-terminal-output">
      <For each={lines()}>
        {(line, index) => (
          <>
            <For each={line}>
              {(run) => (
                <span
                  style={{
                    color: run.style.color ?? "#fff",
                    "background-color": run.style.background,
                    "font-weight": run.style.bold ? "700" : undefined,
                    opacity: run.style.dim ? "0.78" : "1",
                    "font-style": run.style.italic ? "italic" : undefined,
                    "text-decoration": run.style.underline ? "underline" : undefined,
                  }}
                >
                  {run.text}
                </span>
              )}
            </For>
            <Show when={index() < lines().length - 1}>{"\n"}</Show>
          </>
        )}
      </For>
    </pre>
  )
}

export const TerminalActivity: Component<{ block: AgentConsoleActivityBlock }> = (props) => {
  return (
    <div
      data-component="agent-console-terminal-activity"
      data-kind={props.block.kind}
      data-running={props.block.running ? "" : undefined}
      data-source={props.block.source}
    >
      <Show when={props.block.data}>
        <Output data={props.block.data} />
      </Show>
      <Show
        when={
          props.block.source === "agent" &&
          props.block.kind === "run" &&
          !props.block.running &&
          props.block.exitCode !== undefined
        }
      >
        <div data-slot="agent-console-command-status" data-exit={props.block.exitCode === 0 ? "success" : "error"}>
          {props.block.exitCode === 0 ? "完成" : `退出码 ${props.block.exitCode}`}
        </div>
      </Show>
      <Show when={props.block.source === "agent" && props.block.kind === "run" && props.block.running}>
        <div data-slot="agent-console-command-status" data-exit="running">
          执行中
        </div>
      </Show>
    </div>
  )
}

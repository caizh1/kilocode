import { For, onCleanup, onMount } from "solid-js"
import { Dialog } from "@chipmate/chipmate-ui/dialog"
import { Button } from "@chipmate/chipmate-ui/button"
import { Icon } from "@chipmate/chipmate-ui/icon"
import { useDialog } from "@chipmate/chipmate-ui/context/dialog"
import "./spec-introduction.css"

const stages = [
  {
    title: "理解与对齐",
    steps: ["已评审详设", "解析资料", "疑点讨论", "执行基线"],
    confirmation: "第一次确认",
    decision: "确认基线",
    roles: ["模型：提取要求、约束与疑点", "开发人员：补充依据，核对理解"],
  },
  {
    title: "计划与开发",
    steps: ["拆分任务", "明确修改范围", "定义验证方法"],
    confirmation: "第二次确认",
    decision: "批准计划",
    roles: ["模型：形成可执行计划", "开发人员：确认任务、范围与验证方法"],
  },
  {
    title: "验证与交付",
    steps: ["实现与修正", "编译测试 / FPGA", "对抗审核"],
    confirmation: "第三次确认",
    decision: "验收交付",
    roles: ["模型调用现有工具：修改代码，执行检查并整理证据", "开发人员：必要板测、交付审核与原有合并流程"],
  },
]

export function SpecIntroductionDialog(props: { displayed: () => void; disposed: () => void }) {
  const dialog = useDialog()
  onMount(props.displayed)
  onCleanup(props.disposed)
  return (
    <Dialog title="Spec 文档驱动开发流程" size="x-large" class="spec-introduction-dialog">
      <div class="spec-introduction-scroll" tabindex="0" aria-label="Spec 流程架构介绍">
        <p class="spec-introduction-subtitle">Skill 指导模型读懂详设、规划开发；每个关键阶段由你确认。</p>
        <ol class="spec-introduction-stages">
          <For each={stages}>
            {(stage, index) => (
              <li class="spec-introduction-stage">
                <div class="spec-introduction-track" aria-hidden="true">
                  <span>{index() + 1}</span>
                  <i />
                </div>
                <section class="spec-introduction-section" aria-label={stage.title}>
                  <h3>{stage.title}</h3>
                  <ol class="spec-introduction-steps">
                    <For each={stage.steps}>
                      {(step) => (
                        <li>
                          <span class="spec-introduction-step">{step}</span>
                          <span class="spec-introduction-arrow" aria-hidden="true">
                            <Icon name="arrow-right" size="small" />
                          </span>
                        </li>
                      )}
                    </For>
                    <li class="spec-introduction-confirmation">
                      <strong>{stage.confirmation}</strong>
                      <span>{stage.decision}</span>
                    </li>
                  </ol>
                  <div class="spec-introduction-roles">
                    <For each={stage.roles}>{(role) => <p>{role}</p>}</For>
                  </div>
                </section>
              </li>
            )}
          </For>
        </ol>
        <div class="spec-introduction-notice">
          <Icon name="help" size="small" />
          <p>影响实现的依据不清楚时先提问；设计或计划变化时重新确认相关部分。</p>
        </div>
        <div class="spec-introduction-inline-disclaimer">
          <Disclaimer />
        </div>
      </div>
      <footer class="spec-introduction-footer">
        <Disclaimer />
        <Button variant="primary" onClick={() => dialog.close()} autofocus>
          返回输入框
        </Button>
      </footer>
    </Dialog>
  )
}

function Disclaimer() {
  return (
    <div class="spec-introduction-disclaimer">
      <p>查看介绍不会启动任务或批准开发</p>
      <small>关闭后补充详设，发送 /spec 才会启动。</small>
    </div>
  )
}

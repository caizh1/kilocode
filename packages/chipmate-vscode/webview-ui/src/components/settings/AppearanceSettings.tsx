import { Show } from "solid-js"
import { Card } from "@chipmate/chipmate-ui/card"
import { Select } from "@chipmate/chipmate-ui/select"
import { Button } from "@chipmate/chipmate-ui/button"
import { RadioGroup } from "@chipmate/chipmate-ui/radio-group"
import { useConfig } from "../../context/config"
import { resolveAppearance } from "../../../../src/shared/appearance"
import SettingsRow from "./SettingsRow"

const skins = [
  { value: "default", label: "原皮肤" },
  { value: "night-city", label: "未来风" },
]
const motions = [
  { value: "off", label: "关闭" },
  { value: "subtle", label: "柔和" },
  { value: "immersive", label: "沉浸" },
]

export default function AppearanceSettings() {
  const { settings, updateSetting } = useConfig()
  const appearance = () =>
    resolveAppearance({
      skin: settings()["appearance.skin"] as "default" | "night-city",
      motion: settings()["appearance.motion"] as "off" | "subtle" | "immersive",
    })
  return (
    <section class="appearance-settings" aria-label="界面外观">
      <div class="appearance-preview" data-preview-skin={appearance().skin}>
        <div class="appearance-preview-caption">
          <h3>{appearance().skin === "night-city" ? "未来风" : "原皮肤"}</h3>
          <p>{appearance().skin === "night-city" ? "蓝紫夜色，沉浸工作。" : "沿用当前插件的主题和界面。"}</p>
          <span>保存后应用到全部插件页面</span>
        </div>
        <div class="appearance-preview-chat" aria-hidden="true">
          <div class="appearance-preview-tab">UFS 初始化流程</div>
          <div class="appearance-preview-user">
            <div>
              <span class="codicon codicon-account" /> 你 <span>14:02</span>
            </div>
            <p>请检查 UFS 初始化流程中的超时处理，给出修改建议。</p>
          </div>
          <div class="appearance-preview-assistant">
            <span class="codicon codicon-circuit-board" /> ChipMate <span>14:02</span>
          </div>
          <div class="appearance-preview-status">
            <span class="codicon codicon-pass-filled" /> 已读取 3 个文件
          </div>
        </div>
      </div>
      <Card>
        <SettingsRow title="界面皮肤" description="选择插件的整体视觉风格。">
          <Select
            options={skins}
            current={skins.find((item) => item.value === appearance().skin)}
            triggerProps={{ "aria-label": "界面皮肤" }}
            value={(item) => item.value}
            label={(item) => item.label}
            variant="secondary"
            size="small"
            triggerVariant="settings"
            onSelect={(item) => {
              if (item) updateSetting("appearance.skin", item.value)
            }}
          />
        </SettingsRow>
        <Show when={appearance().skin === "night-city"}>
          <SettingsRow title="配色模式" description="未来风皮肤保持固定深色。">
            <span>独立深色</span>
          </SettingsRow>
          <SettingsRow title="氛围动效" description="减少动态效果时，保留静态边框与状态提示。">
            <RadioGroup
              options={motions}
              current={motions.find((item) => item.value === appearance().motion)}
              value={(item) => item.value}
              label={(item) => item.label}
              size="small"
              aria-label="氛围动效"
              onSelect={(item) => {
                if (item) updateSetting("appearance.motion", item.value)
              }}
            />
          </SettingsRow>
        </Show>
        <SettingsRow title="恢复外观默认值" description="保存后切回原皮肤，不修改其他设置。" last>
          <Button
            variant="secondary"
            size="small"
            onClick={() => {
              updateSetting("appearance.skin", "default")
              updateSetting("appearance.motion", "immersive")
            }}
          >
            恢复默认
          </Button>
        </SettingsRow>
      </Card>
    </section>
  )
}

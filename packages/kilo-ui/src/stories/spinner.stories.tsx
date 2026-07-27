/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { For } from "solid-js"
import { Spinner, type SpinnerVariant } from "../components/dynamic-spinner"
import { variants } from "../components/spinner-sequence"

const meta: Meta<typeof Spinner> = {
  title: "Components/Spinner",
  component: Spinner,
  args: {
    assetBase: "/loading-motion",
  },
}

export default meta
type Story = StoryObj<typeof Spinner>

export const Default: Story = {}

export const Small: Story = {
  render: () => <Spinner assetBase="/loading-motion" style={{ width: "16px", height: "16px" }} />,
}

export const Large: Story = {
  render: () => <Spinner assetBase="/loading-motion" style={{ width: "48px", height: "48px" }} />,
}

export const Colored: Story = {
  render: () => (
    <Spinner
      assetBase="/loading-motion"
      style={{ width: "24px", height: "24px", color: "var(--text-interactive-base)" }}
    />
  ),
}

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "24px", "align-items": "center" }}>
      <For each={variants}>
        {(variant) => (
          <div style={{ display: "grid", gap: "8px", "justify-items": "center", color: "var(--text-base)" }}>
            <Spinner assetBase="/loading-motion" variant={variant} style={{ width: "48px", height: "48px" }} />
            <span style={{ "font-size": "12px", color: "var(--text-weak)" }}>{variant}</span>
          </div>
        )}
      </For>
    </div>
  ),
}

export const SizeMatrix: Story = {
  render: () => (
    <div style={{ display: "grid", gap: "16px" }}>
      <For each={variants}>
        {(variant) => (
          <div style={{ display: "flex", gap: "14px", "align-items": "center" }}>
            <For each={[12, 14, 16, 18]}>
              {(size) => (
                <Spinner
                  assetBase="/loading-motion"
                  variant={variant}
                  style={{ width: `${size}px`, height: `${size}px` }}
                />
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  ),
}

export const StatusRows: Story = {
  render: () => (
    <div style={{ display: "grid", gap: "12px", width: "320px" }}>
      <For each={variants}>
        {(variant) => (
          <div
            role="status"
            style={{
              display: "flex",
              "align-items": "center",
              gap: "8px",
              padding: "8px 12px",
              color: "var(--text-weak)",
              "font-size": "12px",
            }}
          >
            <Spinner
              assetBase="/loading-motion"
              variant={variant as SpinnerVariant}
              style={{ width: "16px", height: "16px" }}
            />
            <span style={{ flex: "1" }}>正在委派工作</span>
            <span style={{ opacity: "0.7", "font-variant-numeric": "tabular-nums" }}>12s</span>
          </div>
        )}
      </For>
    </div>
  ),
}

export const MotionQA: Story = {
  render: () => (
    <div
      style={{
        display: "grid",
        gap: "18px",
        width: "100vw",
        padding: "24px",
        "justify-items": "start",
        color: "var(--text-base)",
      }}
    >
      <For each={variants}>
        {(variant) => (
          <div style={{ display: "flex", gap: "12px", "align-items": "center" }}>
            <Spinner assetBase="/loading-motion" variant={variant} style={{ width: "48px", height: "48px" }} />
            <span style={{ width: "72px", "font-size": "12px" }}>{variant}</span>
            <Spinner assetBase="/loading-motion" variant={variant} style={{ width: "16px", height: "16px" }} />
            <span style={{ "font-size": "12px", color: "var(--text-weak)" }}>正在委派工作</span>
          </div>
        )}
      </For>
    </div>
  ),
}

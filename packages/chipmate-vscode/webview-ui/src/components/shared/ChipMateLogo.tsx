import type { JSX } from "solid-js"

type Props = {
  class: string
  welcome?: boolean
}

export const ChipMateLogo = (props: Props): JSX.Element => {
  const base = (window as { ICONS_BASE_URI?: string }).ICONS_BASE_URI || ""
  const light =
    document.body.classList.contains("vscode-light") || document.body.classList.contains("vscode-high-contrast-light")
  const icon = props.welcome ? "chipmate-icon.png" : light ? "chipmate-light.png" : "chipmate-dark.png"

  return (
    <div class={props.class}>
      <img src={`${base}/${icon}`} alt="ChipMate" />
    </div>
  )
}

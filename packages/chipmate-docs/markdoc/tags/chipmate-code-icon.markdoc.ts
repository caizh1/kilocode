import { ChipMateIcon } from "../../components"

export const chipmateCodeIcon = {
  render: ChipMateIcon,
  selfClosing: true,
  attributes: {
    size: {
      type: String,
      default: "1.2em",
      description: "Size of the icon (CSS height value)",
    },
  },
}

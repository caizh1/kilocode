import React from "react"
import { Icon } from "./Icon"

interface ChipMateIconProps {
  size?: string
}

export function ChipMateIcon({ size = "1.2em" }: ChipMateIconProps) {
  return <Icon src="/docs/img/chipmate-v1.svg" srcDark="/docs/img/chipmate-v1-white.svg" alt="ChipMate Icon" size={size} />
}

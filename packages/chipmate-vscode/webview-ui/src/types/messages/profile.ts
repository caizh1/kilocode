// ChipMate notification types (mirrored from chipmate-gateway)
export interface ChipMateNotificationAction {
  actionText: string
  actionURL: string
}

export interface ChipMateNotification {
  id: string
  title: string
  message: string
  action?: ChipMateNotificationAction
  showIn?: string[]
  suggestModelId?: string
}

// Profile types from chipmate-gateway
export interface ChipMateBalance {
  balance: number
}

export interface ChipMatePassState {
  currentPeriodBaseCreditsUsd: number
  currentPeriodUsageUsd: number
  currentPeriodBonusCreditsUsd: number
  nextBillingAt?: string | null
}

export interface ProfileData {
  profile: {
    email: string
    name?: string
    organizations?: Array<{ id: string; name: string; role: string }>
    selectedOrganizationId?: string
    hasPersonalAccount?: boolean
  }
  balance: ChipMateBalance | null
  chipmatePass: ChipMatePassState | null
  currentOrgId: string | null
}

import { z } from "zod"
import { CHIPMATE_API_BASE } from "./constants.js"
import { getDefaultHeaders, buildChipMateHeaders } from "../headers.js"

/**
 * ChipMate notification schema
 */
export const ChipMateNotificationSchema = z.object({
  id: z.string(),
  title: z.string(),
  message: z.string(),
  action: z
    .object({
      actionText: z.string(),
      actionURL: z.string(),
    })
    .optional(),
  showIn: z.array(z.string()).optional(),
  suggestModelId: z.string().optional(),
})

export type ChipMateNotification = z.infer<typeof ChipMateNotificationSchema>

const NotificationsResponseSchema = z.object({
  notifications: z.array(ChipMateNotificationSchema),
})

const NOTIFICATIONS_TIMEOUT_MS = 5000

/**
 * Fetch notifications from ChipMate API
 *
 * @param options - Configuration with token and optional organization ID
 * @returns Array of notifications from the ChipMate API (clients filter by showIn)
 */
export async function fetchChipMateNotifications(options: {
  chipmateToken?: string
  chipmateOrganizationId?: string
}): Promise<ChipMateNotification[]> {
  const token = options.chipmateToken
  if (!token) return []

  const url = `${CHIPMATE_API_BASE}/api/users/notifications`

  try {
    const response = await fetch(url, {
      headers: {
        ...getDefaultHeaders(),
        ...buildChipMateHeaders(undefined, { chipmateOrganizationId: options.chipmateOrganizationId }),
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(NOTIFICATIONS_TIMEOUT_MS),
    })

    if (!response.ok) return []

    const json = await response.json()
    const result = NotificationsResponseSchema.safeParse(json)

    if (!result.success) return []

    return result.data.notifications
  } catch {
    return []
  }
}

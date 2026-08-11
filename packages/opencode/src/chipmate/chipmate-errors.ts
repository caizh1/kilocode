import type { NamedError } from "@opencode-ai/core/util/error"
import { isRecord } from "@/util/record"

export const CHIPMATE_ERROR_CODES = {
  PAID_MODEL_AUTH_REQUIRED: "PAID_MODEL_AUTH_REQUIRED",
  PROMOTION_MODEL_LIMIT_REACHED: "PROMOTION_MODEL_LIMIT_REACHED",
} as const

export type ChipMateErrorCode = (typeof CHIPMATE_ERROR_CODES)[keyof typeof CHIPMATE_ERROR_CODES]

const CHIPMATE_ERROR_CODE_VALUES = Object.values(CHIPMATE_ERROR_CODES) as string[]

/**
 * Check if an error is a ChipMate-specific error (has a known ChipMate error code in responseBody).
 * Currently all ChipMate errors are non-retryable, but this may change in the future.
 */
export function isChipMateError(error: ReturnType<NamedError["toObject"]>): boolean {
  return parseChipMateErrorCode(error) !== undefined
}

/**
 * Get a user-friendly title for a ChipMate error code.
 */
export function chipmateErrorTitle(code: ChipMateErrorCode): string {
  switch (code) {
    case CHIPMATE_ERROR_CODES.PAID_MODEL_AUTH_REQUIRED:
      return "You need to sign in to use this model"
    case CHIPMATE_ERROR_CODES.PROMOTION_MODEL_LIMIT_REACHED:
      return "You need to sign up to keep going"
  }
}

/**
 * Get a user-friendly description for a ChipMate error code.
 */
export function chipmateErrorDescription(code: ChipMateErrorCode): string {
  switch (code) {
    case CHIPMATE_ERROR_CODES.PAID_MODEL_AUTH_REQUIRED:
      return "Sign in or create an account to access over 500 models, use credits at cost, or bring your own key."
    case CHIPMATE_ERROR_CODES.PROMOTION_MODEL_LIMIT_REACHED:
      return "Sign up for free to continue and explore 500 other models. Takes 2 minutes, no credit card required. Or come back later."
  }
}

/**
 * Show a warning toast with the appropriate ChipMate error title/description.
 * Caller should check isChipMateError() first.
 */
export function showChipMateErrorToast(
  error: ReturnType<NamedError["toObject"]>,
  toast: { show: (opts: { variant: "warning"; title: string; message: string; duration: number }) => void },
): void {
  const code = parseChipMateErrorCode(error)
  if (!code) return
  toast.show({
    variant: "warning",
    title: chipmateErrorTitle(code),
    message: chipmateErrorDescription(code),
    duration: 5000,
  })
}

/**
 * Extract the specific ChipMate error code from an APIError's responseBody.
 * Returns the code string if found, undefined otherwise.
 *
 * Note: We check error.name === "APIError" directly instead of using
 * MessageV2.APIError.isInstance() to avoid a circular dependency
 * (message-v2.ts re-exports from this file).
 */
export function parseChipMateErrorCode(error: ReturnType<NamedError["toObject"]>): ChipMateErrorCode | undefined {
  if (error.name !== "APIError") return undefined
  const responseBody = isRecord(error.data) ? error.data.responseBody : undefined
  if (typeof responseBody !== "string") return undefined
  try {
    const body = JSON.parse(responseBody)
    // Backend sends: { error: { code: "PAID_MODEL_AUTH_REQUIRED" } }
    // or: { code: "PROMOTION_MODEL_LIMIT_REACHED" }
    const code = body?.error?.code ?? body?.code
    if (typeof code === "string" && CHIPMATE_ERROR_CODE_VALUES.includes(code)) {
      return code as ChipMateErrorCode
    }
  } catch {}
  return undefined
}

/**
 * ChipMate Gateway Configuration Constants
 * Centralized configuration for all API endpoints, headers, and settings
 */

/** Environment variable for custom ChipMate API URL */
export const ENV_CHIPMATE_API_URL = "CHIPMATE_API_URL"

/** Default ChipMate API URL */
export const DEFAULT_CHIPMATE_API_URL = "https://api.chipmate.ai"

/** Base URL for ChipMate API - can be overridden by CHIPMATE_API_URL env var */
export const CHIPMATE_API_BASE = process.env[ENV_CHIPMATE_API_URL] || DEFAULT_CHIPMATE_API_URL

/** Environment variable for custom ChipMate Chat URL */
export const CHIPMATE_CHAT_URL_ENV = "CHIPMATE_CHAT_URL"

/** Default ChipMate Chat URL (REST endpoint for messages, conversations, etc.) */
export const CHIPMATE_DEFAULT_CHAT_URL = "https://chat.chipmateapps.io"

/** Base URL for ChipMate Chat - can be overridden by CHIPMATE_CHAT_URL env var */
export const CHIPMATE_CHAT_URL = process.env[CHIPMATE_CHAT_URL_ENV] || CHIPMATE_DEFAULT_CHAT_URL

/** Environment variable for custom Event Service URL */
export const CHIPMATE_EVENT_SERVICE_URL_ENV = "EVENT_SERVICE_URL"

/** Default Event Service URL (WebSocket endpoint for chipmate-chat events) */
export const CHIPMATE_DEFAULT_EVENT_SERVICE_URL = "wss://events.chipmateapps.io"

/** Base URL for Event Service - can be overridden by EVENT_SERVICE_URL env var */
export const CHIPMATE_EVENT_SERVICE_URL = process.env[CHIPMATE_EVENT_SERVICE_URL_ENV] || CHIPMATE_DEFAULT_EVENT_SERVICE_URL

/** Default base URL for OpenRouter-compatible endpoint */
export const CHIPMATE_OPENROUTER_BASE = `${CHIPMATE_API_BASE}/api/openrouter`

/** Device auth polling interval in milliseconds */
export const POLL_INTERVAL_MS = 3000

/** Default model for authenticated users */
export const DEFAULT_MODEL = "chipmate-auto/free"

/** Default model for anonymous/free usage */
export const DEFAULT_FREE_MODEL = "chipmate-auto/free"

/** Token expiration duration in milliseconds (1 year) */
export const TOKEN_EXPIRATION_MS = 365 * 24 * 60 * 60 * 1000

/** User-Agent header base value for requests */
export const USER_AGENT_BASE = "opencode-chipmate-provider"

/** Content-Type header value for requests */
export const CONTENT_TYPE = "application/json"

/** Default provider name */
export const DEFAULT_PROVIDER_NAME = "chipmate"

/** Default API key for anonymous requests */
export const ANONYMOUS_API_KEY = "anonymous"

/** Fetch timeout for model requests in milliseconds (10 seconds) */
export const MODELS_FETCH_TIMEOUT_MS = 10 * 1000

/**
 * Header constants for ChipMate API requests
 */
export const HEADER_ORGANIZATIONID = "X-CHIPMATE-ORGANIZATIONID"
export const HEADER_TASKID = "X-CHIPMATE-TASKID"
export const HEADER_PARENT_TASKID = "X-CHIPMATE-PARENT-TASKID"
export const HEADER_PROJECTID = "X-CHIPMATE-PROJECTID"
export const HEADER_TESTER = "X-CHIPMATE-TESTER"
export const HEADER_EDITORNAME = "X-CHIPMATE-EDITORNAME"
export const HEADER_MACHINEID = "X-CHIPMATE-MACHINEID"

/** Default editor name value */
export const DEFAULT_EDITOR_NAME = "ChipMate CLI"

/** Environment variable name for custom editor name */
export const ENV_EDITOR_NAME = "CHIPMATE_EDITOR_NAME"

/** Environment variable name for version (set by CLI at startup) */
export const ENV_VERSION = "CHIPMATE_VERSION"

/** Tester header value for suppressing warnings */
export const TESTER_SUPPRESS_VALUE = "SUPPRESS"

/** Header name for feature tracking */
export const HEADER_FEATURE = "X-CHIPMATE-FEATURE"

/** Environment variable name for feature override */
export const ENV_FEATURE = "CHIPMATE_FEATURE"

export const PROMPTS = [
  "codex",
  "gemini",
  "beast",
  "anthropic",
  "trinity",
  "anthropic_without_todo",
  "ling",
  "gpt55",
] as const

export const AI_SDK_PROVIDERS = [
  "alibaba",
  "anthropic",
  "mistral",
  "openai",
  "openai-compatible",
  "openrouter",
] as const

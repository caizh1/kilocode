// ============================================================================
// Plugin
// ============================================================================
export { ChipMateAuthPlugin, default } from "./plugin.js"

// ============================================================================
// Provider
// ============================================================================
export { createChipMate } from "./provider.js"
export { createChipMateDebug } from "./provider-debug.js"
export { chipmateCustomLoader } from "./loader.js"
export { buildChipMateHeaders, getEditorNameHeader, getFeatureHeader, getDefaultHeaders, getUserAgent } from "./headers.js"

// ============================================================================
// Auth
// ============================================================================
export { authenticateWithDeviceAuth } from "./auth/device-auth.js"
export { authenticateWithDeviceAuthTUI } from "./auth/device-auth-tui.js"
export { getChipMateUrlFromToken, isValidChipMateToken, getApiKey } from "./auth/token.js"
export { poll, formatTimeRemaining } from "./auth/polling.js"
export { migrateLegacyChipMateAuth, LEGACY_CONFIG_PATH } from "./auth/legacy-migration.js"

// ============================================================================
// API
// ============================================================================
export {
  fetchProfile,
  fetchBalance,
  fetchProfileWithBalance,
  fetchDefaultModel,
  getChipMateProfile,
  defaultOrganizationId,
  getChipMateBalance,
  getChipMateDefaultModel,
  promptOrganizationSelection,
} from "./api/profile.js"
export { fetchChipMatePassState } from "./api/chipmate-pass.js"
export {
  fetchChipMateModels,
  type ChipMateModelsResult,
  fetchChipMateImageModels,
  type ChipMateImageModel,
  type ChipMateImageModelsResult,
  fetchChipMateTranscriptionModels,
  type ChipMateTranscriptionModel,
  type ChipMateTranscriptionModelsResult,
} from "./api/models.js"
export {
  EMPTY_CHIPMATE_EMBEDDING_MODEL_CATALOG,
  fetchChipMateEmbeddingModelCatalog,
  type ChipMateEmbeddingModel,
  type ChipMateEmbeddingModelCatalog,
  type ChipMateEmbeddingModelCatalogIssue,
} from "./api/embedding-models.js"
export { resolveChipMateGatewayBaseUrl, resolveChipMateOpenRouterBaseUrl } from "./api/url.js"
export {
  AUTOCOMPLETE_MODELS,
  DEFAULT_AUTOCOMPLETE_MODEL,
  getAutocompleteModel,
  getAutocompleteModelById,
  validAutocompleteModel,
  validAutocompleteProvider,
  type AutocompleteModelDef,
  type AutocompleteProviderID,
} from "./autocomplete.js"
export {
  fetchOrganizationModes,
  clearModesCache,
  type OrganizationMode,
  type OrganizationModeConfig,
} from "./api/modes.js"
export { fetchChipMateNotifications, type ChipMateNotification } from "./api/notifications.js"
export {
  fetchCloudSession,
  fetchCloudSessionForImport,
  SessionImportValidationError,
  prepareSessionImport,
  importSessionToDb,
} from "./cloud-sessions.js"

// ============================================================================
// Server Routes (optional - requires hono and OpenCode dependencies)
// ============================================================================
export { createChipMateRoutes } from "./server/routes.js"
export {
  GatewayError,
  UnauthorizedError,
  getOrganizationId,
  getClawChatCredentials,
  getClawStatus,
  getCloudSessions,
  getNotifications,
  getProfile,
  getToken,
  normalizeClawStatus,
  setOrganization,
} from "./server/handlers.js"

// ============================================================================
// Note: TUI exports moved to separate entry point
// ============================================================================
// For TUI components and commands, import from "@chipmate/chipmate-gateway/tui"
// This avoids circular dependencies with opencode TUI infrastructure

// ============================================================================
// Types
// ============================================================================
export type {
  // Auth types
  DeviceAuthInitiateResponse,
  DeviceAuthPollResponse,
  Organization,
  ChipMateProfile,
  ChipMateBalance,
  ChipMatePassState,
  PollOptions,
  PollResult,
  // Provider types
  ChipMateProvider,
  ChipMateProviderOptions,
  ChipMateMetadata,
  CustomLoaderResult,
  ProviderInfo,
  LanguageModelV3,
} from "./types.js"

// ============================================================================
// Constants
// ============================================================================
export {
  ENV_CHIPMATE_API_URL,
  DEFAULT_CHIPMATE_API_URL,
  CHIPMATE_API_BASE,
  CHIPMATE_CHAT_URL,
  CHIPMATE_EVENT_SERVICE_URL,
  CHIPMATE_OPENROUTER_BASE,
  POLL_INTERVAL_MS,
  DEFAULT_MODEL,
  DEFAULT_FREE_MODEL,
  TOKEN_EXPIRATION_MS,
  USER_AGENT_BASE,
  CONTENT_TYPE,
  DEFAULT_PROVIDER_NAME,
  ANONYMOUS_API_KEY,
  MODELS_FETCH_TIMEOUT_MS,
  HEADER_ORGANIZATIONID,
  HEADER_TASKID,
  HEADER_PARENT_TASKID,
  HEADER_PROJECTID,
  HEADER_TESTER,
  HEADER_EDITORNAME,
  HEADER_MACHINEID,
  HEADER_FEATURE,
  DEFAULT_EDITOR_NAME,
  ENV_EDITOR_NAME,
  ENV_VERSION,
  TESTER_SUPPRESS_VALUE,
  ENV_FEATURE,
  PROMPTS,
  AI_SDK_PROVIDERS,
} from "./api/constants.js"

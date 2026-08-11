/**
 * ChipMate Gateway TUI Integration
 *
 * This module provides TUI-specific functionality for chipmate-gateway.
 * It requires OpenCode TUI dependencies to be injected at runtime.
 *
 * Import from "@chipmate/chipmate-gateway/tui" for TUI features.
 */

// ============================================================================
// TUI Dependency Injection
// ============================================================================
export { initializeTUIDependencies, getTUIDependencies, areTUIDependenciesInitialized } from "./tui/context.js"
export type { TUIDependencies } from "./tui/types.js"

// ============================================================================
// TUI Helpers
// ============================================================================
export { formatProfileInfo, getOrganizationOptions, getDefaultOrganizationSelection } from "./tui/helpers.js"

// ============================================================================
// NOTE: TUI Components Moved to OpenCode
// ============================================================================
// All TUI components with JSX have been moved to packages/opencode/src/chipmate/
// to ensure correct JSX transpilation with @opentui/solid.
//
// Components moved:
// - registerChipMateCommands -> @/chipmate/chipmate-commands
// - DialogChipMateTeamSelect -> @/chipmate/components/dialog-chipmate-team-select
// - DialogChipMateOrganization -> @/chipmate/components/dialog-chipmate-organization
// - DialogChipMateProfile -> @/chipmate/components/dialog-chipmate-profile
// - ChipMateAutoMethod -> @/chipmate/components/dialog-chipmate-auto-method
// - ChipMateNews -> @/chipmate/components/chipmate-news
// - NotificationBanner -> @/chipmate/components/notification-banner
// - DialogChipMateNotifications -> @/chipmate/components/dialog-chipmate-notifications

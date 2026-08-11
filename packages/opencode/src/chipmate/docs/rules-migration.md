# ChipMate Rules Migration

This document explains how ChipMate rules are automatically migrated to Opencode's `instructions` config array.

## Overview

ChipMate stores rules in various file locations. When Opencode starts, it reads these files and injects their paths into the `instructions` config array, which Opencode then loads as part of the system prompt.

## Key Guarantees

### 1. Read-Only Migration

The migration **never modifies project files**. We only:

- Read existing rule files from disk
- Inject file paths into the config's `instructions` array
- Never write to the project or modify any files

### 2. Combines with Existing Config (Never Overwrites)

If you have existing opencode config with `instructions`, the ChipMate rules are **combined**, not replaced:

```typescript
// Example: User has opencode.json with:
{ "instructions": ["AGENTS.md", "custom-rules.md"] }

// ChipMate rules add:
{ "instructions": [".chipmaterules", ".chipmate/rules/coding.md"] }

// Result (combined, deduplicated):
{ "instructions": ["AGENTS.md", "custom-rules.md", ".chipmaterules", ".chipmate/rules/coding.md"] }
```

### 3. Restart to Pick Up Changes

If you change your ChipMate configuration (e.g., edit `.chipmaterules`), simply restart chipmate-cli to pick up the new config. No manual migration or conversion needed.

## Source Locations

The migrator reads rules from these locations:

### Project Rules

| Location | Description |
|---|---|
| `.chipmaterules` | Legacy single-file rules in project root |
| `.chipmate/rules/*.md` | Directory-based rules (multiple markdown files) |
| `.chipmaterules-{mode}` | Mode-specific legacy rules (e.g., `.chipmaterules-code`) |
| `.chipmate/rules-{mode}/*.md` | Mode-specific rule directories |

### Global Rules

| Location | Description |
|---|---|
| `~/.chipmate/rules/*.md` | Global rules directory |

## File Mapping

| ChipMate Location | Opencode Equivalent |
|---|---|
| `.chipmaterules` | `instructions: [".chipmaterules"]` |
| `.chipmaterules-{mode}` | `instructions: [".chipmaterules-{mode}"]` |
| `.chipmate/rules/*.md` | `instructions: [".chipmate/rules/file.md", ...]` |
| `.chipmate/rules-{mode}/*.md` | `instructions: [".chipmate/rules-{mode}/file.md", ...]` |
| `~/.chipmate/rules/*.md` | `instructions: ["~/.chipmate/rules/file.md", ...]` |

## AGENTS.md Compatibility

`AGENTS.md` is loaded **natively** by Opencode - no migration needed. Opencode automatically loads:

- `AGENTS.md` in project root
- `CLAUDE.md` in project root
- `~/.config/chipmate/AGENTS.md` (global)

## Not Migrated

The following are **not** migrated:

- `.roorules` - Roo-specific rules
- `.clinerules` - Cline-specific rules

Only ChipMate-specific files (`.chipmaterules`, `.chipmate/rules/`) are migrated.

## Mode-Specific Rules

Mode-specific rules (e.g., `.chipmaterules-code`, `.chipmate/rules-architect/`) are included by default. All mode-specific rules are loaded regardless of the current mode.

## Warnings

The migrator generates warnings for:

- **Legacy files**: When `.chipmaterules` is found, a warning suggests migrating to `.chipmate/rules/` directory structure

## Example

### Before (ChipMate)

```
project/
├── .chipmaterules           # Legacy rules
├── .chipmaterules-code      # Code-mode specific
└── .chipmate/
    └── rules/
        ├── coding.md        # Coding standards
        └── testing.md       # Testing guidelines
```

### After (Opencode Config)

```json
{
  "instructions": [
    "/path/to/project/.chipmate/rules/coding.md",
    "/path/to/project/.chipmate/rules/testing.md",
    "/path/to/project/.chipmaterules",
    "/path/to/project/.chipmaterules-code"
  ]
}
```

## Troubleshooting

### Rules not appearing

1. Check the file exists at the expected location
2. Ensure markdown files have `.md` extension
3. Restart chipmate-cli to pick up changes

### Duplicate rules

The `mergeConfigConcatArrays` function automatically deduplicates the `instructions` array using `Array.from(new Set([...]))`.

## Related Files

- [`rules-migrator.ts`](../rules-migrator.ts) - Core migration logic
- [`config-injector.ts`](../config-injector.ts) - Config building and injection
- [`modes-migration.md`](./modes-migration.md) - Modes migration documentation

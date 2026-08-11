---
title: "Development Patterns"
description: "Contributor patterns for ChipMate architecture implementation and fork maintenance"
---

# Development Patterns

This page turns architecture boundaries into contributor decisions. Read [Architecture Overview](/docs/contributing/architecture) and relevant subsystem page first, then use this guide before editing architecture-facing code in `ChipMate-Org/chipmate` or its cross-repository contracts.

{% callout type="info" title="Default rule" %}
Prefer ChipMate-owned seams over broad changes to shared OpenCode files. Follow neighboring style when changing existing modules.
{% /callout %}

## How to use this page

1. Identify owning subsystem in architecture docs.
2. Choose narrowest source boundary that can hold change.
3. Update generated or cross-repository contracts when public surface changes.
4. Run smallest relevant checks plus affected repository guards.

## Where should change live?

| Change shape | Preferred location or action | Reason |
|---|---|---|
| Additive ChipMate CLI behavior | `packages/opencode/src/chipmate/` | Keeps ChipMate-only behavior out of upstream-owned files |
| ChipMate CLI test for additive behavior | `packages/opencode/test/chipmate/` | Avoids shared tests that encode only ChipMate behavior |
| Required shared OpenCode edit | Small import, route, or injection seam in shared file plus `chipmate_change` marker | Keeps upstream diff narrow and merge review obvious |
| VS Code, JetBrains, docs, indexing, UI, gateway, or telemetry change | Existing ChipMate-owned package | These packages are ChipMate-owned; do not add `chipmate_change` markers |
| CLI server endpoint change | Effect `HttpApi` route plus handler; then run root SDK generator | Keeps server contract and generated JavaScript SDK aligned |
| JetBrains API contract change | Shared CLI OpenAPI change; let Gradle regenerate build-local Kotlin client | Kotlin client is generated during JetBrains build |
| ChipMate-only config-key change | Update CLI Effect Schema and cloud JSON Schema overlay | Runtime acceptance and editor validation are separate cross-repository paths |
| Docs page move or removal | Update nav and add permanent redirect | Preserves external links and bookmarks |

## ChipMate-owned boundaries

ChipMate CLI forks upstream OpenCode. Prefer ChipMate-owned directories and packages for additive behavior:

| Prefer | Avoid unless necessary |
|---|---|
| `packages/opencode/src/chipmate/` | Broad edits to shared `packages/opencode/src/` files |
| `packages/opencode/test/chipmate/` | Shared tests that encode only ChipMate behavior |
| `packages/chipmate-vscode/`, `packages/chipmate-jetbrains/`, `packages/chipmate-docs/`, `packages/chipmate-indexing/` | Moving ChipMate-only behavior into upstream-owned modules |
| Narrow import or route seams in shared files | Refactors that enlarge upstream merge conflicts |

## Shared OpenCode files

Use `chipmate_change` markers when ChipMate-specific code must modify shared upstream files.

| Change shape | Marker |
|---|---|
| One line | Trailing `// chipmate_change` |
| Multi-line block | `// chipmate_change start` and `// chipmate_change end` |
| New file in shared path | Top-level `// chipmate_change - new file` |
| JSX or TSX | JSX comment equivalents |

Marker exemptions apply to paths already owned by ChipMate, including paths whose names contain `chipmate` and ChipMate packages such as `packages/chipmate-vscode/` or `packages/chipmate-ui/`. Do not add markers there.

| Guard | When to run |
|---|---|
| `bun run script/check-opencode-annotations.ts` | PR touches `packages/opencode/`; verifies shared OpenCode ChipMate edits are annotated |
| `bun run script/check-opencode-promise-facades.ts` | Service adapter changes; prevents new runtime-backed Promise facades in shared Effect services |
| `bun run check-chipmate-change` from `packages/chipmate-vscode/` | VS Code or ChipMate UI changes; markers must not appear in fully ChipMate-owned packages |
| `bun run script/check-workflows.ts` | Workflow add or remove changes; keeps workflow allowlist explicit |

## CLI server API

CLI server uses Effect `HttpApi` and publishes OpenAPI-compatible HTTP + SSE surfaces consumed by JavaScript SDK and JetBrains build-local Kotlin client.

| Rule | Reason |
|---|---|
| Define shared routes under `packages/opencode/src/server/routes/instance/httpapi/` | Keeps route contract close to runtime handlers |
| Normalize public spec in `packages/opencode/src/server/routes/instance/httpapi/public.ts` | Preserves legacy-compatible request and response shapes during Effect migration |
| Put additive ChipMate groups and handlers under `packages/opencode/src/chipmate/server/httpapi/` | Reduces edits in shared upstream-owned files |
| Inject ChipMate APIs through narrow shared seam | Keeps upstream diff small and marker placement obvious |
| Preserve route spans and stable attributes | Keeps diagnostics and telemetry understandable |

## SDK generation

[CLI Runtime SDK contract](/docs/contributing/architecture/cli-runtime#sdk-contract) owns generation pipeline detail. Contributor rules are short:

| Change | Action |
|---|---|
| Add or change CLI server endpoint | Run root `./script/generate.ts` after route and handler edits |
| JavaScript SDK generated files under `packages/sdk/js/src/v2/gen/` | Do not edit by hand |
| JavaScript SDK wrapper behavior | Edit handwritten `packages/sdk/js/src/v2/client.ts` |
| JetBrains generated Kotlin client | Let Gradle regenerate build-local client from normalized OpenAPI |

## CLI config schema

Runtime config loading and editor validation are separate paths. New ChipMate-only config key requires CLI Effect Schema change in `ChipMate-Org/chipmate` and JSON Schema overlay change in `ChipMate-Org/cloud`. Follow [CLI Config Schema](/docs/contributing/architecture/config-schema) for exact workflow.

## Module export pattern

For new public APIs, prefer flat ESM exports inside module, then namespace re-exports from index files when grouped access helps callers.

```typescript
// packages/opencode/src/session/session.ts
export const create = fn(CreateSchema, async (input) => {
  // ...
})

export const list = fn(ListSchema, async (input) => {
  // ...
})

// packages/opencode/src/session/index.ts
export * as Session from "./session"
```

Import specific export when practical. Use namespace shape (`Session.create`) when preserving existing API or grouped module access improves clarity. Existing ChipMate-owned namespaces remain valid; do not refactor them solely for style.

## Tool implementation

Tools use `Tool.define("id", Effect.gen(...))` with Effect Schema validation and typed execution.

```typescript
export const ExampleTool = Tool.define(
  "example",
  Effect.gen(function* () {
    return {
      description: "Example tool",
      parameters: Schema.Struct({
        value: Schema.String,
      }),
      execute(args) {
        return Effect.succeed({
          title: args.value,
          metadata: {},
          output: args.value,
        })
      },
    }
  }),
)
```

Reuse tool helpers, permission gates, and telemetry conventions before adding abstractions. Tests should exercise implementation behavior rather than duplicating logic in mocks.

## Build system

| Area | Tooling |
|---|---|
| Package manager | Bun workspaces |
| Task orchestration | Turborepo |
| CLI executable | Bun compile build in `packages/opencode/script/build.ts` |
| VS Code extension and webviews | esbuild |
| JetBrains plugin | Gradle, Kotlin JVM toolchain 21, build-local OpenAPI generation |
| Type checking | `tsgo` through `bun turbo typecheck`; Gradle compile checks for JetBrains |
| Tests | Package-level Bun test, Vitest, or Gradle test depending on package |
| Docs | Next.js, Markdoc, Mermaid, and custom Markdoc components |

## Documentation changes

When adding or moving docs pages:

- Create page under `pages/`.
- Update matching navigation file in `lib/nav/`.
- Add redirects when removing or moving routes.
- Use compact markdown tables with unpadded cells.
- Use `/docs` prefix for docs image paths.

## Source map

Paths below are relative to [`ChipMate-Org/chipmate`](https://github.com/ChipMate-Org/chipmate).

| Concern | Source path |
|---|---|
| Tool definition API | `packages/opencode/src/tool/tool.ts` |
| Tool example | `packages/opencode/src/tool/read.ts` |
| Server APIs | `packages/opencode/src/server/routes/instance/httpapi/` |
| Public OpenAPI normalization | `packages/opencode/src/server/routes/instance/httpapi/public.ts` |
| ChipMate route seam | `packages/opencode/src/chipmate/server/httpapi/` |
| JavaScript SDK generation | `packages/sdk/js/script/build.ts`{% linebreak /%}`script/generate.ts` |
| JetBrains client generation | `packages/chipmate-jetbrains/backend/build.gradle.kts` |
| Upstream merge automation | `script/upstream/` |

## Upstream merge workflow

`bun install` runs `script/setup-git.ts`, which sets repo-local merge conflict style to `zdiff3`. Base-aware markers make manual resolution and syntax-aware tooling more useful. Upstream automation under `script/upstream/` applies transforms before merge, forces `zdiff3` for merge operation, and runs `mergiraf` against remaining textual conflicts. `mergiraf` is required by merge script.

From `script/upstream/`, use:

```bash
bun run analyze.ts --version <tag>
bun run merge.ts --version <tag> --dry-run
bun run merge.ts --version <tag>
```

Keep ChipMate-specific logic extracted, shared seams narrow, markers accurate, and CI guards green before upstream merge work lands.

## Related pages

- [Architecture Overview](/docs/contributing/architecture) - system layers and reading paths
- [CLI Runtime](/docs/contributing/architecture/cli-runtime) - local runtime ownership and SDK contract
- [CLI Config Schema](/docs/contributing/architecture/config-schema) - cross-repository config-key workflow

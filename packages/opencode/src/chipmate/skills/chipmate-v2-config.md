# ChipMate v2 Configuration Safety Reference

ChipMate v2 is isolated from native ChipMate. Project configuration and project-owned agents, commands, skills, plans, workflows, and artifacts must stay under `.chipmate-v2/`. The primary project configuration target is `.chipmate-v2/chipmate.jsonc`.

Global ChipMate configuration, authentication, sessions, and caches live under the VS Code extension's own global storage. Resolve those paths through the running ChipMate configuration APIs or Settings UI; never guess or construct a native ChipMate path.

Do not read, write, migrate, rename, or delete native ChipMate configuration or state. In particular, do not use project-root `chipmate.json` or `chipmate.jsonc`, and do not use native ChipMate home or project directories. When a requested operation is not exposed through ChipMate's configuration APIs, explain the limitation instead of falling back to a native ChipMate path.

For project changes, prefer the built-in configuration, agent, MCP, permission, and artifact tools. Use the exact target path returned by the tool and keep all manual files within `.chipmate-v2/`.

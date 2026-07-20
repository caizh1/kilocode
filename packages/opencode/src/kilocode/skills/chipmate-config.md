# ChipMate v2 Configuration Safety Reference

ChipMate v2 is isolated from native Kilo. Project configuration and project-owned agents, commands, skills, plans, workflows, and artifacts must stay under `.chipmate-v2/`. The primary project configuration target is `.chipmate-v2/kilo.jsonc`.

Global ChipMate configuration, authentication, sessions, and caches live under the VS Code extension's own global storage. Resolve those paths through the running ChipMate configuration APIs or Settings UI; never guess or construct a native Kilo path.

Do not read, write, migrate, rename, or delete native Kilo configuration or state. In particular, do not use project-root `kilo.json` or `kilo.jsonc`, and do not use native Kilo home or project directories. When a requested operation is not exposed through ChipMate's configuration APIs, explain the limitation instead of falling back to a native Kilo path.

For project changes, prefer the built-in configuration, agent, MCP, permission, and artifact tools. Use the exact target path returned by the tool and keep all manual files within `.chipmate-v2/`.

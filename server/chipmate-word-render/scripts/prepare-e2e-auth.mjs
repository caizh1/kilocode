import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

const root = resolve(".runtime/e2e-auth")
await mkdir(root, { recursive: true })
await writeFile(resolve(root, "master.key"), "ChipMate-E2E-Authentication-Master-Key-0001\n", { mode: 0o600 })
await writeFile(resolve(root, "break-glass.key"), "ChipMate-E2E-Break-Glass-Key\n", { mode: 0o600 })

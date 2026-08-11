# Dedicated Output Channel

**Priority:** P2

Agent Manager has its own output channel. No general "ChipMate" output channel exists.

## Remaining Work

- Create `vscode.window.createOutputChannel("ChipMate")` during activation
- Centralized logging utility with log levels (debug, info, warn, error)
- Route all `[ChipMate New]` log messages to this channel
- Dispose on deactivation
- Migrate existing `console.log("[ChipMate New] ...")` calls to the logger

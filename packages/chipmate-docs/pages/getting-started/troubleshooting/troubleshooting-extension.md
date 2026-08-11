---
title: "Troubleshooting IDE Extensions"
description: "How to capture console logs and report issues with ChipMate"
---

# Capturing Console Logs

Providing console logs helps us pinpoint exactly what's going wrong with your installation, network, or MCP setup. This guide walks you through capturing those logs in your IDE.

## Opening Developer Tools

1. **Open the Command Palette**: Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
2. **Search for Developer Tools**: Type `Developer: Open Webview Developer Tools` and select it

## Capturing the Error

Once you have the Developer Tools console open:

1. **Clear previous logs**: Click the "Clear Console" button (🚫 icon at the top of the Console panel) to remove old messages
2. **Reproduce the issue**: Perform the action that was causing problems
3. **Check for errors**: Look at the Console tab for error messages (usually shown in red). If you suspect connection issues, also check the **Network** tab
4. **Copy the logs**: Right-click in the console and select "Save as..." or copy the relevant error messages

## SQLite database is malformed

If every prompt fails with `SQLiteError: database disk image is malformed`, ChipMate's local SQLite database may be corrupted. This database stores local ChipMate state such as sessions and history.

### Find the database

When the chipmate CLI uses the same environment as the affected installation, run `chipmate db path` to print the selected database. See [Session History and Search](/docs/code-with-ai/agents/session-history) for normal database inspection and search workflows.

The default database location depends on where ChipMate is running:

| Environment | Database path |
|---|---|
| Windows | `%USERPROFILE%\.local\share\chipmate\chipmate.db` |
| macOS | `~/.local/share/chipmate/chipmate.db` |
| Linux | `~/.local/share/chipmate/chipmate.db` |
| VS Code Remote SSH | `~/.local/share/chipmate/chipmate.db` on the remote machine |

{% callout type="warning" %}
When using VS Code Remote SSH, check the remote Linux machine, not your local Windows or macOS computer.
{% /callout %}

### Reset the database

Close VS Code or stop the ChipMate backend first. On Linux or Remote SSH, run:

```bash
pkill -f "chipmate serve"
mkdir -p ~/.local/share/chipmate
mv ~/.local/share/chipmate/chipmate.db ~/.local/share/chipmate/chipmate.db.bak
mv ~/.local/share/chipmate/chipmate.db-wal ~/.local/share/chipmate/chipmate.db-wal.bak 2>/dev/null
mv ~/.local/share/chipmate/chipmate.db-shm ~/.local/share/chipmate/chipmate.db-shm.bak 2>/dev/null
```

Then reload VS Code or reconnect Remote SSH. ChipMate recreates the database the next time it starts.

On Windows or macOS, rename the database file and any `chipmate.db-wal` or `chipmate.db-shm` files in the same folder, then restart the IDE.

{% callout type="warning" %}
Renaming this database resets local ChipMate sessions and history for that machine. Keep the `.bak` files if you need to share them with support or attempt recovery later.
{% /callout %}

### Fully reset local ChipMate data

If resetting the database does not fix the issue, you can fully reset ChipMate's local data. This also removes local configuration and cache files, so use it only after trying the database reset above.

On Linux or VS Code Remote SSH, run this on the machine where ChipMate is running:

```bash
pkill -f "chipmate serve"
mv ~/.local/share/chipmate ~/.local/share/chipmate.bak 2>/dev/null
mv ~/.config/chipmate ~/.config/chipmate.bak 2>/dev/null
mv ~/.cache/chipmate ~/.cache/chipmate.bak 2>/dev/null
```

Then reload VS Code or reconnect Remote SSH. ChipMate recreates these directories the next time it starts.

{% callout type="warning" %}
This resets local sessions, history, settings, and cached data. Prefer renaming the directories instead of deleting them so you can recover files. Remove secrets such as API keys or tokens before sharing any backup with support.
{% /callout %}

## Contact Support

If you're unable to resolve the issue, please inspect the console logs, remove any secrets, and send the logs to **[hi@chipmate.ai](mailto:hi@chipmate.ai)** along with the following:

- The error messages from the console
- Steps to reproduce the issue
- Screenshots or screen recordings of the issue
- Your IDE and ChipMate version

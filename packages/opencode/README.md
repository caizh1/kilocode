# ChipMate CLI

The AI coding agent built for the terminal. Generate code from natural language, automate tasks, and run terminal commands -- powered by 500+ AI models.

![ChipMate CLI showing code edits in a terminal](https://raw.githubusercontent.com/ChipMate-Org/chipmate/main/packages/chipmate-docs/public/img/npm-package-readme/chipmate-cli.png)

ChipMate is the all-in-one agentic engineering platform. Build, ship, and iterate faster with the most popular open source coding agent.

[Website](https://chipmate.ai) · [Install](https://chipmate.ai/install) · [IDE](https://chipmate.ai/landing/vs-code) · [CLI](https://chipmate.ai/cli) · [Docs](https://chipmate.ai/docs) · [Models](https://chipmate.ai/leaderboard) · [Gateway](https://chipmate.ai/gateway) · [Pricing](https://chipmate.ai/pricing) · [ChipMate Pass](https://chipmate.ai/pricing/chipmate-pass)

[500+ models](https://chipmate.ai/leaderboard). One open source agent in [VS Code](https://chipmate.ai/vscode-marketplace), [JetBrains](https://plugins.jetbrains.com/plugin/27133-chipmate-code), [CLI](https://www.npmjs.com/package/@chipmate/cli), [Slack](https://chipmate.ai/slack), and [Cloud](https://chipmate.ai/cloud).

## Install

```bash
npm install -g @chipmate/cli
```

Or run directly with npx:

```bash
npx --package @chipmate/cli chipmate
```

## Getting Started

Run `chipmate` in any project directory to launch the interactive TUI:

```bash
chipmate
```

Run a one-off task:

```bash
chipmate run "add input validation to the signup form"
```

## Features

- **Code generation** -- describe what you want in natural language
- **Terminal commands** -- the agent can run shell commands on your behalf
- **500+ AI models** -- use models from OpenAI, Anthropic, Google, and more
- **MCP servers** -- extend agent capabilities with the Model Context Protocol
- **Multiple modes** -- Plan with Architect, code with Coder, debug with Debugger, or create your own
- **Sessions** -- resume previous conversations and export transcripts
- **API keys optional** -- bring your own keys or use ChipMate credits

## Commands

| Command               | Description                |
| --------------------- | -------------------------- |
| `chipmate`                | Launch interactive TUI     |
| `chipmate run "<task>"`   | Run a one-off task         |
| `chipmate auth`           | Manage authentication      |
| `chipmate models`         | List available models      |
| `chipmate mcp`            | Manage MCP servers         |
| `chipmate session list`   | List sessions              |
| `chipmate session delete` | Delete a session           |
| `chipmate export`         | Export session transcripts |

Run `chipmate --help` for the full list.

## Alternative Installation

### Homebrew (macOS/Linux)

```bash
brew install ChipMate-Org/tap/chipmate
```

### GitHub Releases

Download pre-built binaries from the [Releases page](https://github.com/ChipMate-Org/chipmate/releases).

## Documentation

- [Docs](https://chipmate.ai/docs)
- [Getting Started](https://chipmate.ai/docs/getting-started)

## Links

- [GitHub](https://github.com/ChipMate-Org/chipmate)
- [Discord](https://chipmate.ai/discord)
- [VS Code Extension](https://chipmate.ai/vscode-marketplace)
- [Website](https://chipmate.ai)

## License

MIT

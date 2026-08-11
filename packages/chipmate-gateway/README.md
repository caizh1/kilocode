# @chipmate/chipmate-gateway

Unified ChipMate Gateway package for OpenCode providing authentication, AI provider integration, and API access.

## Features

- **Authentication**: Device authorization flow for ChipMate Gateway
- **AI Provider**: OpenRouter-based provider with ChipMate Gateway integration
- **API Integration**: Profile, balance, and model management
- **TUI Helpers**: Utilities for terminal UI components

## Installation

```bash
bun add @chipmate/chipmate-gateway
```

## Usage

### Plugin Registration

```typescript
import { ChipMateAuthPlugin } from "@chipmate/chipmate-gateway"

// Register with OpenCode
const plugins = [ChipMateAuthPlugin]
```

### Provider Usage

```typescript
import { createChipMate } from "@chipmate/chipmate-gateway"

const provider = createChipMate({
  chipmateToken: process.env.CHIPMATE_API_KEY,
  chipmateOrganizationId: "org-123",
})

const model = provider.languageModel("anthropic/claude-sonnet-4")
```

### API Access

```typescript
import { fetchProfile, fetchBalance } from "@chipmate/chipmate-gateway"

const profile = await fetchProfile(token)
const balance = await fetchBalance(token)
```

## License

MIT

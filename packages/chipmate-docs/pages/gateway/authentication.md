---
title: "Authentication"
description: "Learn how to authenticate with the ChipMate AI Gateway using API keys, session tokens, and Bring Your Own Key (BYOK)."
---

# Authentication

The ChipMate AI Gateway supports multiple authentication methods depending on your use case.

## API key authentication

The primary authentication method is a Bearer token passed in the `Authorization` header:

```bash
Authorization: Bearer <your_api_key>
```

API keys are JWT tokens tied to your ChipMate account. See [how to get your API key](/docs/getting-started/setup-authentication#chipmate-gateway-api-key) for step-by-step instructions.

### Using your API key

{% tabs %}
{% tab label="TypeScript" %}

```typescript
import { createOpenAI } from "@ai-sdk/openai"

const chipmate = createOpenAI({
  baseURL: "https://api.chipmate.ai/api/gateway",
  apiKey: process.env.CHIPMATE_API_KEY,
})
```

{% /tab %}
{% tab label="Python" %}

```python
from openai import OpenAI

client = OpenAI(
    api_key=os.getenv("CHIPMATE_API_KEY"),
    base_url="https://api.chipmate.ai/api/gateway",
)
```

{% /tab %}
{% tab label="cURL" %}

```bash
curl -X POST "https://api.chipmate.ai/api/gateway/chat/completions" \
  -H "Authorization: Bearer $CHIPMATE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "anthropic/claude-sonnet-4.5", "messages": [{"role": "user", "content": "Hello"}]}'
```

{% /tab %}
{% /tabs %}

## Organization tokens

When making requests on behalf of an organization, include the organization ID in the request header:

```
X-ChipMate-OrganizationId: your_org_id
```

Organization tokens are scoped with a 15-minute expiry and enforce the organization's policies, including model allow lists, provider restrictions, and per-user spending limits.

## Anonymous access

The gateway allows unauthenticated access for free models only. Anonymous requests are identified by IP address and are subject to rate limiting (200 requests per hour per IP).

Free models include models tagged with `:free` in their model ID, such as `minimax/minimax-m2.1:free` and `z-ai/glm-5:free`.

## Bring Your Own Key (BYOK)

BYOK lets you use your own provider API keys with the ChipMate AI Gateway. When a BYOK key is configured, requests are sent to the provider using your key. You are billed directly by the provider -- ChipMate does not add any markup.

### Supported BYOK providers

| Provider | BYOK Key ID |
|---|---|
| Anthropic | `anthropic` |
| AWS Bedrock | `bedrock` |
| Google AI Studio | `google` |
| Inception | `inception` |
| OpenAI | `openai` |
| MiniMax | `minimax` |
| Mistral | `mistral` |
| xAI | `xai` |
| Z.AI | `zai` |
| BytePlus Coding Plan | `byteplus-coding` |
| Chutes BYOK | `chutes-byok` |
| Codestral (FIM) | `codestral` |
| CrofAI | `crofai` |
| Inceptron BYOK | `inceptron-byok` |
| Kimi Code | `kimi-coding` |
| Martian | `martian` |
| Neuralwatt | `neuralwatt` |
| NVIDIA | `nvidia-byok` |
| Ollama Cloud | `ollama-cloud` |
| OpenCode Go | `opencode-go` |
| OrcaRouter | `orcarouter` |
| Synthetic | `synthetic` |
| Xiaomi Token Plan (Europe) | `xiaomi-token-plan-ams` |
| Xiaomi Token Plan (Singapore) | `xiaomi-token-plan-sgp` |
| Z.ai Coding Plan | `zai-coding` |

### How BYOK works

1. Add your provider API key in the [ChipMate dashboard](https://app.chipmate.ai) or through your ChipMate extension settings
2. Keys are encrypted at rest using AES-256 encryption
3. When you make a request for a model from that provider, the gateway automatically uses your key
4. Usage is tracked but not billed to your ChipMate balance (cost is set to $0)
5. If your BYOK key fails, the request will not automatically fall back to ChipMate's keys

BYOK keys can be configured at the personal level or at the organization level. Organization-level keys apply to all members of the organization and require owner or billing manager access to manage.

## Request headers

The gateway accepts the following headers:

| Header | Required | Description |
|---|---|---|
| `Authorization` | Yes (unless free model) | `Bearer <api_key>` |
| `Content-Type` | Yes | `application/json` |
| `X-ChipMate-OrganizationId` | No | Organization context for org-scoped requests |
| `X-ChipMate-TaskId` | No | Task identifier for prompt cache keying |
| `X-ChipMate-Version` | No | Client version string |
| `x-chipmate-mode` | No | Mode hint for `chipmate-auto` model routing |

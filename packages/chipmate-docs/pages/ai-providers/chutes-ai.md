---
title: "Using Chutes AI with ChipMate"
description: "Access open-source AI models through Chutes AI in ChipMate. Setup guide for getting an API key and configuring models."
sidebar_label: Chutes AI
---

# Using Chutes AI With ChipMate

Chutes.ai offers free API access to several large language models (LLMs), allowing developers to integrate and experiment with these models without immediate financial commitment. They provide access to a curated set of open-source and proprietary language models, often with a focus on specific capabilities or regional language support.

**Website:** [https://chutes.ai/](https://chutes.ai/)

## Getting an API Key

To use Chutes AI with ChipMate, obtain an API key from the [Chutes AI platform](https://chutes.ai/). After signing up or logging in, you should find an option to generate or retrieve your API key within your account dashboard or settings.

## Supported Models

ChipMate will attempt to fetch the list of available models from the Chutes AI API. The specific models available will depend on Chutes AI's current offerings.

Always refer to the official Chutes AI documentation or your dashboard for the most up-to-date list of supported models.

## Configuration in ChipMate

{% tabs %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab to add Chutes AI and enter your API key.

The extension stores this in your `chipmate.json` config file. You can also edit the config file directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="CLI" %}

Set the API key as an environment variable or configure it in your `chipmate.json` config file:

**Environment variable:**

```bash
export CHUTES_API_KEY="your-api-key"
```

**Config file** (`~/.config/chipmate/chipmate.json` or `./chipmate.json`):

```jsonc
{
  "provider": {
    "chutes": {
      "env": ["CHUTES_API_KEY"],
    },
  },
}
```

Then set your default model:

```jsonc
{
  "model": "chutes/model-name",
}
```

{% /tab %}
{% /tabs %}

## Tips and Notes

- **Free Access:** Chutes AI provides free API access, making it an excellent option for experimentation and development without immediate costs.
- **Model Variety:** The platform offers access to both open-source and proprietary models, giving you flexibility in choosing the right model for your needs.
- **Rate Limits:** As with any free service, be aware of potential rate limits or usage restrictions that may apply to your API key.

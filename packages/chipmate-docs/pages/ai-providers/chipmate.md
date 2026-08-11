---
title: "Using the ChipMate Provider"
description: "The built-in ChipMate provider gives you access to top AI models with one account. Setup and sign-in guide."
sidebar_label: ChipMate Provider
---

# Using ChipMate's Built-in Provider

ChipMate provides its own built-in API provider that gives you access to the latest frontier coding models through a simple registration process. No need to manage API keys from multiple providers - just sign up and start coding.

**Website:** [https://chipmate.ai/](https://chipmate.ai/)

## Getting Started

When you sign up for ChipMate, you can start immediately with free models, or add credits to your account to access premium models.

1. **Sign up:** Complete the registration process
2. **Add credits:** Top up your account at [app.chipmate.ai](https://app.chipmate.ai/profile)
3. **Start Coding:** Use 500+ models including the latest frontier coding models

## Registration Process

ChipMate offers a streamlined registration that connects you directly to frontier coding models:

1. **Start Registration:** Click "Try ChipMate for Free" in the extension
2. **Sign In:** Use your Google account to sign in at chipmate.ai
3. **Authorize VS Code:**
   - chipmate.ai will prompt you to open Visual Studio Code
   - For web-based IDEs, you'll copy the API key manually instead
4. **Complete Setup:** Allow VS Code to open the authorization URL when prompted

<!-- <img src="/img/setting-up/signupflow.gif" alt="Sign up and registration flow with ChipMate" width="600" /> -->

## Supported Models

ChipMate provides access to the latest frontier coding models through its built-in provider. The specific models available are automatically updated and managed by the ChipMate service, ensuring you always have access to the most capable models for coding tasks.

## ChipMate Gateway integration

ChipMate routes requests through the ChipMate Gateway for model access, usage tracking, and organization controls. For BYOK setup, provider routing, and full model availability, use the Gateway docs as the source of truth:

- [ChipMate Gateway overview](/docs/gateway)
- [Models & Providers](/docs/gateway/models-and-providers)
- [Authentication & BYOK](/docs/gateway/authentication)

## Configuration in ChipMate

Once you've completed the registration process, ChipMate is automatically configured:

1. **Automatic Setup:** After successful registration, ChipMate is ready to use immediately
2. **No API Key Management:** Your authentication is handled seamlessly through the registration process
3. **Model Selection:** Access to frontier models is provided automatically through your ChipMate account

## Connected Accounts

With the ChipMate provider, if you sign up with Google you can also connect other sign in accounts - like GitHub - by:

1. Go to your profile
2. Select [**Connected Accounts**](https://app.chipmate.ai/connected-accounts)
3. Under "Link a New account" select the type of account to link
4. Complete the OAuth authorization, and you'll see your connected accounts!

<!-- <img src="/docs/img/chipmate-provider/connected-accounts.png" alt="Connect account screen" width="600" /> -->

## Tips and Notes

- **Free Models:** New users can start with free models to explore ChipMate's capabilities
- **Identity Verification:** The temporary hold system ensures service reliability while preventing misuse
- **Seamless Integration:** No need to manage multiple API keys or provider configurations
- **Latest Models:** Automatic access to the most current frontier coding models
- **Support Available:** Contact [hi@chipmate.ai](mailto:hi@chipmate.ai) for questions about pricing or tokens

For detailed setup instructions, see [Setting up ChipMate](/docs/getting-started/setup-authentication).

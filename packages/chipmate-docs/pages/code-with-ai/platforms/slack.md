---
title: "Slack"
description: "Using ChipMate in Slack"
---

# ChipMate for Slack

**ChipMate for Slack** brings ChipMate directly into your Slack workspace. Ask questions about your repositories, request code implementations, debug issues, and collaborate with your team — all without leaving Slack.

When you mention `@ChipMate` in a thread, the bot:

- Reads the full conversation
- Accesses your connected repositories
- Answers your question or spins up a Cloud Agent to implement the change
- Creates branches, pushes commits, and opens pull requests on your behalf

---

## What You Can Do

### Ask questions about your codebase

```
@ChipMate what does the UserService class do in our main backend repo?
```

```
@ChipMate how is error handling implemented in the payment processing module?
```

{% image src="/docs/img/connect/slack/slackbot-ask-questions.webp" alt="Asking ChipMate a question about the codebase in Slack" width="800" /%}

### Implement fixes and features from Slack discussions

When your team identifies a bug or improvement in a thread, ask the bot to handle it:

```
@ChipMate based on this thread, can you implement the fix for the null pointer exception in the order processing service?
```

The bot will:

- Read the thread context
- Understand the proposed solution
- Create a branch with the implementation
- Push a pull request to your repository

{% image src="/docs/img/connect/slack/slackbot-turn-discussions-into-PRs.webp" alt="ChipMate turning a Slack thread discussion into a pull request" width="800" /%}

### Implement changes across multiple repositories

If the same change needs to land in several repos, just tell the bot:

```
@ChipMate please fix this in the cloud, landing, and handbook repos
```

{% image src="/docs/img/connect/slack/slackbot-coding.webp" alt="ChipMate implementing changes across multiple repositories from Slack" width="800" /%}

### Debug issues

Paste an error message or stack trace and ask for help:

```
@ChipMate I'm seeing this error in production:
[paste error message]
Can you help me understand what's causing it?
```

{% image src="/docs/img/connect/slack/slackbot-bugs.webp" alt="ChipMate helping debug a production error in Slack" width="800" /%}

---

## How to Interact

### Direct Messages

You can DM ChipMate directly for private conversations. Find ChipMate in your workspace's app list and start a direct message.

Good for:

- Private questions about your code
- Sensitive debugging sessions
- Personal productivity tasks

### Channel Mentions

Mention the bot in any channel where it's been added:

```
@ChipMate can you explain how the authentication flow works in our backend?
```

Good for:

- Team discussions where AI assistance would help
- Collaborative debugging
- Getting quick answers during code reviews

---

## Prerequisites

Before using ChipMate for Slack:

- You need a ChipMate account with available credits
- Your Git provider integration (GitHub or GitLab) must be configured via the Integrations tab at [app.chipmate.ai](https://app.chipmate.ai) so ChipMate can access your repositories

---

## Setup

To install ChipMate for Slack, go to the Integrations menu in the sidebar at [app.chipmate.ai](https://app.chipmate.ai) and set up the Slack integration:

{% image src="/docs/img/connect/slack/slackbot-integrations.webp" alt="ChipMate Integrations page where you install the Slack integration" width="800" /%}

Then hit the Configure button, which will take you to this page:
{% image src="/docs/img/connect/slack/slackbot-integrations-2.webp" alt="ChipMate Integrations page where you install the Slack integration, step 2" width="800" /%}

Once you press "Connect with Slack", the Slack OAuth authorization page appears:
{% image src="/docs/img/connect/slack/slackbot-slack-authorize.webp" alt="Slack OAuth authorization page" width="800" /%}

Once this is completed you're good to go!

To make proper use of all of the ChipMate Slack bot's capabilities, it's important that you also connect your source control provider with ChipMate:

| Platform | Integration Type | Details |
|---|---|---|
| GitHub | GitHub App | [GitHub Setup Guide](/docs/automate/integrations#connecting-github) |
| GitLab | OAuth or PAT | [GitLab Setup Guide](/docs/automate/integrations#connecting-gitlab) |

---

## How It Works

1. **Message ChipMate** through a DM or channel mention
2. **ChipMate processes your request** using your connected repositories for context
3. **AI generates a response** analyzing your request and providing an answer
4. **Code changes (if requested)** — ChipMate creates a branch, commits the changes, and opens a pull or merge request

---

## Changing the Model

You can customize which AI model ChipMate uses for generating responses.

1. Go to your ChipMate Workspace at [app.chipmate.ai](https://app.chipmate.ai)
2. Navigate to **Integrations > Slack**
3. Select your preferred model

ChipMate for Slack supports 400+ models across different providers. The new model applies immediately to subsequent requests.

---

## Cost

ChipMate credits are used when ChipMate performs work (model usage, operations, etc.). Credit usage is the same as using ChipMate through any other interface.

---

## Tips for Best Results

- **Be specific.** The more context you provide, the better the response.
- **Reference specific files or functions.** Help the bot understand exactly what you're asking about.
- **Use threads.** Keep related conversations in threads for better context.
- **Specify the repository.** If you have multiple repos connected, mention which one you're asking about.

---

## Troubleshooting

**ChipMate isn't responding.**
Make sure ChipMate for Slack is installed in your workspace and has been added to the channel you're using.

**ChipMate can't access my repository.**
Verify your Git provider integration is configured correctly in the Integrations tab.

**I'm getting incomplete responses.**
Try breaking your request into smaller, more specific questions.

**ChipMate doesn't understand my codebase.**
Confirm that the repository you're asking about is connected and accessible through your Git provider integration.

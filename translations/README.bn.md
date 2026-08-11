<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | <a href="README.br.md">Português (Brasil)</a> | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | বাংলা | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a>
</p>

<p align="center">
  <a href="https://chipmate.ai"><img width="250" alt="ChipMate logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">VS Code, JetBrains বা CLI-তে AI দিয়ে তৈরি করার জন্য ওপেন সোর্স কোডিং এজেন্ট।</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=chipmate.ChipMate-Code"><img src="https://raster.shields.io/badge/VS_Code_Marketplace-007ACC?style=flat&logo=visualstudiocode&logoColor=white" alt="VS Code Marketplace" height="20"></a>
  <a href="https://www.npmjs.com/package/@chipmate/cli"><img alt="npm" src="https://raster.shields.io/npm/v/@chipmate/cli?style=flat" height="20" /></a>
  <a href="https://x.com/chipmate"><img src="https://raster.shields.io/badge/chipmate-000000?style=flat&logo=x&logoColor=white" alt="X (Twitter)" height="20"></a>
  <a href="https://blog.chipmate.ai"><img src="https://raster.shields.io/badge/Blog-555?style=flat&logo=substack&logoColor=white" alt="Blog" height="20"></a>
  <a href="https://chipmate.ai/discord"><img src="https://raster.shields.io/badge/Join%20Discord-5865F2?style=flat&logo=discord&logoColor=white" alt="Discord" height="20"></a>
  <a href="https://www.reddit.com/r/chipmate/"><img src="https://raster.shields.io/badge/Join%20r%2Fchipmate-D84315?style=flat&logo=reddit&logoColor=white" alt="Reddit" height="20"></a>
</p>

![ChipMate-in-VS-Code-and-CLI](https://github.com/user-attachments/assets/0536ca59-ed81-4512-9e05-d186187a1b52)

---

ChipMate হলো একটি AI কোডিং এজেন্ট যা আপনি যেখানে কাজ করেন সেখানেই কাজ করে: [VS Code](https://chipmate.ai/landing/vs-code), [JetBrains](https://chipmate.ai/features/jetbrains-native) এবং [CLI](https://chipmate.ai/cli)। এটি ওপেন সোর্স এবং খোলা মূল্যনীতির। আপনি 500টির বেশি মডেল থেকে বেছে নিতে পারেন, কাজের মাঝখানে মডেল বদলাতে পারেন এবং কোনো অতিরিক্ত চার্জ ছাড়াই মডেল প্রদানকারীর রেট পরিশোধ করেন। শুরু করতে API key দরকার নেই।

### ইনস্টলেশন

আপনি কোথায় ChipMate চালাতে চান তা বেছে নিন।

<details open>
<summary><strong>VS Code</strong></summary>

<br>

[ChipMate extension](vscode:extension/chipmate.chipmate-code) সরাসরি ইনস্টল করুন, অথবা [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=chipmate.ChipMate-Code) থেকে নিন। একটি অ্যাকাউন্ট তৈরি করলে GPT-5.5, Claude Opus 4.7, Claude Sonnet 4.6 এবং Gemini 3.1 Pro Preview সহ 500টির বেশি মডেলে প্রদানকারীর দামে অ্যাক্সেস পাবেন।

</details>

<details open>
<summary><strong>CLI</strong></summary>

<br>

```bash
# npm
npm install -g @chipmate/cli

# curl
curl -fsSL https://chipmate.ai/cli/install | bash

# pnpm
pnpm add -g @chipmate/cli

# bun
bun add -g @chipmate/cli

# Homebrew (macOS / Linux)
brew install ChipMate-Org/tap/chipmate

# Arch Linux (AUR)
paru -S chipmate-bin
```

তারপর শুরু করতে যেকোনো প্রজেক্ট ডিরেক্টরিতে `chipmate` চালান।

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

JetBrains Marketplace থেকে [ChipMate plugin](https://plugins.jetbrains.com/plugin/28350-chipmate-code) ইনস্টল করুন, অথবা যেকোনো JetBrains IDE-তে `Settings → Plugins`-এ "ChipMate" খুঁজুন।

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

লোকাল মেশিন ছাড়াই ওয়েব থেকে [app.chipmate.ai/cloud](https://app.chipmate.ai/cloud)-এ ChipMate চালান।

</details>

<details>
<summary><strong>Code Reviews</strong></summary>

<br>

[app.chipmate.ai/code-reviews](https://app.chipmate.ai/code-reviews)-এ আপনার pull request-এ স্বয়ংক্রিয় AI code review সেট আপ করুন।

</details>

<details>
<summary><strong>ChipMateClaw</strong></summary>

<br>

[app.chipmate.ai/claw](https://app.chipmate.ai/claw)-এ আপনার always-on AI agent চালু করুন।

</details>

<details>
<summary>GitHub Releases থেকে CLI ইনস্টল করুন (বাইনারি)</summary>

[Releases page](https://github.com/ChipMate-Org/chipmate/releases) থেকে সর্বশেষ বাইনারি ডাউনলোড করুন।

| প্ল্যাটফর্ম | Asset |
|---|---|
| Windows (বেশিরভাগ PC) | `chipmate-windows-x64.zip` |
| macOS (Apple Silicon) | `chipmate-darwin-arm64.zip` |
| macOS (Intel) | `chipmate-darwin-x64.zip` |
| Linux x64 | `chipmate-linux-x64.tar.gz` |
| Linux ARM | `chipmate-linux-arm64.tar.gz` |

নোট: `x64-baseline` হলো AVX ছাড়া পুরোনো CPU-এর জন্য compatibility build। `musl` হলো Alpine বা glibc ছাড়া minimal Docker image-এর জন্য statically linked build। `chipmate-vscode-*.vsix` হলো VS Code extension package, CLI নয়। `Source code` archive source থেকে build করার জন্য।

</details>

### Agents

ChipMate বিশেষায়িত agents সহ আসে, কাজ অনুযায়ী আপনি এগুলোর মধ্যে বদলাতে পারেন। আপনি নিজের custom agents-ও বানাতে পারেন।

- **Code** - ডিফল্ট। প্রাকৃতিক ভাষা থেকে কোড implement এবং edit করে।
- **Plan** - কোনো কোড লেখার আগে architecture design করে এবং implementation plan লেখে।
- **Ask** - কোনো ফাইল না ছুঁয়ে আপনার codebase সম্পর্কে প্রশ্নের উত্তর দেয়।
- **Debug** - সমস্যা troubleshoot এবং trace করে।
- **Review** - আপনার পরিবর্তন review করে এবং performance, security, style ও test coverage-এর সমস্যা তুলে ধরে।

[agents এবং custom agents](https://chipmate.ai/docs/code-with-ai/agents/using-agents) সম্পর্কে আরও জানুন।

### এটি কী করে

- প্রাকৃতিক ভাষা থেকে একাধিক ফাইলে **code generation**।
- ghost-text suggestion এবং Tab দিয়ে accept করার **inline autocomplete**।
- agent যেন নিজের কাজ review ও correct করে তার জন্য **self-checking**।
- command চালানো এবং web automate করার জন্য **terminal ও browser control**।
- agent-এর ক্ষমতা বাড়ায় এমন MCP server খুঁজে ও যুক্ত করার জন্য **MCP marketplace**।
- latency, cost এবং reasoning কাজের সাথে মেলাতে mid-task switching সহ **500টির বেশি model**।

### Autonomous Mode (CI/CD)

CI/CD pipeline-এর জন্য prompts ছাড়া পুরোপুরি autonomous operation পেতে `chipmate run`-এর সাথে `--auto` ব্যবহার করুন:

```bash
chipmate run --auto "run tests and fix any failures"
```

`--auto` সব permission prompt বন্ধ করে এবং agent-কে confirmation ছাড়া যেকোনো action execute করতে দেয়। শুধু trusted environment-এ ব্যবহার করুন।

### ডকুমেন্টেশন

Configuration এবং বাকি সবকিছুর জন্য [docs](https://chipmate.ai/docs) দেখুন।

### Contributing

Developer, writer এবং সবাইকে contribution-এর জন্য স্বাগতম। environment setup, coding standard এবং pull request খোলার পদ্ধতির জন্য [Contributing Guide](/CONTRIBUTING.md) দিয়ে শুরু করুন। VS Code extension এবং CLI release process-এর জন্য [RELEASING.md](../RELEASING.md), এবং JetBrains plugin-এর জন্য [packages/chipmate-jetbrains/RELEASING.md](../packages/chipmate-jetbrains/RELEASING.md) দেখুন।

অংশ নেওয়ার আগে আমাদের [Code of Conduct](/CODE_OF_CONDUCT.md) পড়ুন।

### License

MIT। attribution এবং license notice রেখে আপনি এই code ব্যবহার, পরিবর্তন এবং distribute করতে পারেন, commercial ব্যবহারসহ। [License](/LICENSE) দেখুন।

### FAQ

<details>
<summary>ChipMate CLI কোথা থেকে এসেছে?</summary>

ChipMate CLI হলো [OpenCode](https://github.com/anomalyco/opencode)-এর একটি fork, ChipMate agentic engineering platform-এর মধ্যে কাজ করার জন্য উন্নত করা হয়েছে।

</details>

---

**কমিউনিটিতে যোগ দিন** [Discord](https://chipmate.ai/discord) | [X](https://x.com/chipmate) | [Reddit](https://www.reddit.com/r/chipmate/)

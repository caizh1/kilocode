<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | Italiano | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | <a href="README.br.md">Português (Brasil)</a> | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | <a href="README.bn.md">বাংলা</a> | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a>
</p>

<p align="center">
  <a href="https://chipmate.ai"><img width="250" alt="ChipMate logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">L'agente di coding open source per creare con l'IA in VS Code, JetBrains o nella CLI.</p>

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

ChipMate è un agente di coding con IA che ti segue ovunque lavori: [VS Code](https://chipmate.ai/landing/vs-code), [JetBrains](https://chipmate.ai/features/jetbrains-native) e la [CLI](https://chipmate.ai/cli). È open source con prezzi trasparenti. Puoi scegliere tra oltre 500 modelli, passare da uno all'altro durante un'attività e pagare la tariffa del provider del modello senza ricarichi. Non servono chiavi API per iniziare.

### Installazione

Scegli dove vuoi eseguire ChipMate.

<details open>
<summary><strong>VS Code</strong></summary>

<br>

Installa direttamente l'[estensione ChipMate](vscode:extension/chipmate.chipmate-code), oppure scaricala dal [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=chipmate.ChipMate-Code). Crea un account e avrai accesso a oltre 500 modelli, inclusi GPT-5.5, Claude Opus 4.7, Claude Sonnet 4.6 e Gemini 3.1 Pro Preview, tutti al prezzo del provider.

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

Poi esegui `chipmate` in qualsiasi directory di progetto per iniziare.

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

Installa il [plugin ChipMate](https://plugins.jetbrains.com/plugin/28350-chipmate-code) dal JetBrains Marketplace, oppure cerca "ChipMate" in `Settings → Plugins` dentro qualsiasi IDE JetBrains.

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

Esegui ChipMate dal web, senza una macchina locale, su [app.chipmate.ai/cloud](https://app.chipmate.ai/cloud).

</details>

<details>
<summary><strong>Revisioni del codice</strong></summary>

<br>

Configura revisioni automatiche del codice con IA sulle tue pull request su [app.chipmate.ai/code-reviews](https://app.chipmate.ai/code-reviews).

</details>

<details>
<summary><strong>ChipMateClaw</strong></summary>

<br>

Avvia il tuo agente IA sempre attivo su [app.chipmate.ai/claw](https://app.chipmate.ai/claw).

</details>

<details>
<summary>Installare la CLI da GitHub Releases (binari)</summary>

Scarica il binario più recente dalla [pagina Releases](https://github.com/ChipMate-Org/chipmate/releases).

| Piattaforma | Asset |
|---|---|
| Windows (la maggior parte dei PC) | `chipmate-windows-x64.zip` |
| macOS (Apple Silicon) | `chipmate-darwin-arm64.zip` |
| macOS (Intel) | `chipmate-darwin-x64.zip` |
| Linux x64 | `chipmate-linux-x64.tar.gz` |
| Linux ARM | `chipmate-linux-arm64.tar.gz` |

Note: `x64-baseline` è una build di compatibilità per CPU più vecchie senza AVX. `musl` è la build collegata staticamente per Alpine o immagini Docker minimali senza glibc. `chipmate-vscode-*.vsix` è il pacchetto dell'estensione VS Code, non la CLI. Gli archivi `Source code` servono per compilare dai sorgenti.

</details>

### Agents

ChipMate include agents specializzati tra cui puoi passare in base all'attività. Puoi anche creare agents personalizzati.

- **Code** - Predefinito. Implementa e modifica codice da linguaggio naturale.
- **Plan** - Progetta l'architettura e scrive piani di implementazione prima che venga scritto codice.
- **Ask** - Risponde a domande sulla tua codebase senza modificare file.
- **Debug** - Risolve e traccia problemi.
- **Review** - Revisiona le modifiche e segnala problemi di performance, sicurezza, stile e copertura dei test.

Scopri di più su [agents e agents personalizzati](https://chipmate.ai/docs/code-with-ai/agents/using-agents).

### Cosa fa

- **Generazione di codice** da linguaggio naturale, su più file.
- **Autocompletamento inline** con suggerimenti ghost-text e Tab per accettare.
- **Autoverifica** così l'agente rivede e corregge il proprio lavoro.
- **Controllo di terminale e browser** per eseguire comandi e automatizzare il web.
- **Marketplace MCP** per trovare e collegare server MCP che estendono ciò che l'agente può fare.
- **Oltre 500 modelli** con cambio durante l'attività, per adattare latenza, costo e ragionamento al lavoro.

### Modalità autonoma (CI/CD)

Esegui `chipmate run` con `--auto` per un funzionamento completamente autonomo senza prompt, pensato per pipeline CI/CD:

```bash
chipmate run --auto "run tests and fix any failures"
```

`--auto` disabilita tutti i prompt di autorizzazione e consente all'agente di eseguire qualsiasi azione senza conferma. Usalo solo in ambienti attendibili.

### Documentazione

Per configurazione e tutto il resto, consulta la [documentazione](https://chipmate.ai/docs).

### Contribuire

Sono benvenuti contributi da sviluppatori, autori e chiunque altro. Inizia dalla [Guida al contributo](/CONTRIBUTING.md) per configurazione dell'ambiente, standard di codice e apertura di una pull request. Consulta [RELEASING.md](../RELEASING.md) per il processo di rilascio dell'estensione VS Code e della CLI, e [packages/chipmate-jetbrains/RELEASING.md](../packages/chipmate-jetbrains/RELEASING.md) per il plugin JetBrains.

Leggi il nostro [Codice di condotta](/CODE_OF_CONDUCT.md) prima di partecipare.

### Licenza

MIT. Puoi usare, modificare e distribuire questo codice, anche commercialmente, purché mantieni le note di attribuzione e licenza. Vedi [License](/LICENSE).

### FAQ

<details>
<summary>Da dove viene ChipMate CLI?</summary>

ChipMate CLI è un fork di [OpenCode](https://github.com/anomalyco/opencode), migliorato per funzionare nella piattaforma di ingegneria agentica ChipMate.

</details>

---

**Unisciti alla community** [Discord](https://chipmate.ai/discord) | [X](https://x.com/chipmate) | [Reddit](https://www.reddit.com/r/chipmate/)

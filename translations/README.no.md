<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | Norsk | <a href="README.br.md">Português (Brasil)</a> | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | <a href="README.bn.md">বাংলা</a> | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a>
</p>

<p align="center">
  <a href="https://chipmate.ai"><img width="250" alt="ChipMate logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">Den åpne kildekodeagenten for å bygge med AI i VS Code, JetBrains eller CLI.</p>

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

ChipMate er en AI-kodeagent som møter deg overalt du jobber: [VS Code](https://chipmate.ai/landing/vs-code), [JetBrains](https://chipmate.ai/features/jetbrains-native) og [CLI](https://chipmate.ai/cli). Den er åpen kildekode med åpen prising. Du velger blant mer enn 500 modeller, bytter mellom dem midt i en oppgave og betaler modellleverandørens pris uten påslag. Ingen API-nøkler kreves for å starte.

### Installasjon

Velg hvor du vil kjøre ChipMate.

<details open>
<summary><strong>VS Code</strong></summary>

<br>

Installer [ChipMate-utvidelsen](vscode:extension/chipmate.chipmate-code) direkte, eller hent den fra [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=chipmate.ChipMate-Code). Opprett en konto, og du får tilgang til mer enn 500 modeller, inkludert GPT-5.5, Claude Opus 4.7, Claude Sonnet 4.6 og Gemini 3.1 Pro Preview, alle til leverandørpris.

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

Kjør deretter `chipmate` i en prosjektmappe for å starte.

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

Installer [ChipMate-pluginen](https://plugins.jetbrains.com/plugin/28350-chipmate-code) fra JetBrains Marketplace, eller søk etter "ChipMate" i `Settings → Plugins` i en JetBrains IDE.

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

Kjør ChipMate fra nettet, uten lokal maskin, på [app.chipmate.ai/cloud](https://app.chipmate.ai/cloud).

</details>

<details>
<summary><strong>Kodegjennomganger</strong></summary>

<br>

Sett opp automatiske AI-kodegjennomganger på pull requestene dine på [app.chipmate.ai/code-reviews](https://app.chipmate.ai/code-reviews).

</details>

<details>
<summary><strong>ChipMateClaw</strong></summary>

<br>

Start din alltid aktive AI-agent på [app.chipmate.ai/claw](https://app.chipmate.ai/claw).

</details>

<details>
<summary>Installer CLI fra GitHub Releases (binærfiler)</summary>

Last ned den nyeste binærfilen fra [Releases-siden](https://github.com/ChipMate-Org/chipmate/releases).

| Plattform | Asset |
|---|---|
| Windows (de fleste PC-er) | `chipmate-windows-x64.zip` |
| macOS (Apple Silicon) | `chipmate-darwin-arm64.zip` |
| macOS (Intel) | `chipmate-darwin-x64.zip` |
| Linux x64 | `chipmate-linux-x64.tar.gz` |
| Linux ARM | `chipmate-linux-arm64.tar.gz` |

Merknader: `x64-baseline` er en kompatibilitetsbygg for eldre CPU-er uten AVX. `musl` er den statisk lenkede byggen for Alpine eller minimale Docker-bilder uten glibc. `chipmate-vscode-*.vsix` er VS Code-utvidelsespakken, ikke CLI-en. `Source code`-arkiver er for bygging fra kildekode.

</details>

### Agents

ChipMate leveres med spesialiserte agents du kan bytte mellom avhengig av oppgaven. Du kan også bygge dine egne egendefinerte agents.

- **Code** - Standard. Implementerer og redigerer kode fra naturlig språk.
- **Plan** - Designer arkitektur og skriver implementeringsplaner før kode skrives.
- **Ask** - Svarer på spørsmål om kodebasen uten å endre filer.
- **Debug** - Feilsøker og sporer problemer.
- **Review** - Gjennomgår endringene dine og finner problemer med ytelse, sikkerhet, stil og testdekning.

Les mer om [agents og egendefinerte agents](https://chipmate.ai/docs/code-with-ai/agents/using-agents).

### Hva den gjør

- **Kodegenerering** fra naturlig språk, på tvers av flere filer.
- **Inline-autofullføring** med ghost-text-forslag og Tab for å godta.
- **Selvsjekking** slik at agenten vurderer og retter sitt eget arbeid.
- **Terminal- og nettleserkontroll** for å kjøre kommandoer og automatisere nettet.
- **MCP-markedsplass** for å finne og koble til MCP-servere som utvider hva agenten kan gjøre.
- **Mer enn 500 modeller** med bytte midt i oppgaven, slik at du kan matche latenstid, kostnad og resonnering til jobben.

### Autonom modus (CI/CD)

Kjør `chipmate run` med `--auto` for helt autonom drift uten spørsmål, bygget for CI/CD-pipelines:

```bash
chipmate run --auto "run tests and fix any failures"
```

`--auto` deaktiverer alle tillatelsesspørsmål og lar agenten utføre enhver handling uten bekreftelse. Bruk det bare i betrodde miljøer.

### Dokumentasjon

For konfigurasjon og alt annet, se [dokumentasjonen](https://chipmate.ai/docs).

### Bidra

Bidrag er velkomne fra utviklere, skribenter og alle andre. Start med [Contributing Guide](/CONTRIBUTING.md) for miljøoppsett, kodestandarder og hvordan du åpner en pull request. Se [RELEASING.md](../RELEASING.md) for releaseprosessen for VS Code-utvidelsen og CLI-en, og [packages/chipmate-jetbrains/RELEASING.md](../packages/chipmate-jetbrains/RELEASING.md) for JetBrains-pluginen.

Les vår [Code of Conduct](/CODE_OF_CONDUCT.md) før du deltar.

### Lisens

MIT. Du kan bruke, endre og distribuere denne koden, også kommersielt, så lenge du beholder attribusjons- og lisensmerknadene. Se [License](/LICENSE).

### FAQ

<details>
<summary>Hvor kommer ChipMate CLI fra?</summary>

ChipMate CLI er en fork av [OpenCode](https://github.com/anomalyco/opencode), forbedret for å fungere i ChipMate agentic engineering-plattformen.

</details>

---

**Bli med i fellesskapet** [Discord](https://chipmate.ai/discord) | [X](https://x.com/chipmate) | [Reddit](https://www.reddit.com/r/chipmate/)

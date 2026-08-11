<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | Deutsch | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | <a href="README.br.md">Português (Brasil)</a> | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | <a href="README.bn.md">বাংলা</a> | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a>
</p>

<p align="center">
  <a href="https://chipmate.ai"><img width="250" alt="ChipMate logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">Der Open-Source-Coding-Agent zum Entwickeln mit KI in VS Code, JetBrains oder der CLI.</p>

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

ChipMate ist ein KI-Coding-Agent, der überall dort arbeitet, wo du arbeitest: [VS Code](https://chipmate.ai/landing/vs-code), [JetBrains](https://chipmate.ai/features/jetbrains-native) und die [CLI](https://chipmate.ai/cli). Es ist Open Source mit transparenter Preisgestaltung. Du wählst aus über 500 Modellen, wechselst sie mitten in einer Aufgabe und zahlst den Tarif des Modellanbieters ohne Aufschlag. Zum Start sind keine API-Schlüssel erforderlich.

### Installation

Wähle aus, wo du ChipMate ausführen möchtest.

<details open>
<summary><strong>VS Code</strong></summary>

<br>

Installiere die [ChipMate-Erweiterung](vscode:extension/chipmate.chipmate-code) direkt oder lade sie aus dem [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=chipmate.ChipMate-Code). Erstelle ein Konto und erhalte Zugriff auf über 500 Modelle, darunter GPT-5.5, Claude Opus 4.7, Claude Sonnet 4.6 und Gemini 3.1 Pro Preview, alle zu Anbieterpreisen.

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

Führe anschließend `chipmate` in einem beliebigen Projektverzeichnis aus.

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

Installiere das [ChipMate-Plugin](https://plugins.jetbrains.com/plugin/28350-chipmate-code) aus dem JetBrains Marketplace oder suche in einer JetBrains-IDE unter `Settings → Plugins` nach "ChipMate".

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

Führe ChipMate im Web aus, ohne lokalen Rechner, unter [app.chipmate.ai/cloud](https://app.chipmate.ai/cloud).

</details>

<details>
<summary><strong>Code Reviews</strong></summary>

<br>

Richte automatisierte KI-Code-Reviews für deine Pull Requests unter [app.chipmate.ai/code-reviews](https://app.chipmate.ai/code-reviews) ein.

</details>

<details>
<summary><strong>ChipMateClaw</strong></summary>

<br>

Starte deinen ständig aktiven KI-Agenten unter [app.chipmate.ai/claw](https://app.chipmate.ai/claw).

</details>

<details>
<summary>CLI aus GitHub Releases installieren (Binärdateien)</summary>

Lade die neueste Binärdatei von der [Releases-Seite](https://github.com/ChipMate-Org/chipmate/releases) herunter.

| Plattform | Asset |
|---|---|
| Windows (die meisten PCs) | `chipmate-windows-x64.zip` |
| macOS (Apple Silicon) | `chipmate-darwin-arm64.zip` |
| macOS (Intel) | `chipmate-darwin-x64.zip` |
| Linux x64 | `chipmate-linux-x64.tar.gz` |
| Linux ARM | `chipmate-linux-arm64.tar.gz` |

Hinweise: `x64-baseline` ist ein Kompatibilitäts-Build für ältere CPUs ohne AVX. `musl` ist der statisch gelinkte Build für Alpine oder minimale Docker-Images ohne glibc. `chipmate-vscode-*.vsix` ist das VS Code-Erweiterungspaket, nicht die CLI. `Source code`-Archive dienen dem Bauen aus dem Quellcode.

</details>

### Agents

ChipMate wird mit spezialisierten Agents ausgeliefert, zwischen denen du je nach Aufgabe wechselst. Du kannst auch eigene Agents erstellen.

- **Code** - Standard. Implementiert und bearbeitet Code aus natürlicher Sprache.
- **Plan** - Entwirft Architektur und schreibt Implementierungspläne, bevor Code geschrieben wird.
- **Ask** - Beantwortet Fragen zu deiner Codebasis, ohne Dateien zu ändern.
- **Debug** - Untersucht und verfolgt Probleme.
- **Review** - Prüft deine Änderungen und findet Probleme bei Performance, Sicherheit, Stil und Testabdeckung.

Mehr erfahren über [Agents und benutzerdefinierte Agents](https://chipmate.ai/docs/code-with-ai/agents/using-agents).

### Funktionen

- **Codegenerierung** aus natürlicher Sprache über mehrere Dateien hinweg.
- **Inline-Autocomplete** mit Ghost-Text-Vorschlägen und Tab zum Übernehmen.
- **Selbstprüfung**, damit der Agent seine eigene Arbeit prüft und korrigiert.
- **Terminal- und Browsersteuerung**, um Befehle auszuführen und das Web zu automatisieren.
- **MCP-Marktplatz**, um MCP-Server zu finden und einzubinden, die den Agent erweitern.
- **Über 500 Modelle** mit Wechsel während einer Aufgabe, damit du Latenz, Kosten und Reasoning passend zur Aufgabe wählst.

### Autonomer Modus (CI/CD)

Führe `chipmate run` mit `--auto` für vollständig autonomen Betrieb ohne Prompts aus, geeignet für CI/CD-Pipelines:

```bash
chipmate run --auto "run tests and fix any failures"
```

`--auto` deaktiviert alle Berechtigungsabfragen und erlaubt dem Agent, jede Aktion ohne Bestätigung auszuführen. Verwende es nur in vertrauenswürdigen Umgebungen.

### Dokumentation

Für Konfiguration und alles Weitere lies die [Dokumentation](https://chipmate.ai/docs).

### Mitwirken

Beiträge von Entwicklerinnen, Autoren und allen anderen sind willkommen. Beginne mit dem [Contributing Guide](/CONTRIBUTING.md) für Einrichtung, Coding-Standards und Pull Requests. Siehe [RELEASING.md](../RELEASING.md) für den Release-Prozess der VS Code-Erweiterung und CLI sowie [packages/chipmate-jetbrains/RELEASING.md](../packages/chipmate-jetbrains/RELEASING.md) für das JetBrains-Plugin.

Bitte lies unseren [Code of Conduct](/CODE_OF_CONDUCT.md), bevor du mitwirkst.

### Lizenz

MIT. Du darfst diesen Code verwenden, ändern und verbreiten, auch kommerziell, solange du die Attribution und Lizenzhinweise beibehältst. Siehe [License](/LICENSE).

### FAQ

<details>
<summary>Woher stammt ChipMate CLI?</summary>

ChipMate CLI ist ein Fork von [OpenCode](https://github.com/anomalyco/opencode), erweitert für die ChipMate-Agentic-Engineering-Plattform.

</details>

---

**Tritt der Community bei** [Discord](https://chipmate.ai/discord) | [X](https://x.com/chipmate) | [Reddit](https://www.reddit.com/r/chipmate/)

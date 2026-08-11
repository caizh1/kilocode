<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | Português (Brasil) | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | <a href="README.bn.md">বাংলা</a> | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a>
</p>

<p align="center">
  <a href="https://chipmate.ai"><img width="250" alt="ChipMate logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">O agente de programação open source para criar com IA no VS Code, JetBrains ou CLI.</p>

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

ChipMate é um agente de programação com IA que acompanha você em todos os lugares onde trabalha: [VS Code](https://chipmate.ai/landing/vs-code), [JetBrains](https://chipmate.ai/features/jetbrains-native) e [CLI](https://chipmate.ai/cli). É open source e tem preços abertos. Você escolhe entre mais de 500 modelos, alterna entre eles no meio da tarefa e paga a tarifa do provedor do modelo sem acréscimo. Não são necessárias chaves de API para começar.

### Instalação

Escolha onde você quer executar o ChipMate.

<details open>
<summary><strong>VS Code</strong></summary>

<br>

Instale a [extensão ChipMate](vscode:extension/chipmate.chipmate-code) diretamente ou baixe pelo [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=chipmate.ChipMate-Code). Crie uma conta e você terá acesso a mais de 500 modelos, incluindo GPT-5.5, Claude Opus 4.7, Claude Sonnet 4.6 e Gemini 3.1 Pro Preview, todos com preço do provedor.

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

Depois execute `chipmate` em qualquer diretório de projeto para começar.

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

Instale o [plugin ChipMate](https://plugins.jetbrains.com/plugin/28350-chipmate-code) pelo JetBrains Marketplace ou procure por "ChipMate" em `Settings → Plugins` dentro de qualquer IDE JetBrains.

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

Execute o ChipMate pela web, sem máquina local, em [app.chipmate.ai/cloud](https://app.chipmate.ai/cloud).

</details>

<details>
<summary><strong>Revisões de código</strong></summary>

<br>

Configure revisões automáticas de código com IA nos seus pull requests em [app.chipmate.ai/code-reviews](https://app.chipmate.ai/code-reviews).

</details>

<details>
<summary><strong>ChipMateClaw</strong></summary>

<br>

Inicie seu agente de IA sempre ativo em [app.chipmate.ai/claw](https://app.chipmate.ai/claw).

</details>

<details>
<summary>Instalar a CLI pelo GitHub Releases (binários)</summary>

Baixe o binário mais recente na [página de Releases](https://github.com/ChipMate-Org/chipmate/releases).

| Plataforma | Asset |
|---|---|
| Windows (a maioria dos PCs) | `chipmate-windows-x64.zip` |
| macOS (Apple Silicon) | `chipmate-darwin-arm64.zip` |
| macOS (Intel) | `chipmate-darwin-x64.zip` |
| Linux x64 | `chipmate-linux-x64.tar.gz` |
| Linux ARM | `chipmate-linux-arm64.tar.gz` |

Notas: `x64-baseline` é uma build de compatibilidade para CPUs antigas sem AVX. `musl` é a build com link estático para Alpine ou imagens Docker mínimas sem glibc. `chipmate-vscode-*.vsix` é o pacote da extensão VS Code, não a CLI. Arquivos `Source code` são para compilar a partir do código-fonte.

</details>

### Agents

ChipMate vem com agents especializados para você alternar dependendo da tarefa. Você também pode criar seus próprios agents personalizados.

- **Code** - O padrão. Implementa e edita código a partir de linguagem natural.
- **Plan** - Desenha a arquitetura e escreve planos de implementação antes de qualquer código ser escrito.
- **Ask** - Responde perguntas sobre sua base de código sem tocar nos arquivos.
- **Debug** - Soluciona e rastreia problemas.
- **Review** - Revisa suas mudanças e aponta problemas de performance, segurança, estilo e cobertura de testes.

Saiba mais sobre [agents e agents personalizados](https://chipmate.ai/docs/code-with-ai/agents/using-agents).

### O que ele faz

- **Geração de código** a partir de linguagem natural, em vários arquivos.
- **Autocomplete inline** com sugestões ghost-text e Tab para aceitar.
- **Autoverificação** para que o agente revise e corrija o próprio trabalho.
- **Controle de terminal e navegador** para executar comandos e automatizar a web.
- **Marketplace MCP** para encontrar e conectar servidores MCP que ampliam o que o agente pode fazer.
- **Mais de 500 modelos** com alternância no meio da tarefa, para combinar latência, custo e raciocínio com o trabalho.

### Modo autônomo (CI/CD)

Execute `chipmate run` com `--auto` para operação totalmente autônoma e sem prompts, criada para pipelines CI/CD:

```bash
chipmate run --auto "run tests and fix any failures"
```

`--auto` desativa todos os prompts de permissão e permite que o agente execute qualquer ação sem confirmação. Use apenas em ambientes confiáveis.

### Documentação

Para configuração e todo o resto, consulte a [documentação](https://chipmate.ai/docs).

### Contribuindo

Contribuições são bem-vindas de desenvolvedores, escritores e qualquer pessoa. Comece pelo [Contributing Guide](/CONTRIBUTING.md) para configurar o ambiente, conhecer os padrões de código e abrir um pull request. Consulte [RELEASING.md](../RELEASING.md) para o processo de release da extensão VS Code e da CLI, e [packages/chipmate-jetbrains/RELEASING.md](../packages/chipmate-jetbrains/RELEASING.md) para o plugin JetBrains.

Leia nosso [Code of Conduct](/CODE_OF_CONDUCT.md) antes de participar.

### Licença

MIT. Você pode usar, modificar e distribuir este código, inclusive comercialmente, desde que mantenha os avisos de atribuição e licença. Consulte [License](/LICENSE).

### FAQ

<details>
<summary>De onde veio o ChipMate CLI?</summary>

ChipMate CLI é um fork do [OpenCode](https://github.com/anomalyco/opencode), aprimorado para funcionar dentro da plataforma de engenharia agêntica da ChipMate.

</details>

---

**Participe da comunidade** [Discord](https://chipmate.ai/discord) | [X](https://x.com/chipmate) | [Reddit](https://www.reddit.com/r/chipmate/)

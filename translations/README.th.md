<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | <a href="README.br.md">Português (Brasil)</a> | ไทย | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | <a href="README.bn.md">বাংলা</a> | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a>
</p>

<p align="center">
  <a href="https://chipmate.ai"><img width="250" alt="ChipMate logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">เอเจนต์เขียนโค้ดโอเพนซอร์สสำหรับสร้างด้วย AI ใน VS Code, JetBrains หรือ CLI</p>

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

ChipMate คือเอเจนต์เขียนโค้ดด้วย AI ที่ทำงานได้ทุกที่ที่คุณทำงาน: [VS Code](https://chipmate.ai/landing/vs-code), [JetBrains](https://chipmate.ai/features/jetbrains-native) และ [CLI](https://chipmate.ai/cli) เป็นโอเพนซอร์สและมีราคาที่โปร่งใส คุณเลือกได้จากโมเดลมากกว่า 500 รายการ สลับโมเดลระหว่างทำงาน และจ่ายตามราคาของผู้ให้บริการโมเดลโดยไม่มีส่วนเพิ่ม ไม่ต้องใช้ API key เพื่อเริ่มต้น

### การติดตั้ง

เลือกตำแหน่งที่คุณต้องการใช้งาน ChipMate

<details open>
<summary><strong>VS Code</strong></summary>

<br>

ติดตั้ง [ส่วนขยาย ChipMate](vscode:extension/chipmate.chipmate-code) โดยตรง หรือดาวน์โหลดจาก [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=chipmate.ChipMate-Code) สร้างบัญชีแล้วคุณจะเข้าถึงโมเดลมากกว่า 500 รายการ รวมถึง GPT-5.5, Claude Opus 4.7, Claude Sonnet 4.6 และ Gemini 3.1 Pro Preview ทั้งหมดในราคาผู้ให้บริการ

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

จากนั้นรัน `chipmate` ในไดเรกทอรีโปรเจกต์ใดก็ได้เพื่อเริ่มต้น

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

ติดตั้ง [ปลั๊กอิน ChipMate](https://plugins.jetbrains.com/plugin/28350-chipmate-code) จาก JetBrains Marketplace หรือค้นหา "ChipMate" ใน `Settings → Plugins` ภายใน JetBrains IDE ใดก็ได้

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

รัน ChipMate จากเว็บโดยไม่ต้องใช้เครื่องภายในที่ [app.chipmate.ai/cloud](https://app.chipmate.ai/cloud)

</details>

<details>
<summary><strong>Code Reviews</strong></summary>

<br>

ตั้งค่าการรีวิวโค้ดด้วย AI อัตโนมัติบน pull request ของคุณที่ [app.chipmate.ai/code-reviews](https://app.chipmate.ai/code-reviews)

</details>

<details>
<summary><strong>ChipMateClaw</strong></summary>

<br>

เริ่มเอเจนต์ AI ที่ทำงานตลอดเวลาของคุณที่ [app.chipmate.ai/claw](https://app.chipmate.ai/claw)

</details>

<details>
<summary>ติดตั้ง CLI จาก GitHub Releases (ไบนารี)</summary>

ดาวน์โหลดไบนารีล่าสุดจาก [หน้า Releases](https://github.com/ChipMate-Org/chipmate/releases)

| แพลตฟอร์ม | Asset |
|---|---|
| Windows (พีซีส่วนใหญ่) | `chipmate-windows-x64.zip` |
| macOS (Apple Silicon) | `chipmate-darwin-arm64.zip` |
| macOS (Intel) | `chipmate-darwin-x64.zip` |
| Linux x64 | `chipmate-linux-x64.tar.gz` |
| Linux ARM | `chipmate-linux-arm64.tar.gz` |

หมายเหตุ: `x64-baseline` คือ build ที่เข้ากันได้สำหรับ CPU รุ่นเก่าที่ไม่มี AVX ส่วน `musl` คือ build แบบ static link สำหรับ Alpine หรือ Docker image ขั้นต่ำที่ไม่มี glibc `chipmate-vscode-*.vsix` คือแพ็กเกจส่วนขยาย VS Code ไม่ใช่ CLI ไฟล์ `Source code` ใช้สำหรับ build จากซอร์ส

</details>

### Agents

ChipMate มาพร้อม agents เฉพาะทางที่คุณสลับได้ตามงาน คุณยังสร้าง agents แบบกำหนดเองได้ด้วย

- **Code** - ค่าเริ่มต้น ใช้ภาษาธรรมชาติในการเขียนและแก้ไขโค้ด
- **Plan** - ออกแบบสถาปัตยกรรมและเขียนแผนการทำงานก่อนมีการเขียนโค้ด
- **Ask** - ตอบคำถามเกี่ยวกับ codebase โดยไม่แตะไฟล์
- **Debug** - แก้ไขและติดตามปัญหา
- **Review** - รีวิวการเปลี่ยนแปลงและค้นหาปัญหาด้านประสิทธิภาพ ความปลอดภัย สไตล์ และ test coverage

เรียนรู้เพิ่มเติมเกี่ยวกับ [agents และ agents แบบกำหนดเอง](https://chipmate.ai/docs/code-with-ai/agents/using-agents)

### ทำอะไรได้บ้าง

- **สร้างโค้ด** จากภาษาธรรมชาติข้ามหลายไฟล์
- **เติมโค้ดอัตโนมัติแบบ inline** พร้อมคำแนะนำ ghost-text และกด Tab เพื่อรับ
- **ตรวจสอบตัวเอง** เพื่อให้เอเจนต์รีวิวและแก้งานของตนเอง
- **ควบคุม terminal และ browser** เพื่อรันคำสั่งและทำงานบนเว็บอัตโนมัติ
- **MCP marketplace** เพื่อค้นหาและเชื่อมต่อ MCP server ที่ขยายความสามารถของเอเจนต์
- **โมเดลมากกว่า 500 รายการ** พร้อมการสลับระหว่างงาน เพื่อให้เหมาะกับ latency, cost และ reasoning ของงาน

### โหมดอัตโนมัติ (CI/CD)

รัน `chipmate run` พร้อม `--auto` เพื่อทำงานอัตโนมัติเต็มรูปแบบโดยไม่มี prompts เหมาะสำหรับ CI/CD pipelines:

```bash
chipmate run --auto "run tests and fix any failures"
```

`--auto` ปิด prompt สิทธิ์ทั้งหมดและให้เอเจนต์ดำเนินการใดก็ได้โดยไม่ต้องยืนยัน ใช้เฉพาะในสภาพแวดล้อมที่เชื่อถือได้เท่านั้น

### เอกสาร

สำหรับการตั้งค่าและเรื่องอื่น ๆ ดูที่ [เอกสาร](https://chipmate.ai/docs)

### การมีส่วนร่วม

ยินดีรับการมีส่วนร่วมจากนักพัฒนา นักเขียน และทุกคน เริ่มจาก [Contributing Guide](/CONTRIBUTING.md) สำหรับการตั้งค่าสภาพแวดล้อม มาตรฐานโค้ด และวิธีเปิด pull request ดู [RELEASING.md](../RELEASING.md) สำหรับกระบวนการ release ของส่วนขยาย VS Code และ CLI และ [packages/chipmate-jetbrains/RELEASING.md](../packages/chipmate-jetbrains/RELEASING.md) สำหรับปลั๊กอิน JetBrains

โปรดอ่าน [Code of Conduct](/CODE_OF_CONDUCT.md) ก่อนเข้าร่วม

### License

MIT คุณสามารถใช้ แก้ไข และแจกจ่ายโค้ดนี้ รวมถึงเชิงพาณิชย์ ตราบใดที่ยังเก็บ attribution และประกาศ license ไว้ ดู [License](/LICENSE)

### FAQ

<details>
<summary>ChipMate CLI มาจากไหน?</summary>

ChipMate CLI เป็น fork ของ [OpenCode](https://github.com/anomalyco/opencode) ที่ได้รับการปรับปรุงให้ทำงานในแพลตฟอร์ม ChipMate agentic engineering

</details>

---

**เข้าร่วมชุมชน** [Discord](https://chipmate.ai/discord) | [X](https://x.com/chipmate) | [Reddit](https://www.reddit.com/r/chipmate/)

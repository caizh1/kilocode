<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | <a href="README.br.md">Português (Brasil)</a> | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | <a href="README.bn.md">বাংলা</a> | <a href="README.gr.md">Ελληνικά</a> | Tiếng Việt
</p>

<p align="center">
  <a href="https://chipmate.ai"><img width="250" alt="ChipMate logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">Tác nhân lập trình mã nguồn mở để xây dựng với AI trong VS Code, JetBrains hoặc CLI.</p>

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

ChipMate là một tác nhân lập trình AI đồng hành với bạn ở mọi nơi bạn làm việc: [VS Code](https://chipmate.ai/landing/vs-code), [JetBrains](https://chipmate.ai/features/jetbrains-native) và [CLI](https://chipmate.ai/cli). Dự án là mã nguồn mở với giá minh bạch. Bạn chọn trong hơn 500 mô hình, chuyển đổi giữa chúng giữa chừng một tác vụ và trả theo giá của nhà cung cấp mô hình, không có phụ phí. Không cần API key để bắt đầu.

### Cài đặt

Chọn nơi bạn muốn chạy ChipMate.

<details open>
<summary><strong>VS Code</strong></summary>

<br>

Cài trực tiếp [tiện ích ChipMate](vscode:extension/chipmate.chipmate-code), hoặc tải từ [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=chipmate.ChipMate-Code). Tạo tài khoản và bạn sẽ có quyền truy cập hơn 500 mô hình, bao gồm GPT-5.5, Claude Opus 4.7, Claude Sonnet 4.6 và Gemini 3.1 Pro Preview, tất cả theo giá của nhà cung cấp.

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

Sau đó chạy `chipmate` trong bất kỳ thư mục dự án nào để bắt đầu.

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

Cài [plugin ChipMate](https://plugins.jetbrains.com/plugin/28350-chipmate-code) từ JetBrains Marketplace, hoặc tìm "ChipMate" trong `Settings → Plugins` bên trong bất kỳ JetBrains IDE nào.

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

Chạy ChipMate từ web, không cần máy cục bộ, tại [app.chipmate.ai/cloud](https://app.chipmate.ai/cloud).

</details>

<details>
<summary><strong>Code Reviews</strong></summary>

<br>

Thiết lập review code tự động bằng AI cho pull request của bạn tại [app.chipmate.ai/code-reviews](https://app.chipmate.ai/code-reviews).

</details>

<details>
<summary><strong>ChipMateClaw</strong></summary>

<br>

Khởi chạy AI agent luôn hoạt động của bạn tại [app.chipmate.ai/claw](https://app.chipmate.ai/claw).

</details>

<details>
<summary>Cài CLI từ GitHub Releases (binary)</summary>

Tải binary mới nhất từ [trang Releases](https://github.com/ChipMate-Org/chipmate/releases).

| Nền tảng | Asset |
|---|---|
| Windows (hầu hết PC) | `chipmate-windows-x64.zip` |
| macOS (Apple Silicon) | `chipmate-darwin-arm64.zip` |
| macOS (Intel) | `chipmate-darwin-x64.zip` |
| Linux x64 | `chipmate-linux-x64.tar.gz` |
| Linux ARM | `chipmate-linux-arm64.tar.gz` |

Ghi chú: `x64-baseline` là build tương thích cho CPU cũ không có AVX. `musl` là build liên kết tĩnh cho Alpine hoặc image Docker tối giản không có glibc. `chipmate-vscode-*.vsix` là gói tiện ích VS Code, không phải CLI. Các archive `Source code` dùng để build từ mã nguồn.

</details>

### Agents

ChipMate đi kèm các agents chuyên biệt để bạn chuyển đổi tùy theo tác vụ. Bạn cũng có thể tạo agents tùy chỉnh của riêng mình.

- **Code** - Mặc định. Triển khai và chỉnh sửa code từ ngôn ngữ tự nhiên.
- **Plan** - Thiết kế kiến trúc và viết kế hoạch triển khai trước khi viết code.
- **Ask** - Trả lời câu hỏi về codebase mà không chạm vào file.
- **Debug** - Khắc phục và truy vết sự cố.
- **Review** - Review thay đổi của bạn và phát hiện vấn đề về hiệu năng, bảo mật, phong cách và độ phủ test.

Tìm hiểu thêm về [agents và agents tùy chỉnh](https://chipmate.ai/docs/code-with-ai/agents/using-agents).

### Nó làm gì

- **Sinh code** từ ngôn ngữ tự nhiên, trên nhiều file.
- **Tự động hoàn thành inline** với gợi ý ghost-text và Tab để chấp nhận.
- **Tự kiểm tra** để agent review và sửa công việc của chính nó.
- **Điều khiển terminal và trình duyệt** để chạy lệnh và tự động hóa web.
- **MCP marketplace** để tìm và kết nối MCP server mở rộng khả năng của agent.
- **Hơn 500 mô hình** với chuyển đổi giữa chừng tác vụ, để bạn khớp độ trễ, chi phí và reasoning với công việc.

### Chế độ tự động (CI/CD)

Chạy `chipmate run` với `--auto` để hoạt động hoàn toàn tự động không có prompts, dành cho pipeline CI/CD:

```bash
chipmate run --auto "run tests and fix any failures"
```

`--auto` tắt mọi prompt xin quyền và cho phép agent thực hiện bất kỳ hành động nào mà không cần xác nhận. Chỉ dùng trong môi trường đáng tin cậy.

### Tài liệu

Về cấu hình và mọi thứ khác, hãy xem [tài liệu](https://chipmate.ai/docs).

### Đóng góp

Chúng tôi chào đón đóng góp từ developer, writer và tất cả mọi người. Bắt đầu với [Contributing Guide](/CONTRIBUTING.md) để thiết lập môi trường, tiêu chuẩn code và cách mở pull request. Xem [RELEASING.md](../RELEASING.md) cho quy trình release tiện ích VS Code và CLI, và [packages/chipmate-jetbrains/RELEASING.md](../packages/chipmate-jetbrains/RELEASING.md) cho plugin JetBrains.

Vui lòng đọc [Code of Conduct](/CODE_OF_CONDUCT.md) trước khi tham gia.

### License

MIT. Bạn có thể sử dụng, chỉnh sửa và phân phối code này, kể cả cho mục đích thương mại, miễn là giữ lại thông tin ghi nhận và thông báo license. Xem [License](/LICENSE).

### FAQ

<details>
<summary>ChipMate CLI đến từ đâu?</summary>

ChipMate CLI là một fork của [OpenCode](https://github.com/anomalyco/opencode), được cải tiến để hoạt động trong nền tảng ChipMate agentic engineering.

</details>

---

**Tham gia cộng đồng** [Discord](https://chipmate.ai/discord) | [X](https://x.com/chipmate) | [Reddit](https://www.reddit.com/r/chipmate/)

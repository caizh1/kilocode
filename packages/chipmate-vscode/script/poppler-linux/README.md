# Linux PDF 提取组件

`linux-x64` 和 `linux-x64-baseline` 的 VSIX 打包会自动构建并内置 `pdftotext`、musl 加载器、完整动态依赖和 Poppler 编码数据。目标机器只需已有的 `/bin/sh`，无需安装 Poppler、修改 PATH 或访问网络。用户显式设置的 `CHIPMATE_PDFTOTEXT_PATH` 仍优先于包内组件。

构建使用固定摘要的 Alpine 镜像和校验过 SHA-256 的 Poppler 26.02.0、poppler-data 0.4.12 源码。上游工具入口有一处修改，使编码数据随组件目录定位。源码归档、修改脚本及上游许可随组件保留在 `licenses/`。

在 `packages/chipmate-vscode/` 执行以下命令可单独构建和验收组件，不生成产品 VSIX：

```bash
bun -e 'import { ensurePopplerForTarget } from "./script/poppler-helper"; await ensurePopplerForTarget("linux-x64", "qa/linux-poppler/bin")'
CHIPMATE_TEST_LINUX_POPPLER_DIR=qa/linux-poppler/bin/poppler bun test tests/unit/poppler-helper.test.ts tests/unit/poppler-linux-helper.test.ts
```

构建机需要 Docker。跨平台验收在禁用网络、只读挂载组件的 Linux x64 容器中执行；Linux x64 构建机直接执行包内加载器和工具。所有动态依赖必须解析到包内，预检还验证中文路径、中文编码数据和中英文分页。组件测试会主动删除依赖及编码数据，确认错误实现不能通过。

离线构建可把已经通过上述流程生成的整个 `poppler/` 目录复制到构建机，通过 `POPPLER_LINUX_X64_DIR` 指定。此目录必须保留 `manifest.json` 和执行权限；不能只放入一个系统 `pdftotext`，也不能自行补写清单绕过校验。跨平台离线验收还须预先准备 Docker 和上述基础镜像。

最终 VSIX 生成后会重新解压组件，核对文件集合、大小、SHA-256、ELF 架构、执行权限，并再次执行提取预检。任一检查失败都会终止打包。上述组件验收不代表完整 VSIX 已发布，也不代替实际远程 Linux 扩展宿主验收。

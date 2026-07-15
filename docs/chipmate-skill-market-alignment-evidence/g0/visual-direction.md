# G0 选定视觉方向

选择时间：2026-07-12（Asia/Shanghai）

## 选择

- 用户选择：方向 1。
- 视觉名称：空间画廊（Spatial Gallery）。
- 权威视觉稿：`visual-direction-selected.png`。
- 原图尺寸：1487 × 1058。
- SHA-256：`7b1b7e79cea95027ac22186937eb516d33f6929588f310c392f208ef0e29184f`。
- 实现目标 viewport：1440 × 1024；扩展验收 viewport：1280 × 800、1440 × 1024、1920 × 1080。
- 小于 1024px：显示桌面访问提示，不承诺移动端布局。

## 关键页面

1. `/`：品牌头部、主搜索、热门搜索、今日推荐、精选分类。
2. `/skills`：目录、筛选、排序、分页。
3. `/skills/:id`：详情、版本、文件、收藏、安装和相关 Skill。
4. `/publish`：上传、校验、修复和发布进度。
5. `/me`：收藏、安装、我的 Skill 和版本。
6. `/analytics`：全局聚合和作者漏斗。
7. `/status`：服务与传输风险状态。
8. `/login`：New API key 登录。

G4 首个 image-to-code 验收面固定为 `/` 亮色首页，随后扩展到暗色主题和其余路由；不允许用静态宣传页替代市场核心交互。

## 视觉 token

| Token | 目标值 | 用途 |
|---|---|---|
| `--cm-bg` | `#eef7ff` | 亮色基底 |
| `--cm-bg-deep` | `#dceeff` | 空间层次底色 |
| `--cm-text` | `#102847` | 主标题和正文 |
| `--cm-text-muted` | `#667892` | 次要信息 |
| `--cm-blue` | `#2478f2` | 主动作和选中态 |
| `--cm-blue-soft` | `#7fc8ff` | 玻璃折射与边缘高光 |
| `--cm-gold` | `#f1c54d` | 品牌节点和可信标记 |
| `--cm-success` | `#2f9d72` | 已验证、已安装 |
| `--cm-danger` | `#c94755` | 安全拒绝和失败 |
| `--cm-glass` | `rgba(255, 255, 255, 0.58)` | 主要玻璃表面 |
| `--cm-glass-border` | `rgba(255, 255, 255, 0.78)` | 柔和高光边界 |
| `--cm-radius-sm` | `12px` | 输入、标签和紧凑控件 |
| `--cm-radius-md` | `20px` | 分类和次级面板 |
| `--cm-radius-lg` | `28px` | 推荐主面板 |
| `--cm-shadow` | `0 18px 50px rgba(42, 105, 170, 0.14)` | 轻盈空间阴影 |

暗色主题以深海军蓝基底、低透明蓝玻璃和相同语义色构建；不能直接反相亮色，也不能降低正文对比度。

## 布局与材质约束

- 品牌头部高度约 112px；主内容最大宽度约 1320px，居中排列。
- 首屏主标题、搜索和推荐卡形成单一阅读路径；分类作为第二层，不把所有能力塞进首屏。
- 玻璃材质优先用于头部、搜索、推荐和少量分类表面；禁止全页叠加大量 `backdrop-filter`。
- 图标使用高质量图标库；品牌图标使用 `packages/kilo-vscode/assets/icons/chipmate-icon.png`，不手画 SVG/CSS 图标。
- 图标按钮和工具栏使用 flex/grid 正常流，不使用 `position:absolute` 对齐。
- 正文 14–16px，系统中文字体栈优先；长描述控制在舒适行长。
- 支持键盘导航、清晰焦点、`prefers-reduced-motion` 和 WCAG 2.2 AA。
- 主动效使用柔和位移、透明度和材质高光变化；减少动效时关闭视差和大幅位移。

## 资产目录

权威视觉稿中的非标准可见资产：

1. ChipMate 品牌图标：复用真实 `chipmate-icon.png`。
2. 推荐 Skill 的立体玻璃品牌对象：G4 使用从权威视觉稿生成或裁切的独立栅格资产，不用 CSS/HTML 近似。
3. 背景中的折射玻璃层和柔和空间纹理：G4 使用独立背景图资产，不用廉价渐变代替。
4. 搜索、筛选、发布、收藏、下载等标准 UI 图标：使用匹配视觉重量的开源图标库。

## 平台分界

- Web 按本文件的 Liquid Glass 方向实现。
- Kilo Marketplace 保持 SolidJS、kilo-ui、VS Code theme token、currentColor 和单色 Codicons。
- 不把 Web 的大面积玻璃背景移植到 VS Code webview。

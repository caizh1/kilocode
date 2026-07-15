# ChipMate 首页 Chrome 全屏视觉偏差逐项对齐计划

Status: `COMPLETE`

Initial Status: `READY_FOR_GOAL_MODE`

Current Task: `NONE`

Completion allowed: `yes`

Last updated: `2026-07-14`

## 1. Goal

按本文件从 `VA-00` 到 `VA-24` 逐项关闭 ChipMate 首页 Chrome 全屏视觉偏差，并以真实 macOS Google Chrome 截图完成桌面视觉签收。

本文件是本轮首页视觉修复的唯一执行账本。它不替代 `docs/chipmate-skill-market-kilo-alignment-plan.md` 的产品与能力对齐记录，也不扩展到 Kilo VS Code Marketplace。

## 2. 执行规则

- 每次只允许一个 Task 为 `IN_PROGRESS`；完成当前 Task 前不得开始下一项。
- 每项完成后必须记录 Changed Files、Commands、Results、Chrome Evidence 和 Remaining Deviations，再把 `[ ]` 改为 `[x]`。
- 真实视觉认证只能使用本机 macOS 上用户真实安装的 Google Chrome。Playwright Chrome 只能作为功能、几何、无障碍和性能证据。
- 视觉对照必须固定浏览器缩放、CSS 视口、DPR、页面主题、种子数据、轮播排名、滚动位置和交互状态。
- 原始截图、组件裁切和同屏对照统一保存在 `.runtime/design-qa/`。
- 不做移动端视觉实现或签收。Edge 品牌运行保持 `USER_WAIVED / NOT_RUN`。
- 图标、图标按钮和侧边箭头使用 flex/grid 正常文档流，不使用 `position: absolute` 对齐。
- 不修改后端 API、数据库、OpenAPI、生成客户端、目录排序或生产 Skill 数据。
- 存在任何 P0、P1 或 P2 时，`design-qa.md` 不得以 `final result: passed` 结束。
- 工作区已有大量用户修改和未跟踪文件；只修改当前 Task 明确列出的文件，不暂存、不覆盖无关内容。

## 3. Baseline

- Repository: `/Users/archer/Work/kilocode`
- Project: `/Users/archer/Work/kilocode/server/chipmate-word-render`
- Branch: `codex/v7.3.42-dev`
- Commit: `d567827207018deef65cf0af450cd9ecd7325835`
- Worktree state: dirty; `server/chipmate-word-render/` currently appears as an untracked subtree in the parent repository.
- Source visual: `/Users/archer/.codex/generated_images/019f5a0c-a2b6-7663-b492-3527ee0f05b8/exec-b971485f-efa4-43b1-9f90-56aa63b3cd5f.png`
- Stable reference copy: `.runtime/design-qa/fullscreen-audit/02-reference.png` (`1484×1060`)
- Chrome fullscreen source: `.runtime/design-qa/fullscreen-audit/01-user-fullscreen.png` (`2262×1406`)
- Full comparison: `.runtime/design-qa/fullscreen-audit/03-full-comparison.png` (`3190×1060`)
- Carousel comparison: `.runtime/design-qa/fullscreen-audit/04-carousel-comparison.png` (`2968×588`)
- Captured state: light theme, carousel rank `#03`, page scrolled to Top 10; screenshot contains external pet and thinking-notification overlays.
- Deterministic Chrome baseline: CSS viewport `1131×616`, DPR `2`, `visualViewport.scale 1`, light theme, rank `#03`, autoplay paused and page scroll `341.5`.
- Clean real Chrome capture: `.runtime/design-qa/fullscreen-audit/chrome-real-baseline-1131x616-rank03.png` (`1131×616`).
- All-rank real Chrome geometry: `.runtime/design-qa/fullscreen-audit/chrome-real-geometry-1131x560-all-ranks.json`.
- VA-03 live content capture: `.runtime/design-qa/fullscreen-audit/chrome-real-geometry-1131x560-rank03.png` (`1131×560`). The Chrome content viewport was 56px shorter after the task reconnect, but its CSS width, DPR, zoom and all sampled card geometry stayed fixed throughout the ten-rank run.
- Original full-window PNG: `2262×1406` physical pixels; its 2262-pixel content width corresponds to the 1131 CSS-pixel viewport at DPR 2.
- Root overflow: `scrollWidth 1131`, `clientWidth 1131`, horizontal overflow `false`.
- Featured-section overflow: `scrollWidth 1310`, `clientWidth 1121`, hidden overflow `189px`, baseline `scrollLeft 0`.
- Active-card baseline at this viewport: `787×255`.
- VA-04 active-card result: `909×255` at the live `1131×560` viewport and exactly `1090×255` at the primary `1484×1060` viewport.
- Detected displays: built-in `3024×1964` Retina; AirPlay `2298×1604`, UI looks like `1149×802`.

## 4. Task Ledger

### G0 — 基线与证据

- [x] **VA-00 建立任务账本**
  - 写入本计划、设计图路径、Chrome 原图和同屏对照路径。
  - 记录 Git 基线、初始状态、Goal 和逐项执行规则。
  - Result: completed; `Current Task` advanced to `VA-01`.

- [x] **VA-01 重新打开视觉 QA**
  - 在 `design-qa.md` 追加本轮 Chrome 全屏偏差，不删除此前对照历史。
  - 将文档最终状态改为 `not passed / reopened`。
  - Acceptance: 文档不再保留会被误读为当前有效结论的末尾 `final result: passed`。

- [x] **VA-02 固定真实 Chrome 状态**
  - 使用本机 macOS Google Chrome、100% 缩放、浅色主题和固定种子数据。
  - 记录 `innerWidth`、`innerHeight`、DPR、`visualViewport.scale`、screen metrics 和水平溢出。
  - 关闭宠物、通知、鼠标标注等外部遮挡后重新保存基线截图。

- [x] **VA-03 建立逐卡尺寸基线**
  - 依次检查 01–10，记录主卡、标题、验证标签、描述、元信息、CTA、预览卡和控制条边界。
  - 重点记录 `#03 C/C++ Codebase Analysis` 长标题状态。
  - Acceptance: 每个排名都有可复核的几何结果，所有重叠、裁切和越界项均映射到后续 Task。

### G1 — P1 结构问题

- [x] **VA-04 修正轮播轨道和主卡比例**
  - 主视口保持约 `1090×255` 的横向主卡。
  - 左右预览和间距不得挤压主卡；全屏窗口下 CSS 尺寸不随物理像素异常放大。

- [x] **VA-05 隔离文案与主视觉区域**
  - 为排名、Skill 图标、文案和主视觉建立明确网格安全区。
  - 主视觉不得侵入标题、验证标签、正文或元信息。

- [x] **VA-06 修正标题与验证标签**
  - `C/C++ Codebase Analysis` 在桌面保持一行。
  - “已验证”保持横向单行、不可压缩、不可叠到主图。
  - 更长标题最多两行，CTA 仍保持可见。

- [x] **VA-07 修正正文、元信息与 CTA**
  - 描述最多两行；已知 Top 10 的版本、下载、收藏和发布者保持紧凑基线。
  - “查看技能”始终可见；消除左下无效空白。

- [x] **VA-08 收拢底部控制条**
  - 01–10、前后按钮、播放/暂停、进度条和 `当前/总数` 全部位于容器内。
  - 不得在任何桌面签收尺寸下裁切或水平溢出。

- [x] **VA-09 修正相邻卡片结构**
  - 左侧只显示完整、干净的玻璃露边，不出现被裁断的排名或半个图标。
  - 右侧显示紧凑且可识别的下一张预览。

- [x] **VA-10 补齐卡片侧边箭头**
  - 按设计图在主卡两侧加入切换按钮，复用现有轮播切换逻辑。
  - 使用 grid/flex 正常文档流；底部导航继续保留。

### G2 — Liquid Glass 材质与组件层级

- [x] **VA-11 调整主视觉尺寸与裁切** — `RECLOSED_AFTER_USER_ARTWORK_RULE`
  - 缩小并右移空间图标主体。
  - 圆盘和光场可以覆盖整卡，但不得抢占文案层级。

- [x] **VA-12 对齐主卡玻璃材质**
  - 降低左侧纯白不透明感。
  - 补足环境色渗透、折射、背景模糊、内高光、细边界和轻盈阴影。

- [x] **VA-13 对齐外层轮播容器**
  - 降低青蓝饱和度和底部蓝色铺底。
  - 恢复设计图更中性、通透的白蓝玻璃场。

- [x] **VA-14 对齐待切换卡材质**
  - 预览卡保持约半透明待播放层级，内部排名和图标仍清晰。
  - 校正饱和度、透明度、模糊、景深、折射、hover 和 active 状态。

- [x] **VA-15 对齐排名徽章和图标底座** — `RECLOSED_AFTER_VA-23`
  - 缩小排名徽章、金色边缘和 Skill 图标底座。
  - 恢复紧凑比例、细腻玻璃厚度和均衡的视觉重量。

- [x] **VA-16 验证分类图标真实运行态** — `RECLOSED_AFTER_USER_ARTWORK_RULE`
  - `#03` 必须显示 development 类别图标，只有白名单 Skill 保留 ChipMate 图标。
  - 若 DOM 已正确但 Chrome 仍显示旧图，只处理旧服务、缓存或预览种子，不修改生产目录数据。

### G3 — 文字、控件和 Header

- [x] **VA-17 收敛文字与内部间距** — `RECLOSED_AFTER_VA-23`
  - 降低区块标题和 Skill 标题的尺寸与重量。
  - 校正文案行高、卡片 padding、组件 gap、圆角和区块总高度。
  - 下载量保持真实数据，仅降低辅助信息的视觉权重。

- [x] **VA-18 收敛导航控件比例**
  - 主题按钮继续位于右侧导航组最左边。
  - 缩小 Header、Logo、按钮高度和间距，保证登录与发布不拥挤。
  - 主题和登录属于确认保留的产品差异，不为匹配设计图而删除。

- [x] **VA-19 补齐主题和交互材质** — `RECLOSED_AFTER_VA-23`
  - 检查浅色、深色、hover、focus、active、disabled、暂停和 reduced-motion。
  - 每个小组件分别核对饱和度、透明度、折射、景深、高光、阴影和边界。

### G4 — 防回归与真实 Chrome 签收

- [x] **VA-20 增加桌面几何回归检查**
  - E2E 遍历 10 张卡，验证标题/标签不重叠、CTA 可见、元信息不越界、控制条完整、分类图标正确、页面无水平溢出。

- [x] **VA-21 运行功能回归**
  - 执行 `npm run check`、`npm run build`、`npm run test:e2e:web:chrome`。
  - Playwright 结果不得被描述为真实 Chrome 视觉通过证据。

- [x] **VA-22 真实 Chrome 分状态截图**
  - 在 `1484×1060`、`1440×1024`、`1050×1024` 和用户 Mac 全屏状态下截图。
  - 至少覆盖 `#01` 与长标题 `#03`；不做移动端视觉验收。

- [x] **VA-23 完成组件级同屏对照** — `COMPLETE_AFTER_REOPENED_TASKS`
  - 分别裁切外层容器、主卡、左右预览、排名徽章、Skill 图标、验证标签、CTA、排名轨道、进度条和 Header。
  - 每个组件与设计图放入同一比较输入，逐项核对材质和几何。

- [x] **VA-24 关闭计划** — `COMPLETE`
  - 确认无开放 P0/P1/P2，控制台和 axe 无新增问题。
  - 更新证据路径、Changed Files、Commands、Results、Known Limitations。
  - 最后才允许把 `design-qa.md` 恢复为 `final result: passed`。

## 5. Public Interfaces and Compatibility

- 后端路由、TypeBox Schema、OpenAPI、数据库、生成客户端和生产目录数据保持不变。
- 主要实现范围限制为 `apps/web/src/main.tsx`、`apps/web/src/styles.css`、现有 Web E2E 和 QA 文档。
- 不新增字体、轮播依赖或临时占位图；继续使用现有空间背景、Phosphor 图标和 20 个分类 Skill 图标。
- Word、Mermaid、health、packages、详情页、目录页和 Kilo VS Code Marketplace 保持兼容。

## 6. Evidence Log

### VA-00 — 2026-07-13

- Status: `COMPLETE`
- Changed Files:
  - `server/chipmate-word-render/visual-alignment-plan.md`
- Commands:
  - `git branch --show-current`
  - `git rev-parse HEAD`
  - `git status --short -- server/chipmate-word-render`
  - `sips -g pixelWidth -g pixelHeight` for the reference, Chrome source and comparison images
- Results:
  - Goal created with the objective recorded in this file.
  - Baseline branch, commit, dirty-worktree boundary and evidence paths recorded.
  - All `VA-00` through `VA-24` tasks written as the single visual-alignment ledger.
- Chrome Evidence:
  - Reused the user-provided real Chrome screenshot and the same-input comparisons listed in Baseline.
  - No new browser capture was required for the documentation-only task.
- Remaining Deviations:
  - All visual deviations remain open; `VA-01` is the next and only active task.

### VA-01 — 2026-07-13

- Status: `COMPLETE`
- Changed Files:
  - `server/chipmate-word-render/design-qa.md`
  - `server/chipmate-word-render/visual-alignment-plan.md`
- Commands:
  - `tail -100 server/chipmate-word-render/design-qa.md`
  - `sed -n '1,230p' server/chipmate-word-render/visual-alignment-plan.md`
  - Markdown whitespace and final-status assertions recorded after the edit
- Results:
  - Preserved the earlier QA history but relabeled its result as historical and superseded.
  - Added the 2026-07-13 fullscreen evidence, six open P1 findings, six open P2 findings and the current evidence limits.
  - The only current final result is `not passed / reopened`.
- Chrome Evidence:
  - Used the user-provided real Chrome fullscreen screenshot plus the stored full-page and carousel same-input comparisons.
  - No new screenshot was captured because deterministic browser metrics belong to `VA-02`.
- Remaining Deviations:
  - All documented P1/P2 findings remain open; `VA-02` is the next and only active task.

### VA-02 — 2026-07-13

- Status: `COMPLETE`
- Changed Files:
  - `server/chipmate-word-render/design-qa.md`
  - `server/chipmate-word-render/visual-alignment-plan.md`
  - `.runtime/design-qa/fullscreen-audit/chrome-real-baseline-1131x616-rank03.png`
- Commands:
  - Connected to the user's existing `http://127.0.0.1:4174/` tab in installed macOS Google Chrome.
  - Reset Chrome page zoom with `Command+0`.
  - Fixed light theme, rank `#03`, paused carousel focus, scroll Y `341.5` and section scrollLeft `0`.
  - Read CSS viewport, DPR, VisualViewport, page overflow, section overflow and active-card bounds from the live Chrome page.
  - `sips -g pixelWidth -g pixelHeight` for the clean Chrome capture and original full-window image.
  - `system_profiler SPDisplaysDataType` for the connected-display baseline.
- Results:
  - CSS viewport is `1131×616`, DPR is `2`, and `visualViewport.scale` is `1` after the 100% zoom reset.
  - Root horizontal overflow is false, but the featured section contains `1310px` of content inside `1121px`, leaving `189px` of hidden internal overflow.
  - Active card is only `787×255`, explaining why the long title, metadata, CTA and controls no longer fit the earlier 1090-pixel composition.
  - The original 2262-pixel-wide PNG must be interpreted as Retina physical pixels, not CSS layout width.
- Chrome Evidence:
  - `.runtime/design-qa/fullscreen-audit/chrome-real-baseline-1131x616-rank03.png`
  - Screenshot is from the user's installed Google Chrome and contains no pet or thinking-notification overlay.
- Remaining Deviations:
  - All P1/P2 visual deviations remain open; `VA-03` is the next and only active task.

### VA-03 — 2026-07-13

- Status: `COMPLETE`
- Changed Files:
  - `server/chipmate-word-render/design-qa.md`
  - `server/chipmate-word-render/visual-alignment-plan.md`
  - `.runtime/design-qa/fullscreen-audit/chrome-real-geometry-1131x560-all-ranks.json`
  - `.runtime/design-qa/fullscreen-audit/chrome-real-geometry-1131x560-rank03.png`
- Commands:
  - Used the installed Chrome connector to click the unique next-preview card through ranks `03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 01 → 02`, then restored rank `#03`.
  - Read active card, copy, title, verification label, description, metadata, CTA, previous/next previews and control-rail rectangles from the live page after every switch.
  - Verified every switch retained featured-section `scrollLeft 0`; the live content viewport stayed at `1131×560`, DPR 2, 100% zoom and light theme for the complete ten-rank sampling run.
  - Rechecked `innerWidth`, `innerHeight`, `outerWidth`, `outerHeight`, `visualViewport` and screenshot pixels after sampling; the reconnected Chrome content viewport was consistently `1131×560` inside the same `1131×703` outer window.
  - `jq empty .runtime/design-qa/fullscreen-audit/chrome-real-geometry-1131x560-all-ranks.json`
  - `sips -g pixelWidth -g pixelHeight .runtime/design-qa/fullscreen-audit/chrome-real-geometry-1131x560-rank03.png`
  - Markdown whitespace and ledger assertions recorded after the edit.
- Results:
  - All 10 ranks use the same `787×255` visible active-card rectangle, while every card has `71px` or more of clipped vertical content; rank `#01` reaches `348px` scroll height.
  - Every copy column is only `224px` wide but needs `320–415px`; all 10 titles extend beyond that safe column and every `已验证` label wraps into approximately four lines.
  - CTA exists for all ranks but begins below the card bottom for all 10; rank `#01` is worst because its description reaches three lines.
  - Every previous preview starts at `x=-25`, every next preview extends to `x=1156` beyond the section right edge `1127`, and the `1057px` control rail contains `1278px` of content.
  - Rank `#10 Repository Onboarding Guide` is the widest title (`352.625px`); rank `#03 C/C++ Codebase Analysis` is `313.852px` and shows the same structural failure.
  - Runtime category artwork is current: rank `#03` uses `dev-terminal.webp`; only the intended whitelist rank `#01` uses `chipmate-icon.png`.
- Chrome Evidence:
  - `.runtime/design-qa/fullscreen-audit/chrome-real-geometry-1131x560-all-ranks.json`
  - `.runtime/design-qa/fullscreen-audit/chrome-real-geometry-1131x560-rank03.png`
  - Evidence was collected from the user's installed macOS Google Chrome, not Playwright Chrome.
- Remaining Deviations:
  - `VA-04`: the active card collapses to `787px` because the fixed three-column stage still reserves oversized preview tracks at the 1131px desktop viewport.
  - `VA-05`–`VA-07`: the `224px` copy safe zone, unshrinkable title width, wrapped verification label, three-row metadata and clipped CTA require structural repair.
  - `VA-08`: control content exceeds its container by `221px`.
  - `VA-09`: both preview cards are cropped at every rank.
  - `VA-11`: the 58% right-side spatial artwork intrudes into the already undersized copy composition.
  - `VA-16`: live category icons are correct at this baseline; revalidation remains required after layout and cache-affecting work.

### VA-04 — 2026-07-13

- Status: `COMPLETE`
- Changed Files:
  - `server/chipmate-word-render/apps/web/src/styles.css`
  - `server/chipmate-word-render/design-qa.md`
  - `server/chipmate-word-render/visual-alignment-plan.md`
  - `.runtime/design-qa/fullscreen-audit/va04-chrome-real-geometry.json`
  - `.runtime/design-qa/fullscreen-audit/va04-chrome-real-1131x560-rank03.png`
  - `.runtime/design-qa/fullscreen-audit/va04-chrome-real-1484x1060-rank01.png`
  - `.runtime/design-qa/fullscreen-audit/va04-chrome-real-1484x1060-rank03.png`
  - `.runtime/design-qa/fullscreen-audit/va04-reference-vs-chrome-1484x1060-rank01.png`
- Commands:
  - `npm run typecheck` from `apps/web`
  - `npm run build` from `apps/web`
  - Actual installed macOS Google Chrome geometry reads at default `1131×560`, DPR 2, and temporary `1484×1060` desktop breakpoint override; the override was reset before handoff.
  - Actual Chrome rank-01 and rank-03 screenshots plus a same-input `1484×1060` reference comparison.
  - Actual Chrome console error/warning read.
  - `jq empty .runtime/design-qa/fullscreen-audit/va04-chrome-real-geometry.json`
  - `sips -g pixelWidth -g pixelHeight` for all VA-04 PNG evidence.
- Results:
  - Added a `1051–1399px` desktop track that contracts preview reservations instead of allowing them to consume the active card.
  - At the user's live 1131px CSS width, the main card increased from `787×255` at `x=111–898` to `909×255` at `x=73–982`.
  - The previous preview moved from `x=-25–41` to `x=9–63`; the next preview moved from `x=959–1156` to `x=994–1122`. Both now remain inside the featured-section viewport without reducing the main card to the old width.
  - At the primary `1484×1060` viewport, the real Chrome card is exactly `1090×255` at `x=136–1226`, matching the source composition. Previous and next preview geometry remains `x=0–66` and `x=1287–1484`.
  - Root horizontal overflow remains false at both measured widths; actual Chrome console contains zero errors and zero warnings.
  - Web typecheck and production build passed.
- Chrome Evidence:
  - `.runtime/design-qa/fullscreen-audit/va04-chrome-real-geometry.json`
  - `.runtime/design-qa/fullscreen-audit/va04-chrome-real-1131x560-rank03.png`
  - `.runtime/design-qa/fullscreen-audit/va04-chrome-real-1484x1060-rank01.png`
  - `.runtime/design-qa/fullscreen-audit/va04-chrome-real-1484x1060-rank03.png`
  - `.runtime/design-qa/fullscreen-audit/va04-reference-vs-chrome-1484x1060-rank01.png`
- Remaining Deviations:
  - The expanded 1131px card still has `289px` of content inside a `253px` client height; copy and artwork separation remains open for `VA-05`.
  - The long title and verification label still collide visually; `VA-06` remains open.
  - CTA and metadata remain clipped at the live fullscreen width; `VA-07` remains open.
  - The control rail still contains `1278px` inside `1057px`; `VA-08` remains open.
  - Preview internal cropping and material hierarchy remain explicitly open for `VA-09` and `VA-14`; VA-04 closes only the track/main-card proportion.

### VA-05 — 2026-07-13

- Status: `COMPLETE`
- Changed Files:
  - `server/chipmate-word-render/apps/web/src/styles.css`
  - `server/chipmate-word-render/design-qa.md`
  - `server/chipmate-word-render/visual-alignment-plan.md`
  - `.runtime/design-qa/fullscreen-audit/va05-chrome-real-geometry.json`
  - `.runtime/design-qa/fullscreen-audit/va05-chrome-real-1131x560-rank03.png`
  - `.runtime/design-qa/fullscreen-audit/va05-chrome-real-1484x1060-rank01.png`
  - `.runtime/design-qa/fullscreen-audit/va05-chrome-real-1484x1060-rank03.png`
  - `.runtime/design-qa/fullscreen-audit/va05-reference-vs-chrome-1484x1060-rank01.png`
  - `.runtime/design-qa/fullscreen-audit/va05-card-reference-vs-chrome-1484-rank01.png`
- Commands:
  - `npm run typecheck` from `apps/web`
  - `npm run build` from `apps/web`
  - Actual installed macOS Google Chrome geometry reads and screenshots at default `1131×560`, DPR 2, and temporary `1484×1060` desktop breakpoint override; the override was reset before handoff.
  - Actual Chrome rank-01 and rank-03 screenshots, a full same-input comparison and a focused active-card comparison against the selected source.
  - Actual Chrome console error/warning read.
  - `jq` inspection of `.runtime/design-qa/fullscreen-audit/va05-chrome-real-geometry.json`
  - `sips -g pixelWidth -g pixelHeight` for all VA-05 PNG evidence.
- Results:
  - Removed `spatial-hero.webp` from the desktop active card's composite background and reused the existing `.feature-art` image as an explicit third grid-column layer in normal document flow.
  - Rank and copy content stay above the artwork layer. A measured left-to-right mask keeps the recognizable blue icon subject out of the rank, Skill icon, title, verification, description and metadata safety zones while still allowing the ambient glass platform and light field to extend under the card.
  - At the real default width, the artwork spans `x=461–981`; the mask is transparent through `x=617`, reaches only low opacity at `x=653`, strong opacity at `x=705` and full opacity at `x=742`. The title ends at `x=632.852`, the verification label at `x=694.852`, and the copy column at `x=665`; the photographed icon subject no longer crosses those elements.
  - At `1484×1060`, the artwork spans `x=595–1225`; the mask is transparent through `x=784`, reaches low opacity at `x=828`, strong opacity at `x=891` and full opacity at `x=935`. The title and verification label end at `x=695.852` and `x=781.852`, before the visible subject region.
  - The primary active card remains exactly `1090×255`; the default active card remains `909×255`. Root horizontal overflow is false, and actual Chrome console errors and warnings are both zero.
  - Web typecheck and production build passed. No backend, API, database, production Skill data, font or dependency changed.
- Chrome Evidence:
  - `.runtime/design-qa/fullscreen-audit/va05-chrome-real-geometry.json`
  - `.runtime/design-qa/fullscreen-audit/va05-chrome-real-1131x560-rank03.png`
  - `.runtime/design-qa/fullscreen-audit/va05-chrome-real-1484x1060-rank01.png`
  - `.runtime/design-qa/fullscreen-audit/va05-chrome-real-1484x1060-rank03.png`
  - `.runtime/design-qa/fullscreen-audit/va05-reference-vs-chrome-1484x1060-rank01.png`
  - `.runtime/design-qa/fullscreen-audit/va05-card-reference-vs-chrome-1484-rank01.png`
  - Evidence was captured in the user's installed macOS Google Chrome. The handoff page is restored to the real `1131×560`, DPR 2 viewport at rank `#03`, light theme, paused autoplay and scroll Y `489`.
- Remaining Deviations:
  - The default-width `已验证` label still wraps vertically; title and verification sizing/flow remain the only active `VA-06` work.
  - Description, metadata and CTA still exceed the default card's content height; `VA-07` remains open.
  - The spatial hero subject is still larger and farther right than the source in the focused comparison; `VA-11` owns that sizing and crop correction.
  - Main-card opacity, outer-shell saturation, preview material, rank/icon scale and typography remain open under `VA-12`–`VA-15` and `VA-17`.

### VA-06 — 2026-07-13

- Status: `COMPLETE`
- Changed Files:
  - `server/chipmate-word-render/apps/web/src/styles.css`
  - `server/chipmate-word-render/design-qa.md`
  - `server/chipmate-word-render/visual-alignment-plan.md`
  - `.runtime/design-qa/va06/chrome-real-1131x560-rank03-title-label.png`
  - `.runtime/design-qa/va06/chrome-real-1131x560-rank03-title-label.json`
  - `.runtime/design-qa/va06/chrome-real-1131x560-all-title-label-geometry.json`
- Commands:
  - Used the installed macOS Google Chrome to pause autoplay, switch all ten rank buttons individually and read each live title, verification label, copy-column and CTA rectangle at the fixed `1131×560`, DPR 2 viewport.
  - Captured the final rank-03 Chrome screenshot and stored both the rank-03 and ten-rank geometry evidence.
  - Read actual Chrome console errors and warnings after the final state.
  - `jq` assertions over the ten-rank evidence for maximum title lines, label no-wrap, title/label overlap, label containment and CTA visibility.
  - `npm run check`
  - `npm run build`
- Results:
  - The desktop title row now reserves a normal-flow `max-content` column for `已验证`, and the label has an explicit no-wrap compact treatment with an unshrinkable 12px Phosphor shield.
  - Rank `#03 C/C++ Codebase Analysis` is one line at the real fullscreen width. Its title occupies `283×24.148px`; the label is `55×18px`, starts 8px after the title and remains completely inside the `346px` copy column.
  - All ten real cards are one line at the fixed 1131px baseline, all labels use `white-space: nowrap`, no title overlaps a label, every label stays inside the copy column and every CTA remains inside the active card.
  - The title rule still allows and clamps unknown longer content to at most two lines; the known Top 10 no longer consumes the second line at this constrained desktop width.
  - Actual Chrome console errors and warnings are both zero. `npm run check` passed all typecheck, lint and 44 package tests; the production build passed.
  - No backend, API, database, production Skill data, asset, font or dependency changed.
- Chrome Evidence:
  - `.runtime/design-qa/va06/chrome-real-1131x560-rank03-title-label.png`
  - `.runtime/design-qa/va06/chrome-real-1131x560-rank03-title-label.json`
  - `.runtime/design-qa/va06/chrome-real-1131x560-all-title-label-geometry.json`
  - Evidence was captured from the user's installed macOS Google Chrome at 100% zoom, light theme, rank `#03`, paused autoplay and DPR 2.
- Remaining Deviations:
  - Description line limits, metadata compaction, publisher/CTA baseline and unused lower-left space remain the only active `VA-07` work.
  - The current 1131px title size is intentionally width-adaptive; the broader reference typography hierarchy and spacing remain open for `VA-17` after structural tasks are complete.
  - Control overflow, preview structure, artwork sizing and all material mismatches remain open under `VA-08`–`VA-15`.

### VA-07 — 2026-07-13

- Status: `COMPLETE`
- Changed Files:
  - `server/chipmate-word-render/apps/web/src/main.tsx`
  - `server/chipmate-word-render/apps/web/src/styles.css`
  - `server/chipmate-word-render/design-qa.md`
  - `server/chipmate-word-render/visual-alignment-plan.md`
  - `.runtime/design-qa/va07/chrome-real-1131x560-rank03-content.png`
  - `.runtime/design-qa/va07/chrome-real-1131x560-all-content-geometry.json`
  - `.runtime/design-qa/va07/chrome-real-1050x1024-all-content-geometry.json`
  - `.runtime/design-qa/va07/chrome-real-1484x1060-rank01-content.png`
  - `.runtime/design-qa/va07/chrome-real-1484x1060-rank01-content.json`
  - `.runtime/design-qa/va07/reference-vs-chrome-1484x1060-rank01-content-normalized.jpg`
  - `.runtime/design-qa/va07/card-reference-vs-chrome-1484-rank01-content-normalized.jpg`
- Commands:
  - Used the installed macOS Google Chrome to switch all ten ranks individually at the native `1131×560`, DPR 2 fullscreen width and at a temporary `1050×1024` desktop viewport override.
  - Captured the real Chrome rank-03 fullscreen state and rank-01 `1484×1060` source state; reset the temporary viewport before handoff.
  - Built a no-rescale side-by-side reference comparison and a focused `1090×255` active-card comparison. The primary override capture's 104px top spacer was cropped before comparison, then the missing bottom area was padded only to keep the comparison canvas at `1484×1060`.
  - Read actual Chrome console errors and warnings after restoring rank `#03`, paused autoplay and the native viewport.
  - `jq` assertions over the 1131px and 1050px ten-rank geometry evidence.
  - `npm run check`
  - `npm run build`
- Results:
  - Moved the CTA out of the copy column into the next normal-flow row of the existing feature-content grid. At the primary source size, the Skill icon and CTA both start at `x=252`, while the copy remains at `x=377`, matching the source's intentional lower-left CTA placement.
  - Reserved a fixed 112px first desktop content row, so one-line and two-line descriptions no longer move the CTA. Every native-width rank shares one CTA baseline and leaves the button exactly 18px inside the card bottom.
  - Descriptions are clamped to at most two lines. At both tested desktop widths, all ten real descriptions use one or two lines, all metadata groups remain one row, every CTA stays fully inside the card, and no copy or metadata overflow is present.
  - At `1131px`, every CTA aligns exactly with its Skill icon. At `1050px`, the maximum left-edge difference is 2px because the 62px icon is end-aligned inside a 64px grid track; no large lower-left void remains.
  - The focused same-input comparison shows title, description, metadata and CTA following the source's two-column copy rhythm. Remaining material, artwork-scale and typography-size differences stay assigned to later tasks.
  - Actual Chrome console errors and warnings are both zero. `npm run check` passed all typecheck, lint and 44 package tests; the production build passed.
  - No backend, API, database, production Skill data, asset, font or dependency changed.
- Chrome Evidence:
  - `.runtime/design-qa/va07/chrome-real-1131x560-rank03-content.png`
  - `.runtime/design-qa/va07/chrome-real-1131x560-all-content-geometry.json`
  - `.runtime/design-qa/va07/chrome-real-1050x1024-all-content-geometry.json`
  - `.runtime/design-qa/va07/chrome-real-1484x1060-rank01-content.png`
  - `.runtime/design-qa/va07/chrome-real-1484x1060-rank01-content.json`
  - `.runtime/design-qa/va07/reference-vs-chrome-1484x1060-rank01-content-normalized.jpg`
  - `.runtime/design-qa/va07/card-reference-vs-chrome-1484-rank01-content-normalized.jpg`
  - Raw screenshots came from the user's installed macOS Google Chrome. The handoff page is restored to the real `1131×560`, DPR 2 viewport at rank `#03`, light theme, paused autoplay and scroll Y `489.5`.
- Remaining Deviations:
  - The bottom control group still exceeds the native desktop width; `VA-08` is the next and only active task.
  - Previous/next preview composition, side arrows, artwork scale and all glass-material differences remain open under `VA-09`–`VA-15`.
  - Final type scale, button proportion and interaction material remain open under `VA-17` and `VA-19`; VA-07 closes only content flow and visibility.

### VA-08 — 2026-07-13

- Status: `COMPLETE`
- Progress: `9 / 25` tasks complete; `16` tasks remain.
- Changed Files:
  - `server/chipmate-word-render/apps/web/src/styles.css`
  - `server/chipmate-word-render/design-qa.md`
  - `server/chipmate-word-render/visual-alignment-plan.md`
  - `.runtime/design-qa/va08/chrome-real-controls-geometry.json`
  - `.runtime/design-qa/va08/chrome-real-1131x560-rank03-controls.png`
  - `.runtime/design-qa/va08/chrome-real-1050x1024-rank03-controls.png`
  - `.runtime/design-qa/va08/chrome-real-1484x1060-rank01-controls.png`
  - `.runtime/design-qa/va08/chrome-reference-vs-current-1484x1060.png`
  - `.runtime/design-qa/va08/chrome-reference-vs-current-controls.png`
- Commands:
  - Used the user's installed macOS Google Chrome to measure the control group before and after the change at the native `1131×560`, DPR 2 viewport.
  - Used temporary real-Chrome viewport overrides at `1050×1024`, `1440×1024` and `1484×1060`, then reset the override before handoff.
  - Captured rank `#03` at the native and 1050px widths, rank `#01` at the primary source size, and built full-page plus focused no-rescale same-input comparisons.
  - `jq` assertions over `.runtime/design-qa/va08/chrome-real-controls-geometry.json`.
  - `sips -g pixelWidth -g pixelHeight .runtime/design-qa/va08/*.png`.
  - `npm run check`.
  - `npm run build`.
- Results:
  - Replaced the fixed 1334px desktop control composition with fluid normal-flow grid tracks. Previous/next buttons, the ten-rank rail, progress/count and the approved pause control now contract continuously between 1051px and the 1484px source width.
  - Added a no-wrap rule for the native progress count. No control uses absolute positioning.
  - At the native `1131×560` viewport, control content shrank from `1278px` inside `1057px` to exactly `1057px`; the featured section shrank from `1310px` to its `1121px` client width.
  - The native, `1050×1024`, `1440×1024` and `1484×1060` real-Chrome checks all report every direct control child inside the control rectangle, rank-rail `scrollWidth <= clientWidth`, control-group `scrollWidth <= clientWidth` and no root horizontal overflow.
  - The focused source/current comparison confirms the complete bottom sequence remains visible. Final control scale and glass material are intentionally deferred to `VA-17` and `VA-19`.
  - Actual Chrome console errors and warnings are both zero. `npm run check` passed typecheck, lint and all 44 package tests; the production build passed.
  - No backend, API, database, production Skill data, asset, font or dependency changed.
- Chrome Evidence:
  - `.runtime/design-qa/va08/chrome-real-controls-geometry.json`
  - `.runtime/design-qa/va08/chrome-real-1131x560-rank03-controls.png`
  - `.runtime/design-qa/va08/chrome-real-1050x1024-rank03-controls.png`
  - `.runtime/design-qa/va08/chrome-real-1484x1060-rank01-controls.png`
  - `.runtime/design-qa/va08/chrome-reference-vs-current-1484x1060.png`
  - `.runtime/design-qa/va08/chrome-reference-vs-current-controls.png`
  - Raw screenshots came from the user's installed macOS Google Chrome. The handoff page is restored to the native `1131×560`, DPR 2 viewport at rank `#03`, light theme, paused autoplay and scroll Y `489`.
- Remaining Deviations:
  - Previous/next preview composition remains the next and only active task under `VA-09`; the current left preview still exposes clipped internal rank/icon content.
  - Card-side arrows remain open under `VA-10`.
  - Control typography, size hierarchy and Liquid Glass interaction material remain open under `VA-17` and `VA-19`; VA-08 closes only containment and overflow.

### VA-09 — 2026-07-13

- Status: `COMPLETE`
- Progress: `10 / 25` tasks complete; `15` tasks remain.
- Changed Files:
  - `server/chipmate-word-render/apps/web/src/main.tsx`
  - `server/chipmate-word-render/apps/web/src/styles.css`
  - `server/chipmate-word-render/design-qa.md`
  - `server/chipmate-word-render/visual-alignment-plan.md`
  - `.runtime/design-qa/va09/chrome-real-preview-geometry.json`
  - `.runtime/design-qa/va09/chrome-real-1131x560-rank03-preview.png`
  - `.runtime/design-qa/va09/chrome-real-1050x1024-rank01-preview.png`
  - `.runtime/design-qa/va09/chrome-real-1484x1060-rank01-preview.png`
  - `.runtime/design-qa/va09/chrome-reference-vs-current-1484x1060.png`
  - `.runtime/design-qa/va09/chrome-reference-vs-current-previews.png`
- Commands:
  - Used the user's installed macOS Google Chrome to record the before/after preview DOM and geometry at the native `1131×560`, DPR 2 viewport.
  - Used temporary real-Chrome viewport overrides at `1050×1024`, `1440×1024` and `1484×1060`; reset the override before handoff.
  - Clicked the clean previous glass edge and the next preview in actual Chrome, verified the carousel changed `03 → 02 → 03`, and restored rank `#03` with paused autoplay.
  - Captured real Chrome screenshots and built full-page plus focused no-rescale same-input comparisons against the selected source.
  - `jq` assertions over `.runtime/design-qa/va09/chrome-real-preview-geometry.json`.
  - `sips -g pixelWidth -g pixelHeight .runtime/design-qa/va09/*.png`.
  - `npm run check`.
  - `npm run build`.
- Results:
  - The previous preview now renders as a dedicated empty glass button with the existing accessible name and click behavior. Its rank and icon are no longer mounted, eliminating the old `112px` internal content inside a `52px` client width and preventing any clipped text or half icon.
  - The next preview keeps both identifying elements in normal grid flow but changes to the source's diagonal composition: rank at the upper-left and Skill icon at the lower-right with a deliberate edge crop.
  - At `1484×1060`, the clean previous glass edge is exactly `x=0–66`; the next preview is `x=1287–1484`, with the rank at `x=1310`, `y=715.5` and the icon at `x=1404`, `y=754`, matching the source geometry.
  - At native width, 1050px and 1440px, the next rank remains 100% visible and the icon remains 91% visible; the empty previous edge never contains cropped children and the root has no horizontal overflow.
  - Both previous and next preview buttons still switch the selected Skill. No icon control uses absolute positioning.
  - Actual Chrome console errors and warnings are both zero. `npm run check` passed typecheck, lint and all 44 package tests; the production build passed.
  - No backend, API, database, production Skill data, asset, font or dependency changed.
- Chrome Evidence:
  - `.runtime/design-qa/va09/chrome-real-preview-geometry.json`
  - `.runtime/design-qa/va09/chrome-real-1131x560-rank03-preview.png`
  - `.runtime/design-qa/va09/chrome-real-1050x1024-rank01-preview.png`
  - `.runtime/design-qa/va09/chrome-real-1484x1060-rank01-preview.png`
  - `.runtime/design-qa/va09/chrome-reference-vs-current-1484x1060.png`
  - `.runtime/design-qa/va09/chrome-reference-vs-current-previews.png`
  - Raw screenshots came from the user's installed macOS Google Chrome. The handoff page is restored to the native `1131×560`, DPR 2 viewport at rank `#03`, light theme, paused autoplay and scroll Y `489`.
- Remaining Deviations:
  - The source's in-card side arrows are still absent; `VA-10` is the next and only active task.
  - Preview transparency, refraction, depth and hover/active material remain open under `VA-14`; VA-09 closes only structure, content crop and recognizability.
  - Rank/icon scale and final interaction material remain open under `VA-15` and `VA-19`.

### VA-10 — 2026-07-13

- Status: `COMPLETE`
- Progress: `11 / 25` tasks complete; `14` tasks remain.
- Changed Files:
  - `server/chipmate-word-render/apps/web/src/main.tsx`
  - `server/chipmate-word-render/apps/web/src/styles.css`
  - `server/chipmate-word-render/design-qa.md`
  - `server/chipmate-word-render/visual-alignment-plan.md`
  - `.runtime/design-qa/va10/chrome-real-arrow-geometry.json`
  - `.runtime/design-qa/va10/chrome-real-1484x1060-rank01-arrows.png`
  - `.runtime/design-qa/va10/chrome-reference-vs-current-1484x1060.png`
  - `.runtime/design-qa/va10/chrome-reference-vs-current-arrows.png`
- Commands:
  - Used the user's installed macOS Google Chrome to click both new card-side buttons and verify `01 → 02 → 01`; verified the original bottom previous/next controls remain mounted.
  - Measured the stage at the native `1131×560`, DPR 2 viewport and temporary `1050×1024`, `1440×1024` and `1484×1060` desktop viewports; reset the override before handoff.
  - Captured the primary real-Chrome screenshot and built full-page plus focused no-rescale comparisons against the selected source.
  - `jq` assertions over `.runtime/design-qa/va10/chrome-real-arrow-geometry.json`.
  - `sips -g pixelWidth -g pixelHeight .runtime/design-qa/va10/*.png`.
  - `npm run check`.
  - `npm run build`.
- Results:
  - The source-aligned previous and next buttons now reuse the existing Phosphor carets and carousel `shift` logic as co-located grid items. No icon control or arrow uses `position: absolute`.
  - At `1484×1060`, the active card remains exactly `1090×255`; the left button is `x=78.98–122.98`, the card is `x=136–1226`, the right button is `x=1239–1283`, and the next preview starts at `x=1287`. These positions match the selected source's card gaps.
  - At the native viewport the card remains `909×255`, both arrows stay visible between the clean previous edge, active card and next preview, and the root has no horizontal overflow.
  - At `1050×1024`, the previous preview and previous arrow are hidden together while the right arrow stays attached to the next-preview boundary; at `1440×1024`, both arrows remain outside the active card with positive gaps and no root overflow.
  - Both card-side directions switch the selected Skill, while the existing bottom navigation remains present. Actual Chrome console errors and warnings are both zero.
  - `npm run check` passed typecheck, lint and all 44 package tests; the production build passed.
  - No backend, API, database, production Skill data, asset, font or dependency changed.
- Chrome Evidence:
  - `.runtime/design-qa/va10/chrome-real-arrow-geometry.json`
  - `.runtime/design-qa/va10/chrome-real-1484x1060-rank01-arrows.png`
  - `.runtime/design-qa/va10/chrome-reference-vs-current-1484x1060.png`
  - `.runtime/design-qa/va10/chrome-reference-vs-current-arrows.png`
  - Raw screenshots came from the user's installed macOS Google Chrome. The handoff page is restored to the native `1131×560`, DPR 2 viewport at rank `#03`, light theme, paused autoplay and scroll Y `489`.
- Remaining Deviations:
  - The spatial artwork is still too large and too far left compared with the source; `VA-11` is the next and only active task.
  - Main-card, outer-stage and preview materials remain open under `VA-12`–`VA-14`; rank/icon scale remains open under `VA-15`.
  - Final arrow/control typography and Liquid Glass interaction material remain open under `VA-17` and `VA-19`; VA-10 closes only structure, geometry and switching behavior.

### VA-11 — 2026-07-13

- Status: `COMPLETE`
- Progress: `12 / 25` tasks complete; `13` tasks remain.
- Changed Files:
  - `server/chipmate-word-render/apps/web/src/styles.css`
  - `server/chipmate-word-render/design-qa.md`
  - `server/chipmate-word-render/visual-alignment-plan.md`
  - `.runtime/design-qa/va11/chrome-real-artwork-geometry.json`
  - `.runtime/design-qa/va11/chrome-real-1050x1024-rank01-artwork.png`
  - `.runtime/design-qa/va11/chrome-real-1131x560-rank01-artwork.png`
  - `.runtime/design-qa/va11/chrome-real-1484x1060-rank01-artwork.png`
  - `.runtime/design-qa/va11/chrome-reference-vs-current-1484x1060.png`
  - `.runtime/design-qa/va11/chrome-reference-vs-current-artwork.png`
- Commands:
  - Used the user's installed macOS Google Chrome to fix rank `#01`, light theme and paused autoplay, then measured the real asset projection at `1484×1060`, `1440×1024`, `1050×1024` and the native `1131×560`, DPR 2 viewport.
  - Captured primary, 1050px and native screenshots in the installed Chrome; restored the native viewport, rank `#03`, paused autoplay and scroll Y `488.5` before handoff.
  - Built full-page and focused no-rescale same-input comparisons against the selected source and opened the focused artwork comparison for visual review.
  - `jq` assertions over `.runtime/design-qa/va11/chrome-real-artwork-geometry.json`.
  - `sips -g pixelWidth -g pixelHeight .runtime/design-qa/va11/*.png`.
  - `npm run check`.
  - `npm run build`.
- Results:
  - The desktop DOM artwork changed from a `520–630px` image at 42% vertical position to a responsive `440–520px` image at 50%, with its right edge moved 18px farther into the card crop. It continues to use the supplied `spatial-hero.webp` in the existing third grid column.
  - At `1484×1060`, the projected spatial icon is `x=921.59–1142.81`, width `221.22px`, bottom `899.41`; the source estimate is `x≈923–1140`, bottom `≈900`. The copy-to-subject gap is `51.43px`, while the active card remains exactly `1090×255`.
  - The focused same-input comparison shows the icon subject now matches the source scale, horizontal placement and bottom crop. The circular platform continues across the card's right field without invading title, verification label, description or metadata.
  - At `1440×1024`, the subject begins `60.88px` after copy. At the native `1131×560`, it begins `62.04px` after copy. Neither viewport has root horizontal overflow.
  - The 1050px desktop background artwork now uses a smaller 46% crop extended beyond the card's right edge. Its subject begins `22.74px` after copy and `40.66px` after the verification label, eliminating the previous label/image collision without changing the mobile layout.
  - Actual Chrome console errors and warnings are both zero. `npm run check` passed typecheck, lint and all 44 package tests; the production build passed.
  - No asset, backend, API, database, production Skill data, font or dependency changed.
- Chrome Evidence:
  - `.runtime/design-qa/va11/chrome-real-artwork-geometry.json`
  - `.runtime/design-qa/va11/chrome-real-1050x1024-rank01-artwork.png`
  - `.runtime/design-qa/va11/chrome-real-1131x560-rank01-artwork.png`
  - `.runtime/design-qa/va11/chrome-real-1484x1060-rank01-artwork.png`
  - `.runtime/design-qa/va11/chrome-reference-vs-current-1484x1060.png`
  - `.runtime/design-qa/va11/chrome-reference-vs-current-artwork.png`
  - Raw screenshots came from the user's installed macOS Google Chrome. The handoff page is restored to the native `1131×560`, DPR 2 viewport at rank `#03`, light theme, paused autoplay and scroll Y `488.5`.
- Remaining Deviations:
  - The main card is still more opaque and flatter than the source; environment-color transmission, refraction, blur, inner highlight, boundary and shadow remain the next and only active task under `VA-12`.
  - Outer-stage and preview materials remain open under `VA-13` and `VA-14`; rank/icon scale remains open under `VA-15`.
  - Typography, control proportion and interaction materials remain open under `VA-17`–`VA-19`; VA-11 closes only artwork scale, placement, crop and copy safety.

### VA-12 — 2026-07-14

- Status: `COMPLETE`
- Progress: `13 / 25` tasks complete; `12` tasks remain.
- Changed Files:
  - `server/chipmate-word-render/apps/web/src/styles.css`
  - `server/chipmate-word-render/design-qa.md`
  - `server/chipmate-word-render/visual-alignment-plan.md`
  - `.runtime/design-qa/va12/chrome-material-evidence.json`
  - `.runtime/design-qa/va12/material-color-stats.json`
  - `.runtime/design-qa/va12/chrome-real-1484x1060-rank01-light-card.png`
  - `.runtime/design-qa/va12/chrome-real-1440x1024-rank01-light-card.png`
  - `.runtime/design-qa/va12/chrome-real-1050x1024-rank01-light-card.png`
  - `.runtime/design-qa/va12/chrome-real-1484x1060-rank01-dark-card.png`
  - `.runtime/design-qa/va12/chrome-real-1131x560-rank01-light-card.png`
  - `.runtime/design-qa/va12/chrome-real-1131x560-rank03-handoff.png`
  - `.runtime/design-qa/va12/chrome-reference-vs-current-1484x1060.png`
  - `.runtime/design-qa/va12/chrome-reference-vs-current-light-card.png`
- Commands:
  - Used the user's installed macOS Google Chrome to capture the main card at `1484×1060`, `1440×1024`, `1050×1024` and the native `1131×560`, DPR 2 viewport.
  - Captured the real light and dark theme states, restored light theme, native viewport, rank `#03`, paused autoplay and the Top 10 scroll position before handing the tab back.
  - Built a full-page and focused `1090×255` no-rescale same-input comparison against the selected source, then sampled four card material regions with Sharp.
  - `jq` assertions over `.runtime/design-qa/va12/chrome-material-evidence.json` and `.runtime/design-qa/va12/material-color-stats.json`.
  - `sips -g pixelWidth -g pixelHeight` over the installed-Chrome captures.
  - `npm run check`.
  - `npm run build`.
- Results:
  - Removed the desktop card's opaque `glass-field.webp` surface layer while retaining the supplied spatial art. The active card now uses two low-opacity material gradients over the existing section light field, so the left side transmits environmental blue instead of becoming a flat white panel.
  - Added a desktop `blur(30px) saturate(135%) brightness(1.02)` backdrop treatment, a fine `rgba(255,255,255,.88)` boundary, two light exterior shadows and four inset highlight/refraction layers. The dark theme uses a separately tuned low-luminance material rather than reusing the light values.
  - In the lower-left sample, the source/current mean RGB difference improved from approximately `8 / 7 / 4` before the final material tuning to `4 / 5 / 3`; the mid-card sample is within approximately `1 / 4 / 2`. The focused comparison shows environmental transmission without losing copy contrast or the source-aligned spatial subject.
  - The `1090×255` primary card remains unchanged. The 1440px, 1050px and native installed-Chrome captures retain the established desktop structure and show no visible page-level horizontal overflow or card/content collision.
  - Light and dark themes remain legible, the actual Chrome console has zero warnings and zero errors, and all screenshots were taken with the user-installed Chrome rather than standalone Playwright.
  - `npm run check` passed generated-contract validation, typecheck, lint and all 44 package tests; `npm run build` passed. No backend, API, database, production Skill data, asset, font or dependency changed.
- Chrome Evidence:
  - `.runtime/design-qa/va12/chrome-material-evidence.json`
  - `.runtime/design-qa/va12/material-color-stats.json`
  - `.runtime/design-qa/va12/chrome-real-1484x1060-rank01-light-card.png`
  - `.runtime/design-qa/va12/chrome-real-1440x1024-rank01-light-card.png`
  - `.runtime/design-qa/va12/chrome-real-1050x1024-rank01-light-card.png`
  - `.runtime/design-qa/va12/chrome-real-1484x1060-rank01-dark-card.png`
  - `.runtime/design-qa/va12/chrome-real-1131x560-rank01-light-card.png`
  - `.runtime/design-qa/va12/chrome-real-1131x560-rank03-handoff.png`
  - `.runtime/design-qa/va12/chrome-reference-vs-current-1484x1060.png`
  - `.runtime/design-qa/va12/chrome-reference-vs-current-light-card.png`
  - Raw screenshots came from the user's installed macOS Google Chrome. The tab is handed back at the native `1131×560`, DPR 2 viewport, rank `#03`, light theme, paused autoplay and the Top 10 scroll position.
- Remaining Deviations:
  - The outer carousel shell is still too cyan and dense near its lower field; `VA-13` is the next and only active task.
  - Preview-card depth and opacity remain open under `VA-14`; rank badge and Skill-icon base scale remain open under `VA-15`.
  - Typography, header proportion and interaction-state material remain open under `VA-17`–`VA-19`; VA-12 closes only the active-card surface material.

### VA-13 — 2026-07-14

- Status: `COMPLETE`
- Progress: `14 / 25` tasks complete; `11` tasks remain.
- Changed Files:
  - `server/chipmate-word-render/apps/web/src/styles.css`
  - `server/chipmate-word-render/design-qa.md`
  - `server/chipmate-word-render/visual-alignment-plan.md`
  - `.runtime/design-qa/va13/chrome-shell-evidence.json`
  - `.runtime/design-qa/va13/outer-shell-before-stats.json`
  - `.runtime/design-qa/va13/outer-shell-after-stats.json`
  - `.runtime/design-qa/va13/outer-shell-color-summary.json`
  - `.runtime/design-qa/va13/chrome-real-1484x1060-rank01-light-shell.png`
  - `.runtime/design-qa/va13/chrome-real-1440x1024-rank01-light-shell.png`
  - `.runtime/design-qa/va13/chrome-real-1050x1024-rank01-light-shell.png`
  - `.runtime/design-qa/va13/chrome-real-1484x1060-rank01-dark-shell.png`
  - `.runtime/design-qa/va13/chrome-real-1131x560-rank01-light-shell.png`
  - `.runtime/design-qa/va13/chrome-real-1131x560-rank03-handoff.png`
  - `.runtime/design-qa/va13/chrome-reference-vs-current-1484x1060.png`
  - `.runtime/design-qa/va13/chrome-reference-vs-current-shell.png`
  - `.runtime/design-qa/va13/chrome-reference-before-after-shell.png`
- Commands:
  - Used the user's installed macOS Google Chrome to capture the outer carousel shell at `1484×1060`, `1440×1024`, `1050×1024` and the native `1131×560`, DPR 2 viewport.
  - Captured both explicit light and dark theme states, then restored light theme, native viewport, rank `#03`, paused autoplay and scroll Y `489` before handing the Chrome tab back.
  - Built full-page, focused source/current and source/before/after no-rescale comparisons; sampled six blank shell regions with Sharp and retained the three most stable material baselines in the summary evidence.
  - `jq` and Node assertions over `.runtime/design-qa/va13/chrome-shell-evidence.json` and `.runtime/design-qa/va13/outer-shell-color-summary.json`.
  - `sips -g pixelWidth -g pixelHeight` over the installed-Chrome captures.
  - `npm run check`.
  - `npm run build`.
- Results:
  - Replaced the desktop shell's saturated `135deg` white-to-cyan wash with a neutral horizontal white/blue/warm-white transmission field plus a very low-opacity vertical depth layer. The underlying spatial light still passes through, but the shell no longer adds a dense cyan floor.
  - Reduced desktop shell backdrop saturation from `150%` to `100%`, increased blur from `28px` to `32px`, and added separate top highlight, lower refraction and diffuse inset depth layers around a finer `rgba(255,255,255,.82)` boundary.
  - The right-side blank-region chroma moved from `31.02` before the fix to `19.91`; the source is `19.43`. Its absolute chroma gap therefore dropped from `11.59` to `0.48`.
  - The center-header luma gap dropped from `4.79` to `0.97`, while the lower blank strip luma gap dropped from `2.18` to `0.34`. The focused same-input comparison shows the outer field now follows the source's neutral white-blue gradient without flattening the active card.
  - The explicit dark theme uses a separate neutral slate-glass surface rather than the light values. All four tested desktop widths retain the established card geometry and `scrollWidth == clientWidth`; mobile styling was not changed or visually assessed.
  - Actual Chrome console errors and warnings are both zero. `npm run check` passed generated-contract validation, typecheck, lint and all 44 package tests; `npm run build` passed. No backend, API, database, production Skill data, asset, font or dependency changed.
- Chrome Evidence:
  - `.runtime/design-qa/va13/chrome-shell-evidence.json`
  - `.runtime/design-qa/va13/outer-shell-color-summary.json`
  - `.runtime/design-qa/va13/chrome-real-1484x1060-rank01-light-shell.png`
  - `.runtime/design-qa/va13/chrome-real-1440x1024-rank01-light-shell.png`
  - `.runtime/design-qa/va13/chrome-real-1050x1024-rank01-light-shell.png`
  - `.runtime/design-qa/va13/chrome-real-1484x1060-rank01-dark-shell.png`
  - `.runtime/design-qa/va13/chrome-real-1131x560-rank01-light-shell.png`
  - `.runtime/design-qa/va13/chrome-real-1131x560-rank03-handoff.png`
  - `.runtime/design-qa/va13/chrome-reference-vs-current-1484x1060.png`
  - `.runtime/design-qa/va13/chrome-reference-vs-current-shell.png`
  - `.runtime/design-qa/va13/chrome-reference-before-after-shell.png`
  - Raw screenshots came from the user's installed macOS Google Chrome. The handoff page is restored to the native `1131×560`, DPR 2 viewport at rank `#03`, light theme, paused autoplay and scroll Y `489`.
- Remaining Deviations:
  - Preview cards still lack the source's clearly subordinate pending-state transparency and depth; `VA-14` is the next and only active task.
  - Rank badge and Skill-icon base scale remain open under `VA-15`; the rank-03 category icon runtime check remains under `VA-16`.
  - Typography, header proportion and interaction-state material remain open under `VA-17`–`VA-19`; VA-13 closes only the outer carousel shell material.

### VA-14 — 2026-07-14

- Status: `COMPLETE`
- Progress: `15 / 25` tasks complete; `10` tasks remain.
- Changed Files:
  - `server/chipmate-word-render/apps/web/src/styles.css`
  - `server/chipmate-word-render/design-qa.md`
  - `server/chipmate-word-render/visual-alignment-plan.md`
  - `.runtime/design-qa/va14/chrome-preview-evidence.json`
  - `.runtime/design-qa/va14/preview-material-color-stats.json`
  - `.runtime/design-qa/va14/chrome-real-1484x1060-rank01-light-preview.png`
  - `.runtime/design-qa/va14/chrome-real-1484x1060-rank01-light-preview-hover.png`
  - `.runtime/design-qa/va14/chrome-real-1440x1024-rank01-light-preview.png`
  - `.runtime/design-qa/va14/chrome-real-1050x1024-rank01-light-preview.png`
  - `.runtime/design-qa/va14/chrome-real-1484x1060-rank01-dark-preview.png`
  - `.runtime/design-qa/va14/chrome-real-1131x560-rank03-handoff.png`
  - `.runtime/design-qa/va14/reference-before-after-previews.png`
  - `.runtime/design-qa/va14/reference-vs-current-next-preview.png`
- Commands:
  - Used the user's installed macOS Google Chrome to capture the pending previews at `1484×1060`, `1440×1024`, `1050×1024` and the native `1131×560`, DPR 2 viewport.
  - Captured the real rank-01 light baseline, light hover, rank-01 dark state and rank-03 native handoff; clicked the next-preview card and verified the active rank changed from `01` to `02`.
  - Built source/before/after and source/current no-rescale preview comparisons, then sampled panel, blank field, rank and icon regions with Sharp.
  - `jq` assertions over `.runtime/design-qa/va14/chrome-preview-evidence.json` and `.runtime/design-qa/va14/preview-material-color-stats.json`.
  - `sips -g pixelWidth -g pixelHeight` over every installed-Chrome capture.
  - `npm run check`.
  - `npm run build`.
- Results:
  - Raised the pending-card surface from the previous whole-card `0.58` opacity to a measured `0.82` light-state transmission layer, while keeping the icon separately at `0.88` opacity and restrained saturation. The card therefore reads as a subordinate glass layer without washing its rank and icon into the background.
  - Replaced the former white-heavy overlay with a pale-blue transmission gradient over the existing `glass-field.webp`, retained `30px` backdrop blur, and added separate top highlight, lower refraction, diffuse inset depth and light exterior elevation layers.
  - The sampled panel chroma moved from `15.03` before the fix to `23.17`; the source is `30.99`. Rank chroma moved from `19.90` to `29.42` against a `34.48` source, and icon chroma from `40.42` to `59.66` against a `76.03` source. The focused same-input comparison shows the internal rank and icon becoming distinctly readable while the container remains behind the active card.
  - Hover raises the preview by `3px`, increases surface opacity to `0.96`, brings the icon to `0.98`, and strengthens the boundary, refraction and shadow. The explicit active state compresses the surface slightly, increases contrast, and the live click continues to select the represented Skill.
  - Light and dark materials are tuned separately. At all four tested desktop widths, `scrollWidth == clientWidth`; the 1484px next preview remains `197×255`, the 1050px next preview remains `120×255`, and no established track geometry changed.
  - Actual Chrome console errors and warnings are both zero. `npm run check` passed generated-contract validation, typecheck, lint and all 44 package tests; `npm run build` passed. No backend, API, database, production Skill data, asset, font or dependency changed.
- Chrome Evidence:
  - `.runtime/design-qa/va14/chrome-preview-evidence.json`
  - `.runtime/design-qa/va14/preview-material-color-stats.json`
  - `.runtime/design-qa/va14/chrome-real-1484x1060-rank01-light-preview.png`
  - `.runtime/design-qa/va14/chrome-real-1484x1060-rank01-light-preview-hover.png`
  - `.runtime/design-qa/va14/chrome-real-1440x1024-rank01-light-preview.png`
  - `.runtime/design-qa/va14/chrome-real-1050x1024-rank01-light-preview.png`
  - `.runtime/design-qa/va14/chrome-real-1484x1060-rank01-dark-preview.png`
  - `.runtime/design-qa/va14/chrome-real-1131x560-rank03-handoff.png`
  - `.runtime/design-qa/va14/reference-before-after-previews.png`
  - `.runtime/design-qa/va14/reference-vs-current-next-preview.png`
  - Raw screenshots came from the user's installed macOS Google Chrome. The tab is handed back at the native `1131×560`, DPR 2 viewport, rank `#03`, light theme, paused autoplay and scroll Y `489.5`.
- Remaining Deviations:
  - Rank badge and Skill-icon base size, edge proportion and visual weight remain the next and only active task under `VA-15`; VA-14 intentionally did not resize either component.
  - The rank-03 category icon runtime check remains under `VA-16`; typography, header proportion and broader focus/disabled/reduced-motion materials remain open under `VA-17`–`VA-19`.
  - VA-14 closes only pending-preview saturation, transparency, blur, refraction, depth, hover and active material. Mobile was not visually assessed.

### VA-15 — 2026-07-14

- Status: `COMPLETE`
- Progress: `16 / 25` tasks complete; `9` tasks remain.
- Changed Files:
  - `server/chipmate-word-render/apps/web/src/styles.css`
  - `server/chipmate-word-render/design-qa.md`
  - `server/chipmate-word-render/visual-alignment-plan.md`
  - `.runtime/design-qa/va15/chrome-badge-icon-evidence.json`
  - `.runtime/design-qa/va15/rank-icon-saturated-bounds.json`
  - `.runtime/design-qa/va15/chrome-real-1484x1060-rank01-light-badge-icon.png`
  - `.runtime/design-qa/va15/chrome-real-1440x1024-rank01-light-badge-icon.png`
  - `.runtime/design-qa/va15/chrome-real-1050x1024-rank01-light-badge-icon.png`
  - `.runtime/design-qa/va15/chrome-real-1484x1060-rank01-dark-badge-icon.png`
  - `.runtime/design-qa/va15/chrome-real-1131x560-rank03-handoff.png`
  - `.runtime/design-qa/va15/reference-before-after-rank-icon.png`
  - `.runtime/design-qa/va15/reference-vs-current-rank-icon.png`
  - `.runtime/design-qa/va15/reference-vs-current-card-left.png`
- Commands:
  - Used the user's installed macOS Google Chrome to measure and capture the rank badge and Skill-icon base at `1484×1060`, `1440×1024`, `1050×1024` and the native `1131×560`, DPR 2 viewport.
  - Captured the effective light and dark material states, restored the light theme, native viewport, rank `#03`, paused autoplay and scroll Y `489.5`, then handed the Chrome tab back.
  - Built source/before/after and source/current no-rescale component comparisons with `ffmpeg` and measured connected high-chroma component bounds.
  - `jq` assertions over `.runtime/design-qa/va15/chrome-badge-icon-evidence.json` and `.runtime/design-qa/va15/rank-icon-saturated-bounds.json`.
  - `sips -g pixelWidth -g pixelHeight` over every installed-Chrome capture and comparison.
  - `npm run check`.
  - `npm run build`.
- Results:
  - Replaced the active badge's plain rounded square with a curved shield silhouette, a separate `3px` gold-glass rim and an inset blue glass body. The desktop DOM badge is `84×98`; its measured high-chroma silhouette is `86×98` versus the source's `90×98`, while the previous silhouette was `84×93` and lacked the source's lower shield depth.
  - The visual measurement showed that the Skill icon itself was undersized, despite the task's initial broad “shrink” wording. The icon therefore moved from an `85×86` high-chroma core to `94×94`, within `2×1px` of the source's `92×93`, inside a dedicated `114×114` frosted base with restrained boundary, blur, inset light and shadow.
  - The icon base and verification seal remain in one normal-flow CSS grid; the badge text remains in its own normal-flow grid. No icon or button gained absolute positioning.
  - Preserved the established copy rhythm: the desktop badge-to-icon gap is `11px`, icon-base-to-title gap is `16px`, and the rank-01 title still begins at `x=382` in the primary viewport. The 1050px desktop breakpoint retains its compact `70×86` badge, `72×72` base and `62×62` icon.
  - At every measured desktop width the root overflow is zero. The distinct dark material stays legible, and the installed Chrome console contains zero warnings and zero errors.
  - `npm run check` passed generated-contract validation, typecheck, lint and all 44 package tests; `npm run build` passed. No backend, API, database, production Skill data, asset, font or dependency changed.
- Chrome Evidence:
  - `.runtime/design-qa/va15/chrome-badge-icon-evidence.json`
  - `.runtime/design-qa/va15/rank-icon-saturated-bounds.json`
  - `.runtime/design-qa/va15/chrome-real-1484x1060-rank01-light-badge-icon.png`
  - `.runtime/design-qa/va15/chrome-real-1440x1024-rank01-light-badge-icon.png`
  - `.runtime/design-qa/va15/chrome-real-1050x1024-rank01-light-badge-icon.png`
  - `.runtime/design-qa/va15/chrome-real-1484x1060-rank01-dark-badge-icon.png`
  - `.runtime/design-qa/va15/chrome-real-1131x560-rank03-handoff.png`
  - `.runtime/design-qa/va15/reference-before-after-rank-icon.png`
  - `.runtime/design-qa/va15/reference-vs-current-rank-icon.png`
  - `.runtime/design-qa/va15/reference-vs-current-card-left.png`
  - Raw screenshots came from the user's installed macOS Google Chrome. The tab is handed back at the native `1131×560`, DPR 2 viewport, rank `#03`, light theme, paused autoplay and scroll Y `489.5`.
- Remaining Deviations:
  - `VA-16` is the next and only active task: verify that rank `#03` uses its development-family icon in the complete real runtime and that only the curated whitelist retains the ChipMate mark.
  - Typography, spacing, header proportion and broader interaction materials remain open under `VA-17`–`VA-19`; VA-15 closes only the active rank badge and Skill-icon base geometry/material.
  - Mobile was not modified or visually assessed. The current QA result remains reopened.

### VA-16 — 2026-07-14

- Status: `COMPLETE`
- Progress: `17 / 25` tasks complete; `8` tasks remain.
- Changed Files:
  - `server/chipmate-word-render/design-qa.md`
  - `server/chipmate-word-render/visual-alignment-plan.md`
  - `.runtime/design-qa/va16/chrome-category-icon-evidence.json`
  - `.runtime/design-qa/va16/chrome-real-1484x1060-rank01.png`
  - `.runtime/design-qa/va16/chrome-real-1484x1060-rank03.png`
  - `.runtime/design-qa/va16/chrome-real-rank01-card.png`
  - `.runtime/design-qa/va16/chrome-real-rank03-card.png`
  - `.runtime/design-qa/va16/chrome-real-chipmate-vs-development.png`
  - `.runtime/design-qa/va16/chrome-real-1131x560-rank03-handoff.png`
- Commands:
  - Read the live `GET /api/v1/skills?sort=downloads&limit=10` response and resolved each row through the current `image`/`art` mapping without modifying the catalog.
  - Used the user's installed macOS Google Chrome to select ranks `01` through `10` one at a time and record the rendered image `src`, `currentSrc`, natural dimensions, load completion, active-card label and root overflow.
  - Captured real-Chrome rank-01 and rank-03 desktop states, built a focused same-input ChipMate/development comparison, then restored the native viewport, rank `#03`, light theme, paused autoplay and scroll Y `489` before handing back the tab.
  - Requested every final runtime asset from the live server and confirmed HTTP `200`.
  - `jq` assertions over `.runtime/design-qa/va16/chrome-category-icon-evidence.json`.
  - `sips -g pixelWidth -g pixelHeight` over every installed-Chrome capture and comparison.
  - `npm run check`.
  - `npm run build`.
- Results:
  - Rank `#03 C/C++ Codebase Analysis` renders `/assets/skill-icons/dev-terminal.webp`, a loaded `512×512` development-family asset. It no longer reproduces the stale ChipMate icon shown in the user's earlier screenshot.
  - Rank `#01 source-backed-detail-design` is the only runtime card using `/assets/chipmate-icon.png`. The other nine cards resolve to category-prefixed `dev-*`, `test-*` or `ops-*` assets matching the live API category.
  - Rank `#02` deliberately advertises the missing `/assets/missing-preview-icon.png`; the real browser `onError` path replaces it with `/assets/skill-icons/dev-architecture.webp`, proving the category fallback in the actual runtime rather than only in a unit test.
  - Every final icon is complete, has non-zero natural dimensions and returns HTTP `200`. All ten ranks retain zero root overflow, and the real Chrome console contains zero warnings and zero errors.
  - No implementation repair was required: the existing source, current Vite service, live API data and real Chrome output are aligned. No cache clear, seed rewrite, production catalog mutation or code change was made.
  - `npm run check` passed generated-contract validation, typecheck, lint and all 44 package tests; `npm run build` passed.
- Chrome Evidence:
  - `.runtime/design-qa/va16/chrome-category-icon-evidence.json`
  - `.runtime/design-qa/va16/chrome-real-1484x1060-rank01.png`
  - `.runtime/design-qa/va16/chrome-real-1484x1060-rank03.png`
  - `.runtime/design-qa/va16/chrome-real-rank01-card.png`
  - `.runtime/design-qa/va16/chrome-real-rank03-card.png`
  - `.runtime/design-qa/va16/chrome-real-chipmate-vs-development.png`
  - `.runtime/design-qa/va16/chrome-real-1131x560-rank03-handoff.png`
  - Raw screenshots came from the user's installed macOS Google Chrome. The tab is handed back at the native `1131×560`, DPR 2 viewport, rank `#03`, light theme, paused autoplay and scroll Y `489`.
- Remaining Deviations:
  - `VA-17` is the next and only active task: align typography, internal spacing, card padding, gaps, radii and section height against the selected source.
  - Header proportion and broader interaction materials remain open under `VA-18` and `VA-19`; regression and final sign-off tasks remain open under `VA-20`–`VA-24`.
  - Mobile was not modified or visually assessed. The current QA result remains reopened.

### VA-17 — 2026-07-14

- Status: `COMPLETE`
- Progress: `18 / 25` tasks complete; `7` tasks remain.
- Changed Files:
  - `server/chipmate-word-render/apps/web/src/styles.css`
  - `server/chipmate-word-render/design-qa.md`
  - `server/chipmate-word-render/visual-alignment-plan.md`
  - `.runtime/design-qa/va17/*`
- Commands:
  - Built full-page and active-card source/current same-input comparisons with `ffmpeg`; the selected source and installed-Chrome implementation were judged in one comparison input before and after editing.
  - Used the user's installed macOS Google Chrome to measure computed typography, line height, margins, gaps, radii, card/section geometry and overflow at rank `#01` and long-title rank `#03`.
  - Captured light-theme desktop evidence at `1484×1060`, `1440×1024`, `1050×1024` and native `1131×560`, plus an effective dark-theme `1484×1060` capture.
  - `npm run check`.
  - `npm run build`.
- Results:
  - Reduced the featured heading from `32px/700` to `31px/680` and the primary Skill title from `27px/700` to `26px/680` at wide desktop widths. The `1051–1399px` range now scales the Skill title down to `21px` at the native `1131px` viewport so `C/C++ Codebase Analysis` stays on one line with its verification label.
  - Replaced the wide title/verification grid distribution with a compact normal-flow flex row. At `1484px`, rank `#03` uses a single `305.2×29.9px` title line; its label starts after an `8px` gap, and neither element overlaps the description.
  - Corrected the copy rhythm to a `23.1px` description line height with `16px` top and `15px` bottom margins. Metadata remains truthful (`9600` for rank `#03`, `1.2万` for rank `#01`) while its lower-contrast color and `680` download emphasis reduce auxiliary visual weight.
  - Tightened the CTA to `134×44px`, aligned its top edge with the source comparison and preserved a `29px` bottom safety margin inside the `255px` card.
  - Preserved the already matched `1090×255` active card, `18px` card padding, `18px` stage gap and `30px` card radius. Only the outer featured shell was corrected to a `32px` top radius and `39px` bottom padding so the section reaches the source's viewport baseline without changing card geometry.
  - The rank-03 title remains one line at `1484`, `1440`, `1050` and native `1131` desktop widths. All measured states retain zero horizontal page overflow; the installed Chrome console contains zero warnings and zero errors.
  - `npm run check` passed generated-contract validation, typecheck, lint and all 44 package tests; `npm run build` passed. No backend, API, database, production Skill data, asset, font or dependency changed.
- Chrome Evidence:
  - `.runtime/design-qa/va17/chrome-real-1484x1060-rank01-light.png`
  - `.runtime/design-qa/va17/chrome-real-1484x1060-rank03-light-fullpage.png`
  - `.runtime/design-qa/va17/chrome-real-1440x1024-rank03-light-fullpage.png`
  - `.runtime/design-qa/va17/chrome-real-1050x1024-rank03-light-fullpage.png`
  - `.runtime/design-qa/va17/chrome-real-1484x1060-rank03-dark-fullpage.png`
  - `.runtime/design-qa/va17/chrome-real-native-rank03-light-handoff.png`
  - `.runtime/design-qa/va17/reference-vs-after-full-1484x1060.png`
  - `.runtime/design-qa/va17/reference-vs-after-card-1484x1060.png`
  - Raw implementation screenshots came from the user's installed macOS Google Chrome. The tab is handed back at native `1131×560`, DPR 2, rank `#03`, light theme, paused autoplay and scroll Y `489`.
- Remaining Deviations:
  - `VA-18` is the next and only active task: reduce Header, Logo and navigation-control proportions while keeping the theme button at the approved leftmost position in the right-side group.
  - Component interaction materials remain open under `VA-19`; regression and final sign-off tasks remain open under `VA-20`–`VA-24`.
  - Mobile was not modified or visually assessed. The current QA result remains reopened.

### VA-18 — 2026-07-14

- Status: `COMPLETE`
- Progress: `19 / 25` tasks complete; `6` tasks remain.
- Changed Files:
  - `server/chipmate-word-render/apps/web/src/styles.css`
  - `server/chipmate-word-render/design-qa.md`
  - `server/chipmate-word-render/visual-alignment-plan.md`
  - `.runtime/design-qa/va18/*`
- Commands:
  - Used the user's installed macOS Google Chrome to measure the Header, brand, logo, each right-navigation control, trust line, Hero, featured shell and active card at `1484×1060`, `1440×1024`, `1050×1024` and native `1131×560`, DPR 2.
  - Captured light and effective-dark states, verified the theme cycle, and checked the real Chrome console.
  - Built source/before/after Header and full-page same-input comparisons with `ffmpeg`; judged the selected source and installed-Chrome implementation together before closing the task.
  - `npm run check`.
  - `npm run build`.
- Results:
  - Reduced the desktop top bar from `110px` to `100px`, logo from `58px` to `54px`, brand title from `23px` to `22px`, subtitle from `13px` to `12px`, navigation controls from `44px` to `42px`, navigation icon size from `19px` to `18px`, and inter-control gap from `10px` to `8px`.
  - The theme control remains the first item in the right-side navigation group. Theme, catalog, service status, login and publish form one `42px`-high row at every measured desktop width; login and publish no longer read as crowded, and no product control was removed.
  - Increased the following trust line from `44px` to `54px` while reducing the Header by the same `10px`. The combined pre-Hero height remains `154px`, so the already aligned Hero, featured shell and `1090×255` active card remain at `y=154`, `y=589` and `y=696.695` in the primary viewport.
  - The primary navigation occupies `518px` and keeps explicit `8px` gaps. The `1484px`, `1440px`, `1050px` and native `1131px` desktop states retain zero root horizontal overflow; light/dark theme geometry is identical.
  - The real Chrome console contains zero warnings and zero errors. `npm run check` passed generated-contract validation, typecheck, lint and all 44 package tests; `npm run build` passed. No backend, API, database, production Skill data, asset, font or dependency changed.
- Chrome Evidence:
  - `.runtime/design-qa/va18/header-geometry-evidence.json`
  - `.runtime/design-qa/va18/01-real-chrome-after-1484x1060-full.png`
  - `.runtime/design-qa/va18/02-real-chrome-after-1484x1060.png`
  - `.runtime/design-qa/va18/03-reference-vs-after-header.png`
  - `.runtime/design-qa/va18/04-reference-vs-after-full.png`
  - `.runtime/design-qa/va18/06-real-chrome-light-1440x1024-full.png`
  - `.runtime/design-qa/va18/07-real-chrome-light-1050x1024-full.png`
  - `.runtime/design-qa/va18/08-real-chrome-dark-1484x1060-full.png`
  - `.runtime/design-qa/va18/09-real-chrome-native-light-rank03-full.png`
  - `.runtime/design-qa/va18/10-real-chrome-native-light-rank03-handoff.png`
  - Raw implementation screenshots came from the user's installed macOS Google Chrome. Temporary viewport overrides were reset; the tab is handed back at native `1131×560`, DPR 2, rank `#03`, light theme, paused autoplay and scroll Y `489`.
- Remaining Deviations:
  - `VA-19` is the next and only active task: inspect and align each component's light, dark, hover, focus, active, disabled, pause and reduced-motion material state.
  - Desktop geometry regression and final sign-off tasks remain open under `VA-20`–`VA-24`.
  - Mobile was not modified or visually assessed. The current QA result remains reopened.

### VA-19 — 2026-07-14

- Status: `COMPLETE`
- Progress: `20 / 25` tasks complete; `5` tasks remain.
- Changed Files:
  - `server/chipmate-word-render/apps/web/src/styles.css`
  - `server/chipmate-word-render/scripts/seed-preview.ts`
  - `server/chipmate-word-render/design-qa.md`
  - `server/chipmate-word-render/visual-alignment-plan.md`
  - `.runtime/design-qa/va19/*`
- Commands:
  - Used the user's installed macOS Google Chrome to capture light normal, Header hover, CTA hover, rank hover, keyboard focus, preview hover, effective dark, running, paused and native rank-03 handoff states.
  - Measured effective gradients, borders, shadows, backdrop filters, saturation, opacity, transforms and focus outlines from the live Chrome components, then assembled state matrices with `ffmpeg`.
  - `npm run test:e2e:web:chrome -- --grep "keyboard focus is visible and reduced motion is honored"`.
  - `npm run preview:seed` followed by preservation assertions for `.runtime/design-qa/va18` and `.runtime/design-qa/va19`.
  - `npm run check`.
  - `npm run build`.
- Results:
  - Header buttons, carousel arrows, rank buttons and pause control now share a layered desktop glass system: directional transmission gradients, `18px` backdrop blur, fine boundaries, upper and lower inset refraction, restrained elevation, hover lift and pressed depth. The distinct dark treatment reduces brightness and saturation while preserving the same hierarchy.
  - The CTA now has separate resting, hover and pressed blue-glass treatments. The verification label has its own compact transmitted-glass surface. The progress track now reads as an inset glass channel with a highlighted blue fill.
  - Keyboard focus remains a visible `3px` ring with a strengthened component boundary. The selected rank keeps the strongest blue elevation; a paused carousel uses a separate blue-tinted pressed surface, while running returns to the neutral pause control.
  - Disabled carousel controls use a muted low-saturation glass layer rather than only global opacity. Reduced motion disables autoplay and the pause control, reduces transition duration to at most `.001s`, removes the slide entrance animation and removes every desktop hover/pressed translation.
  - A targeted reduced-motion Chrome E2E passed. `npm run check` passed generated-contract validation, typecheck, lint and all 44 package tests; `npm run build` passed. The real Chrome console contains zero warnings and zero errors, and root horizontal overflow remains zero in both themes.
  - The first targeted E2E invocation exposed that `preview:seed` deleted the complete `.runtime` directory, including visual evidence. The seed script now removes only its owned `source`, `e2e-db`, `e2e-legacy`, `e2e-packages` and `e2e-results` directories. A direct preservation check confirms future E2E runs retain `.runtime/design-qa`.
- Chrome Evidence:
  - `.runtime/design-qa/va19/interaction-material-evidence.json`
  - `.runtime/design-qa/va19/01-light-normal-1484x1060.png`
  - `.runtime/design-qa/va19/02-light-header-theme-hover.png`
  - `.runtime/design-qa/va19/03-light-cta-hover.png`
  - `.runtime/design-qa/va19/04-light-rank-hover.png`
  - `.runtime/design-qa/va19/05-light-rank-focus.png`
  - `.runtime/design-qa/va19/06-light-preview-hover.png`
  - `.runtime/design-qa/va19/07-dark-normal-1484x1060.png`
  - `.runtime/design-qa/va19/08-dark-carousel-normal.png`
  - `.runtime/design-qa/va19/09-dark-rank-hover.png`
  - `.runtime/design-qa/va19/10-carousel-state-matrix.png`
  - `.runtime/design-qa/va19/11-header-state-matrix.png`
  - `.runtime/design-qa/va19/12-cta-normal-hover.png`
  - `.runtime/design-qa/va19/13-preview-state-matrix.png`
  - `.runtime/design-qa/va19/14-light-running-state.png`
  - `.runtime/design-qa/va19/15-running-vs-paused.png`
  - `.runtime/design-qa/va19/16-real-chrome-native-light-rank03-handoff.png`
  - Raw implementation screenshots came from the user's installed macOS Google Chrome. The tab is handed back at native `1131×560`, DPR 2, rank `#03`, light theme, paused autoplay and scroll Y `489`.
- Remaining Deviations:
  - `VA-20` is the next and only active task: add deterministic desktop geometry regression coverage across all ten live cards.
  - The pre-fix seed run removed historical runtime evidence files. The source/reference, current VA-18/VA-19 proof and recoverable cached VA-14/VA-15 captures were restored; VA-22 and VA-23 must generate a complete new authoritative desktop sign-off set before VA-24 can close the plan.
  - Full function regression and final desktop sign-off remain open under `VA-21`–`VA-24`. Mobile was not modified or visually assessed, and the current QA result remains reopened.

### VA-20 — 2026-07-14

- Status: `COMPLETE`
- Progress: `21 / 25` tasks complete; `4` tasks remain.
- Changed Files:
  - `server/chipmate-word-render/apps/web/e2e/market.spec.ts`
  - `server/chipmate-word-render/design-qa.md`
  - `server/chipmate-word-render/visual-alignment-plan.md`
  - `.runtime/design-qa/va20/*`
- Commands:
  - `npm run test:e2e:web:chrome -- --grep "desktop carousel geometry stays safe for all Top 10 cards"`.
  - `npm run check`.
  - `npm run build`.
  - Used the user's installed macOS Google Chrome to traverse ranks `01`–`10` at `1484×1060`, `1440×1024`, `1131×560` and `1050×1024`, recording component geometry, category-icon source and root overflow for every state.
- Results:
  - Added a real-data E2E that requests `GET /api/v1/skills?sort=downloads&limit=10`, asserts ten actual rows and traverses all ten direct-rank controls at four desktop viewports.
  - Every one of the `40` E2E card states verifies that the title, verification label, description, metadata, CTA and Skill mark stay inside the active card; title and verification label do not overlap; CTA remains measurable; all control-strip children and rank buttons stay inside their containers; and the document has no horizontal overflow.
  - Runtime icon assertions require rank `#01` to use the approved ChipMate asset and every other row to use its category prefix. Rank `#03` resolves to `/assets/skill-icons/dev-terminal.webp` in the real installed Chrome.
  - The installed Chrome repeated the same `40 / 40` geometry states successfully. Its font rasterization reports a `16.898px` metadata box as integer `clientHeight=17` and `scrollHeight=18`, so both E2E and live evidence use a strictly bounded `1px` tolerance instead of producing a false clipping failure; the visible content and its bounding box remain inside the card.
  - The targeted Chrome E2E passed. `npm run check` passed generated-contract validation, typecheck, lint and all 44 package tests; `npm run build` passed. The E2E seed preservation guard retained VA-18, VA-19 and VA-20 visual evidence.
- Chrome Evidence:
  - `.runtime/design-qa/va20/chrome-real-all-ranks-geometry.json`
  - `.runtime/design-qa/va20/1484x1060-rank03-real-chrome.png`
  - `.runtime/design-qa/va20/1440x1024-rank03-real-chrome.png`
  - `.runtime/design-qa/va20/1131x560-rank03-real-chrome.png`
  - `.runtime/design-qa/va20/1050x1024-rank03-real-chrome.png`
  - All screenshots and the geometry manifest were captured from the user's installed macOS Google Chrome; Playwright evidence is recorded separately as functional/geometry coverage, not visual sign-off.
- Remaining Deviations:
  - `VA-21` is the next and only active task: run the complete functional regression suite and record any failures without treating Playwright as visual proof.
  - The complete authoritative real-Chrome screenshot and component-comparison set remains open under `VA-22` and `VA-23`; final closure remains open under `VA-24`. Mobile remains outside scope and the current QA result stays reopened.

### VA-21 — 2026-07-14

- Status: `COMPLETE`
- Progress: `22 / 25` tasks complete; `3` tasks remain.
- Changed Files:
  - `server/chipmate-word-render/apps/web/e2e/market.spec.ts`
  - `server/chipmate-word-render/design-qa.md`
  - `server/chipmate-word-render/visual-alignment-plan.md`
  - `.runtime/design-qa/va21/*`
- Commands:
  - `npm run check`.
  - `npm run build`.
  - `npm run test:e2e:web:chrome`.
  - `npm run test:e2e:web:chrome -- --grep "home meets accessibility and performance gates" --repeat-each=3`.
  - Repeated `npm run check` and `npm run build` after correcting the ambiguous carousel-control locators.
  - Reloaded the live application in the user's installed macOS Google Chrome, restored native viewport/light/rank-03/paused state, checked console output and captured the functional-smoke handoff.
- Results:
  - The first full E2E run correctly exposed that the new card-side arrows made substring role lookups for `下一个技能` and `上一个技能` ambiguous. All affected direct-control and focus locators now use `exact: true`, explicitly targeting the bottom controls while retaining separate side-arrow coverage.
  - The same first run recorded one transient INP sample of `248ms` against the `200ms` gate. No threshold was weakened: three immediate isolated repetitions all passed, and the subsequent complete suite passed the unchanged performance gate.
  - The final full Chrome E2E result is `13 passed / 0 failed`. It covers accessibility, Web Vitals, download ordering, every direct control, the new 40-state geometry regression, autoplay pause causes, empty/single/pair/loading/error states, catalog/detail/status flow, theme persistence, reduced motion, frame budget, login, publish, unpublish and storage-degradation behavior.
  - Final `npm run check` passed generated-contract validation, all workspace typechecks, E2E typecheck, lint and all 44 package tests. Final `npm run build` passed all five workspace builds.
  - The real installed Chrome smoke state is native `1131×560`, DPR 2, scale 1, light theme, rank `#03`, paused autoplay, scroll Y `489`, no root horizontal overflow, development icon loaded, and zero console warnings/errors.
  - `.runtime/design-qa` survived every full and targeted E2E seed run. Edge remains `USER_WAIVED / NOT_RUN`, and Playwright remains functional/geometry evidence rather than visual sign-off.
- Chrome Evidence:
  - `.runtime/design-qa/va21/real-chrome-functional-smoke.json`
  - `.runtime/design-qa/va21/real-chrome-native-functional-smoke.png`
  - `.runtime/e2e-results/` contains the Playwright run artifacts; these are not counted as visual approval evidence.
- Remaining Deviations:
  - `VA-22` is the next and only active task: create a new authoritative installed-Chrome desktop screenshot set at every required viewport for ranks `#01` and `#03`.
  - Component-by-component same-input material comparison remains open under `VA-23`, and final review/closure remains open under `VA-24`. Mobile remains outside scope and the current QA result stays reopened.

### VA-22 — 2026-07-14

- Status: `COMPLETE`
- Progress: `23 / 25` tasks complete; `2` tasks remain.
- Changed Files:
  - `server/chipmate-word-render/apps/web/src/styles.css`
  - `server/chipmate-word-render/design-qa.md`
  - `server/chipmate-word-render/visual-alignment-plan.md`
  - `.runtime/design-qa/va22/*`
- Commands:
  - Used the user's installed macOS Google Chrome to capture light, paused rank `#01` and rank `#03` states at `1484×1060`, `1440×1024`, `1050×1024` and the native `1131×560` Mac viewport.
  - Captured an additional native rank-03 carousel-focus state at scroll Y `489`.
  - Inspected the primary `1484×1060` rank-01/rank-03 captures and the `1050×1024` rank-03 capture at original resolution.
  - `npm run check`.
  - `npm run build`.
  - `npm run test:e2e:web:chrome -- --grep "desktop carousel geometry stays safe|theme persists and narrow widths stay readable"`.
- Results:
  - Created eight authoritative installed-Chrome viewport screenshots plus one native carousel-focus screenshot. Every recorded state is light theme, paused autoplay, the requested rank, and free of root horizontal overflow; the installed-Chrome console contains zero warnings/errors.
  - The `1484×1060` source-size states retain the complete Header, Hero, search, trust line, carousel heading, active card, both preview layers and the entire control row. Rank `#03` remains one line and uses `/assets/skill-icons/dev-terminal.webp`.
  - The first `1050×1024` capture exposed an existing breakpoint mismatch: a notice claiming the width was below `1024px` appeared at exactly `1050px`. The responsive carousel rules remain at `1050px`, but a separate `min-width:1024px` rule now hides that notice wherever its own wording says the desktop requirement is satisfied. The corrected 1050px rank-01 and rank-03 screenshots replaced the rejected captures.
  - `npm run check` passed generated-contract validation, typecheck, lint and all 44 package tests; `npm run build` passed. The targeted geometry and narrow-width Chrome E2E tests both passed.
  - No mobile implementation or visual review was performed. Edge remains `USER_WAIVED / NOT_RUN`.
- Chrome Evidence:
  - `.runtime/design-qa/va22/real-chrome-desktop-state-manifest.json`
  - `.runtime/design-qa/va22/1484x1060-rank01-light-paused-top.png`
  - `.runtime/design-qa/va22/1484x1060-rank03-light-paused-top.png`
  - `.runtime/design-qa/va22/1440x1024-rank01-light-paused-top.png`
  - `.runtime/design-qa/va22/1440x1024-rank03-light-paused-top.png`
  - `.runtime/design-qa/va22/1050x1024-rank01-light-paused-top.png`
  - `.runtime/design-qa/va22/1050x1024-rank03-light-paused-top.png`
  - `.runtime/design-qa/va22/native-1131x560-rank01-light-paused-top.png`
  - `.runtime/design-qa/va22/native-1131x560-rank03-light-paused-top.png`
  - `.runtime/design-qa/va22/native-1131x560-rank03-light-paused-focus.png`
- Remaining Deviations:
  - `VA-23` is the next and only active task: crop every named component and compare it beside the source at the same input scale, including material rather than geometry alone.
  - Final P0/P1/P2 review, axe/console confirmation and plan closure remain open under `VA-24`; the current QA result stays reopened.

### VA-23 Audit Gate — 2026-07-14

- Status: `PAUSED_FOR_REOPENED_TASKS`
- Progress after reopen: `20 / 25` tasks complete; `5` tasks remain.
- Same-input evidence reviewed:
  - `.runtime/design-qa/va23/12-full-page-reference-left-current-right.png`
  - `.runtime/design-qa/va23/02-outer-shell-reference-left-current-right.png`
  - `.runtime/design-qa/va23/03-active-card-reference-left-current-right.png`
  - `.runtime/design-qa/va23/04-left-preview-reference-left-current-right.png`
  - `.runtime/design-qa/va23/05-right-preview-reference-left-current-right.png`
  - `.runtime/design-qa/va23/06-rank-badge-reference-left-current-right.png`
  - `.runtime/design-qa/va23/07-skill-icon-reference-left-current-right.png`
  - `.runtime/design-qa/va23/08-verified-label-reference-left-current-right.png`
  - `.runtime/design-qa/va23/09-cta-reference-left-current-right.png`
  - `.runtime/design-qa/va23/10-rank-rail-reference-left-current-right.png`
  - `.runtime/design-qa/va23/11-progress-reference-left-current-right.png`
- Reopened Findings:
  - `VA-15 / P2`: the active rank badge remains more saturated and flatter than the source glass shield, and the Skill-icon base still carries a redundant yellow verification seal absent from the selected design.
  - `VA-17 / P2`: the active CTA is `134px` wide while the source component is approximately `145px`; the material matches but the component proportion remains visibly short in isolation.
  - `VA-19 / P2`: the current verification state is a small frosted pill, while the selected design uses an inline blue seal/check plus text. The current extra container changes the component hierarchy even though it no longer overlaps the title.
- Accepted Differences:
  - Theme and login controls remain approved product differences; their Header material and spacing are otherwise aligned.
  - The play/pause control and semantic `1 / 10` native progress value remain required product behavior even though the static source omits the pause control and depicts a decorative fill.
  - Category-specific preview artwork intentionally differs from the source's repeated ChipMate/puzzle imagery; the preview glass hierarchy itself is aligned.
- Next:
  - Resume only after `VA-15`, `VA-17` and `VA-19` have each been separately fixed, captured and reclosed. `VA-15` is the only active task.

### VA-15 Reopened Closure — 2026-07-14

- Status: `COMPLETE / RECLOSED_AFTER_VA-23`
- Progress: `21 / 25` tasks complete; `4` tasks remain.
- Changed Files:
  - `server/chipmate-word-render/apps/web/src/main.tsx`
  - `server/chipmate-word-render/apps/web/src/styles.css`
  - `server/chipmate-word-render/design-qa.md`
  - `server/chipmate-word-render/visual-alignment-plan.md`
  - `.runtime/design-qa/va15-reopened/*`
- Commands:
  - Captured the revised rank-01 badge and Skill-icon base in the user's installed macOS Google Chrome at `1484×1060`.
  - Cropped the source and current badge/icon components at the same scale and reviewed the composites side by side.
  - `npm run check`.
  - `npm run build`.
  - `npm run test:e2e:web:chrome -- --grep "desktop carousel geometry stays safe for all Top 10 cards"`.
- Results:
  - The badge height is reduced from `98px` to `94px`, matching the source's tighter shield. Its gold rim is thicker and less saturated; the blue glass uses a lighter slate transmission gradient, inset highlights, lower-depth shading, restrained saturation and a tighter shadow instead of the former bright flat blue.
  - The redundant yellow CheckCircle was removed from the active Skill-icon base. Verification remains explicit in the title row, while the icon now matches the source's clean layered glass base.
  - Real Chrome reports an `84×94` badge, `114×114` Skill mark, no seal element and no root horizontal overflow. The new source/current badge and icon crops were reviewed together and no open VA-15 P2 remains.
  - `npm run check` passed generated-contract validation, typecheck, lint and all 44 package tests; `npm run build` passed. The 40-state desktop geometry test passed.
- Chrome Evidence:
  - `.runtime/design-qa/va15-reopened/rank-badge-and-icon-evidence.json`
  - `.runtime/design-qa/va15-reopened/01-real-chrome-1484x1060-rank01.png`
  - `.runtime/design-qa/va15-reopened/02-rank-badge-reference-left-current-right.png`
  - `.runtime/design-qa/va15-reopened/03-skill-icon-reference-left-current-right.png`
- Remaining Deviations:
  - `VA-17` is the next and only active reopened task: align the CTA width while retaining its existing material and all proven content geometry.
  - Reopened `VA-19`, paused `VA-23` and final `VA-24` remain open; the QA result stays reopened.

### VA-17 Reopened Closure — 2026-07-14

- Status: `COMPLETE / RECLOSED_AFTER_VA-23`
- Progress before the new artwork rule: `22 / 25` tasks complete; `3` tasks remain.
- Changed Files:
  - `server/chipmate-word-render/apps/web/src/styles.css`
  - `server/chipmate-word-render/design-qa.md`
  - `server/chipmate-word-render/visual-alignment-plan.md`
  - `.runtime/design-qa/va17-reopened/*`
- Commands:
  - Captured and measured the CTA at `1484×1060` rank `#01` and `1050×1024` rank `#03` in the user's installed macOS Google Chrome.
  - Cropped the source and current CTA at the same scale and reviewed them side by side.
  - `npm run check`.
  - `npm run build`.
  - `npm run test:e2e:web:chrome -- --grep "desktop carousel geometry stays safe for all Top 10 cards"`.
- Results:
  - The active-card CTA now has a desktop `min-width` of `145px`, matching the selected design's measured `x=257..402` span while preserving its `44px` height, radius, type, arrow and Liquid Glass material.
  - Real Chrome reports exactly `145×44` at both source size and 1050px. The CTA stays inside the card in both rank-01 and long-title rank-03 states, and neither viewport has root horizontal overflow.
  - The source/current CTA composite now matches component width and baseline. `npm run check`, `npm run build` and the 40-state desktop geometry test all pass, so no open VA-17 P2 remains.
- Chrome Evidence:
  - `.runtime/design-qa/va17-reopened/cta-evidence.json`
  - `.runtime/design-qa/va17-reopened/01-real-chrome-1484x1060-rank01.png`
  - `.runtime/design-qa/va17-reopened/02-cta-reference-left-current-right.png`
  - `.runtime/design-qa/va17-reopened/03-real-chrome-1050x1024-rank03.png`
- Remaining Deviations:
  - The user's new artwork rule reopens `VA-16` and `VA-11`: the active card's large artwork must use the current Skill's resolved artwork/category icon instead of the fixed ChipMate hero. After those tasks, reopened `VA-19`, paused `VA-23` and final `VA-24` remain.
  - With `VA-11` and `VA-16` reopened, current progress is `20 / 25`; `5` tasks remain. The QA result stays reopened.

### VA-16 Reopened Closure — 2026-07-14

- Status: `COMPLETE / RECLOSED_AFTER_USER_ARTWORK_RULE`
- Progress: `21 / 25` tasks complete; `4` tasks remain.
- Changed Files:
  - `server/chipmate-word-render/apps/web/src/main.tsx`
  - `server/chipmate-word-render/apps/web/e2e/market.spec.ts`
  - `server/chipmate-word-render/design-qa.md`
  - `server/chipmate-word-render/visual-alignment-plan.md`
  - `.runtime/design-qa/va16-reopened/*`
- Commands:
  - Used the user's installed macOS Google Chrome to traverse ranks `#01`–`#10`, recording the small Skill mark and large active-card artwork `src`, `currentSrc`, natural dimensions and load state.
  - Captured source-mapping states for ranks `#01`, `#02` and `#03` at `1484×1060`.
  - `npm run check`.
  - `npm run build`.
  - `npm run test:e2e:web:chrome -- --grep "desktop carousel geometry stays safe for all Top 10 cards"`.
- Results:
  - The active card's large visual now resolves through the same `image(active)` and `repair(...)` chain as its small Skill mark. Rank `#01` uses ChipMate in both places; ranks `#02`–`#10` use their own development/testing/operations category artwork in both places.
  - The real installed Chrome reports `10 / 10` loaded source pairs with exact small/large `src` equality. Rank `#02` uses `/assets/skill-icons/dev-architecture.webp` and rank `#03` uses `/assets/skill-icons/dev-terminal.webp` in both slots.
  - A damaged author-artwork seed exposed a lazy-load race: the small mark had already fallen back while an off-screen large visual retained the broken URL. The active large visual no longer uses `loading="lazy"`, so its failure and category fallback occur immediately at every desktop viewport.
  - The E2E geometry loop now asserts large/small artwork equality for all ten cards at four desktop sizes. After the eager fallback fix it passes all 40 states. `npm run check` and `npm run build` pass.
- Chrome Evidence:
  - `.runtime/design-qa/va16-reopened/skill-artwork-source-map.json`
  - `.runtime/design-qa/va16-reopened/01-real-chrome-1484x1060-rank01-mapping.png`
  - `.runtime/design-qa/va16-reopened/02-real-chrome-1484x1060-rank02-mapping.png`
  - `.runtime/design-qa/va16-reopened/03-real-chrome-1484x1060-rank03-mapping.png`
  - `.runtime/design-qa/va16-reopened/00-raw-source-mapping-rank02.png`
- Remaining Deviations:
  - `VA-11` is the next and only active task. The raw square artwork currently fills the existing spatial-hero crop, so large icon subjects are clipped and lack the intended icon-scale composition; VA-11 must tune size, object fit, mask, depth and copy safety without reverting the new per-Skill source.
  - Reopened `VA-19`, paused `VA-23` and final `VA-24` remain open; the QA result stays reopened.

### VA-11 Reopened Closure — 2026-07-14

- Status: `COMPLETE / RECLOSED_AFTER_USER_ARTWORK_RULE`
- Progress: `22 / 25` tasks complete; `3` tasks remain.
- Changed Files:
  - `server/chipmate-word-render/apps/web/src/styles.css`
  - `server/chipmate-word-render/apps/web/e2e/market.spec.ts`
  - `server/chipmate-word-render/design-qa.md`
  - `server/chipmate-word-render/visual-alignment-plan.md`
  - `.runtime/design-qa/va11-reopened/*`
- Commands:
  - Captured rank `#01`, `#02` and `#03` at `1484×1060`, rank `#02/#03` at `1050×1024`, and rank `#02/#03` at `1131×560` in the user's installed macOS Google Chrome.
  - Measured the active artwork, content block and root overflow at every captured state, including source equality and copy/art overlap.
  - Reviewed the rank-02/rank-03 source-size and native focused screenshots at original resolution.
  - `npm run check`.
  - `npm run build`.
  - `npm run test:e2e:web:chrome -- --grep "desktop carousel geometry stays safe for all Top 10 cards"`.
- Results:
  - Replaced the former spatial-hero crop with a responsive square Skill-art composition. At `1484px` the active artwork is a full `219×219` glass icon; at `1131px` it is `167.38×167.38`; at `1050px` it is `155.40×155.40`.
  - Every large icon uses `object-fit: cover`, the artwork's own rounded-square subject, a scale-dependent radius, low-saturation transmission, a fine white boundary and restrained depth shadow. It stays in grid column 3 in normal document flow; no absolute positioning was introduced.
  - The fixed spatial-hero background was also removed from the 761–1050px desktop card, preventing a category icon from appearing on top of a hidden repeated ChipMate visual.
  - Rank `#02` now displays the architecture icon both small and large; rank `#03` displays the terminal icon both small and large. Rank `#01` remains the approved ChipMate row. All captured states report equal sources, no copy/art overlap and no root horizontal overflow.
  - The E2E geometry loop now requires the large artwork to stay inside the card and not intersect the complete content block for all 40 desktop card states. It passes; `npm run check` and `npm run build` pass.
- Chrome Evidence:
  - `.runtime/design-qa/va11-reopened/skill-artwork-composition-evidence.json`
  - `.runtime/design-qa/va11-reopened/02-real-chrome-1484x1060-rank01.png`
  - `.runtime/design-qa/va11-reopened/03-real-chrome-1484x1060-rank02.png`
  - `.runtime/design-qa/va11-reopened/04-real-chrome-1484x1060-rank03.png`
  - `.runtime/design-qa/va11-reopened/05-real-chrome-1484x1060-rank02-focus.png`
  - `.runtime/design-qa/va11-reopened/06-real-chrome-1050x1024-rank02.png`
  - `.runtime/design-qa/va11-reopened/07-real-chrome-1050x1024-rank03.png`
  - `.runtime/design-qa/va11-reopened/08-real-chrome-1131x560-rank02.png`
  - `.runtime/design-qa/va11-reopened/09-real-chrome-1131x560-rank03.png`
- Remaining Deviations:
  - `VA-19` is the next and only active reopened task: replace the extra verification pill hierarchy identified by VA-23 while preserving focus, dark and reduced-motion materials.
  - Paused `VA-23` and final `VA-24` remain open; the QA result stays reopened.

### VA-19 Reopened Closure — 2026-07-14

- Status: `COMPLETE / RECLOSED_AFTER_VA-23`
- Progress: `23 / 25` tasks complete; `2` tasks remain.
- Changed Files:
  - `server/chipmate-word-render/apps/web/src/main.tsx`
  - `server/chipmate-word-render/apps/web/src/styles.css`
  - `server/chipmate-word-render/design-qa.md`
  - `server/chipmate-word-render/visual-alignment-plan.md`
  - `.runtime/design-qa/va19-reopened/*`
- Commands:
  - Used the user's installed macOS Google Chrome at `1484×1060`, DPR 1, 100% zoom, paused autoplay and light rank `#01` / rank `#03` states.
  - Captured the long-title rank `#03` in effective dark theme and inspected computed verification-label material.
  - Cropped the source and current verification labels at the same scale and reviewed them in one comparison input.
  - `npm run check`.
  - `npm run build`.
  - `npm run test:e2e:web:chrome -- --grep "desktop carousel geometry stays safe|keyboard focus is visible"`.
- Results:
  - The active-card verification state now uses a Phosphor filled seal plus blue inline text, matching the selected source hierarchy without an extra pill surface, border, blur or inset shadow. Generic directory-card verification pills remain unchanged.
  - Rank `#01` and long-title rank `#03` keep the label on one line. Real Chrome reports zero title/label overlap, zero title/artwork overlap and root `scrollWidth=innerWidth=1484`.
  - Light state uses `#2876d8`; dark uses `#8fc8ff` with no container background or shadow. The existing focus, disabled, paused and reduced-motion control system remains intact.
  - `npm run check` passed generated-contract validation, typecheck, lint and all 44 package tests; `npm run build` passed; both targeted Chrome E2E cases passed.
- Chrome Evidence:
  - `.runtime/design-qa/va19-reopened/interaction-evidence.json`
  - `.runtime/design-qa/va19-reopened/01-real-chrome-1484x1060-rank01.jpg`
  - `.runtime/design-qa/va19-reopened/02-real-chrome-1484x1060-rank03.jpg`
  - `.runtime/design-qa/va19-reopened/03-real-chrome-1484x1060-rank03-dark.jpg`
  - `.runtime/design-qa/va19-reopened/04-verified-label-reference-left-current-right.png`
- Remaining Deviations:
  - `VA-23` resumes as the only active task and must regenerate the complete same-input comparison set after the badge, CTA, artwork and verification fixes.
  - Final review and closure remain open under `VA-24`; the QA result stays reopened.

### VA-23 Final Component Audit — 2026-07-14

- Status: `COMPLETE_AFTER_REOPENED_TASKS`
- Progress: `24 / 25` tasks complete; `1` task remains.
- Changed Files:
  - `server/chipmate-word-render/design-qa.md`
  - `server/chipmate-word-render/visual-alignment-plan.md`
  - `.runtime/design-qa/va23-current/*`
- Commands:
  - Fixed the user's installed macOS Google Chrome to `1484×1060`, DPR 1, 100% zoom, light theme, rank `#01`, paused autoplay, page top and no temporary focus ring.
  - Measured Header, outer shell, active card, previews, badge, Skill icon, title, verification state, CTA, artwork, rank rail, controls and progress in the live DOM.
  - Rebuilt twelve source/current comparison inputs from the current browser capture and visually reviewed each one at original resolution.
  - Captured rank `#01`, `#02` and `#03` from the same real-Chrome state and reviewed the active cards and large per-Skill artwork in one contact sheet.
- Results:
  - Header, outer shell, active card, left/right previews, rank badge, Skill icon base, verification state, CTA, rank rail and progress all retain the accepted source geometry and Liquid Glass hierarchy after the reopened fixes.
  - The current comparison has no baseline focus ring, no stale ChipMate large visual on rank `#02`/`#03`, no clipped large icon, no hidden CTA and no page-level horizontal overflow.
  - Rank `#01` uses ChipMate, rank `#02` uses API architecture and rank `#03` uses the development terminal in both small and large slots. The large-art subject change from the source's fixed spatial platform to per-Skill artwork is the user's explicit product rule, not an open visual defect.
  - The retained theme/login Header controls are the previously approved product difference. No open P0, P1 or P2 remains in the component comparison gate.
- Chrome Evidence:
  - `.runtime/design-qa/va23-current/component-audit-evidence.json`
  - `.runtime/design-qa/va23-current/00-real-chrome-1484x1060-rank01-light-paused.jpg`
  - `.runtime/design-qa/va23-current/01-full-page-reference-left-current-right.png`
  - `.runtime/design-qa/va23-current/02-header-reference-left-current-right.png`
  - `.runtime/design-qa/va23-current/03-outer-shell-reference-left-current-right.png`
  - `.runtime/design-qa/va23-current/04-active-card-reference-left-current-right.png`
  - `.runtime/design-qa/va23-current/05-left-preview-reference-left-current-right.png`
  - `.runtime/design-qa/va23-current/06-right-preview-reference-left-current-right.png`
  - `.runtime/design-qa/va23-current/07-rank-badge-reference-left-current-right.png`
  - `.runtime/design-qa/va23-current/08-skill-icon-reference-left-current-right.png`
  - `.runtime/design-qa/va23-current/09-verified-reference-left-current-right.png`
  - `.runtime/design-qa/va23-current/10-cta-reference-left-current-right.png`
  - `.runtime/design-qa/va23-current/11-rank-rail-reference-left-current-right.png`
  - `.runtime/design-qa/va23-current/12-progress-reference-left-current-right.png`
  - `.runtime/design-qa/va23-current/15-rank01-02-03-active-card-artwork.png`
  - `.runtime/design-qa/va23-current/16-rank01-02-03-large-skill-artwork.png`
- Remaining Deviations:
  - Only `VA-24` remains: rerun the complete regression, capture the final requested desktop states in real Chrome, verify axe/current console/overflow and close the QA documents.
  - Mobile and Edge visual sign-off remain outside scope; Edge stays `USER_WAIVED / NOT_RUN`.

### VA-24 Final Closure — 2026-07-14

- Status: `COMPLETE`
- Progress: `25 / 25` tasks complete; `0` tasks remain.
- Changed Files:
  - `server/chipmate-word-render/apps/web/src/main.tsx`
  - `server/chipmate-word-render/apps/web/src/styles.css`
  - `server/chipmate-word-render/apps/web/e2e/market.spec.ts`
  - `server/chipmate-word-render/scripts/seed-preview.ts`
  - `server/chipmate-word-render/design-qa.md`
  - `server/chipmate-word-render/visual-alignment-plan.md`
  - `.runtime/design-qa/va24-final/*`
- Commands:
  - Captured installed-Chrome rank `#01` and `#03` at `1484×1060`, rank `#03` at `1440×1024`, `1050×1024` and native `1131×560`, plus effective-dark rank `#03`.
  - Checked current real-Chrome console, root overflow, long-title/verification geometry, artwork/content geometry, responsive notice state, autoplay state and native viewport/DPR/scale.
  - `npm run check`.
  - `npm run build`.
  - `npm run test:e2e:web:chrome`.
  - After one isolated INP sample of `296ms`, reran the unchanged gate three times with `--repeat-each=3`, then reran the complete suite without changing the `200ms` threshold.
- Results:
  - Installed Chrome is visually signed off at all requested desktop sizes. Every captured state has zero root overflow; rank `#03` has no title/verification or title/artwork overlap; native controls remain fully visible at scroll Y `489`.
  - The clean final Chrome tab reports zero warnings and zero errors. The final accessibility/performance test passes, including axe, LCP, INP and CLS gates.
  - `npm run check` passed generated-contract validation, typecheck, lint and all 44 package tests. `npm run build` passed all workspace builds. The final Chrome E2E run passed `13 / 13`.
  - All P0/P1/P2 findings are closed. `design-qa.md` may now end in `final result: passed`.
- Chrome Evidence:
  - `.runtime/design-qa/va24-final/final-signoff-evidence.json`
  - `.runtime/design-qa/va24-final/01-real-chrome-1484x1060-rank01-light.jpg`
  - `.runtime/design-qa/va24-final/02-real-chrome-1484x1060-rank03-light.jpg`
  - `.runtime/design-qa/va24-final/03-real-chrome-1484x1060-rank03-dark.jpg`
  - `.runtime/design-qa/va24-final/04-real-chrome-1440x1024-rank03-light.jpg`
  - `.runtime/design-qa/va24-final/05-real-chrome-1050x1024-rank03-light.jpg`
  - `.runtime/design-qa/va24-final/06-real-chrome-native-rank03-light.jpg`
  - `.runtime/design-qa/va24-final/07-real-chrome-native-rank03-carousel.jpg`
- Known Limitations:
  - Mobile visual work is intentionally excluded by user direction.
  - Edge brand visual execution remains `USER_WAIVED / NOT_RUN`.
  - The large active artwork intentionally follows the current Skill rather than reproducing the source's fixed ChipMate spatial platform.
  - No files were staged or committed; the parent worktree remains dirty and the existing untracked project subtree is preserved.

## 7. Decision Log

- `D-001` — `2026-07-13`: Use this file as the single ledger for the Chrome fullscreen visual repair cycle; preserve the broader Kilo/Market alignment plan separately.
- `D-002` — `2026-07-13`: Preserve historical QA evidence, but reopen the current sign-off because the new fullscreen screenshot exposes open P1/P2 deviations.
- `D-003` — `2026-07-13`: Treat physical screenshot pixels, CSS viewport pixels and DPR as separate measurements; do not resize the UI based only on the PNG dimensions.
- `D-004` — `2026-07-13`: Keep theme and login controls as intentional product differences while aligning their scale and spacing.
- `D-005` — `2026-07-13`: Relabel the previous pass as historical instead of deleting it; the newest fullscreen review owns the current final result.
- `D-006` — `2026-07-13`: Treat the user's fullscreen Chrome state as an `1131×616` CSS viewport at DPR 2; the 2262-pixel PNG width is physical Retina output.
- `D-007` — `2026-07-13`: Track root overflow and featured-section overflow separately; the root is clean while the fixed desktop control layout makes the featured section 189px wider than its viewport.
- `D-008` — `2026-07-13`: Treat `1131px` as a first-class desktop viewport rather than forcing the earlier 1484px three-column composition; preserve the 255px card height while adapting stage tracks and controls to the available CSS width.
- `D-009` — `2026-07-13`: Preserve the VA-02 `1131×616` screenshot as its recorded baseline, but label the VA-03 reconnect truthfully as `1131×560`; the ten-rank run was internally fixed at that size, and its horizontal failures are width-driven. VA-22 must recreate and sign off the exact requested screenshot states separately.
- `D-010` — `2026-07-13`: Keep the source-perfect 1484px track unchanged, but use a dedicated 1051–1399px desktop track that shrinks preview reservations. This preserves both adjacent previews in normal grid flow while giving the active card the largest available width.
- `D-011` — `2026-07-13`: Reuse the existing `.feature-art` DOM image as a dedicated third-column grid layer instead of a desktop background image. This makes the copy/art boundary measurable and maskable in normal flow, so the recognizable spatial subject cannot cross the copy safety zone without using absolute positioning or adding an asset.
- `D-012` — `2026-07-13`: Reserve the verification label as a compact `max-content` grid column and adapt the title size only within the 1051–1399px desktop range. This keeps known Top 10 titles and CTAs inside the fixed-height card while preserving a two-line clamp for future longer names.
- `D-013` — `2026-07-13`: Place the active-card CTA in a second normal-flow feature-content row spanning both content columns. A fixed 112px first row keeps one-line and two-line descriptions on one CTA baseline and restores the source's icon-aligned lower-left action without absolute positioning.
- `D-014` — `2026-07-13`: Make the desktop control group fluid across the complete 1051px-plus range instead of adding a one-off fullscreen override. Clamp button, rank, gap, padding and progress tracks together so all controls remain present while the later typography/material tasks retain their own scope.
- `D-015` — `2026-07-13`: Treat the previous preview as a clickable glass edge rather than squeezing hidden content into its narrow track. Keep identifying content only in the next preview and reproduce the source's upper-left rank/lower-right icon composition in normal grid flow.
- `D-016` — `2026-07-13`: Mount the two card-side arrow buttons as co-located items in the existing stage grid instead of adding fixed arrow tracks or absolute overlays. Responsive margins place them in the source gaps without changing the proven `1090×255` active-card geometry or removing the bottom navigation.
- `D-017` — `2026-07-13`: Size the existing 1448×1086 spatial asset from its actual subject bounds instead of replacing or redrawing it. A `440–520px` normal-flow image with a 50% vertical crop reproduces the source's 221px primary subject at 1484px; a separate 761–1050px background crop protects the narrower desktop copy zone without touching mobile styling.
- `D-018` — `2026-07-14`: Remove the opaque desktop `glass-field.webp` layer from the active card only, and render its surface with low-opacity gradients, backdrop blur, inset highlights and a fine boundary over the existing section light field. Keep the spatial artwork in its proven normal-flow slot; defer the outer shell and preview material to `VA-13` and `VA-14`.
- `D-019` — `2026-07-14`: Tune the desktop outer shell independently from the active and preview cards. Use a horizontal neutral transmission gradient, a minimal vertical depth layer, `32px` blur at `100%` backdrop saturation and restrained inset refraction so the source light field remains visible without adding a cyan floor; keep mobile and preview-card material outside this task.
- `D-020` — `2026-07-14`: Keep the supplied `glass-field.webp` inside the pending preview but stop using low whole-card opacity as the only hierarchy mechanism. Use a pale-blue transmission layer, `30px` blur, separate rank/icon opacity and explicit hover/active depth so the card remains subordinate without erasing identifying content; defer badge and icon-base dimensions to `VA-15`.
- `D-021` — `2026-07-14`: Follow measured source geometry instead of applying the VA-15 “shrink” wording uniformly. Tighten the badge to a curved `84×98` shield with a separate gold rim, but enlarge the undersized Skill artwork to `104×104` inside a `114×114` frosted base; reduce the content-column gap by the same amount so the title start does not move. Keep badge text, icon and verification seal in normal-flow CSS grids.
- `D-022` — `2026-07-14`: Treat the live API row plus the installed Chrome image `currentSrc`, natural dimensions and successful fallback as the authoritative VA-16 proof. Static source mapping alone cannot disprove stale service/cache behavior; conversely, when all ten live cards match the source and category prefixes, do not mutate preview or production data merely to manufacture a code diff.
- `D-023` — `2026-07-14`: Preserve already matched active-card geometry during typography work. Use the source/current card comparison to distinguish true type-rhythm errors from correct `1090×255`, `18px` padding and `30px` radius measurements; adapt the title only in the `1051–1399px` desktop range so the native Chrome long-title state remains one line without changing mobile styling.
- `D-024` — `2026-07-14`: Tighten only the desktop Header's internal scale and transfer its `10px` height reduction to the existing trust line. This keeps the five retained product controls readable and uncrowded while preserving the source-aligned `154px` pre-Hero baseline and every downstream carousel Y position.
- `D-025` — `2026-07-14`: Treat focus, paused and reduced-motion states as first-class glass materials instead of icon swaps or opacity alone. Keep all desktop interaction movement in CSS normal flow, and explicitly remove transforms and entrance animation under reduced motion.
- `D-026` — `2026-07-14`: Limit `preview:seed` cleanup to E2E-owned runtime directories. `.runtime/design-qa` is durable QA evidence and must survive all later Chrome test runs.
- `D-027` — `2026-07-14`: Give metadata overflow checks a maximum `1px` rasterization tolerance. The installed Chrome exposes a fractional `16.898px` line box as integer `clientHeight=17` and `scrollHeight=18`; component containment plus the bounded tolerance distinguishes this from real clipping without weakening horizontal or card-boundary assertions.
- `D-028` — `2026-07-14`: Address side-arrow naming collisions with exact accessible-name locators rather than renaming visible controls or weakening the interaction test. Keep the unchanged `200ms` INP gate after one transient `248ms` sample because three isolated repetitions plus the subsequent full run pass it; record the transient instead of hiding it.
- `D-029` — `2026-07-14`: Keep the established `1050px` responsive carousel composition but show the narrow-width notice only below its stated `1024px` requirement. This removes a false desktop warning without changing the 761–1050px card layout or doing mobile visual work.
- `D-030` — `2026-07-14`: Treat same-input component comparison as a gate, not documentation after the fact. Reopen VA-15, VA-17 and VA-19 for the badge/icon seal, CTA width and verification hierarchy P2 findings before VA-23 can resume.
- `D-031` — `2026-07-14`: Keep verification in the title row and remove the redundant CheckCircle from the active Skill artwork. Use the selected source's clean icon base and a lower-saturation `84×94` blue/gold glass shield as the VA-15 closure target.
- `D-032` — `2026-07-14`: Set the desktop active-card CTA to the source-measured `145×44` component while retaining its existing material and responsive safety checks.
- `D-033` — `2026-07-14`: Apply one resolved artwork source to both the small Skill mark and the large active-card visual. Only curated ChipMate-icon rows may show ChipMate in both places; category artwork must propagate to the large visual for every other Skill.
- `D-034` — `2026-07-14`: Do not lazy-load the active card's large artwork. The active item must resolve a damaged author image and category fallback in the same frame as its small mark, including when the card begins below the viewport.
- `D-035` — `2026-07-14`: Render the resolved Skill artwork as a complete responsive square icon rather than stretching its pixels across the old spatial-hero crop. Use `219px`, `167px` and `155px` desktop compositions at the validated viewports, keep it in grid column 3 and remove the hidden fixed ChipMate background at 761–1050px.
- `D-036` — `2026-07-14`: Keep verification inside the active title row but express it as the selected source's inline blue filled seal and text. Remove only the active-card pill surface; preserve the shared verification component for directory cards and preserve all previously proven control-state materials.
- `D-037` — `2026-07-14`: Rebuild VA-23 from a fresh, unfocused rank-01 real-Chrome baseline after every reopened fix. Treat the Header's theme/login controls and the user's per-Skill large-art rule as explicit product differences; require every remaining component to pass the same-input geometry and material gate with no open P0/P1/P2.
- `D-038` — `2026-07-14`: Keep the established `200ms` INP threshold after one final `296ms` outlier. Require three isolated passes and a subsequent complete `13 / 13` pass before closure; record the transient rather than weakening the performance gate or hiding the first result.

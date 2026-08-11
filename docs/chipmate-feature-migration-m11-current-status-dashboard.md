# ChipMate Feature Migration M11 Current Status Dashboard
Status: `NOT_READY`
Generated stamp: `20260709-173000`

## Scope

This dashboard is a read-only source-side summary. It does not execute QA, does not install VSIX files, does not run provider calls, and does not mark external evidence gates complete.

It also does not migrate ChipMate contract/repair/gating behavior such as `nextToolContract`, `missingDeliverable`, `validate_artifacts`, missing-diagram auto-render repair, or missing-document contract planning.

## Current completion snapshot

| Metric | Value |
|---|---:|
| Completed checklist items | `714` |
| Open checklist items | `22` |
| Total checklist items | `736` |
| Completion audit blockers | `46` |
| Completion audit review items | `165` |
| Completion allowed | `no` |
| Current-state consistency | `PASS` |
| Current-state failed checks | `missing` |
| M11 final signoff | `NOT_READY_FOR_FINAL_SIGNOFF` |
| M11 ready gates | `1 / 5` |
| M11 readiness intake | `NOT_READY_FOR_M11_REVIEW` |

## Evidence sources

| Evidence | Path | Current signal |
|---|---|---|
| Plan | `docs/chipmate-feature-migration-plan.md` | `714` complete / `22` open |
| Completion audit | `docs/chipmate-feature-migration-validation-runs/20260709-151000-completion-audit-after-dashboard-consistency/completion-audit.md` | blockers `46`, allowed `no` |
| Current-state consistency | `docs/chipmate-feature-migration-validation-runs/20260709-151500-current-state-consistency-after-dashboard-consistency/summary.md` | `PASS`, failed `missing` |
| M11 readiness intake | `docs/chipmate-feature-migration-validation-runs/20260709-161000-m11-readiness-after-latest-s3-rerun/summary.md` | `NOT_READY_FOR_M11_REVIEW` |
| M11 final signoff | `docs/chipmate-feature-migration-validation-runs/20260709-152000-m11-final-signoff-after-dashboard-consistency/current-signoff-summary.md` | `NOT_READY_FOR_FINAL_SIGNOFF`, gates `1/5` |
| Document RAG readiness rerun | `docs/chipmate-feature-migration-validation-runs/20260709-160500-document-rag-readiness-rerun-after-marker-guards/document-rag-readiness-summary.md` | `ERROR_NEEDS_REVIEW`, HTTP `503` |
| Current source/skill marker audit | `docs/chipmate-feature-migration-validation-runs/20260709-154500-contract-marker-current-source-audit-english-variants/summary.md` | `PASS` |
| Package runtime-surface marker audit | `docs/chipmate-feature-migration-validation-runs/20260709-155000-package-marker-audit-english-variants/summary.md` | `PASS` |
| Target execution boundary check | `docs/chipmate-feature-migration-validation-runs/20260709-163000-target-execution-boundary-check/summary.md` | `PASS_BOUNDARY_RECORDED`, linux direct `no`, windows direct `no` |
| Package refresh boundary check | `docs/chipmate-feature-migration-validation-runs/20260709-164000-package-refresh-boundary-check/summary.md` | `REFRESH_REQUIRED_FOR_FINAL_DELIVERY`, latest source evidence present `no` |
| Package refresh decision intake | `docs/chipmate-feature-migration-validation-runs/20260709-164500-package-refresh-decision-intake/summary.md` | `NEEDS_PACKAGE_REFRESH_DECISION`, decision `MISSING`, accepted by `MISSING`, accepted date `MISSING` |
| Package refresh owner action packet | `docs/chipmate-feature-migration-package-refresh-owner-action-packet.md` | `present` |

## Open checklist groups

### M11 review/signoff

- `7` 每个里程碑完成后必须执行本阶段 `Review` checklist。
- `8` 最终交付前必须执行 `M11: 最终迁移 Review`。
- `9` Review 重点是确认迁移能力没有破坏 ChipMate 原有 QA、代码理解、Document RAG、autocomplete、terminal、tool registry、VS Code extension 激活和打包能力。
- `26` 每个里程碑完成后必须 review 是否影响 ChipMate 原有能力。
- `40` M10: 做真实项目验收、QA 回归 review、VSIX 打包。
- `41` M11: 做最终迁移 review，确认没有明显破坏 ChipMate 原有能力的问题。
- `59` 每个阶段完成后都必须 review 是否影响 ChipMate 原有 QA、terminal、tool registry、VS Code extension 激活、settings、packaging。
- `633` Installed chat/runtime S1-S16, internal embedded C full source-backed skill run, and M11 no-regression review remain pending.
- `650` Review 真实项目结果，确认至少一个内网嵌入式 C 项目完整跑通。
- `654` 最终结论必须明确写出已迁移能力、未迁移能力、验证过的 ChipMate 原有能力、已知风险。
- `717` 每个里程碑完成后必须执行对应 review checklist。
- `718` 最终交付前必须执行 M11 最终迁移 review。

### Installed VSIX runtime

- `435` 安装 VSIX 做真实 chat/runtime S1-S16 smoke；这仍依赖可用 chat/autocomplete provider、目标工作区和人工/目标机执行，不能由 extension-host/command smoke 替代。
- `518` Installed VS Code smoke S1-S16 not run in this session.
- `519` Internal embedded C detailed-design end-to-end project validation not run in this session; QEMU UFS smoke above validates migrated artifact helpers on real source evidence, not the installed chat/skill pipeline.
- `691` 打包验收: 安装 VSIX 后普通 ChipMate QA、Word、Mermaid、artifact、Agent Terminal smoke 均通过。

### Internal embedded C validation

- `431` 在内网嵌入式 C 项目上测试详细设计文档生成。
- `688` 详细设计: “为该嵌入式 C 模块生成源码驱动详细设计文档”，预期 ChipMate 搜证据，生成 Markdown、图、Word。

### Company Word template

- `520` Real company `.docx` template validation not run in this session.

### Offline Windows/Linux target

- `631` Target offline Windows x86-64 execution remains pending.
- `632` Target offline Linux x86-64 execution remains pending.

### Final packaging/acceptance

- None

### Other open checklist items

- `682` Word 模板: “用这个公司模板样式生成文档”，预期继承样式，不承诺任意占位符填充。

## No-regression boundary for ChipMate native capabilities

| Capability | Dashboard effect | Current M11 interpretation |
|---|---|---|
| Native ChipMate QA | No runtime or prompt-path change | Still requires installed S1-S16 runtime evidence |
| Code understanding | No runtime or tool-routing change | Final no-regression review remains open |
| Document RAG | No provider or retrieval-path change | Readiness rerun is still not enough for final pass if provider is unavailable |
| Autocomplete | No qwen autocomplete source change | S16 needs explicit product/user decision and read-only smoke evidence |
| Terminal / Agent Terminal | No terminal implementation change | Visible installed UX evidence remains pending |
| Tool registry | No tool registration change | Final review still must confirm no registry breakage |
| VS Code activation/package | No activation/package change | Installed VSIX smoke remains pending |

## Current contract-marker boundary refresh

| Boundary check | Status | Interpretation |
|---|---|---|
| Current source/skill marker audit | `PASS` | Product source, VS Code source/webview, package manifest, and local skill surfaces should remain free of old ChipMate contract/repair/gating markers. |
| Package runtime-surface marker audit | `PASS` | VSIX runtime surfaces, offline delivery metadata, and target-kit boundary should remain free of old ChipMate contract/repair/gating markers. |

## Target execution boundary

| Boundary check | Status | Current interpretation |
|---|---|---|
| Current source workstation target boundary | `PASS_BOUNDARY_RECORDED` | This host can satisfy Linux x86-64 target directly: `no`; Windows x86-64 target directly: `no`. |
| Package-only runner | `not sufficient` | Package/integrity evidence does not replace offline target execution evidence, installed VSIX S1-S16 runtime smoke, or final M11 review. |

## Package refresh boundary

| Boundary check | Status | Current interpretation |
|---|---|---|
| Offline package refresh boundary | `REFRESH_REQUIRED_FOR_FINAL_DELIVERY` | Latest source-side M11/readiness/target-boundary evidence present in checked packages: `no`. |
| Final offline delivery | `requires decision` | Regenerate offline packages before claiming they include the current M11 evidence chain, or explicitly state these source-side evidence updates remain outside the packaged target kit. |
| Package refresh decision intake | `NEEDS_PACKAGE_REFRESH_DECISION` | Current decision: `MISSING`; accepted by: `MISSING`; accepted date: `MISSING`. Accepted decisions are `REGENERATE_OFFLINE_PACKAGES` or `EXCLUDE_SOURCE_SIDE_EVIDENCE_FROM_TARGET_KIT` with an accepted owner and date. |
| Owner action packet | `present` | `docs/chipmate-feature-migration-package-refresh-owner-action-packet.md` gives the final-delivery owner the copyable decision/intake/signoff command path. |

## Next evidence needed before M11 can pass

- Return installed VSIX S1-S16 runtime smoke evidence from the target VS Code environment.
- Return at least one internal embedded-C source-backed detail-design end-to-end run.
- Return a real company `.docx` template validation result.
- Return Windows x86-64 and Linux x86-64 offline target execution evidence.
- Return visible Agent Terminal UX evidence from an installed VSIX run.
- Resolve or rerun Document RAG readiness after the provider/upstream is available.
- Record the S16 autocomplete decision and run the accepted read-only smoke path.
- Then run M11 final review and explicitly decide PASS or PASS_WITH_KNOWN_LIMITS.

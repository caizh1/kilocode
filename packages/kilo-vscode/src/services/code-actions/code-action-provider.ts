import * as vscode from "vscode"

export class KiloCodeActionProvider implements vscode.CodeActionProvider {
  static readonly metadata: vscode.CodeActionProviderMetadata = {
    providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.RefactorRewrite],
  }

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    if (range.isEmpty) return []

    const actions: vscode.CodeAction[] = []

    const add = new vscode.CodeAction("Add to ChipMate", vscode.CodeActionKind.RefactorRewrite)
    add.command = { command: "chipmate.v2.addToContext", title: "Add to ChipMate" }
    actions.push(add)

    const hasDiagnostics = context.diagnostics.length > 0

    if (hasDiagnostics) {
      const fix = new vscode.CodeAction("Fix with ChipMate", vscode.CodeActionKind.QuickFix)
      fix.command = { command: "chipmate.v2.fixCode", title: "Fix with ChipMate" }
      fix.isPreferred = true
      actions.push(fix)
    }

    if (!hasDiagnostics) {
      const explain = new vscode.CodeAction("Explain with ChipMate", vscode.CodeActionKind.RefactorRewrite)
      explain.command = { command: "chipmate.v2.explainCode", title: "Explain with ChipMate" }
      actions.push(explain)

      const improve = new vscode.CodeAction("Improve with ChipMate", vscode.CodeActionKind.RefactorRewrite)
      improve.command = { command: "chipmate.v2.improveCode", title: "Improve with ChipMate" }
      actions.push(improve)
    }

    return actions
  }
}

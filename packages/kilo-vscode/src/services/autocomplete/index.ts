import * as vscode from "vscode"

export const registerAutocompleteProvider = (context: vscode.ExtensionContext) => {
  // Phase 1A: keep legacy command IDs registered for compatibility, but do not
  // construct AutocompleteServiceManager or register the old inline providers.
  context.subscriptions.push(
    vscode.commands.registerCommand("kilo-code.new.autocomplete.reload", () => {
      void vscode.commands.executeCommand("editor.action.inlineSuggest.trigger")
    }),
    vscode.commands.registerCommand("kilo-code.new.autocomplete.codeActionQuickFix", () => {
      return
    }),
    vscode.commands.registerCommand("kilo-code.new.autocomplete.cancelSuggestions", () => {
      void vscode.commands.executeCommand("editor.action.inlineSuggest.hide")
      void vscode.commands.executeCommand("setContext", "kilo-code.new.autocomplete.hasSuggestions", false)
    }),
    vscode.commands.registerCommand("kilo-code.new.autocomplete.generateSuggestions", () => {
      void vscode.commands.executeCommand("editor.action.inlineSuggest.trigger")
    }),
    vscode.commands.registerCommand("kilo-code.new.autocomplete.showIncompatibilityExtensionPopup", () => {
      return
    }),
    vscode.commands.registerCommand("kilo-code.new.autocomplete.disable", () => {
      return
    }),
    vscode.commands.registerCommand("kilo-code.new.autocomplete.nextEdit.acceptOrJump", () => {
      return
    }),
    vscode.commands.registerCommand("kilo-code.new.autocomplete.nextEdit.dismiss", () => {
      return
    }),
  )
}

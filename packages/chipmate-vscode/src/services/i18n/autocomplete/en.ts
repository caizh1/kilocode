// English runtime translations for autocomplete (chipmate:autocomplete.* namespace)
// Source: src/i18n/locales/en/chipmate.json → "autocomplete" section

export const dict = {
  "chipmate:autocomplete.statusBar.enabled": "$(chipmate-v2-logo) Autocomplete",
  "chipmate:autocomplete.statusBar.snoozed": "snoozed",
  "chipmate:autocomplete.statusBar.warning": "$(warning) Autocomplete",
  "chipmate:autocomplete.statusBar.tooltip.basic": "ChipMate Autocomplete",
  "chipmate:autocomplete.statusBar.tooltip.disabled": "ChipMate Autocomplete (disabled)",
  "chipmate:autocomplete.statusBar.tooltip.noUsableProvider":
    "**No autocomplete model configured**\n\nTo enable autocomplete, add a profile with one of these supported providers: {{providers}}.\n\n[Open Settings]({{command}})",
  "chipmate:autocomplete.statusBar.tooltip.sessionTotal": "Session total cost:",
  "chipmate:autocomplete.statusBar.tooltip.provider": "Provider:",
  "chipmate:autocomplete.statusBar.tooltip.model": "Model:",
  "chipmate:autocomplete.statusBar.tooltip.profile": "Profile: ",
  "chipmate:autocomplete.statusBar.tooltip.defaultProfile": "Default",
  "chipmate:autocomplete.statusBar.tooltip.completionSummary":
    "Performed {{count}} completions between {{startTime}} and {{endTime}}, for a total cost of {{cost}}.",
  "chipmate:autocomplete.statusBar.tooltip.providerInfo": "Autocompletions provided by {{model}} via {{provider}}.",
  "chipmate:autocomplete.statusBar.cost.zero": "$0.00",
  "chipmate:autocomplete.statusBar.cost.lessThanCent": "<$0.01",
  "chipmate:autocomplete.toggleMessage": "ChipMate Autocomplete {{status}}",
  "chipmate:autocomplete.progress.title": "ChipMate",
  "chipmate:autocomplete.progress.analyzing": "Analyzing your code...",
  "chipmate:autocomplete.progress.generating": "Generating suggested edits...",
  "chipmate:autocomplete.progress.processing": "Processing suggested edits...",
  "chipmate:autocomplete.progress.showing": "Displaying suggested edits...",
  "chipmate:autocomplete.input.title": "ChipMate: Quick Task",
  "chipmate:autocomplete.input.placeholder": "e.g., 'refactor this function to be more efficient'",
  "chipmate:autocomplete.commands.generateSuggestions": "ChipMate: Generate Suggested Edits",
  "chipmate:autocomplete.commands.displaySuggestions": "Display Suggested Edits",
  "chipmate:autocomplete.commands.cancelSuggestions": "Cancel Suggested Edits",
  "chipmate:autocomplete.commands.applyCurrentSuggestion": "Apply Current Suggested Edit",
  "chipmate:autocomplete.commands.applyAllSuggestions": "Apply All Suggested Edits",
  "chipmate:autocomplete.commands.category": "ChipMate",
  "chipmate:autocomplete.codeAction.title": "ChipMate: Suggested Edits",
  "chipmate:autocomplete.chatParticipant.fullName": "ChipMate Agent",
  "chipmate:autocomplete.chatParticipant.name": "Agent",
  "chipmate:autocomplete.chatParticipant.description": "I can help you with quick tasks and suggested edits.",
  "chipmate:autocomplete.incompatibilityExtensionPopup.message":
    "The ChipMate Autocomplete is being blocked by a conflict with GitHub Copilot. To fix this, you must disable Copilot's inline suggestions.",
  "chipmate:autocomplete.incompatibilityExtensionPopup.disableCopilot": "Disable Copilot",
  "chipmate:autocomplete.incompatibilityExtensionPopup.disableInlineAssist": "Disable Autocomplete",
  "chipmate:autocomplete.creditsExhausted.message":
    "ChipMate Autocomplete has been paused. Possible causes: your account has no remaining credits, or your configured API key (BYOK) has reached its quota limit. Add credits or check your API key configuration to resume autocomplete.",
  "chipmate:autocomplete.creditsExhausted.addCredits": "Add Credits",
  "chipmate:autocomplete.authError.message":
    "ChipMate Autocomplete has been paused due to an authentication issue. Possible causes: you are not signed in, or your API key (BYOK) is invalid or missing. Please sign in again or check your provider API key settings.",
}

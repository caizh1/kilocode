import { NavSection } from "../types"

export const ChipMateClawNav: NavSection[] = [
  {
    title: "ChipMateClaw",
    links: [
      { href: "/chipmateclaw/overview", children: "Overview" },
      { href: "/chipmateclaw/dashboard", children: "Dashboard" },
      { href: "/chipmateclaw/pre-installed-software", children: "Pre-installed Software" },
      { href: "/chipmateclaw/end-to-end", children: "End to End Config" },
      {
        href: "/chipmateclaw/control-ui/overview",
        children: "Control UI",
        subLinks: [
          { href: "/chipmateclaw/control-ui/changing-models", children: "Changing Models" },
          { href: "/chipmateclaw/control-ui/exec-approvals", children: "Exec Approvals" },
          { href: "/chipmateclaw/control-ui/version-pinning", children: "Version Pinning" },
        ],
      },
      {
        href: "/chipmateclaw/chat-platforms",
        children: "Chat Platforms",
        subLinks: [
          { href: "/chipmateclaw/chat-platforms/telegram", children: "Telegram" },
          { href: "/chipmateclaw/chat-platforms/discord", children: "Discord" },
          { href: "/chipmateclaw/chat-platforms/slack", children: "Slack" },
        ],
      },
      {
        href: "/chipmateclaw/development-tools",
        children: "Integrations",
        subLinks: [
          { href: "/chipmateclaw/development-tools/github", children: "GitHub" },
          { href: "/chipmateclaw/development-tools/google", children: "Google Workspace" },
          { href: "/chipmateclaw/development-tools/linear", children: "Linear" },
          { href: "/chipmateclaw/development-tools/composio", children: "Composio" },
          { href: "/chipmateclaw/tools/1password", children: "1Password" },
          { href: "/chipmateclaw/tools/brave-search", children: "Brave Search" },
          { href: "/chipmateclaw/tools/agentcard", children: "AgentCard" },
          { href: "/chipmateclaw/tools/other-tools", children: "Other Tools" },
        ],
      },
      {
        href: "/chipmateclaw/triggers",
        children: "Triggers",
        subLinks: [
          { href: "/chipmateclaw/triggers/webhooks", children: "Webhooks" },
          { href: "/chipmateclaw/triggers/scheduled", children: "Scheduled" },
        ],
      },
      {
        href: "/chipmateclaw/troubleshooting/common-questions",
        children: "Troubleshooting",
        subLinks: [
          { href: "/chipmateclaw/troubleshooting/common-questions", children: "Common Questions" },
          { href: "/chipmateclaw/troubleshooting/gateway-process", children: "Gateway Process States" },
          { href: "/chipmateclaw/troubleshooting/architecture", children: "Architecture Notes" },
        ],
      },
      {
        href: "/chipmateclaw/faq/general",
        children: "FAQ",
        subLinks: [
          { href: "/chipmateclaw/faq/general", children: "General" },
          { href: "/chipmateclaw/faq/pricing", children: "Pricing" },
        ],
      },
    ],
  },
]

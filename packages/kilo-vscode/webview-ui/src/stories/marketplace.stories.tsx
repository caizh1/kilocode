/** @jsxImportSource solid-js */
/**
 * Stories for Marketplace components.
 *
 * Renders MarketplaceListView and ItemCard directly with mock data
 * so no API requests are made.
 */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { createSignal, onMount } from "solid-js"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { StoryProviders } from "./StoryProviders"
import { MarketplaceListView } from "../components/marketplace/MarketplaceListView"
import { ItemCard } from "../components/marketplace/ItemCard"
import { AlignedSkillMarket } from "../components/marketplace/AlignedSkillMarket"
import { LocalSkillImportDialog } from "../components/marketplace/LocalSkillImportDialog"
import { InstallModal } from "../components/marketplace/InstallModal"
import { MarketplaceDiagnostics } from "../components/marketplace/MarketplaceDiagnostics"
import { MarketplaceRuntimeCard } from "../components/marketplace/MarketplaceRuntimeCard"
import { MarketplaceSessionProvider } from "../context/marketplace-session"
import type {
  SkillMarketplaceItem,
  McpMarketplaceItem,
  AgentMarketplaceItem,
  MarketplaceInstalledMetadata,
} from "../types/marketplace"
import "../components/marketplace/marketplace.css"

const meta: Meta = {
  title: "Marketplace",
  parameters: { layout: "fullscreen" },
}
export default meta
type Story = StoryObj

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_SKILLS: SkillMarketplaceItem[] = [
  {
    type: "skill",
    id: "nextjs-developer",
    name: "Next.js Developer",
    displayName: "Next.js Developer",
    description:
      "Expert at building Next.js applications with App Router, server components, and modern React patterns.",
    category: "web-development",
    displayCategory: "Web Development",
    githubUrl: "https://github.com/example/nextjs-developer",
    content: "https://example.com/nextjs-developer.tar.gz",
  },
  {
    type: "skill",
    id: "python-data-science",
    name: "Python Data Science",
    displayName: "Python Data Science",
    description:
      "Analyzes data using pandas, numpy, and matplotlib. Creates visualizations and builds machine learning models.",
    category: "data-science",
    displayCategory: "Data Science",
    githubUrl: "https://github.com/example/python-data-science",
    content: "https://example.com/python-data-science.tar.gz",
    author: "DataTeam",
  },
  {
    type: "skill",
    id: "rust-systems",
    name: "Rust Systems",
    displayName: "Rust Systems",
    description: "Systems programming with Rust. Memory safety, concurrency, and performance optimization.",
    category: "systems",
    displayCategory: "Systems",
    githubUrl: "https://github.com/example/rust-systems",
    content: "https://example.com/rust-systems.tar.gz",
  },
  {
    type: "skill",
    id: "react-native-mobile",
    name: "React Native Mobile",
    displayName: "React Native Mobile",
    description: "Build cross-platform mobile apps with React Native, Expo, and native modules.",
    category: "mobile",
    displayCategory: "Mobile",
    githubUrl: "https://github.com/example/react-native-mobile",
    content: "https://example.com/react-native-mobile.tar.gz",
    author: "MobileDev",
  },
  {
    type: "skill",
    id: "devops-kubernetes",
    name: "DevOps Kubernetes",
    displayName: "DevOps Kubernetes",
    description: "Container orchestration with Kubernetes. Helm charts, deployments, and cluster management.",
    category: "devops",
    displayCategory: "DevOps",
    githubUrl: "https://github.com/example/devops-kubernetes",
    content: "https://example.com/devops-kubernetes.tar.gz",
  },
  {
    type: "skill",
    id: "api-design",
    name: "API Design",
    displayName: "API Design",
    description: "Design RESTful and GraphQL APIs with OpenAPI specs, authentication, and rate limiting.",
    category: "web-development",
    displayCategory: "Web Development",
    githubUrl: "https://github.com/example/api-design",
    content: "https://example.com/api-design.tar.gz",
    author: "APIGuild",
  },
]

const MOCK_MCPS: McpMarketplaceItem[] = [
  {
    type: "mcp",
    id: "github-mcp",
    name: "GitHub",
    description:
      "Interact with GitHub repositories, issues, and pull requests. Search code, manage branches, and automate workflows.",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
    content:
      '{ "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" } }',
    parameters: [{ name: "GitHub Token", key: "GITHUB_TOKEN", placeholder: "ghp_xxxxxxxxxxxx" }],
    suggest_for: { vscode_extension: ["github.vscode-pull-request-github"] },
    author: "Anthropic",
    category: "development",
  },
  {
    type: "mcp",
    id: "postgres-mcp",
    name: "PostgreSQL",
    description: "Query and manage PostgreSQL databases. Run SQL, inspect schemas, and manage connections.",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/postgres",
    content: [
      {
        name: "npx",
        content:
          '{ "command": "npx", "args": ["-y", "@modelcontextprotocol/server-postgres", "${CONNECTION_STRING}"] }',
        parameters: [
          { name: "Connection String", key: "CONNECTION_STRING", placeholder: "postgresql://user:pass@localhost/db" },
        ],
      },
      {
        name: "Docker",
        content:
          '{ "command": "docker", "args": ["run", "--rm", "-e", "CONNECTION_STRING=${CONNECTION_STRING}", "mcp/postgres"] }',
        parameters: [
          { name: "Connection String", key: "CONNECTION_STRING", placeholder: "postgresql://user:pass@localhost/db" },
        ],
        prerequisites: ["Docker must be installed and running"],
      },
    ],
    author: "Anthropic",
    category: "data",
  },
  {
    type: "mcp",
    id: "filesystem-mcp",
    name: "Filesystem",
    description: "Read, write, and manage files on the local filesystem with configurable access controls.",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
    content: '{ "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "${ALLOWED_DIR}"] }',
    parameters: [{ name: "Allowed Directory", key: "ALLOWED_DIR", placeholder: "/path/to/directory" }],
    category: "development",
  },
  {
    type: "mcp",
    id: "slack-mcp",
    name: "Slack",
    description: "Send and receive messages, manage channels, and search conversations in Slack workspaces.",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/slack",
    content:
      '{ "command": "npx", "args": ["-y", "@modelcontextprotocol/server-slack"], "env": { "SLACK_TOKEN": "${SLACK_TOKEN}" } }',
    parameters: [{ name: "Slack Bot Token", key: "SLACK_TOKEN", placeholder: "xoxb-xxxxxxxxxxxx" }],
    author: "Anthropic",
    category: "productivity",
  },
  {
    type: "mcp",
    id: "brave-search-mcp",
    name: "Brave Search",
    description: "Search the web using the Brave Search API for real-time information retrieval.",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search",
    content:
      '{ "command": "npx", "args": ["-y", "@modelcontextprotocol/server-brave-search"], "env": { "BRAVE_API_KEY": "${BRAVE_API_KEY}" } }',
    parameters: [{ name: "API Key", key: "BRAVE_API_KEY", placeholder: "BSA-xxxxxxxxxxxx" }],
    category: "search",
  },
  {
    type: "mcp",
    id: "puppeteer-mcp",
    name: "Puppeteer",
    description: "Automate browser interactions, take screenshots, and scrape web pages using headless Chrome.",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer",
    content: '{ "command": "npx", "args": ["-y", "@modelcontextprotocol/server-puppeteer"] }',
    prerequisites: ["Chrome or Chromium must be installed"],
    category: "web-automation",
  },
]

const MOCK_AGENTS: AgentMarketplaceItem[] = [
  {
    type: "agent",
    id: "architect",
    name: "Architect",
    description:
      "High-level system design and planning. Focuses on architecture decisions, component boundaries, and technical specifications without writing implementation code.",
    suggest_for: { filename: ["*.architecture.md"] },
    content: {
      mode: "primary",
      description: "Stress-test technical designs and produce implementation-ready plans",
      prompt: "You are a software architect...",
      options: { displayName: "Architect" },
      permission: { read: "allow", edit: "deny", bash: "deny", mcp: "deny", question: "allow" },
    },
    author: "Kilo",
    category: "development",
  },
  {
    type: "agent",
    id: "reviewer",
    name: "Code Reviewer",
    description:
      "Reviews code for bugs, security issues, and best practices. Provides actionable feedback with specific line references.",
    content: {
      mode: "primary",
      description: "Senior software engineer conducting thorough code reviews",
      prompt: "You are a code reviewer...",
      options: { displayName: "Code Reviewer" },
      permission: { read: "allow", edit: "deny", bash: "allow", mcp: "deny", question: "allow" },
    },
    author: "Kilo",
    category: "development",
  },
  {
    type: "agent",
    id: "docs-writer",
    name: "Documentation Writer",
    description: "Generates and maintains documentation including READMEs, API docs, and inline code comments.",
    content: {
      mode: "primary",
      description: "Focus on writing documentation and other text-based files",
      prompt: "You write documentation...",
      options: { displayName: "Documentation Writer" },
      permission: { read: "allow", edit: "allow", bash: "allow", mcp: "deny", question: "allow" },
    },
    category: "business",
  },
  {
    type: "agent",
    id: "tdd",
    name: "Test-Driven Developer",
    description:
      "Follows strict TDD methodology: write failing tests first, implement minimum code to pass, then refactor.",
    content: {
      mode: "primary",
      description: "Strict TDD practitioner",
      prompt: "You follow TDD...",
      options: { displayName: "Test-Driven Developer" },
      permission: { read: "allow", edit: "allow", bash: "allow", mcp: "allow", question: "allow" },
    },
    author: "Community",
    category: "development",
  },
  {
    type: "agent",
    id: "debug",
    name: "Debugger",
    description: "Systematically diagnoses and fixes bugs. Uses logs, stack traces, and bisection to isolate issues.",
    content: {
      mode: "primary",
      description: "Systematic bug diagnosis and fixing",
      prompt: "You are a debugger...",
      options: { displayName: "Debugger" },
      permission: { read: "allow", edit: "allow", bash: "allow", mcp: "deny", question: "allow" },
    },
    category: "development",
  },
]

const EMPTY_METADATA: MarketplaceInstalledMetadata = { project: {}, global: {} }
const RELEVANCE = {
  "agent:architect": { filename: ["*.architecture.md"] },
  "mcp:github-mcp": { vscodeExtension: ["github.vscode-pull-request-github"] },
}

const PARTIAL_INSTALLED_SKILLS: MarketplaceInstalledMetadata = {
  project: { "skill:nextjs-developer": { type: "skill" } },
  global: { "skill:python-data-science": { type: "skill" } },
}

const PARTIAL_INSTALLED_MCPS: MarketplaceInstalledMetadata = {
  project: { "mcp:github-mcp": { type: "mcp" } },
  global: { "mcp:postgres-mcp": { type: "mcp" } },
}

const PARTIAL_INSTALLED_AGENTS: MarketplaceInstalledMetadata = {
  project: { "agent:architect": { type: "agent" } },
  global: { "agent:reviewer": { type: "agent" } },
}

const PARTIAL_INSTALLED_MIXED: MarketplaceInstalledMetadata = {
  project: {
    "agent:architect": { type: "agent" },
    "mcp:github-mcp": { type: "mcp" },
  },
  global: { "skill:python-data-science": { type: "skill" } },
}

const noop = () => {}

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

export const MixedListWithItems: Story = {
  name: "Mixed list — categories and installed items",
  render: () => (
    <StoryProviders>
      <div style={{ "max-height": "700px", overflow: "auto", padding: "12px" }}>
        <MarketplaceListView
          items={[...MOCK_AGENTS, ...MOCK_MCPS, ...MOCK_SKILLS]}
          metadata={PARTIAL_INSTALLED_MIXED}
          relevance={RELEVANCE}
          fetching={false}
          searchPlaceholder="Search marketplace..."
          emptyMessage="No items found"
          relevantEmptyMessage="No relevant marketplace items found for this workspace."
          onInstall={noop}
          onRemove={noop}
        />
      </div>
    </StoryProviders>
  ),
}

export const RelevantItems: Story = {
  name: "Mixed list — relevant to workspace",
  render: () => (
    <StoryProviders>
      <div style={{ "max-height": "700px", overflow: "auto", padding: "12px" }}>
        <MarketplaceListView
          items={[...MOCK_AGENTS, ...MOCK_MCPS, ...MOCK_SKILLS]}
          metadata={PARTIAL_INSTALLED_MIXED}
          relevance={RELEVANCE}
          fetching={false}
          searchPlaceholder="Search marketplace..."
          emptyMessage="No items found"
          relevantEmptyMessage="No relevant marketplace items found for this workspace."
          initialRelevant
          onInstall={noop}
          onRemove={noop}
        />
      </div>
    </StoryProviders>
  ),
}

export const EmptyList: Story = {
  name: "Mixed list — empty state",
  render: () => (
    <StoryProviders>
      <div style={{ "max-height": "400px", overflow: "auto", padding: "12px" }}>
        <MarketplaceListView
          items={[]}
          metadata={EMPTY_METADATA}
          relevance={{}}
          fetching={false}
          searchPlaceholder="Search marketplace..."
          emptyMessage="No items found"
          relevantEmptyMessage="No relevant marketplace items found for this workspace."
          onInstall={noop}
          onRemove={noop}
        />
      </div>
    </StoryProviders>
  ),
}

export const SingleSkillCard: Story = {
  name: "ItemCard — single skill not installed",
  render: () => (
    <StoryProviders>
      <div style={{ width: "420px", padding: "12px" }}>
        <ItemCard
          item={MOCK_SKILLS[0]}
          metadata={EMPTY_METADATA}
          displayName={MOCK_SKILLS[0].displayName}
          linkUrl={MOCK_SKILLS[0].githubUrl}
          onInstall={noop}
          onRemove={noop}
        />
      </div>
    </StoryProviders>
  ),
}

export const InstalledSkillCard: Story = {
  name: "ItemCard — installed skill",
  render: () => (
    <StoryProviders>
      <div style={{ width: "420px", padding: "12px" }}>
        <ItemCard
          item={MOCK_SKILLS[0]}
          metadata={PARTIAL_INSTALLED_SKILLS}
          displayName={MOCK_SKILLS[0].displayName}
          linkUrl={MOCK_SKILLS[0].githubUrl}
          onInstall={noop}
          onRemove={noop}
        />
      </div>
    </StoryProviders>
  ),
}

// ---------------------------------------------------------------------------
// MCP Stories
// ---------------------------------------------------------------------------

export const SingleMcpCard: Story = {
  name: "ItemCard — single MCP not installed",
  render: () => (
    <StoryProviders>
      <div style={{ width: "420px", padding: "12px" }}>
        <ItemCard
          item={MOCK_MCPS[0]}
          metadata={EMPTY_METADATA}
          linkUrl={MOCK_MCPS[0].url}
          onInstall={noop}
          onRemove={noop}
        />
      </div>
    </StoryProviders>
  ),
}

export const InstalledMcpCard: Story = {
  name: "ItemCard — installed MCP",
  render: () => (
    <StoryProviders>
      <div style={{ width: "420px", padding: "12px" }}>
        <ItemCard
          item={MOCK_MCPS[0]}
          metadata={PARTIAL_INSTALLED_MCPS}
          linkUrl={MOCK_MCPS[0].url}
          onInstall={noop}
          onRemove={noop}
        />
      </div>
    </StoryProviders>
  ),
}

export const InstallMcpModal: Story = {
  name: "InstallModal — MCP explanation and destination",
  render: () => (
    <StoryProviders>
      <MarketplaceSessionProvider>
        <div style={{ "max-height": "700px", overflow: "auto", padding: "12px" }}>
          <InstallModal item={MOCK_MCPS[0]} onClose={noop} onInstallResult={noop} />
        </div>
      </MarketplaceSessionProvider>
    </StoryProviders>
  ),
}

// ---------------------------------------------------------------------------
// Mode Stories
// ---------------------------------------------------------------------------

export const RuntimeConnected: Story = {
  name: "Runtime status — connected and verified",
  render: () => (
    <StoryProviders locale="zh">
      <div style={{ width: "760px", padding: "12px" }}>
        <MarketplaceRuntimeCard
          server={{ status: "connected", checkedAt: "2026-07-20T08:00:00.000Z" }}
          identity={{
            status: "verified",
            checkedAt: "2026-07-20T08:00:01.000Z",
            user: { name: "Alice", tokenName: "workstation" },
          }}
          onVerify={noop}
        />
      </div>
    </StoryProviders>
  ),
}

export const RuntimeInvalidUrlNarrow: Story = {
  name: "Runtime status — invalid URL at 320px",
  render: () => (
    <StoryProviders locale="zh">
      <div style={{ width: "320px", padding: "8px" }}>
        <MarketplaceRuntimeCard
          server={{
            status: "degraded",
            checkedAt: "2026-07-20T08:05:00.000Z",
            issue: { summary: "目录可用，但服务状态检查失败。", code: "marketplace-degraded" },
          }}
          identity={{
            status: "failed",
            checkedAt: "2026-07-20T08:05:02.000Z",
            issue: {
              summary:
                "New API 地址格式无效，请检查 NEW_API_BASE_URL 是否包含 http:// 或 https://，并移除多余引号、空格。",
              status: 502,
              code: "new-api-error",
              reason: "invalid-url",
              requestId: "resolve-7d9a",
            },
          }}
          onVerify={noop}
          diagnostics={
            <MarketplaceDiagnostics
              protocol="aligned-v1"
              mode="skills-only"
              baseUrl="https://chipmate.example.com/marketplace"
            />
          }
        />
      </div>
    </StoryProviders>
  ),
}

export const SingleAgentCard: Story = {
  name: "ItemCard — single agent not installed",
  render: () => (
    <StoryProviders>
      <div style={{ width: "420px", padding: "12px" }}>
        <ItemCard item={MOCK_AGENTS[0]} metadata={EMPTY_METADATA} onInstall={noop} onRemove={noop} />
      </div>
    </StoryProviders>
  ),
}

export const InstalledAgentCard: Story = {
  name: "ItemCard — installed agent",
  render: () => (
    <StoryProviders>
      <div style={{ width: "420px", padding: "12px" }}>
        <ItemCard item={MOCK_AGENTS[0]} metadata={PARTIAL_INSTALLED_AGENTS} onInstall={noop} onRemove={noop} />
      </div>
    </StoryProviders>
  ),
}

export const BatchSkillSelection: Story = {
  name: "Skill Market — batch upload selection",
  render: () => {
    const items = MOCK_SKILLS.slice(0, 4).map((item) => ({ ...item, uploadable: true }))
    const [active, setActive] = createSignal(false)
    const [selected, setSelected] = createSignal<string[]>([])
    return (
      <StoryProviders locale="zh">
        <div style={{ width: "100%", height: "720px", overflow: "auto", padding: "12px" }}>
          <MarketplaceListView
            items={items}
            metadata={PARTIAL_INSTALLED_SKILLS}
            fetching={false}
            type="skill"
            searchPlaceholder="搜索…"
            emptyMessage="未找到项目"
            onInstall={noop}
            onRemove={noop}
            batchActive={active()}
            batchSelected={selected()}
            onBatchStart={() => setActive(true)}
            onBatchChange={setSelected}
            onBatchCancel={() => {
              setActive(false)
              setSelected([])
            }}
            onBatchSubmit={noop}
          />
        </div>
      </StoryProviders>
    )
  },
}

export const AlignedSkillsHome: Story = {
  name: "Aligned Skill Market — home",
  render: () => (
    <StoryProviders>
      <div style={{ width: "1100px", height: "760px", overflow: "auto", padding: "12px" }}>
        <AlignedSkillMarket
          items={MOCK_SKILLS.map((item, index) => ({
            ...item,
            revision: index + 1,
            sha256: String(index).repeat(64),
            favorite: index === 0,
          }))}
          metadata={PARTIAL_INSTALLED_SKILLS}
          fetching={false}
          user={{ name: "Alice" }}
          baseUrl="http://market.test/marketplace"
          capabilities={{
            mode: "aligned-v1",
            apiVersion: "1.0.0",
            catalogVersion: "v1",
            skillSpecVersion: "agent-skills-1",
            features: {
              versions: true,
              favorites: true,
              installations: true,
              publications: true,
              repairs: true,
              analytics: true,
              events: true,
            },
          }}
          installations={[
            {
              skillId: "nextjs-developer",
              revision: 1,
              sha256: "a".repeat(64),
              scope: "project",
              status: "installed",
              clientId: "client-1",
              changedAt: "2026-07-12T00:00:00.000Z",
            },
          ]}
          publications={[
            {
              id: "run-1",
              skillId: "nextjs-developer",
              ownerId: "user-1",
              status: "PUBLISHED",
              stage: "complete",
              patches: [],
              release: {
                skillId: "nextjs-developer",
                revision: 1,
                sha256: "a".repeat(64),
                archiveUrl: "/archive",
                publishedAt: "2026-07-12T00:00:00.000Z",
              },
              createdAt: "2026-07-12T00:00:00.000Z",
              updatedAt: "2026-07-12T00:00:00.000Z",
            },
          ]}
          status={{
            ok: true,
            transport: "trusted-http",
            render: "ready",
            market: "ready",
            packages: "ready",
            warnings: ["Trusted intranet HTTP"],
          }}
          analytics={[{ metric: "skill_open", scope: "global", points: [{ date: "2026-07-12", value: 12 }] }]}
          onOpen={noop}
          onCloseDetail={noop}
          onInstall={noop}
          onRemove={noop}
          onStar={noop}
          onUpload={noop}
          onUnpublish={noop}
        />
      </div>
    </StoryProviders>
  ),
}

export const AlignedSkillDetail: Story = {
  name: "Aligned Skill Market — detail",
  render: () => (
    <StoryProviders>
      <div style={{ width: "1100px", height: "760px", overflow: "auto", padding: "12px" }}>
        <AlignedSkillMarket
          items={[{ ...MOCK_SKILLS[0], revision: 2, sha256: "a".repeat(64), favorite: true }]}
          metadata={EMPTY_METADATA}
          fetching={false}
          user={{ name: "Alice" }}
          baseUrl="http://market.test/marketplace"
          capabilities={{
            mode: "aligned-v1",
            apiVersion: "1.0.0",
            catalogVersion: "v2",
            skillSpecVersion: "agent-skills-1",
            features: {
              versions: true,
              favorites: true,
              installations: true,
              publications: true,
              repairs: true,
              analytics: true,
              events: true,
            },
          }}
          installations={[]}
          publications={[]}
          status={{
            ok: true,
            transport: "trusted-http",
            render: "ready",
            market: "ready",
            packages: "ready",
            warnings: [],
          }}
          analytics={[]}
          detailId="nextjs-developer"
          detail={{
            id: "nextjs-developer",
            name: "Next.js Developer",
            description: MOCK_SKILLS[0].description,
            category: "web-development",
            tags: ["react", "server-components"],
            author: { id: "user-1", displayName: "DataTeam" },
            latestRevision: 2,
            semver: "1.1.0",
            sha256: "a".repeat(64),
            updatedAt: "2026-07-12T00:00:00.000Z",
            downloads: 12,
            favorites: 4,
            risk: { level: "medium", issueCount: 1, policyVersion: "skill-risk-v2" },
            markdown:
              "# Next.js Developer\n\nUse source-backed evidence and explain routing decisions.\n\n- Inspect the current App Router\n- Preserve server boundaries\n- Report limitations",
            releases: [
              {
                skillId: "nextjs-developer",
                revision: 2,
                semver: "1.1.0",
                sha256: "a".repeat(64),
                size: 2048,
                report: {
                  valid: true,
                  policyVersion: "skill-risk-v2",
                  risk: { level: "medium", issueCount: 1, policyVersion: "skill-risk-v2" },
                  issues: [
                    {
                      code: "scripts-present",
                      severity: "warning",
                      file: "scripts/check.sh",
                      message: "Skill 包含脚本文件，服务不会执行这些脚本。",
                      fixable: false,
                      repairKind: "none",
                      riskLevel: "medium",
                    },
                  ],
                },
                archiveUrl: "/r2",
                publishedAt: "2026-07-12T00:00:00.000Z",
              },
              {
                skillId: "nextjs-developer",
                revision: 1,
                semver: "1.0.0",
                sha256: "b".repeat(64),
                size: 1800,
                report: { valid: true, risk: { level: "unknown", issueCount: 0 }, issues: [] },
                archiveUrl: "/r1",
                publishedAt: "2026-07-11T00:00:00.000Z",
              },
            ],
            files: [
              {
                path: "SKILL.md",
                type: "text",
                mime: "text/markdown",
                size: 640,
                sha256: "c".repeat(64),
                previewable: true,
              },
              {
                path: "references/router.md",
                type: "text",
                mime: "text/markdown",
                size: 1200,
                sha256: "d".repeat(64),
                previewable: true,
              },
            ],
          }}
          onOpen={noop}
          onCloseDetail={noop}
          onInstall={noop}
          onRemove={noop}
          onStar={noop}
          onUpload={noop}
          onUnpublish={noop}
        />
      </div>
    </StoryProviders>
  ),
}

const LocalImportPreview = () => {
  const dialog = useDialog()

  onMount(() => {
    dialog.show(() => <LocalSkillImportDialog onClose={() => dialog.close()} />)
    queueMicrotask(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "localSkillImportPreview",
            preview: {
              token: "storybook-import-token",
              expiresAt: "2026-07-15T00:10:00.000Z",
              projectAvailable: true,
              candidates: [
                {
                  key: "0:.",
                  id: "codex-review",
                  name: "codex-review",
                  description: "Review a code change with portable, source-backed evidence.",
                  sourceKind: "zip",
                  sourceLabel: "portable-skills.zip",
                  hints: ["agent-skills", "codex"],
                  fileCount: 9,
                  totalBytes: 48312,
                  valid: true,
                  snapshotSha256: "a".repeat(64),
                  repairs: [
                    { field: "name", before: "Codex Review", after: "codex-review" },
                    {
                      field: "description",
                      after: "Review a code change with portable, source-backed evidence.",
                    },
                  ],
                  issues: [
                    {
                      code: "scripts-present",
                      severity: "warning",
                      file: "scripts/check.sh",
                      message: "包含脚本文件；市场服务不会执行这些脚本，使用前请自行审查。",
                      fixable: false,
                      repairKind: "none",
                    },
                  ],
                  conflicts: [
                    { scope: "project", state: "managed", installedSha256: "b".repeat(64) },
                    { scope: "global", state: "none" },
                  ],
                },
                {
                  key: "1:docs",
                  id: "document-brief",
                  name: "document-brief",
                  description: "Build a concise document brief with templates and examples.",
                  sourceKind: "zip",
                  sourceLabel: "portable-skills.zip",
                  hints: ["agent-skills", "claude"],
                  fileCount: 14,
                  totalBytes: 92804,
                  valid: true,
                  snapshotSha256: "c".repeat(64),
                  repairs: [],
                  issues: [],
                  conflicts: [
                    { scope: "project", state: "none" },
                    { scope: "global", state: "same", installedSha256: "c".repeat(64) },
                  ],
                },
              ],
            },
          },
        }),
      )
    })
  })
  return <div class="marketplace-view" style={{ width: "100%", height: "100%" }} />
}

export const LocalImportGlass: Story = {
  name: "Local Skill import — Liquid Glass review",
  render: () => (
    <StoryProviders locale="zh" noPadding>
      <div style={{ width: "100vw", height: "100vh" }}>
        <LocalImportPreview />
      </div>
    </StoryProviders>
  ),
}

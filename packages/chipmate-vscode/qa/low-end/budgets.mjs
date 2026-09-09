export const profile = {
  id: "2c-8gb-hdd-proxy",
  cpuRate: 6,
  network: {
    latencyMs: 300,
    downloadBytesPerSecond: 125_000,
    uploadBytesPerSecond: 125_000,
  },
  storageReadMs: 40,
  storageWriteMs: 80,
  saveDelayMs: 300,
}

export const budgets = {
  coldStartMs: 12_000,
  activationMs: 5_000,
  settingsOpenMs: 1_500,
  tabFirstMs: 800,
  tabRevisitMs: 300,
  inputP95Ms: 100,
  inputMaxMs: 200,
  saveMs: 1_500,
  historyReturnMs: 1_500,
  indexingMs: 800,
  settingsScrollP95Ms: 20,
  settingsScrollMaxMs: 50,
  settingsScrollOver32Percent: 1,
  stallMaxMs: 500,
  agentManagerOpenMs: 1_500,
  heapGrowthPercent: 20,
  heapGrowthBytes: 50 * 1024 * 1024,
}

export const fixtures = {
  providers: 20,
  models: 300,
  agents: 30,
  mcps: 40,
  skills: 100,
  sessions: 100,
  turns: 1_000,
  managerSessions: 4,
}

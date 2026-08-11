export function model(extra?: NodeJS.ProcessEnv | null): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries({ ...process.env, ...(extra ?? {}) }).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  )
  delete env.CHIPMATE_SERVER_PASSWORD
  delete env.CHIPMATE_SERVER_USERNAME
  delete env.CHIPMATE_CONFIG
  delete env.CHIPMATE_CONFIG_CONTENT
  delete env.CHIPMATE_CONFIG_DIR
  return env
}

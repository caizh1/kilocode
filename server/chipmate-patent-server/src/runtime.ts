import { loadConfig } from "./config.js"
import { PatentDatabase } from "./database.js"
import { PatentImporter } from "./importer.js"
import { OpenSearchStore } from "./opensearch.js"

export interface RuntimeOptions {
  initializeRawStore?: boolean
}

export async function runtime(options: RuntimeOptions = {}) {
  const config = loadConfig()
  const database = new PatentDatabase(config.databaseUrl, config.jurisdictions)
  const search = new OpenSearchStore(config, database)
  const importer = new PatentImporter(config, database, search)
  if (options.initializeRawStore === false) await database.migrate()
  else await importer.initialize()
  return { config, database, search, importer }
}

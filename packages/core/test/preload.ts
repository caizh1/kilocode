import path from "path"

process.env.CHIPMATE_DB = ":memory:"
process.env.CHIPMATE_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.CHIPMATE_DISABLE_MODELS_FETCH = "true"

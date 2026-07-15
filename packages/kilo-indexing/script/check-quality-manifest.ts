import { compareQualityManifests, parseQualityManifest } from "../src/indexing/kilocode/quality-gate"

const [baselinePath, candidatePath] = process.argv.slice(2)

if (!baselinePath || !candidatePath) {
  console.error("Usage: bun script/check-quality-manifest.ts <baseline.json> <candidate.json>")
  process.exit(2)
}

const baseline = parseQualityManifest(await Bun.file(baselinePath).json())
const candidate = parseQualityManifest(await Bun.file(candidatePath).json())
const report = compareQualityManifests(baseline, candidate)

if (report.ok) {
  console.log("RAG quality manifests are equivalent.")
  process.exit(0)
}

for (const mismatch of report.mismatches) console.error(mismatch)
process.exit(1)

import * as yauzl from "yauzl"

const MAX_MANIFEST = 2 * 1024 * 1024
const ENTRY = "extension/package.json"

export type VsixManifest = {
  publisher?: unknown
  name?: unknown
  version?: unknown
  chipmatePackageTarget?: unknown
}

export function readVsixManifest(file: string): Promise<VsixManifest> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: true }, (openErr, zip) => {
      if (openErr || !zip) {
        reject(openErr ?? new Error("Could not open VSIX archive."))
        return
      }

      let count = 0
      let raw: Buffer | undefined
      let settled = false
      const fail = (err: unknown) => {
        if (settled) return
        settled = true
        zip.close()
        reject(err instanceof Error ? err : new Error(String(err)))
      }
      zip.on("error", fail)
      zip.on("entry", (entry) => {
        if (entry.fileName.includes("\\")) {
          fail(new Error("VSIX contains a backslash entry path."))
          return
        }
        if (entry.fileName !== ENTRY) {
          zip.readEntry()
          return
        }
        count++
        if (count !== 1) {
          fail(new Error(`${ENTRY} must appear exactly once.`))
          return
        }
        if (entry.uncompressedSize > MAX_MANIFEST) {
          fail(new Error(`${ENTRY} is larger than ${MAX_MANIFEST} bytes.`))
          return
        }
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) {
            fail(streamErr ?? new Error(`Could not read ${ENTRY}.`))
            return
          }
          const chunks: Buffer[] = []
          let size = 0
          stream.on("data", (chunk: Buffer) => {
            size += chunk.length
            if (size > MAX_MANIFEST) {
              stream.destroy(new Error(`${ENTRY} is larger than ${MAX_MANIFEST} bytes.`))
              return
            }
            chunks.push(chunk)
          })
          stream.on("error", fail)
          stream.on("end", () => {
            raw = Buffer.concat(chunks)
            zip.readEntry()
          })
        })
      })
      zip.on("end", () => {
        if (settled) return
        if (count !== 1 || !raw) {
          fail(new Error(`${ENTRY} must appear exactly once.`))
          return
        }
        try {
          const value = JSON.parse(raw.toString("utf8"))
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            fail(new Error(`${ENTRY} must contain a JSON object.`))
            return
          }
          settled = true
          resolve(value as VsixManifest)
        } catch (err) {
          fail(new Error(`${ENTRY} is invalid JSON: ${err instanceof Error ? err.message : String(err)}`))
        }
      })
      zip.readEntry()
    })
  })
}

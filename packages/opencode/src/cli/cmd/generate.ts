import type { CommandModule } from "yargs"

type Args = {}

export const GenerateCommand = {
  command: "generate",
  builder: (yargs) => yargs,
  handler: async () => {
    const { Server } = await import("../../server/server")
    const specs = (await Server.openapi()) as {
      info: { title: string; description: string } // chipmate_change
      paths: Record<string, Record<string, any>>
    }
    // chipmate_change start
    specs.info.title = "chipmate"
    specs.info.description = "chipmate api"
    // chipmate_change end
    for (const item of Object.values(specs.paths)) {
      for (const method of ["get", "post", "put", "delete", "patch"] as const) {
        const operation = item[method]
        if (!operation?.operationId) continue
        operation["x-codeSamples"] = [
          // chipmate_change start
          {
            lang: "js",
            source: [
              `import { createChipMateClient } from "@chipmate/sdk"`,
              ``,
              `const client = createChipMateClient()`,
              `await client.${operation.operationId}({`,
              `  ...`,
              `})`,
            ].join("\n"),
          },
          // chipmate_change end,
        ]
      }
    }
    const raw = JSON.stringify(specs, null, 2)
      // chipmate_change start - replace upstream product name in all descriptions
      .replaceAll("OpenCode", "ChipMate")
      .replaceAll("opencode.local", "chipmate.local")
      .replaceAll("opencode serve", "chipmate serve")
      .replaceAll("https://opencode.ai/", "https://chipmate.ai/")
    // chipmate_change end

    // Format through prettier so output is byte-identical to committed file
    // regardless of whether ./script/format.ts runs afterward.
    const prettier = await import("prettier")
    const babel = await import("prettier/plugins/babel")
    const estree = await import("prettier/plugins/estree")
    const format = prettier.format ?? prettier.default?.format
    const json = await format(raw, {
      parser: "json",
      plugins: [babel.default ?? babel, estree.default ?? estree],
      printWidth: 120,
    })

    // Wait for stdout to finish writing before process.exit() is called
    await new Promise<void>((resolve, reject) => {
      process.stdout.write(json, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  },
} satisfies CommandModule<object, Args>

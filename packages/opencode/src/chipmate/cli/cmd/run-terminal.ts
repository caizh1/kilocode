import type { ChipMateClient } from "@chipmate/sdk/v2"

type Client = {
  session: Pick<ChipMateClient["session"], "get">
  terminal: Pick<ChipMateClient["interactiveTerminal"], "write" | "resize" | "close">
}

export namespace ChipMateRunTerminal {
  export function create(sdk: ChipMateClient, session: () => string) {
    const client: Client = { session: sdk.session, terminal: sdk.interactiveTerminal }
    const state = {
      id: "",
      workspace: undefined as Promise<string | undefined> | undefined,
    }

    function workspace() {
      const id = session()
      if (state.id === id && state.workspace) return state.workspace
      state.id = id
      state.workspace = client.session
        .get({ sessionID: id })
        .then((result) => {
          if (result.error) throw result.error
          return result.data?.workspaceID
        })
        .catch(() => {
          state.id = ""
          state.workspace = undefined
          return undefined
        })
      return state.workspace
    }

    return {
      write: async (input: { terminalID: string; data: string }) => {
        await client.terminal.write({
          terminalID: input.terminalID,
          workspace: await workspace(),
          interactiveTerminalWriteInput: { data: input.data },
        })
      },
      resize: async (input: { terminalID: string; cols: number; rows: number }) => {
        await client.terminal.resize({
          terminalID: input.terminalID,
          workspace: await workspace(),
          interactiveTerminalResizeInput: { cols: input.cols, rows: input.rows },
        })
      },
      close: async (terminalID: string) => {
        await client.terminal.close({ terminalID, workspace: await workspace() })
      },
    }
  }
}

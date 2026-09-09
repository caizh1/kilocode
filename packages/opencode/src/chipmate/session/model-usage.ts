import { NonNegativeInt } from "@opencode-ai/core/schema"
import { Effect, Schema } from "effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Database } from "@opencode-ai/core/database/database"
import { SessionID } from "@/session/schema"
import { sql } from "drizzle-orm"

export namespace ModelUsage {
  const Tokens = Schema.Struct({
    input: NonNegativeInt,
    output: NonNegativeInt,
    reasoning: NonNegativeInt,
    cache: Schema.Struct({
      read: NonNegativeInt,
      write: NonNegativeInt,
    }),
  })

  const Usage = Schema.Struct({
    steps: NonNegativeInt,
    cost: Schema.Finite,
    billing: Schema.Struct({
      amountCNY: Schema.Finite,
      settledSteps: NonNegativeInt,
      pendingSteps: NonNegativeInt,
      unavailableSteps: NonNegativeInt,
      otherCostUSD: Schema.Finite,
      groups: Schema.Array(
        Schema.Struct({
          name: Schema.String,
          steps: NonNegativeInt,
          amountCNY: Schema.Finite,
        }),
      ),
    }),
    tokens: Tokens,
  })

  const Model = Schema.Struct({
    providerID: ProviderV2.ID,
    modelID: ModelV2.ID,
    ...Usage.fields,
  })

  type Model = typeof Model.Type

  export const Info = Schema.Struct({
    sessionIDs: Schema.Array(SessionID),
    totals: Usage,
    models: Schema.Array(Model),
  })

  type Info = typeof Info.Type

  type Anchor = {
    projectID: ProjectV2.ID
  }

  type Ancestor = {
    id: SessionID
    parentID: SessionID | null
  }

  type Row = {
    providerID: ProviderV2.ID
    modelID: ModelV2.ID
    steps: number
    cost: number
    billingStatus: string | null
    billingGroup: string | null
    amountCNY: number
    otherCostUSD: number
    input: number
    output: number
    reasoning: number
    read: number
    write: number
  }

  // Scope aggregation to the already-resolved family session IDs via an IN list.
  // Re-deriving the family with an inline recursive CTE prevents SQLite from
  // using part_session_idx and forces a full scan of the entire part table
  // (seconds on large histories), which blocks the single-threaded server on
  // every session open. A concrete IN list lets the planner seek the index.
  const usageSql = (sessionIDs: SessionID[]) => sql`
    WITH step AS (
      SELECT
        coalesce(json_extract(part.data, '$.model.providerID'), json_extract(message.data, '$.providerID')) AS providerID,
        coalesce(json_extract(part.data, '$.model.modelID'), json_extract(message.data, '$.modelID')) AS modelID,
        max(0.0, cast(coalesce(json_extract(part.data, '$.cost'), 0) AS REAL)) AS cost,
        json_extract(part.data, '$.billing.status') AS billing_status,
        json_extract(part.data, '$.billing.group') AS billing_group,
        max(0.0, cast(coalesce(json_extract(part.data, '$.billing.amount'), 0) AS REAL)) AS amount_cny,
        max(0, cast(coalesce(json_extract(part.data, '$.tokens.input'), 0) AS INTEGER)) AS input,
        max(0, cast(coalesce(json_extract(part.data, '$.tokens.output'), 0) AS INTEGER)) AS output,
        max(0, cast(coalesce(json_extract(part.data, '$.tokens.reasoning'), 0) AS INTEGER)) AS reasoning,
        max(0, cast(coalesce(json_extract(part.data, '$.tokens.cache.read'), 0) AS INTEGER)) AS cache_read,
        max(0, cast(coalesce(json_extract(part.data, '$.tokens.cache.write'), 0) AS INTEGER)) AS cache_write
      FROM part
      JOIN message ON message.id = part.message_id AND message.session_id = part.session_id
      WHERE part.session_id IN (${sql.join(
        sessionIDs.map((id) => sql`${id}`),
        sql`,`,
      )})
        AND json_extract(part.data, '$.type') = 'step-finish'
        AND json_extract(message.data, '$.role') = 'assistant'
    )
    SELECT
      providerID,
      modelID,
      billing_status AS billingStatus,
      billing_group AS billingGroup,
      count(*) AS steps,
      coalesce(sum(cost), 0) AS cost,
      coalesce(sum(amount_cny), 0) AS amountCNY,
      coalesce(sum(CASE WHEN billing_status IS NULL THEN cost ELSE 0 END), 0) AS otherCostUSD,
      coalesce(sum(input), 0) AS input,
      coalesce(sum(output), 0) AS output,
      coalesce(sum(reasoning), 0) AS reasoning,
      coalesce(sum(cache_read), 0) AS read,
      coalesce(sum(cache_write), 0) AS write
    FROM step
    WHERE providerID IS NOT NULL AND modelID IS NOT NULL
    GROUP BY providerID, modelID, billing_status, billing_group
    ORDER BY cost DESC, providerID, modelID, billing_status, billing_group`

  const empty = () => ({
    steps: 0,
    cost: 0,
    billing: {
      amountCNY: 0,
      settledSteps: 0,
      pendingSteps: 0,
      unavailableSteps: 0,
      otherCostUSD: 0,
      groups: [] as Array<{ name: string; steps: number; amountCNY: number }>,
    },
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  })

  export const get = Effect.fn("ModelUsage.get")(function* (sessionID: SessionID) {
    const { db } = yield* Database.Service
    const anchor = yield* db
      .get<Anchor>(sql`SELECT project_id AS projectID FROM session WHERE id = ${sessionID}`)
      .pipe(Effect.orDie)
    if (!anchor) return undefined

    const ancestors = yield* db
      .all<Ancestor>(sql`
        WITH RECURSIVE ancestor(id, parent_id) AS (
          SELECT id, parent_id
          FROM session
          WHERE id = ${sessionID} AND project_id = ${anchor.projectID}

          UNION

          SELECT parent.id, parent.parent_id
          FROM session AS parent
          JOIN ancestor AS child ON child.parent_id = parent.id
          WHERE parent.project_id = ${anchor.projectID}
        )
        SELECT id, parent_id AS parentID
        FROM ancestor`)
      .pipe(Effect.orDie)
    const ids = new Set(ancestors.map((item) => item.id))
    const rootID = ancestors.find((item) => !item.parentID || !ids.has(item.parentID))?.id ?? sessionID
    const sessionIDs = (
      yield* db
        .all<{ id: SessionID }>(sql`
          WITH RECURSIVE family(id) AS (
            SELECT id
            FROM session
            WHERE id = ${rootID} AND project_id = ${anchor.projectID}

            UNION

            SELECT child.id
            FROM session AS child
            JOIN family AS parent ON child.parent_id = parent.id
            WHERE child.project_id = ${anchor.projectID}
          )
          SELECT id
          FROM family
          ORDER BY id`)
        .pipe(Effect.orDie)
    ).map((item) => item.id)
    const rows = sessionIDs.length === 0 ? [] : yield* db.all<Row>(usageSql(sessionIDs)).pipe(Effect.orDie)
    const add = (usage: ReturnType<typeof empty>, row: Row) => {
      usage.steps += row.steps
      usage.cost += row.cost
      usage.billing.amountCNY += row.amountCNY
      usage.billing.otherCostUSD += row.otherCostUSD
      if (row.billingStatus === "settled") usage.billing.settledSteps += row.steps
      if (row.billingStatus === "pending") usage.billing.pendingSteps += row.steps
      if (row.billingStatus === "unavailable") usage.billing.unavailableSteps += row.steps
      if (row.billingStatus === "settled" && row.billingGroup) {
        const group = usage.billing.groups.find((item) => item.name === row.billingGroup)
        if (group) {
          group.steps += row.steps
          group.amountCNY += row.amountCNY
        } else usage.billing.groups.push({ name: row.billingGroup, steps: row.steps, amountCNY: row.amountCNY })
      }
      usage.tokens.input += row.input
      usage.tokens.output += row.output
      usage.tokens.reasoning += row.reasoning
      usage.tokens.cache.read += row.read
      usage.tokens.cache.write += row.write
    }

    const totals = empty()
    const byModel = new Map<
      string,
      ReturnType<typeof empty> & { providerID: ProviderV2.ID; modelID: ModelV2.ID }
    >()
    for (const row of rows) {
      add(totals, row)
      const key = `${row.providerID}\u0000${row.modelID}`
      const current = byModel.get(key) ?? { providerID: row.providerID, modelID: row.modelID, ...empty() }
      add(current, row)
      byModel.set(key, current)
    }
    const models = [...byModel.values()].sort(
      (left, right) => right.cost - left.cost || left.providerID.localeCompare(right.providerID) || left.modelID.localeCompare(right.modelID),
    )
    for (const usage of [totals, ...models]) {
      usage.billing.groups.sort((left, right) => right.amountCNY - left.amountCNY || left.name.localeCompare(right.name))
    }
    return { sessionIDs, totals, models } satisfies Info
  })
}

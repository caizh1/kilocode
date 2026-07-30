import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { MarketDb } from "@chipmate/market-db"
import { Identity, sendIdentityError, type ResolveUser } from "./identity.ts"
import { parseRulePack, RulePackValidationError, type ReviewRule, type ReviewRulePack } from "./review-rulepack.ts"

const MAX = 20 * 1024 * 1024

interface Options {
  root: string
  resolveUser?: ResolveUser
  now?: () => number
  authorize?: (req: FastifyRequest) => Promise<void>
  publishers?: string[]
}

type Pointer = {
  hash: string
  publishedAt: string
}

export class ReviewRuleStore {
  private chain = Promise.resolve()

  constructor(
    readonly root: string,
    private readonly now: () => number = Date.now,
  ) {}

  async import(input: Buffer, version: string) {
    return this.lock(async () => {
      await this.init()
      const pack = await parseRulePack(input, version)
      const packs = await this.list()
      const duplicate = packs.find((item) => item.version === version)
      if (duplicate && duplicate.sourceHash !== pack.sourceHash) {
        throw new RulePackValidationError(`RulePack version ${version} already exists with different content.`)
      }
      if (duplicate) return duplicate
      pack.rules = revisions(pack.rules, packs)
      pack.contentHash = await digest(pack)
      await atomic(join(this.root, "packs", `${pack.contentHash}.json`), pack)
      return pack
    })
  }

  async publish(hash: string) {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new RulePackValidationError("Invalid RulePack content hash.")
    return this.lock(async () => {
      await this.init()
      const pack = await this.get(hash)
      if (!pack) throw new RulePackValidationError("RulePack was not found.")
      const pointer = { hash, publishedAt: new Date(this.now()).toISOString() }
      await atomic(join(this.root, "published.json"), pointer)
      return { ...pack, status: "PUBLISHED" as const, publishedAt: pointer.publishedAt }
    })
  }

  async latest() {
    await this.init()
    const pointer = await json<Pointer>(join(this.root, "published.json"))
    if (!pointer) return
    const pack = await this.get(pointer.hash)
    if (!pack) return
    return { ...pack, status: "PUBLISHED" as const, publishedAt: pointer.publishedAt }
  }

  async get(hash: string) {
    if (!/^[0-9a-f]{64}$/.test(hash)) return
    return json<ReviewRulePack>(join(this.root, "packs", `${hash}.json`))
  }

  private async list() {
    await this.init()
    const files = await readdir(join(this.root, "packs"))
    const packs = await Promise.all(
      files
        .filter((file) => /^[0-9a-f]{64}\.json$/.test(file))
        .map((file) => json<ReviewRulePack>(join(this.root, "packs", file))),
    )
    return packs.filter((pack): pack is ReviewRulePack => Boolean(pack))
  }

  private async init() {
    await mkdir(join(this.root, "packs"), { recursive: true })
  }

  private lock<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(task, task)
    this.chain = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }
}

export function registerReviewRules(app: FastifyInstance, db: MarketDb | undefined, opts: Options) {
  const store = new ReviewRuleStore(opts.root, opts.now)
  const identity = db ? new Identity(db, opts.resolveUser, opts.now) : undefined
  const authorize = async (req: FastifyRequest) => {
    if (opts.authorize) return opts.authorize(req)
    if (!identity) throw new RuleWriteUnavailableError()
    const principal = await identity.write(req)
    const publishers = new Set((opts.publishers ?? []).map((item) => item.trim().toLocaleLowerCase()).filter(Boolean))
    if (!publishers.size) throw new RulePublisherError("RulePack publishers are not configured.")
    if (!publishers.has(principal.user.displayName.trim().toLocaleLowerCase())) {
      throw new RulePublisherError("The authenticated user is not allowed to publish RulePacks.")
    }
  }

  app.get("/api/v1/review-rule-packs/latest", async (_req, reply) => {
    const pack = await store.latest()
    if (!pack) return problem(reply, 404, "RULEPACK_NOT_PUBLISHED", "No published RulePack is available.")
    return reply.header("cache-control", "no-store").header("etag", `"${pack.contentHash}"`).send(pack)
  })

  app.get("/api/v1/review-rule-packs/:hash", async (req, reply) => {
    const pack = await store.get((req.params as { hash: string }).hash)
    if (!pack) return problem(reply, 404, "RULEPACK_NOT_FOUND", "RulePack was not found.")
    return reply.header("cache-control", "no-store").send(pack)
  })

  app.post("/api/v1/review-rule-packs", { config: { bodyLimit: MAX } }, async (req, reply) => {
    const denied = await permission(req, reply, authorize)
    if (denied) return denied
    const body = req.body
    if (!Buffer.isBuffer(body)) return problem(reply, 400, "INVALID_DOCX", "A DOCX request body is required.")
    const version = header(req.headers["x-rulepack-version"])
    return store
      .import(body, version)
      .then((pack) => reply.code(201).send(pack))
      .catch((err: unknown) => validation(reply, err))
  })

  app.post("/api/v1/review-rule-packs/:hash/publish", async (req, reply) => {
    const denied = await permission(req, reply, authorize)
    if (denied) return denied
    return store
      .publish((req.params as { hash: string }).hash)
      .then((pack) => reply.send(pack))
      .catch((err: unknown) => validation(reply, err))
  })

  return store
}

class RuleWriteUnavailableError extends Error {}
class RulePublisherError extends Error {}

async function permission(req: FastifyRequest, reply: FastifyReply, authorize: (req: FastifyRequest) => Promise<void>) {
  try {
    await authorize(req)
    return
  } catch (err) {
    if (err instanceof RuleWriteUnavailableError) {
      return problem(reply, 503, "RULE_WRITE_UNAVAILABLE", "RulePack write authentication is unavailable.")
    }
    if (err instanceof RulePublisherError) return problem(reply, 403, "RULE_PUBLISHER_REQUIRED", err.message)
    return sendIdentityError(reply, err)
  }
}

function validation(reply: FastifyReply, err: unknown) {
  if (err instanceof RulePackValidationError) return problem(reply, 400, "RULEPACK_INVALID", err.message)
  throw err
}

function problem(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ ok: false, code, message })
}

function header(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0]?.trim() ?? "") : (value?.trim() ?? "")
}

async function json<T>(file: string): Promise<T | undefined> {
  const value = await readFile(file, "utf8").catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return undefined
    throw err
  })
  if (!value) return
  return JSON.parse(value) as T
}

async function atomic(file: string, value: unknown) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, `${JSON.stringify(value)}\n`, { flag: "wx" })
  await rename(tmp, file)
}

function revisions(rules: ReviewRule[], packs: ReviewRulePack[]) {
  return rules.map((rule) => {
    const prior = packs
      .flatMap((pack) => pack.rules)
      .filter((item) => item.id === rule.id)
      .toSorted((left, right) => right.revision - left.revision)
    const same = prior.find((item) => item.contentHash === rule.contentHash)
    return { ...rule, revision: same?.revision ?? (prior[0]?.revision ?? 0) + 1 }
  })
}

async function digest(pack: ReviewRulePack) {
  const { createHash } = await import("node:crypto")
  return createHash("sha256")
    .update(JSON.stringify({ version: pack.version, sourceHash: pack.sourceHash, rules: pack.rules }))
    .digest("hex")
}

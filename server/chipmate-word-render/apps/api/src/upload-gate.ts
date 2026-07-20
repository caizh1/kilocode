import { statfs } from "node:fs/promises"

export const UPLOAD_MAX_BYTES = 512 * 1024 * 1024
export const UPLOAD_MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024
export const UPLOAD_MAX_ACTIVE = 20

export class UploadAdmissionError extends Error {
  constructor(
    readonly code: "PUBLICATION_BUSY" | "STORAGE_PRESSURE",
    message: string,
  ) {
    super(message)
  }
}

interface Options {
  root: string
  active?: number
  free?: number
  stat?: (path: string) => Promise<{ bavail: number | bigint; bsize: number | bigint }>
}

export class UploadGate {
  private active = 0
  private reserved = 0
  private free = 0
  private pressure = false
  private chain = Promise.resolve()
  private readonly limit: number
  private readonly floor: number
  private readonly stat: NonNullable<Options["stat"]>

  constructor(private readonly opts: Options) {
    this.limit = opts.active ?? UPLOAD_MAX_ACTIVE
    this.floor = opts.free ?? UPLOAD_MIN_FREE_BYTES
    this.stat = opts.stat ?? statfs
  }

  async claim(bytes: number) {
    const size = Number.isSafeInteger(bytes) && bytes > 0 && bytes <= UPLOAD_MAX_BYTES ? bytes : UPLOAD_MAX_BYTES
    return this.lock(async () => {
      if (this.active >= this.limit)
        throw new UploadAdmissionError("PUBLICATION_BUSY", "All extension publication slots are busy.")
      const info = await this.stat(this.opts.root).catch(() => {
        this.free = 0
        this.pressure = true
        throw new UploadAdmissionError("STORAGE_PRESSURE", "Extension storage free space could not be determined.")
      })
      const free = Number(info.bavail) * Number(info.bsize)
      this.free = Number.isFinite(free) ? free : 0
      this.pressure = this.free - this.reserved - size < this.floor
      if (this.pressure)
        throw new UploadAdmissionError("STORAGE_PRESSURE", "Extension storage does not have enough free space.")
      this.active += 1
      this.reserved += size
      const state = { released: false }
      return {
        release: async () => {
          if (state.released) return
          state.released = true
          await this.lock(() => {
            this.active = Math.max(0, this.active - 1)
            this.reserved = Math.max(0, this.reserved - size)
            this.pressure = this.free - this.reserved < this.floor
          })
        },
      }
    })
  }

  async refresh() {
    await this.lock(async () => {
      const info = await this.stat(this.opts.root).catch(() => undefined)
      if (!info) {
        this.free = 0
        this.pressure = true
        return
      }
      const free = Number(info.bavail) * Number(info.bsize)
      this.free = Number.isFinite(free) ? free : 0
      this.pressure = this.free - this.reserved < this.floor
    })
  }

  health() {
    return {
      activeUploads: this.active,
      maxActiveUploads: this.limit,
      reservedBytes: this.reserved,
      freeBytes: this.free,
      minimumFreeBytes: this.floor,
      storagePressure: this.pressure,
    }
  }

  private lock<T>(task: () => Promise<T> | T): Promise<T> {
    const next = this.chain.then(task, task)
    this.chain = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }
}

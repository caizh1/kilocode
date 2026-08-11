export interface ICacheManager {
  getHash(filePath: string): string | undefined
  updateHash(filePath: string, hash: string): void
  deleteHash(filePath: string): void
  getAllHashes(): Record<string, string>
  checkpoint?(): Promise<void>
  flush?(): Promise<void>
}

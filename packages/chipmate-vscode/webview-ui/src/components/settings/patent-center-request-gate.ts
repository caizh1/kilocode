export class PatentCenterRequestGate {
  private scanSequence = 0
  private cancelRequest: string | undefined

  beginScan() {
    return ++this.scanSequence
  }

  isLatestScan(sequence: number) {
    return sequence === this.scanSequence
  }

  beginCancel(requestId: string) {
    if (this.cancelRequest) return false
    this.cancelRequest = requestId
    return true
  }

  completeCancel(requestId: string) {
    if (this.cancelRequest !== requestId) return false
    this.cancelRequest = undefined
    return true
  }
}

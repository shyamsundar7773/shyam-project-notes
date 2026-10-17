export type SaveState =
  | 'saved'
  | 'unsaved'
  | 'saving'
  | 'failed'

export class AutosaveQueue<T> {
  private desired: T
  private revision = 0
  private savedRevision = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private running: Promise<void> | undefined
  private disposed = false
  private readonly saveValue: (value: T) => Promise<void>
  private readonly onState: (state: SaveState) => void
  private readonly delayMs: number

  constructor(
    initial: T,
    saveValue: (value: T) => Promise<void>,
    onState: (state: SaveState) => void,
    delayMs = 600,
  ) {
    this.desired = initial
    this.saveValue = saveValue
    this.onState = onState
    this.delayMs = delayMs
  }

  edit(value: T): void {
    if (this.disposed) {
      return
    }
    this.desired = value
    this.revision += 1
    this.onState('unsaved')
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.timer = setTimeout(() => void this.flush(), this.delayMs)
  }

  async flush(): Promise<void> {
    if (this.disposed) {
      return
    }
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (this.running) {
      return this.running
    }

    this.running = this.savePending()
    try {
      await this.running
    } finally {
      this.running = undefined
    }
  }

  retry(): Promise<void> {
    return this.flush()
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }

  private async savePending(): Promise<void> {
    while (!this.disposed && this.savedRevision < this.revision) {
      const revision = this.revision
      const value = this.desired
      this.onState('saving')
      try {
        await this.saveValue(value)
        this.savedRevision = revision
        if (!this.disposed) {
          this.onState(
            this.savedRevision === this.revision ? 'saved' : 'unsaved',
          )
        }
      } catch {
        if (revision < this.revision) {
          continue
        }
        if (!this.disposed) {
          this.onState('failed')
        }
        return
      }
    }
  }
}

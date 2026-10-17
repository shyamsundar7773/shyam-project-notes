export class RequestSequence {
  private current = 0

  begin(): number {
    this.current += 1
    return this.current
  }

  invalidate(): void {
    this.current += 1
  }

  isCurrent(request: number): boolean {
    return request === this.current
  }
}

export class Semaphore {
  private available: number;
  private waiters: Array<() => void> = [];

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Semaphore capacity must be >= 1');
    this.available = capacity;
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available--;
      return this.release.bind(this);
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.available--;
    return this.release.bind(this);
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.available++;
  }
}

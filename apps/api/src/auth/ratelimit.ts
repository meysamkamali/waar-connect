// Small in-memory limiter for the login route: N failures per address per window.

interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  readonly #buckets = new Map<string, Bucket>();
  private readonly max: number;
  private readonly windowMs: number;

  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }

  /** True when the key is currently blocked. */
  blocked(key: string, now: number = Date.now()): boolean {
    const b = this.#buckets.get(key);
    if (!b) return false;
    if (b.resetAt <= now) {
      this.#buckets.delete(key);
      return false;
    }
    return b.count >= this.max;
  }

  failure(key: string, now: number = Date.now()): void {
    const b = this.#buckets.get(key);
    if (!b || b.resetAt <= now) this.#buckets.set(key, { count: 1, resetAt: now + this.windowMs });
    else b.count += 1;
  }

  success(key: string): void {
    this.#buckets.delete(key);
  }
}

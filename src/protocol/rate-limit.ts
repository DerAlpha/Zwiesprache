// Token-Bucket-Ratenbegrenzung für eingehende Nachrichten.

export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.tokens = capacity;
    this.last = now();
  }

  /** Verbraucht ein Token; false, wenn das Limit erreicht ist. */
  take(): boolean {
    const t = this.now();
    const elapsed = Math.max(0, t - this.last) / 1000;
    this.last = t;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** Standardlimits: Text großzügig für normales Tippen, Steuernachrichten etwas höher. */
export function createRateLimits(now?: () => number) {
  return {
    text: new TokenBucket(30, 5, now),
    control: new TokenBucket(120, 40, now),
  };
}

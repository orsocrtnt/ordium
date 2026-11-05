import { QuotaExceededError, type RateLimits } from "./types.js";

interface Window {
  name: string;
  ms: number;
  max: number;
  /** true : attendre que la fenêtre se libère ; false : lever QuotaExceededError. */
  waitable: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Limiteur à fenêtres glissantes couvrant toutes les granularités réelles
 * des plans gratuits (seconde → mois). Les fenêtres courtes font attendre ;
 * les quotas longs font basculer vers le fournisseur suivant.
 */
export class RateLimiter {
  private readonly windows: Window[];
  private timestamps: number[] = [];

  constructor(
    private readonly providerId: string,
    limits: RateLimits,
    private readonly now: () => number = Date.now,
  ) {
    this.windows = [
      { name: "par seconde", ms: 1_000, max: limits.perSecond ?? Infinity, waitable: true },
      { name: "par minute", ms: 60_000, max: limits.perMinute ?? Infinity, waitable: true },
      { name: "horaire", ms: 3_600_000, max: limits.perHour ?? Infinity, waitable: false },
      { name: "journalier", ms: 86_400_000, max: limits.perDay ?? Infinity, waitable: false },
      { name: "mensuel", ms: 30 * 86_400_000, max: limits.perMonth ?? Infinity, waitable: false },
    ].filter((w) => w.max !== Infinity);
  }

  /** Réserve un appel : attend si nécessaire, lève QuotaExceededError si épuisé. */
  async acquire(): Promise<void> {
    for (;;) {
      const t = this.now();
      const horizon = Math.max(...this.windows.map((w) => w.ms), 0);
      this.timestamps = this.timestamps.filter((ts) => t - ts < horizon);

      let waitMs = 0;
      for (const w of this.windows) {
        const inWindow = this.timestamps.filter((ts) => t - ts < w.ms);
        if (inWindow.length < w.max) continue;
        if (!w.waitable) throw new QuotaExceededError(this.providerId, w.name);
        waitMs = Math.max(waitMs, inWindow[0]! + w.ms - t);
      }
      if (waitMs === 0) {
        this.timestamps.push(t);
        return;
      }
      await sleep(waitMs + 5);
    }
  }
}

const FAILURES_BEFORE_COOLDOWN = 3;
const COOLDOWN_MS = 15 * 60_000;

/**
 * Circuit breaker par fournisseur : après 3 échecs consécutifs, le
 * fournisseur passe en cooldown 15 minutes et le suivant prend le relais.
 */
export class CircuitBreaker {
  private failures = 0;
  private cooldownUntil = 0;

  constructor(private readonly now: () => number = Date.now) {}

  get open(): boolean {
    return this.now() < this.cooldownUntil;
  }

  recordSuccess(): void {
    this.failures = 0;
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.failures >= FAILURES_BEFORE_COOLDOWN) {
      this.cooldownUntil = this.now() + COOLDOWN_MS;
      this.failures = 0;
    }
  }
}

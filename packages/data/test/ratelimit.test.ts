import { describe, expect, it } from "vitest";
import { CircuitBreaker, QuotaExceededError, RateLimiter } from "../src/index.js";

describe("RateLimiter", () => {
  it("laisse passer sous la limite", async () => {
    const limiter = new RateLimiter("test", { perDay: 3 });
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
  });

  it("lève QuotaExceededError quand un quota long est épuisé", async () => {
    const limiter = new RateLimiter("test", { perDay: 2 });
    await limiter.acquire();
    await limiter.acquire();
    await expect(limiter.acquire()).rejects.toThrow(QuotaExceededError);
  });

  it("fait attendre sur une fenêtre courte au lieu d'échouer", async () => {
    let clock = 0;
    // Horloge simulée : le sleep réel est court, on vérifie surtout la logique.
    const limiter = new RateLimiter("test", { perSecond: 2 }, () => {
      clock += 300;
      return clock;
    });
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire(); // l'horloge avance de 300 ms par consultation : finit par passer
  });

  it("le quota mensuel se libère avec le temps", async () => {
    let clock = 0;
    const limiter = new RateLimiter("test", { perMonth: 1 }, () => clock);
    await limiter.acquire();
    await expect(limiter.acquire()).rejects.toThrow(QuotaExceededError);
    clock += 31 * 86_400_000;
    await limiter.acquire();
  });
});

describe("CircuitBreaker", () => {
  it("s'ouvre après 3 échecs et se referme après le cooldown", () => {
    let clock = 0;
    const breaker = new CircuitBreaker(() => clock);
    expect(breaker.open).toBe(false);
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.open).toBe(false);
    breaker.recordFailure();
    expect(breaker.open).toBe(true);
    clock += 15 * 60_000 + 1;
    expect(breaker.open).toBe(false);
  });

  it("un succès remet le compteur d'échecs à zéro", () => {
    const breaker = new CircuitBreaker(() => 0);
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.open).toBe(false);
  });
});

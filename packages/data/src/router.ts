import type { AssetSeries } from "@ordium/engine";
import { CircuitBreaker, RateLimiter } from "./ratelimit.js";
import {
  QuotaExceededError,
  SymbolNotSupportedError,
  type FetchQuery,
  type MarketDataProvider,
} from "./types.js";

export interface RouterFetchOptions {
  /**
   * true si la classe d'actif est une hypothèse (l'appelant ne la connaît pas).
   * On écarte alors les fournisseurs qui ne servent cette classe qu'en
   * fallback (capability `fallbackOnly`) : sans cela, l'hypothèse « crypto »
   * pour QQQ matcherait chez Yahoo un obscur token homonyme de l'ETF.
   */
  guessed?: boolean;
}

/**
 * Routeur : sélectionne les fournisseurs capables de servir la requête,
 * les essaie par priorité croissante, et bascule automatiquement sur le
 * suivant en cas de panne, de quota épuisé ou de cooldown.
 *
 * Le moteur de stratégie ne voit jamais cette couche : il consomme des
 * AssetSeries sans savoir qui les a fournies.
 */
export class DataRouter {
  private readonly limiters = new Map<string, RateLimiter>();
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(private readonly providers: MarketDataProvider[]) {
    for (const p of providers) {
      this.limiters.set(p.id, new RateLimiter(p.id, p.capabilities.rateLimits));
      this.breakers.set(p.id, new CircuitBreaker());
    }
  }

  /** Fournisseurs capables de (assetType, timeframe), triés par priorité. */
  eligible(
    query: Pick<FetchQuery, "assetType" | "timeframe">,
    opts: RouterFetchOptions = {},
  ): MarketDataProvider[] {
    return this.providers
      .filter(
        (p) =>
          p.capabilities.assetTypes.includes(query.assetType) &&
          p.capabilities.timeframes.includes(query.timeframe) &&
          !(opts.guessed && p.capabilities.fallbackOnly?.includes(query.assetType)),
      )
      .sort((a, b) => a.capabilities.priority - b.capabilities.priority);
  }

  /** Essaie chaque fournisseur éligible jusqu'au premier succès. */
  async fetch(query: FetchQuery, opts: RouterFetchOptions = {}): Promise<AssetSeries> {
    const candidates = this.eligible(query, opts);
    if (candidates.length === 0) {
      throw new Error(
        `Aucun fournisseur ne couvre ${query.assetType}/${query.timeframe}. ` +
          `Fournisseurs enregistrés : ${this.providers.map((p) => p.id).join(", ") || "aucun"}.`,
      );
    }

    const failures: string[] = [];
    for (const provider of candidates) {
      const breaker = this.breakers.get(provider.id)!;
      if (breaker.open) {
        failures.push(`${provider.id} : en cooldown après échecs répétés`);
        continue;
      }
      if (provider.resolveSymbol(query) === null) {
        failures.push(`${provider.id} : ne connaît pas ${query.symbol}`);
        continue;
      }
      try {
        await this.limiters.get(provider.id)!.acquire();
        const series = await provider.fetchCandles(query);
        breaker.recordSuccess();
        return series;
      } catch (err) {
        // Quota épuisé ou symbole inconnu ≠ panne : on ne pénalise pas le breaker.
        if (err instanceof QuotaExceededError || err instanceof SymbolNotSupportedError) {
          failures.push(err.message);
          continue;
        }
        breaker.recordFailure();
        failures.push(`${provider.id} : ${(err as Error).message}`);
      }
    }

    throw new Error(
      `Impossible de récupérer ${query.symbol} (${query.assetType}) :\n  - ${failures.join("\n  - ")}`,
    );
  }
}

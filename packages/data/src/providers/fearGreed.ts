/**
 * Fear & Greed Index (crypto) — Alternative.me
 * Live : limit=1 · Historique : limit=N (max ~plusieurs années)
 * https://api.alternative.me/fng/
 */

export type FearGreedSnapshot = {
  value: number;
  classification: string;
  timestamp: string;
  source: "alternative.me";
};

/** Map date ISO (YYYY-MM-DD) → valeur 0–100 */
export type FearGreedSeries = Map<string, number>;

let liveCache: { at: number; data: FearGreedSnapshot } | null = null;
let historyCache: { at: number; series: FearGreedSeries } | null = null;
const TTL_MS = 15 * 60_000;
const HISTORY_TTL_MS = 6 * 60 * 60_000;

function classificationFor(value: number): string {
  if (value <= 24) return "Extreme Fear";
  if (value <= 44) return "Fear";
  if (value <= 55) return "Neutral";
  if (value <= 75) return "Greed";
  return "Extreme Greed";
}

export async function fetchFearGreedIndex(): Promise<FearGreedSnapshot> {
  if (liveCache && Date.now() - liveCache.at < TTL_MS) return liveCache.data;

  const res = await fetch("https://api.alternative.me/fng/?limit=1&format=json");
  if (!res.ok) throw new Error(`Fear & Greed HTTP ${res.status}`);
  const json = (await res.json()) as {
    data?: Array<{ value: string; value_classification: string; timestamp: string }>;
  };
  const row = json.data?.[0];
  if (!row) throw new Error("Fear & Greed : réponse vide");

  const data: FearGreedSnapshot = {
    value: Number(row.value),
    classification: row.value_classification || classificationFor(Number(row.value)),
    timestamp: new Date(Number(row.timestamp) * 1000).toISOString(),
    source: "alternative.me",
  };
  liveCache = { at: Date.now(), data };
  return data;
}

/**
 * Historique Fear & Greed (1 point / jour UTC).
 * `limit` = nombre de jours (0 = tout l’historique dispo côté API).
 */
export async function fetchFearGreedHistory(limit = 0): Promise<FearGreedSeries> {
  if (historyCache && Date.now() - historyCache.at < HISTORY_TTL_MS) {
    return historyCache.series;
  }

  const url =
    limit > 0
      ? `https://api.alternative.me/fng/?limit=${limit}&format=json`
      : "https://api.alternative.me/fng/?limit=0&format=json";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fear & Greed history HTTP ${res.status}`);
  const json = (await res.json()) as {
    data?: Array<{ value: string; timestamp: string }>;
  };
  const series: FearGreedSeries = new Map();
  for (const row of json.data ?? []) {
    const day = new Date(Number(row.timestamp) * 1000).toISOString().slice(0, 10);
    series.set(day, Number(row.value));
  }
  historyCache = { at: Date.now(), series };
  return series;
}

/** Valeur Fear & Greed pour une date (ou dernière dispo ≤ date). */
export function fearGreedOnDate(series: FearGreedSeries, date: string): number | null {
  if (series.has(date)) return series.get(date)!;
  // Cherche le jour précédent le plus proche (week-ends / trous)
  const target = Date.parse(`${date}T00:00:00Z`);
  let best: { t: number; v: number } | null = null;
  for (const [d, v] of series) {
    const t = Date.parse(`${d}T00:00:00Z`);
    if (t <= target && (best == null || t > best.t)) best = { t, v };
  }
  return best?.v ?? null;
}

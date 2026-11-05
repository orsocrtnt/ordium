/** Moyenne mobile simple sur les `period` dernières valeurs. Null si historique insuffisant. */
export function sma(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i]!;
  return sum / period;
}

/** EMA (exponential moving average). Null si historique insuffisant. */
export function ema(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i]!;
  prev /= period;
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
  }
  return prev;
}

/** RSI (lissage de Wilder). Null si historique insuffisant. */
export function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i]! - values[i - 1]!;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i]! - values[i - 1]!;
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** MACD (12, 26, 9) — dernier point. */
export function macd(
  values: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): { macd: number; signal: number; histogram: number } | null {
  if (values.length < slow + signalPeriod) return null;
  const macdLine: number[] = [];
  for (let end = slow; end <= values.length; end++) {
    const slice = values.slice(0, end);
    const f = ema(slice, fast);
    const s = ema(slice, slow);
    if (f == null || s == null) continue;
    macdLine.push(f - s);
  }
  if (macdLine.length < signalPeriod) return null;
  const signal = ema(macdLine, signalPeriod);
  if (signal == null) return null;
  const macdVal = macdLine[macdLine.length - 1]!;
  return { macd: macdVal, signal, histogram: macdVal - signal };
}

/** Bandes de Bollinger (SMA ± k·σ). */
export function bollinger(
  values: number[],
  period = 20,
  k = 2,
): { mid: number; upper: number; lower: number; pctB: number } | null {
  if (values.length < period) return null;
  const slice = values.slice(values.length - period);
  const mid = slice.reduce((a, b) => a + b, 0) / period;
  let varSum = 0;
  for (const v of slice) varSum += (v - mid) ** 2;
  const stdev = Math.sqrt(varSum / period);
  const upper = mid + k * stdev;
  const lower = mid - k * stdev;
  const last = values[values.length - 1]!;
  const width = upper - lower;
  const pctB = width === 0 ? 0.5 : (last - lower) / width;
  return { mid, upper, lower, pctB };
}

/** Plus haute valeur sur les `lookback` dernières valeurs. Null si série vide. */
export function highestValue(values: number[], lookback: number): number | null {
  if (values.length === 0) return null;
  let max = -Infinity;
  for (let i = Math.max(0, values.length - lookback); i < values.length; i++) {
    max = Math.max(max, values[i]!);
  }
  return max;
}

/** Plus basse valeur sur les `lookback` dernières valeurs. Null si série vide. */
export function lowestValue(values: number[], lookback: number): number | null {
  if (values.length === 0) return null;
  let min = Infinity;
  for (let i = Math.max(0, values.length - lookback); i < values.length; i++) {
    min = Math.min(min, values[i]!);
  }
  return min;
}

/**
 * Volatilité réalisée annualisée (%) sur `period` jours (écarts log, × √252).
 * Null si historique insuffisant.
 */
export function realizedVolPct(values: number[], period: number): number | null {
  if (period < 2 || values.length < period + 1) return null;
  const returns: number[] = [];
  for (let i = values.length - period; i < values.length; i++) {
    const prev = values[i - 1]!;
    const cur = values[i]!;
    if (prev <= 0 || cur <= 0) return null;
    returns.push(Math.log(cur / prev));
  }
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  let varSum = 0;
  for (const r of returns) varSum += (r - mean) ** 2;
  const stdev = Math.sqrt(varSum / returns.length);
  return stdev * Math.sqrt(252) * 100;
}

/** Distance % au plus haut sur lookback (négatif = sous l’ATH de fenêtre). */
export function pctFromHigh(values: number[], lookback: number): number | null {
  const high = highestValue(values, lookback);
  const last = values[values.length - 1];
  if (high == null || last == null || high <= 0) return null;
  return ((last - high) / high) * 100;
}

/** Snapshot d’indicateurs pour analyse live / dashboard. */
export function computeIndicatorSnapshot(closes: number[]): {
  price: number | null;
  rsi14: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema12: number | null;
  ema26: number | null;
  macd: { macd: number; signal: number; histogram: number } | null;
  bollinger: { mid: number; upper: number; lower: number; pctB: number } | null;
  vol20: number | null;
  pctFromAth252: number | null;
  regime: "bull" | "bear" | "neutral" | null;
} {
  const price = closes.length ? closes[closes.length - 1]! : null;
  const sma200 = sma(closes, 200);
  let regime: "bull" | "bear" | "neutral" | null = null;
  if (price != null && sma200 != null) {
    const band = 0.02;
    if (price > sma200 * (1 + band)) regime = "bull";
    else if (price < sma200 * (1 - band)) regime = "bear";
    else regime = "neutral";
  }
  return {
    price,
    rsi14: rsi(closes, 14),
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    sma200,
    ema12: ema(closes, 12),
    ema26: ema(closes, 26),
    macd: macd(closes),
    bollinger: bollinger(closes),
    vol20: realizedVolPct(closes, 20),
    pctFromAth252: pctFromHigh(closes, Math.min(252, closes.length)),
    regime,
  };
}

/**
 * Séries d’indicateurs barre par barre (mêmes formules que snapshot / règles).
 * `null` pendant le warmup. Aligné : dernier point === computeIndicatorSnapshot.
 */
export function computeIndicatorSeries(closes: number[]): {
  sma20: (number | null)[];
  sma50: (number | null)[];
  sma200: (number | null)[];
  rsi14: (number | null)[];
  bollinger: Array<{ mid: number; upper: number; lower: number } | null>;
  macd: Array<{ macd: number; signal: number; histogram: number } | null>;
} {
  const sma20: (number | null)[] = [];
  const sma50: (number | null)[] = [];
  const sma200: (number | null)[] = [];
  const rsi14: (number | null)[] = [];
  const bollingerSeries: Array<{ mid: number; upper: number; lower: number } | null> = [];
  const macdSeries: Array<{ macd: number; signal: number; histogram: number } | null> = [];

  for (let i = 0; i < closes.length; i++) {
    const prefix = closes.slice(0, i + 1);
    sma20.push(sma(prefix, 20));
    sma50.push(sma(prefix, 50));
    sma200.push(sma(prefix, 200));
    rsi14.push(rsi(prefix, 14));
    const b = bollinger(prefix);
    bollingerSeries.push(b ? { mid: b.mid, upper: b.upper, lower: b.lower } : null);
    macdSeries.push(macd(prefix));
  }

  return {
    sma20,
    sma50,
    sma200,
    rsi14,
    bollinger: bollingerSeries,
    macd: macdSeries,
  };
}

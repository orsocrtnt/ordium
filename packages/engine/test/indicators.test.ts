import { describe, expect, it } from "vitest";
import {
  bollinger,
  computeIndicatorSeries,
  computeIndicatorSnapshot,
  ema,
  highestValue,
  lowestValue,
  macd,
  realizedVolPct,
  rsi,
  sma,
} from "../src/indicators.js";

describe("sma", () => {
  it("calcule la moyenne des dernières valeurs", () => {
    expect(sma([1, 2, 3, 4], 2)).toBe(3.5);
    expect(sma([10, 20, 30], 3)).toBe(20);
  });
  it("retourne null si l'historique est insuffisant", () => {
    expect(sma([1, 2], 3)).toBeNull();
  });
});

describe("rsi", () => {
  it("vaut 100 pour une série strictement haussière", () => {
    const values = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(rsi(values, 14)).toBe(100);
  });
  it("tend vers 0 pour une série strictement baissière", () => {
    const values = Array.from({ length: 30 }, (_, i) => 100 - i);
    expect(rsi(values, 14)).toBeLessThan(1);
  });
  it("retourne null si l'historique est insuffisant", () => {
    expect(rsi([1, 2, 3], 14)).toBeNull();
  });
  it("reste entre 0 et 100 sur une série mixte", () => {
    const values = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i) * 10);
    const v = rsi(values, 14);
    expect(v).not.toBeNull();
    expect(v!).toBeGreaterThan(0);
    expect(v!).toBeLessThan(100);
  });
});

describe("highestValue", () => {
  it("retourne le max sur le lookback", () => {
    expect(highestValue([1, 9, 3, 4], 2)).toBe(4);
    expect(highestValue([1, 9, 3, 4], 10)).toBe(9);
  });
  it("retourne null sur série vide", () => {
    expect(highestValue([], 5)).toBeNull();
  });
});

describe("lowestValue", () => {
  it("retourne le min sur le lookback", () => {
    expect(lowestValue([1, 9, 3, 4], 2)).toBe(3);
    expect(lowestValue([1, 9, 3, 4], 10)).toBe(1);
  });
});

describe("realizedVolPct", () => {
  it("retourne null si historique insuffisant", () => {
    expect(realizedVolPct([1, 2, 3], 10)).toBeNull();
  });
  it("est positif sur une série bruyante", () => {
    const values = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i) * 5 + (i % 3));
    const v = realizedVolPct(values, 30);
    expect(v).not.toBeNull();
    expect(v!).toBeGreaterThan(0);
  });
});

describe("ema / macd / bollinger / snapshot", () => {
  const values = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 3) * 8 + i * 0.05);
  it("ema retourne une valeur", () => {
    expect(ema(values, 12)).not.toBeNull();
  });
  it("macd produit histogramme", () => {
    const m = macd(values);
    expect(m).not.toBeNull();
    expect(typeof m!.histogram).toBe("number");
  });
  it("bollinger a mid entre lower et upper", () => {
    const b = bollinger(values);
    expect(b).not.toBeNull();
    expect(b!.lower).toBeLessThan(b!.mid);
    expect(b!.mid).toBeLessThan(b!.upper);
  });
  it("computeIndicatorSnapshot expose rsi", () => {
    const snap = computeIndicatorSnapshot(values);
    expect(snap.rsi14).not.toBeNull();
    expect(snap.price).toBe(values[values.length - 1]);
  });
  it("computeIndicatorSeries aligne le dernier point sur le snapshot", () => {
    const long = Array.from({ length: 220 }, (_, i) => 100 + Math.sin(i / 5) * 10 + i * 0.02);
    const snap = computeIndicatorSnapshot(long);
    const series = computeIndicatorSeries(long);
    const last = long.length - 1;
    expect(series.sma20[last]).toBe(snap.sma20);
    expect(series.sma50[last]).toBe(snap.sma50);
    expect(series.sma200[last]).toBe(snap.sma200);
    expect(series.rsi14[last]).toBe(snap.rsi14);
    expect(series.bollinger[last]?.mid).toBe(snap.bollinger?.mid);
    expect(series.macd[last]?.histogram).toBe(snap.macd?.histogram);
  });
});

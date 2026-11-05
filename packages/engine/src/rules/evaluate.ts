import {
  bollinger,
  highestValue,
  lowestValue,
  macd,
  realizedVolPct,
  rsi,
  sma,
} from "../indicators.js";
import type { Regime } from "../types.js";
import type { Condition } from "./schema.js";

/**
 * Contexte d'évaluation d'une condition à un instant T.
 * Ne contient jamais de données futures (anti-lookahead).
 */
export interface EvalContext {
  /** Clôtures de l'actif évalué, jusqu'à aujourd'hui inclus. */
  closes: number[];
  /** Prix d'ouverture de la fenêtre (référence des dips). */
  openPrice: number | null;
  /** Régime de marché déjà détecté pour la fenêtre en cours. */
  regime: Regime;
  /**
   * Fear & Greed du jour (0–100), fourni par le pipeline data.
   * Absent → conditions fear_greed ne matchent pas.
   */
  fearGreed?: number | null;
}

export interface EvalResult {
  matched: boolean;
  reason: string | null;
}

function compare(op: "lt" | "lte" | "gt" | "gte", left: number, right: number): boolean {
  switch (op) {
    case "lt":
      return left < right;
    case "lte":
      return left <= right;
    case "gt":
      return left > right;
    case "gte":
      return left >= right;
  }
}

/**
 * Évalue un arbre de conditions. Pur et déterministe.
 * Retourne aussi une raison lisible quand la condition est vraie (pour le journal).
 */
export function evaluateCondition(condition: Condition, ctx: EvalContext): EvalResult {
  if ("all" in condition) {
    const reasons: string[] = [];
    for (const c of condition.all) {
      const r = evaluateCondition(c, ctx);
      if (!r.matched) return { matched: false, reason: null };
      if (r.reason) reasons.push(r.reason);
    }
    return { matched: true, reason: reasons.join(" ET ") || null };
  }

  if ("any" in condition) {
    for (const c of condition.any) {
      const r = evaluateCondition(c, ctx);
      if (r.matched) return r;
    }
    return { matched: false, reason: null };
  }

  if ("not" in condition) {
    const r = evaluateCondition(condition.not, ctx);
    return {
      matched: !r.matched,
      reason: !r.matched ? `NON(${r.reason ?? "condition"})` : null,
    };
  }

  switch (condition.type) {
    case "always":
      return { matched: true, reason: null };

    case "regime":
      return {
        matched: ctx.regime === condition.value,
        reason: ctx.regime === condition.value ? `régime ${condition.value}` : null,
      };

    case "rsi": {
      const period = condition.period ?? 14;
      const op = condition.op ?? "lte";
      const value = rsi(ctx.closes, period);
      if (value == null) return { matched: false, reason: null };
      const ok = compare(op, value, condition.value);
      return {
        matched: ok,
        reason: ok ? `RSI(${period})=${value.toFixed(0)} ${op} ${condition.value}` : null,
      };
    }

    case "dip": {
      const last = ctx.closes[ctx.closes.length - 1];
      if (last == null || ctx.openPrice == null || ctx.openPrice <= 0) {
        return { matched: false, reason: null };
      }
      const changePct = (last / ctx.openPrice - 1) * 100;
      const ok = changePct <= -condition.drop_pct;
      return {
        matched: ok,
        reason: ok
          ? `dip: ${changePct.toFixed(1)}% vs ouverture de fenêtre`
          : null,
      };
    }

    case "new_ath": {
      const last = ctx.closes[ctx.closes.length - 1];
      if (last == null) return { matched: false, reason: null };
      const prevMax = highestValue(ctx.closes.slice(0, -1), condition.lookback_days);
      const ok = prevMax != null && last >= prevMax;
      return {
        matched: ok,
        reason: ok
          ? `ATH: nouveau plus haut sur ${condition.lookback_days} jours`
          : null,
      };
    }

    case "drawdown": {
      const last = ctx.closes[ctx.closes.length - 1];
      if (last == null) return { matched: false, reason: null };
      const lookback = condition.lookback_days ?? 365;
      const peak = highestValue(ctx.closes, lookback);
      if (peak == null || peak <= 0) return { matched: false, reason: null };
      const ddPct = (1 - last / peak) * 100;
      const op = condition.op ?? "gte";
      const ok = compare(op, ddPct, condition.value);
      return {
        matched: ok,
        reason: ok ? `drawdown: -${ddPct.toFixed(1)}% ${op} ${condition.value}%` : null,
      };
    }

    case "rise": {
      const last = ctx.closes[ctx.closes.length - 1];
      if (last == null) return { matched: false, reason: null };
      const lookback = condition.lookback_days ?? 365;
      const trough = lowestValue(ctx.closes, lookback);
      if (trough == null || trough <= 0) return { matched: false, reason: null };
      const risePct = (last / trough - 1) * 100;
      const op = condition.op ?? "gte";
      const ok = compare(op, risePct, condition.value);
      return {
        matched: ok,
        reason: ok ? `rise: +${risePct.toFixed(1)}% ${op} ${condition.value}%` : null,
      };
    }

    case "volatility": {
      const period = condition.period ?? 30;
      const vol = realizedVolPct(ctx.closes, period);
      if (vol == null) return { matched: false, reason: null };
      const op = condition.op ?? "gte";
      const ok = compare(op, vol, condition.value);
      return {
        matched: ok,
        reason: ok
          ? `volatilité: ${vol.toFixed(0)}% ann. ${op} ${condition.value}%`
          : null,
      };
    }

    case "macd": {
      const m = macd(ctx.closes);
      if (m == null) return { matched: false, reason: null };
      const op = condition.op ?? "gt";
      const threshold = condition.value ?? 0;
      const ok = compare(op, m.histogram, threshold);
      return {
        matched: ok,
        reason: ok
          ? `MACD hist=${m.histogram.toFixed(3)} ${op} ${threshold}`
          : null,
      };
    }

    case "bollinger": {
      const period = condition.period ?? 20;
      const k = condition.k ?? 2;
      const b = bollinger(ctx.closes, period, k);
      if (b == null) return { matched: false, reason: null };
      const op = condition.op ?? "lte";
      const ok = compare(op, b.pctB, condition.value);
      return {
        matched: ok,
        reason: ok ? `Bollinger %B=${b.pctB.toFixed(2)} ${op} ${condition.value}` : null,
      };
    }

    case "price_vs_sma": {
      const period = condition.period ?? 200;
      const avg = sma(ctx.closes, period);
      const last = ctx.closes[ctx.closes.length - 1];
      if (avg == null || last == null) return { matched: false, reason: null };
      const op = condition.op ?? "lt";
      const ok = compare(op, last, avg);
      return {
        matched: ok,
        reason: ok ? `prix ${op} SMA(${period})` : null,
      };
    }

    case "fear_greed": {
      const fg = ctx.fearGreed;
      if (fg == null || !Number.isFinite(fg)) return { matched: false, reason: null };
      const op = condition.op ?? "lte";
      const ok = compare(op, fg, condition.value);
      return {
        matched: ok,
        reason: ok ? `Fear&Greed=${fg} ${op} ${condition.value}` : null,
      };
    }
  }
}

/** Drawdown courant en % depuis le plus haut sur `lookback` jours (0 si indisponible). */
export function currentDrawdownPct(closes: number[], lookback = 365): number {
  const last = closes[closes.length - 1];
  if (last == null) return 0;
  const peak = highestValue(closes, lookback);
  if (peak == null || peak <= 0) return 0;
  return Math.max(0, (1 - last / peak) * 100);
}

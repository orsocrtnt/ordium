import { resolveWindows } from "./calendar.js";
import {
  type ActiveWindow,
  checkExtraBuys,
  checkTrigger,
  checkVeto,
  hasTriggerRules,
  openWindow,
  type TrancheState,
} from "./engine.js";
import {
  buildPurchaseJustification,
  buildWindowJustification,
} from "./justification.js";
import { compileStrategy } from "./rules/compile.js";
import { lintRuleDocument, type LintIssue } from "./rules/lint.js";
import type { RuleDocument } from "./rules/schema.js";
import type { Strategy } from "./schema.js";
import type {
  AmountJustification,
  AssetSeries,
  Candle,
  Purchase,
  PurchaseKind,
  Regime,
  SkippedBuy,
} from "./types.js";

export interface BacktestOptions {
  from: string;
  to: string;
  /** Frais de transaction en % (défaut 0,1 %). */
  feePct?: number;
  /**
   * Fear & Greed historique (date → 0–100), injecté par la couche data.
   * Requis pour que les conditions `fear_greed` matchent en backtest.
   */
  fearGreedByDate?: Map<string, number> | Record<string, number>;
}

export interface WindowRecord {
  key: string;
  start: string;
  end: string;
  regime: Regime;
  multiplier: number;
  plannedBudget: number;
  invested: number;
  /** Justificatif du versement de la fenêtre (base × régime). */
  justification?: AmountJustification;
}

export interface AssetResult {
  asset: string;
  quantity: number;
  invested: number;
  fees: number;
  avgCost: number | null;
  lastPrice: number;
  value: number;
  plPct: number | null;
}

/** Point de courbe portefeuille (+ détail par actif si présent). */
export interface ValueSeriesPoint {
  date: string;
  value: number;
  contributed: number;
  /** Mark-to-market et coût par actif (pour détail / graphiques). */
  assets?: Record<string, { value: number; invested: number }>;
}

export interface BacktestResult {
  strategyName: string;
  from: string;
  to: string;
  feePct: number;
  contributed: number;
  invested: number;
  fees: number;
  cash: number;
  holdingsValue: number;
  totalValue: number;
  roiPct: number;
  maxDrawdownPct: number;
  perAsset: AssetResult[];
  purchases: Purchase[];
  skipped: SkippedBuy[];
  windows: WindowRecord[];
  valueSeries: ValueSeriesPoint[];
  warnings: string[];
  /** Document de règles v1 compilé depuis la stratégie (auditabilité). */
  rules: RuleDocument;
  /** Issues du linter de cohérence. */
  lint: LintIssue[];
}

/**
 * Baseline de comparaison : même budget / cadence / allocation, zéro règle.
 * Construit un objet neuf (pas de spread) pour qu’aucun levier (régime, paliers,
 * timing, cash, fractionnement) ne fuite depuis la stratégie.
 */
export function toClassicDca(strategy: Strategy): Strategy {
  return {
    name: `${strategy.name} — DCA classique`,
    budget: { ...strategy.budget },
    window: strategy.window,
    allocation: strategy.allocation.map((a) => ({ ...a })),
    splitting: { tranches: 1, distribution: "equal" },
    timing_rules: [],
  };
}

/**
 * Calage « enveloppe fixe » : budget par période = netInvested / N fenêtres,
 * pour que le total versé du DCA simulé ≈ la somme investie réelle.
 */
export function calibrateStrategyBudget(
  strategy: Strategy,
  from: string,
  to: string,
  netInvested: number,
): { strategy: Strategy; windowCount: number; budgetAmount: number } {
  if (!(netInvested > 0) || !Number.isFinite(netInvested)) {
    return {
      strategy,
      windowCount: resolveWindows(strategy, from, to).length,
      budgetAmount: strategy.budget.amount,
    };
  }
  const windowCount = Math.max(1, resolveWindows(strategy, from, to).length);
  const budgetAmount = Math.round((netInvested / windowCount) * 100) / 100;
  return {
    strategy: {
      ...strategy,
      budget: { ...strategy.budget, amount: budgetAmount },
    },
    windowCount,
    budgetAmount,
  };
}

/**
 * Rejoue la stratégie bougie par bougie sur [from, to].
 * Anti-lookahead : le moteur ne voit que l'historique jusqu'au jour courant.
 * Hypothèse d'exécution : les achats se font au cours de clôture du jour.
 */
export function runBacktest(
  strategy: Strategy,
  series: AssetSeries[],
  opts: BacktestOptions,
): BacktestResult {
  const feePct = opts.feePct ?? 0.1;
  const warnings: string[] = [];
  const fngMap: Map<string, number> =
    opts.fearGreedByDate instanceof Map
      ? opts.fearGreedByDate
      : new Map(Object.entries(opts.fearGreedByDate ?? {}));

  const fngOn = (date: string): number | null => {
    if (fngMap.size === 0) return null;
    if (fngMap.has(date)) return fngMap.get(date)!;
    const target = Date.parse(`${date}T00:00:00Z`);
    let best: { t: number; v: number } | null = null;
    for (const [d, v] of fngMap) {
      const t = Date.parse(`${d}T00:00:00Z`);
      if (t <= target && (best == null || t > best.t)) best = { t, v };
    }
    return best?.v ?? null;
  };
  const rules = compileStrategy(strategy);
  const lint = lintRuleDocument(rules);
  for (const issue of lint) {
    if (issue.severity === "error" || issue.severity === "warning") {
      warnings.push(`[${issue.severity}] ${issue.message}`);
    }
  }

  const seriesByAsset = new Map(series.map((s) => [s.symbol, s]));
  for (const a of strategy.allocation) {
    const s = seriesByAsset.get(a.asset);
    if (!s) throw new Error(`Aucune donnée de marché fournie pour ${a.asset}.`);
    if (!s.candles.some((c) => c.date >= opts.from && c.date <= opts.to)) {
      throw new Error(`Aucune bougie pour ${a.asset} dans [${opts.from}, ${opts.to}].`);
    }
    if (s.quote !== strategy.budget.currency) {
      warnings.push(
        `${a.asset} est coté en ${s.quote} alors que le budget est en ${strategy.budget.currency} ; ` +
          `aucune conversion de change n'est appliquée (limitation v0).`,
      );
    }
  }

  // Index par actif : bougies par date dans la période, jours de cotation,
  // et historique complet (y compris avant `from`, requis par SMA200/RSI).
  const candleByDate = new Map<string, Map<string, Candle>>();
  const tradingDates = new Map<string, string[]>();
  const fullCandles = new Map<string, Candle[]>();
  const cursor = new Map<string, number>();
  const closes = new Map<string, number[]>();
  const allDatesSet = new Set<string>();

  for (const a of strategy.allocation) {
    const s = seriesByAsset.get(a.asset)!;
    const inRange = s.candles.filter((c) => c.date >= opts.from && c.date <= opts.to);
    candleByDate.set(a.asset, new Map(inRange.map((c) => [c.date, c])));
    tradingDates.set(a.asset, inRange.map((c) => c.date));
    for (const c of inRange) allDatesSet.add(c.date);
    fullCandles.set(a.asset, s.candles);
    cursor.set(a.asset, 0);
    closes.set(a.asset, []);
  }

  const heaviest = [...strategy.allocation].sort((a, b) => b.weight - a.weight)[0]!.asset;
  let referenceAsset = strategy.regime_adjustment?.reference_asset?.trim() || heaviest;
  if (!seriesByAsset.has(referenceAsset)) {
    // Alias courants (IWDA → IWDA.AS).
    const alt = [...seriesByAsset.keys()].find(
      (k) => k.toUpperCase() === referenceAsset.toUpperCase() || k.startsWith(`${referenceAsset}.`),
    );
    if (alt) referenceAsset = alt;
  }
  if (!seriesByAsset.has(referenceAsset)) {
    if (strategy.regime_adjustment?.reference_asset) {
      warnings.push(
        `Actif de référence ${strategy.regime_adjustment.reference_asset} indisponible — repli sur ${heaviest}.`,
      );
    }
    referenceAsset = heaviest;
  }

  // Référence hors allocation (ex. MSCI World) : on indexe ses cours sans l'acheter.
  if (!closes.has(referenceAsset)) {
    const s = seriesByAsset.get(referenceAsset)!;
    fullCandles.set(referenceAsset, s.candles);
    cursor.set(referenceAsset, 0);
    closes.set(referenceAsset, []);
  }

  const allDates = [...allDatesSet].sort();

  const windows = resolveWindows(strategy, opts.from, opts.to);
  let windowIdx = 0;
  let active: ActiveWindow | null = null;

  let cash = 0;
  let contributed = 0;
  const holdings = new Map<string, { qty: number; invested: number; fees: number }>();
  const lastClose = new Map<string, number>();
  const purchases: Purchase[] = [];
  const skipped: SkippedBuy[] = [];
  const windowRecords: WindowRecord[] = [];
  const valueSeries: ValueSeriesPoint[] = [];
  /** Cooldown buy_extra : persiste entre fenêtres. */
  const extraLastFired = new Map<string, string>();

  const portfolioValue = () => {
    let v = cash;
    for (const [asset, h] of holdings) v += h.qty * (lastClose.get(asset) ?? 0);
    return v;
  };

  const snapshotAssets = (): Record<string, { value: number; invested: number }> => {
    const out: Record<string, { value: number; invested: number }> = {};
    for (const { asset } of strategy.allocation) {
      const h = holdings.get(asset);
      if (!h || h.qty <= 0) continue;
      out[asset] = {
        value: h.qty * (lastClose.get(asset) ?? 0),
        invested: h.invested,
      };
    }
    return out;
  };

  const finalizeWindow = () => {
    if (!active) return;
    windowRecords.push({
      key: active.spec.key,
      start: active.spec.start,
      end: active.spec.end,
      regime: active.regime,
      multiplier: active.multiplier,
      plannedBudget: active.plannedBudget,
      invested: active.invested,
      justification: buildWindowJustification({
        baseBudget: active.baseBudget,
        multiplier: active.multiplier,
        regime: active.regime,
        windowBudget: active.plannedBudget,
        envelopeMin: active.envelopeMin,
        envelopeMax: active.envelopeMax,
      }),
    });
    active = null;
  };

  const executeBuy = (
    asset: string,
    planned: number,
    price: number,
    date: string,
    kind: PurchaseKind,
    reason: string,
    meta?: { weight: number; trancheFraction: number },
  ) => {
    if (!active) return;
    const reserve = (strategy.cash_rules?.min_cash_reserve_pct ?? 0) / 100;
    const availableCash = Math.min(cash, cash - reserve * portfolioValue());
    // Inviolable : on ne dépasse jamais le budget de la fenêtre déjà versé.
    const remainingWindow = Math.max(0, active.plannedBudget - active.invested);
    const capped = Math.min(planned, availableCash, remainingWindow);
    const clipped =
      capped < planned - 0.01 || capped < Math.min(planned, availableCash) - 0.01;
    if (price <= 0 || capped < 0.01) {
      skipped.push({
        date,
        asset,
        plannedAmount: planned,
        reason:
          price <= 0
            ? "prix invalide"
            : remainingWindow < 0.01
              ? "plafond fenêtre atteint (règle inviolable)"
              : "réserve de liquidités : achat bloqué",
        windowKey: active.spec.key,
      });
      return;
    }
    const amount = capped;
    const fee = (amount * feePct) / 100;
    const qty = (amount - fee) / price;
    cash -= amount;
    const h = holdings.get(asset) ?? { qty: 0, invested: 0, fees: 0 };
    h.qty += qty;
    h.invested += amount;
    h.fees += fee;
    holdings.set(asset, h);
    active.invested += amount;
    const weight = meta?.weight ?? 1;
    const trancheFraction = meta?.trancheFraction ?? 1;
    purchases.push({
      date,
      asset,
      quoteAmount: amount,
      fee,
      quantity: qty,
      price,
      kind,
      reason:
        clipped && remainingWindow <= amount + 0.01
          ? `${reason} (plafonné à l’enveloppe de la fenêtre)`
          : clipped
            ? `${reason} (réduit par la réserve de liquidités)`
            : reason,
      windowKey: active.spec.key,
      justification: buildPurchaseJustification({
        baseBudget: active.baseBudget,
        multiplier: active.multiplier,
        regime: active.regime,
        windowBudget: active.plannedBudget,
        envelopeMin: active.envelopeMin,
        envelopeMax: active.envelopeMax,
        assetWeight: weight,
        trancheFraction,
        kind,
        quoteAmount: amount,
        clipped,
      }),
    });
  };

  for (const date of allDates) {
    // Avance l'historique de chaque actif (allocation + éventuelle référence externe).
    const trackAssets = closes.has(referenceAsset)
      ? [...new Set([...strategy.allocation.map((a) => a.asset), referenceAsset])]
      : strategy.allocation.map((a) => a.asset);
    for (const asset of trackAssets) {
      const cs = fullCandles.get(asset)!;
      let p = cursor.get(asset)!;
      const hist = closes.get(asset)!;
      while (p < cs.length && cs[p]!.date <= date) {
        hist.push(cs[p]!.close);
        lastClose.set(asset, cs[p]!.close);
        p++;
      }
      cursor.set(asset, p);
    }

    if (active && date > active.spec.end) finalizeWindow();

    // Ouverture de fenêtre : régime → montant versé = budget de base × multiplicateur.
    while (windowIdx < windows.length && windows[windowIdx]!.start <= date) {
      const spec = windows[windowIdx]!;
      if (spec.end < date) {
        // Fenêtre sans aucun jour de cotation : on verse le budget de base (reste en cash).
        const base = strategy.budget.amount;
        cash += base;
        contributed += base;
        windowRecords.push({
          key: spec.key,
          start: spec.start,
          end: spec.end,
          regime: "neutral",
          multiplier: 1,
          plannedBudget: base,
          invested: 0,
          justification: buildWindowJustification({
            baseBudget: base,
            multiplier: 1,
            regime: "neutral",
            windowBudget: base,
            envelopeMin: base,
            envelopeMax: base,
          }),
        });
        windowIdx++;
        continue;
      }
      const datesInWindow = new Map<string, string[]>(
        strategy.allocation.map((a) => [
          a.asset,
          tradingDates.get(a.asset)!.filter((d) => d >= spec.start && d <= spec.end),
        ]),
      );
      active = openWindow(
        strategy,
        spec,
        datesInWindow,
        closes.get(referenceAsset)!,
        `${strategy.name}:${spec.key}`,
        rules,
      );
      // Versement = plan (ex. 200 × 1.15 en baissier) — pas le budget figé.
      cash += active.plannedBudget;
      contributed += active.plannedBudget;
      windowIdx++;
    }

    if (active && date >= active.spec.start && date <= active.spec.end) {
      for (const alloc of strategy.allocation) {
        const st = active.assets.get(alloc.asset)!;
        const candle = candleByDate.get(alloc.asset)!.get(date);
        if (!candle) continue;
        if (st.openPrice == null) st.openPrice = candle.open;

        const hist = closes.get(alloc.asset)!;
        const isLastTradingDay = st.tradingDates[st.tradingDates.length - 1] === date;
        const toExecute: { tranche: TrancheState; kind: PurchaseKind; reason: string }[] = [];

        if (st.pending.length > 0 && isLastTradingDay) {
          // Règle produit : le DCA est toujours honoré. Le timing optimise le
          // "quand", jamais le "si" — tout ce qui reste part avant la clôture.
          for (const tranche of st.pending) {
            const due = tranche.scheduledDate === date;
            toExecute.push({
              tranche,
              kind: due ? "scheduled" : "fallback",
              reason: due ? "achat programmé" : "fallback : fin de fenêtre",
            });
          }
        } else if (!isLastTradingDay) {
          const veto = checkVeto(strategy, hist, active.regime, st.openPrice, rules, fngOn(date));
          if (!veto) {
            if (st.pending.length > 0) {
              if (hasTriggerRules(strategy, rules)) {
                const trigger = checkTrigger(
                  strategy,
                  hist,
                  st.openPrice,
                  active.regime,
                  rules,
                  fngOn(date),
                );
                // Une tranche par jour au maximum : le déclencheur ne doit pas
                // vider tout le budget d'un coup (c'est le rôle du fractionnement).
                if (trigger) {
                  toExecute.push({
                    tranche: st.pending[0]!,
                    kind: "trigger",
                    reason: trigger,
                  });
                }
              } else {
                for (const tranche of st.pending) {
                  if (tranche.scheduledDate != null && tranche.scheduledDate <= date) {
                    toExecute.push({
                      tranche,
                      kind: "scheduled",
                      reason: "achat programmé",
                    });
                  }
                }
              }
            }

            // Achats exceptionnels : hors tranches, avec cooldown (règles 7/9).
            const extras = checkExtraBuys(
              strategy,
              hist,
              st.openPrice,
              active.regime,
              date,
              extraLastFired,
              rules,
              fngOn(date),
            );
            for (const extra of extras) {
              const amount = active.plannedBudget * alloc.weight * (extra.pctOfBudget / 100);
              if (amount > 0) {
                // Jamais de versement hors enveloppe : l’extra ne peut utiliser
                // que le cash déjà versé pour la fenêtre (pas d’apport supplémentaire).
                executeBuy(alloc.asset, amount, candle.close, date, "extra", extra.reason, {
                  weight: alloc.weight,
                  trancheFraction: extra.pctOfBudget / 100,
                });
                extraLastFired.set(extra.ruleId, date);
                active.extraLastFired.set(extra.ruleId, date);
              }
            }
          }
          // En cas de veto, les tranches dues glissent au jour suivant
          // (le fallback de fin de fenêtre reste la garantie ultime).
        }

        for (const e of toExecute) {
          executeBuy(alloc.asset, e.tranche.amount, candle.close, date, e.kind, e.reason, {
            weight: alloc.weight,
            trancheFraction: e.tranche.fraction,
          });
          st.pending = st.pending.filter((t) => t !== e.tranche);
        }
      }
    }

    valueSeries.push({
      date,
      value: portfolioValue(),
      contributed,
      assets: snapshotAssets(),
    });
  }
  finalizeWindow();

  const perAsset: AssetResult[] = strategy.allocation.map(({ asset }) => {
    const h = holdings.get(asset) ?? { qty: 0, invested: 0, fees: 0 };
    const price = lastClose.get(asset) ?? 0;
    const value = h.qty * price;
    const avgCost = h.qty > 0 ? h.invested / h.qty : null;
    return {
      asset,
      quantity: h.qty,
      invested: h.invested,
      fees: h.fees,
      avgCost,
      lastPrice: price,
      value,
      plPct: h.invested > 0 ? ((value - h.invested) / h.invested) * 100 : null,
    };
  });

  const invested = perAsset.reduce((s, a) => s + a.invested, 0);
  const fees = perAsset.reduce((s, a) => s + a.fees, 0);
  const holdingsValue = perAsset.reduce((s, a) => s + a.value, 0);
  const totalValue = cash + holdingsValue;

  let peak = -Infinity;
  let maxDrawdown = 0;
  for (const p of valueSeries) {
    peak = Math.max(peak, p.value);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - p.value) / peak);
  }

  for (const w of windowRecords) {
    const j = w.justification;
    if (!j) continue;
    const { envelopeMin, envelopeMax } = j;
    if (w.plannedBudget + 0.02 < envelopeMin || w.plannedBudget - 0.02 > envelopeMax) {
      warnings.push(
        `Enveloppe violée sur ${w.key} : versé ${w.plannedBudget} hors [${envelopeMin}, ${envelopeMax}].`,
      );
    }
  }

  return {
    strategyName: strategy.name,
    from: opts.from,
    to: opts.to,
    feePct,
    contributed,
    invested,
    fees,
    cash,
    holdingsValue,
    totalValue,
    roiPct: contributed > 0 ? ((totalValue - contributed) / contributed) * 100 : 0,
    maxDrawdownPct: maxDrawdown * 100,
    perAsset,
    purchases,
    skipped,
    windows: windowRecords,
    valueSeries,
    warnings,
    rules,
    lint,
  };
}

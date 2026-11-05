import { resolveWindows, isWeekend, nextWeekdayOnOrAfter } from "./calendar.js";
import {
  type ActiveWindow,
  type AssetWindowState,
  checkExtraBuys,
  checkTrigger,
  checkVeto,
  detectRegime,
  hasTriggerRules,
  isPerAssetRegime,
  openWindow,
  requiresSignal,
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
  /** Détail par actif (mode per_asset : régimes/multiplicateurs indépendants). */
  perAsset?: Record<
    string,
    { regime: Regime; multiplier: number; plannedBudget: number; invested: number }
  >;
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
  /** Cumul des versements (cash crédité), y compris mois sans achat. */
  contributed: number;
  /** Cumul du coût des achats (≠ contributed si cash non déployé). */
  invested: number;
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
  const needsFg = rules.rules.some(
    (r) =>
      r.enabled &&
      r.if &&
      JSON.stringify(r.if).includes('"fear_greed"'),
  );
  if (needsFg && fngMap.size === 0) {
    warnings.push(
      "[warning] Règles Fear & Greed actives mais aucune série F&G fournie : les seuils ne peuvent pas s’appliquer.",
    );
  }
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
  const perAssetRegime = isPerAssetRegime(strategy);
  let referenceAsset = strategy.regime_adjustment?.reference_asset?.trim() || heaviest;
  if (!seriesByAsset.has(referenceAsset)) {
    // Alias courants (IWDA → IWDA.AS).
    const alt = [...seriesByAsset.keys()].find(
      (k) => k.toUpperCase() === referenceAsset.toUpperCase() || k.startsWith(`${referenceAsset}.`),
    );
    if (alt) referenceAsset = alt;
  }
  if (!seriesByAsset.has(referenceAsset)) {
    if (!perAssetRegime && strategy.regime_adjustment?.reference_asset) {
      warnings.push(
        `Actif de référence ${strategy.regime_adjustment.reference_asset} indisponible — repli sur ${heaviest}.`,
      );
    }
    referenceAsset = heaviest;
  }

  // Référence hors allocation (ex. MSCI World) : on indexe ses cours sans l'acheter.
  if (!perAssetRegime && !closes.has(referenceAsset)) {
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

  const executeBuy = (
    asset: string,
    planned: number,
    price: number,
    date: string,
    kind: PurchaseKind,
    reason: string,
    meta?: { weight: number; trancheFraction: number; multiplier?: number; regime?: Regime; sleeveBudget?: number },
  ) => {
    if (!active) return;
    const st = active.assets.get(asset);
    const reserve = (strategy.cash_rules?.min_cash_reserve_pct ?? 0) / 100;
    const availableCash = Math.min(cash, cash - reserve * portfolioValue());
    // Plafond par actif (cash sleeve) + plafond fenêtre total.
    const remainingAsset = Math.max(0, (st?.plannedBudget ?? 0) - (st?.invested ?? 0));
    const remainingWindow = Math.max(0, active.plannedBudget - active.invested);
    const remaining = Math.min(remainingAsset, remainingWindow);
    const capped = Math.min(planned, availableCash, remaining);
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
            : remaining < 0.01
              ? "plafond actif/fenêtre atteint (règle inviolable)"
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
    if (st) st.invested += amount;
    const weight = meta?.weight ?? 1;
    const trancheFraction = meta?.trancheFraction ?? 1;
    const assetRegime = meta?.regime ?? st?.regime ?? active.regime;
    const assetMult = meta?.multiplier ?? st?.multiplier ?? active.multiplier;
    const assetBudget = meta?.sleeveBudget ?? st?.regimeBudget ?? st?.plannedBudget ?? active.plannedBudget;
    purchases.push({
      date,
      asset,
      quoteAmount: amount,
      fee,
      quantity: qty,
      price,
      kind,
      reason:
        clipped && remaining <= amount + 0.01
          ? `${reason} (plafonné à l’enveloppe de la fenêtre)`
          : clipped
            ? `${reason} (réduit par la réserve de liquidités)`
            : reason,
      windowKey: active.spec.key,
      justification: buildPurchaseJustification({
        baseBudget: active.baseBudget,
        multiplier: assetMult,
        regime: assetRegime,
        windowBudget: assetBudget,
        envelopeMin: active.envelopeMin,
        envelopeMax: active.envelopeMax,
        assetWeight: weight,
        trancheFraction,
        kind,
        quoteAmount: amount,
        clipped,
        perAssetSleeve: perAssetRegime,
      }),
    });
  };

  /**
   * Achète tout le pending restant d’un actif (fin de fenêtre / réouverture).
   */
  const executePendingFallback = (
    asset: string,
    st: AssetWindowState,
    date: string,
    price: number,
    reason: string,
  ) => {
    // Mode « uniquement si signal » : ne pas forcer un achat sans déclencheur.
    if (requiresSignal(strategy, rules) && st.invested <= 0.01) {
      st.pending = [];
      return;
    }
    const neutralMult = strategy.regime_adjustment?.neutral?.budget_multiplier ?? 1;
    const forceNeutral =
      Boolean(strategy.regime_adjustment) &&
      (strategy.regime_adjustment?.fallback_budget ?? "neutral") === "neutral";
    const remaining = [...st.pending];
    for (const tranche of remaining) {
      const buyMult = forceNeutral ? neutralMult : st.multiplier;
      const buyRegime: Regime = forceNeutral ? "neutral" : st.regime;
      const sleeveBudget = forceNeutral ? st.fallbackBudget : st.regimeBudget;
      const amount = sleeveBudget * tranche.fraction;
      executeBuy(asset, amount, price, date, "fallback", reason, {
        weight: st.weight,
        trancheFraction: tranche.fraction,
        multiplier: buyMult,
        regime: buyRegime,
        sleeveBudget,
      });
      st.pending = st.pending.filter((t) => t !== tranche);
    }
  };

  /**
   * Après la fin calendaire de la fenêtre : si le marché était fermé, le
   * versement part au premier jour de réouverture (cours du jour).
   */
  const canSettleReopen = (date: string): boolean => {
    if (!active || date <= active.spec.end) return false;
    if (isWeekend(active.spec.end)) {
      return date >= nextWeekdayOnOrAfter(active.spec.end);
    }
    return true;
  };

  /** Prix utilisable pour un achat à date (bougie du jour ou dernier close connu). */
  const priceForBuy = (asset: string, date: string): number => {
    const candle = candleByDate.get(asset)?.get(date);
    if (candle && candle.close > 0) return candle.close;
    const last = lastClose.get(asset) ?? 0;
    if (last > 0) return last;
    const cs = fullCandles.get(asset) ?? [];
    for (let i = cs.length - 1; i >= 0; i--) {
      const c = cs[i]!;
      if (c.date <= date && c.close > 0) return c.close;
    }
    return 0;
  };

  const settleReopenBuys = (date: string) => {
    if (!canSettleReopen(date)) return;
    for (const alloc of strategy.allocation) {
      const st = active!.assets.get(alloc.asset);
      if (!st || st.pending.length === 0) continue;
      const price = priceForBuy(alloc.asset, date);
      if (price <= 0) continue;
      const candle = candleByDate.get(alloc.asset)?.get(date);
      if (candle && st.openPrice == null) st.openPrice = candle.open;
      executePendingFallback(
        alloc.asset,
        st,
        date,
        price,
        "fallback : premier jour de réouverture",
      );
    }
  };

  const hasPendingBuys = () =>
    Boolean(active && [...active.assets.values()].some((st) => st.pending.length > 0));

  /**
   * Dernier recours (fin de backtest / fenêtre suivante) : cours déjà connus.
   */
  const flushPendingLastResort = (asOfDate: string) => {
    if (!active) return;
    const execDate = isWeekend(active.spec.end)
      ? nextWeekdayOnOrAfter(active.spec.end)
      : asOfDate;
    for (const alloc of strategy.allocation) {
      const st = active.assets.get(alloc.asset);
      if (!st || st.pending.length === 0) continue;

      const price = priceForBuy(alloc.asset, execDate);
      if (price <= 0) {
        for (const tranche of st.pending) {
          skipped.push({
            date: execDate,
            asset: alloc.asset,
            plannedAmount: tranche.amount,
            reason: "fallback fin de fenêtre : pas de cours disponible",
            windowKey: active.spec.key,
          });
        }
        st.pending = [];
        continue;
      }
      executePendingFallback(
        alloc.asset,
        st,
        execDate,
        price,
        isWeekend(active.spec.end)
          ? "fallback : premier jour de réouverture"
          : "fallback : fin de fenêtre",
      );
    }
  };

  const recordWindow = () => {
    if (!active) return;
    const perAssetDetail: NonNullable<WindowRecord["perAsset"]> = {};
    for (const [asset, st] of active.assets) {
      perAssetDetail[asset] = {
        regime: st.regime,
        multiplier: st.multiplier,
        plannedBudget: st.plannedBudget,
        invested: st.invested,
      };
    }
    windowRecords.push({
      key: active.spec.key,
      start: active.spec.start,
      end: active.spec.end,
      regime: active.regime,
      multiplier: active.multiplier,
      plannedBudget: active.plannedBudget,
      invested: active.invested,
      perAsset: perAssetDetail,
      justification: buildWindowJustification({
        baseBudget: active.baseBudget,
        multiplier: active.multiplier,
        regime: active.regime,
        windowBudget: active.invested > 0.01 ? active.invested : active.plannedBudget,
        envelopeMin: active.envelopeMin,
        envelopeMax: active.envelopeMax,
        perAsset: perAssetDetail,
      }),
    });
    active = null;
  };

  /** Clôture forcée : réouverture impossible (fin de simu / fenêtre suivante). */
  const forceFinalizeWindow = () => {
    if (!active) return;
    flushPendingLastResort(active.spec.end);
    recordWindow();
  };

  for (const date of allDates) {
    // Avance l'historique de chaque actif (allocation + éventuelle référence externe).
    const trackAssets =
      !perAssetRegime && closes.has(referenceAsset)
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

    // Fin calendaire dépassée : verser au 1er jour de réouverture, puis clôturer.
    if (active && canSettleReopen(date)) {
      settleReopenBuys(date);
      if (!hasPendingBuys()) recordWindow();
    }

    // Ouverture de fenêtre : régime → montant versé = budget de base × multiplicateur.
    while (windowIdx < windows.length && windows[windowIdx]!.start <= date) {
      const spec = windows[windowIdx]!;
      // Une seule fenêtre active à la fois : soldater l’éventuel pending en retard.
      if (active) forceFinalizeWindow();

      const datesInWindow = new Map<string, string[]>(
        strategy.allocation.map((a) => [
          a.asset,
          tradingDates.get(a.asset)!.filter((d) => d >= spec.start && d <= spec.end && !isWeekend(d)),
        ]),
      );
      active = openWindow(
        strategy,
        spec,
        datesInWindow,
        closes.get(referenceAsset) ?? closes.get(heaviest) ?? [],
        `${strategy.name}:${spec.key}`,
        rules,
        closes,
        fngOn(spec.start),
      );
      // Versement = plan (ex. 200 × 1.15 en baissier) — pas le budget figé.
      cash += active.plannedBudget;
      contributed += active.plannedBudget;
      windowIdx++;

      // Fenêtre déjà dépassée (ex. 1er = dimanche, 1ʳᵉ cotation = lundi) :
      // acheter TOUT immédiatement à la réouverture — ne jamais laisser en cash fantôme.
      if (spec.end < date) {
        flushPendingLastResort(date);
        recordWindow();
      }
    }

    if (active && date >= active.spec.start && date <= active.spec.end) {
      // Aucun achat un samedi/dimanche — reports au prochain jour ouvré.
      if (!isWeekend(date)) {
      for (const alloc of strategy.allocation) {
        const st = active.assets.get(alloc.asset)!;
        const candle = candleByDate.get(alloc.asset)!.get(date);
        if (!candle) continue;
        if (st.openPrice == null) st.openPrice = candle.open;

        const hist = closes.get(alloc.asset)!;
        const isLastTradingDay = st.tradingDates[st.tradingDates.length - 1] === date;
        const toExecute: { tranche: TrancheState; kind: PurchaseKind; reason: string }[] = [];
        const exclusive = requiresSignal(strategy, rules);
        const hasTriggers = hasTriggerRules(strategy, rules);
        const veto = checkVeto(strategy, hist, st.regime, st.openPrice, rules, fngOn(date));

        // Triggers : TOUS les jours de la fenêtre, y compris le dernier.
        // (Avant : le dernier jour sautait checkTrigger → fenêtre 1 jour + require_signal = 0 achat.)
        if (!veto && st.pending.length > 0 && hasTriggers) {
          const trigger = checkTrigger(
            strategy,
            hist,
            st.openPrice,
            st.regime,
            rules,
            fngOn(date),
          );
          if (trigger) {
            toExecute.push({
              tranche: st.pending[0]!,
              kind: "trigger",
              reason: trigger,
            });
          }
        }

        if (!veto && st.pending.length > 0 && !hasTriggers && !isLastTradingDay) {
          for (const tranche of st.pending) {
            if (tranche.scheduledDate != null && tranche.scheduledDate <= date) {
              // Évite de doubler si déjà pris par un trigger le même jour.
              if (toExecute.some((e) => e.tranche === tranche)) continue;
              toExecute.push({
                tranche,
                kind: "scheduled",
                reason: "achat programmé",
              });
            }
          }
        }

        // Fin de fenêtre : rattrapage DCA sauf require_signal sans aucun achat signal.
        if (st.pending.length > 0 && isLastTradingDay) {
          const triggerBuyingToday = toExecute.some((e) => e.kind === "trigger");
          if (!exclusive || st.invested > 0.01 || triggerBuyingToday) {
            for (const tranche of st.pending) {
              if (toExecute.some((e) => e.tranche === tranche)) continue;
              const due = tranche.scheduledDate === date;
              toExecute.push({
                tranche,
                kind: due ? "scheduled" : "fallback",
                reason: due ? "achat programmé" : "fallback : fin de fenêtre",
              });
            }
          }
        }

        if (!veto) {
          // Achats exceptionnels : hors tranches, avec cooldown (tous jours de fenêtre).
          const extras = checkExtraBuys(
            strategy,
            hist,
            st.openPrice,
            st.regime,
            date,
            extraLastFired,
            rules,
            fngOn(date),
          );
          for (const extra of extras) {
            let extraMult = st.multiplier;
            let extraRegime = st.regime;
            let extraSleeve = st.regimeBudget;
            if (perAssetRegime && strategy.regime_adjustment) {
              const live = detectRegime(strategy, hist, rules, fngOn(date));
              extraMult = live.multiplier;
              extraRegime = live.regime;
              extraSleeve = Math.round(active.baseBudget * st.weight * extraMult * 100) / 100;
            }
            const amount = extraSleeve * (extra.pctOfBudget / 100);
            if (amount > 0) {
              executeBuy(alloc.asset, amount, candle.close, date, "extra", extra.reason, {
                weight: st.weight,
                trancheFraction: extra.pctOfBudget / 100,
                multiplier: extraMult,
                regime: extraRegime,
                sleeveBudget: extraSleeve,
              });
              extraLastFired.set(extra.ruleId, date);
              active.extraLastFired.set(extra.ruleId, date);
            }
          }
        }
        // En cas de veto, les tranches dues glissent au jour suivant
        // (le fallback de fin de fenêtre reste la garantie ultime hors require_signal).

        const neutralMult = strategy.regime_adjustment?.neutral?.budget_multiplier ?? 1;
        const fallbackUsesNeutral =
          hasTriggerRules(strategy, rules) &&
          Boolean(strategy.regime_adjustment) &&
          (strategy.regime_adjustment?.fallback_budget ?? "neutral") === "neutral";

        for (const e of toExecute) {
          const isFallback = e.kind === "fallback";
          let buyMult = st.multiplier;
          let buyRegime: Regime = st.regime;
          let sleeveBudget = st.regimeBudget;

          if (isFallback && fallbackUsesNeutral) {
            buyMult = neutralMult;
            buyRegime = "neutral";
            sleeveBudget = st.fallbackBudget;
          } else if (perAssetRegime && strategy.regime_adjustment) {
            // Régime live de CET actif (sa courbe), pas le gel d’ouverture ni une ref partagée.
            const live = detectRegime(strategy, hist, rules, fngOn(date));
            buyMult = live.multiplier;
            buyRegime = live.regime;
            sleeveBudget = Math.round(active.baseBudget * st.weight * buyMult * 100) / 100;
            st.regime = live.regime;
            st.multiplier = live.multiplier;
            st.regimeBudget = sleeveBudget;
          }

          const amount =
            isFallback && fallbackUsesNeutral
              ? st.fallbackBudget * e.tranche.fraction
              : perAssetRegime && strategy.regime_adjustment
                ? sleeveBudget * e.tranche.fraction
                : e.tranche.amount;

          executeBuy(alloc.asset, amount, candle.close, date, e.kind, e.reason, {
            weight: st.weight,
            trancheFraction: e.tranche.fraction,
            multiplier: buyMult,
            regime: buyRegime,
            sleeveBudget,
          });
          st.pending = st.pending.filter((t) => t !== e.tranche);
        }
      }
      }
    }

    const investedSoFar = [...holdings.values()].reduce((s, h) => s + h.invested, 0);
    valueSeries.push({
      date,
      value: portfolioValue(),
      contributed,
      invested: investedSoFar,
      assets: snapshotAssets(),
    });
  }
  forceFinalizeWindow();

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

  if (requiresSignal(strategy, rules) && contributed > 0 && invested < 0.01) {
    const skippedWindows = windowRecords.filter((w) => w.invested < 0.01).length;
    warnings.push(
      `[warning] Aucun achat : stratégie « uniquement si signal » — ${skippedWindows} fenêtre(s) sans déclencheur (versé ${Math.round(contributed)} resté en cash). Vérifie les seuils (Fear & Greed, RSI…) et la fenêtre d’achat.`,
    );
  } else if (contributed > 0 && invested < 0.01) {
    warnings.push(
      `[warning] Versé ${Math.round(contributed)} mais 0 investi — cash non déployé. Vérifie données de marché / règles.`,
    );
  } else if (contributed > 0 && cash > contributed * 0.5 && requiresSignal(strategy, rules)) {
    warnings.push(
      `[info] ${Math.round(cash)} en cash (${Math.round((cash / contributed) * 100)} % du versé) : mois sans signal non investis (comportement attendu avec « uniquement si signal »).`,
    );
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

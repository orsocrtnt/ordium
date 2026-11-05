"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { BacktestResult, Purchase } from "@ordium/engine";
import type { RealPortfolioSeries, Transaction } from "@ordium/portfolio";
import type { PositionValuation } from "@ordium/portfolio";
import { assetLabel } from "@/lib/assets";
import { fmtMoney, fmtMonth, fmtPct } from "@/lib/format";
import { ScenarioDetail, type ScenarioId } from "./ScenarioDetail";

const MONTH_LABEL_FR = new Intl.DateTimeFormat("fr-FR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function monthKey(date: string): string {
  return date.slice(0, 7); // YYYY-MM
}

function formatMonthTitle(yyyyMm: string): string {
  const label = MONTH_LABEL_FR.format(new Date(`${yyyyMm}-01T00:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

type MonthBucket<T> = {
  key: string;
  title: string;
  items: T[];
  total: number;
};

function groupByMonth<T>(
  items: T[],
  getDate: (item: T) => string,
  getAmount: (item: T) => number,
): MonthBucket<T>[] {
  const map = new Map<string, MonthBucket<T>>();
  for (const item of items) {
    const key = monthKey(getDate(item));
    if (!key) continue;
    let bucket = map.get(key);
    if (!bucket) {
      bucket = { key, title: formatMonthTitle(key), items: [], total: 0 };
      map.set(key, bucket);
    }
    bucket.items.push(item);
    bucket.total += getAmount(item);
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? 1 : -1));
}

function MonthBlocks<T>({
  buckets,
  currency,
  empty,
  renderDetail,
  badge = "versement",
  totalLabel,
}: {
  buckets: MonthBucket<T>[];
  currency: string;
  empty: ReactNode;
  renderDetail: (items: T[]) => ReactNode;
  badge?: string;
  /** Si fourni, affiche le cumul des totaux (doit = Total versé stratégie). */
  totalLabel?: string;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  if (buckets.length === 0) return <>{empty}</>;

  const sum = buckets.reduce((s, b) => s + b.total, 0);

  return (
    <div className="max-h-80 space-y-1.5 overflow-y-auto">
      {totalLabel != null && (
        <div className="flex items-center justify-between gap-3 px-1 pb-1 text-[11px] text-[var(--muted)]">
          <span>{totalLabel}</span>
          <span className="font-medium tabular-nums text-[var(--text)]">
            {fmtMoney(sum, currency, 2)}
          </span>
        </div>
      )}
      {buckets.map((b) => {
        const open = openKey === b.key;
        return (
          <div
            key={b.key}
            className="overflow-hidden rounded-xl border border-[var(--border)]"
          >
            <button
              type="button"
              onClick={() => setOpenKey(open ? null : b.key)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-[var(--bg-elevated)]"
              aria-expanded={open}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={`text-[10px] text-[var(--muted)] transition-transform ${
                    open ? "rotate-90" : ""
                  }`}
                >
                  ›
                </span>
                <span className="truncate text-sm font-medium text-[var(--text)]">
                  {b.title}
                </span>
                <span className="shrink-0 text-[11px] text-[var(--muted)]">{badge}</span>
              </span>
              <span className="shrink-0 text-xs font-medium tabular-nums text-[var(--text)]">
                {fmtMoney(b.total, currency, 2)}
              </span>
            </button>
            {open && (
              <div className="border-t border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1">
                {renderDetail(b.items)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export type SimulationSummary = {
  from: string;
  to: string;
  budgetAmount: number;
  currency: string;
  period: "weekly" | "monthly";
  windowFrom?: number;
  windowTo?: number;
  assets: string[];
  horizonLabel?: string | null;
};

type DetailTab = ScenarioId;

interface ResultsProps {
  result: BacktestResult;
  baseline: BacktestResult;
  real?: RealPortfolioSeries | null;
  realError?: string | null;
  currency: string;
  assetNames?: Map<string, string>;
  /** Positions actuelles (référence situation réelle). */
  positions?: PositionValuation[];
  /** Transactions réelles pour le détail des versements. */
  transactions?: Transaction[];
  importedSnapshot?: {
    name: string;
    totalValue: number;
    netInvested: number | null;
    plPct: number | null;
  } | null;
  simulationSummary?: SimulationSummary | null;
  onEditSettings?: () => void;
  onBackToChat?: () => void;
  /** Stratégie déjà marquée active (pastille verte). */
  strategyEnabled?: boolean;
  /** Activer / désactiver depuis la simulation (après analyse). */
  onToggleActivate?: () => void;
  /** Statut paper auto après activation. */
  paperStatus?: {
    broker: string;
    nextRunAt: string | null;
    lastError?: string;
  } | null;
  activateMessage?: string | null;
}

const KIND_LABEL: Record<string, string> = {
  trigger: "Déclencheur",
  scheduled: "Programmé",
  fallback: "Fin de fenêtre",
  extra: "Achat exceptionnel",
};

const REGIME_FR: Record<string, string> = {
  bull: "haussier",
  bear: "baissier",
  neutral: "neutre",
};

/** Texte clair : pourquoi cet achat a eu lieu. */
function humanizePurchaseTrigger(kind: string, reason: string | undefined): string {
  const r = (reason ?? "").trim();
  if (kind === "fallback") {
    if (/réouverture/i.test(r)) {
      return "Marché fermé en fin de fenêtre → versement au premier jour de réouverture";
    }
    return "Aucun signal pendant la fenêtre → achat de fin de période (budget neutre si activé)";
  }
  if (kind === "scheduled") {
    return r && r !== "achat programmé" ? r : "Achat programmé dans la fenêtre";
  }
  if (kind === "extra") {
    return r ? `Achat exceptionnel : ${r}` : "Achat exceptionnel";
  }
  // trigger
  if (!r) return "Signal de timing atteint";
  if (/^fallback/i.test(r)) return "Fin de fenêtre";
  if (/rsi/i.test(r)) return r.replace(/^veto:\s*/i, "");
  if (/^dip:/i.test(r)) return r.replace(/^dip:\s*/i, "Baisse : ");
  if (/macd/i.test(r)) return r;
  if (/bollinger|%B/i.test(r)) return r;
  if (/fear|greed/i.test(r)) return r;
  if (/sma/i.test(r)) return r;
  if (/ath|sommet/i.test(r)) return r;
  return r;
}

function formatWindowTitle(key: string, start: string): string {
  if (key.startsWith("M-") && key.length >= 8) {
    // clé moteur : M-YYYY-MM
    return formatMonthTitle(key.slice(2));
  }
  if (key.startsWith("W-") || key.startsWith("S-")) {
    return `Semaine du ${start}`;
  }
  return start || key;
}

function groupPurchasesByWindow(purchases: Purchase[]): MonthBucket<Purchase>[] {
  const map = new Map<string, MonthBucket<Purchase>>();
  const sorted = [...purchases].sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const p of sorted) {
    const key = p.windowKey || monthKey(p.date);
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        key,
        title: formatWindowTitle(key, p.date),
        items: [],
        total: 0,
      };
      map.set(key, bucket);
    }
    bucket.items.push(p);
    bucket.total += p.quoteAmount;
  }
  return [...map.values()].sort((a, b) => {
    const da = a.items[0]?.date ?? a.key;
    const db = b.items[0]?.date ?? b.key;
    return da < db ? 1 : -1;
  });
}

function ColumnCard({
  title,
  accent,
  invested,
  deployed,
  perf,
  finalValue,
  currency,
  note,
  selected,
  onSelect,
}: {
  title: string;
  accent: string;
  /** Total versé (contributions). */
  invested: number | null;
  /** Montant réellement acheté (si ≠ versé, ex. require_signal). */
  deployed?: number | null;
  perf: number | null;
  finalValue: number | null;
  currency: string;
  note?: string;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const className = `flex flex-col rounded-2xl border p-4 text-left transition ${
    selected
      ? "border-[var(--text)] bg-[var(--bg-card)] ring-1 ring-[var(--text)]/20"
      : "border-[var(--border)] bg-[var(--bg-card)]"
  } ${onSelect ? "cursor-pointer hover:border-[var(--text)]/40" : ""}`;

  const plusValue =
    invested != null && finalValue != null ? finalValue - invested : null;
  const showDeployed =
    deployed != null &&
    invested != null &&
    Math.abs(deployed - invested) > 0.5;

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${accent}`} />
          <h3 className="text-sm font-semibold text-[var(--text)]">{title}</h3>
        </div>
        {onSelect && (
          <span className="text-[10px] text-[var(--muted)]">
            {selected ? "ouvert" : "détail →"}
          </span>
        )}
      </div>
      {note && <p className="mt-1 text-[11px] leading-snug text-[var(--muted)]">{note}</p>}
      <dl className="mt-4 space-y-3">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-[var(--muted)]">
            Total versé
          </dt>
          <dd className="mt-0.5 text-lg font-semibold text-[var(--text)]">
            {invested != null ? fmtMoney(invested, currency) : "—"}
          </dd>
          {showDeployed && (
            <dd className="mt-0.5 text-[11px] text-[var(--muted)]">
              dont investi (achats) {fmtMoney(deployed!, currency, 0)}
            </dd>
          )}
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-[var(--muted)]">
            Valeur finale
          </dt>
          <dd className="mt-0.5 text-lg font-semibold text-[var(--text)]">
            {finalValue != null ? fmtMoney(finalValue, currency) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-[var(--muted)]">
            Plus-value
          </dt>
          <dd
            className={`mt-0.5 text-lg font-semibold ${
              plusValue == null
                ? "text-[var(--text)]"
                : plusValue >= 0
                  ? "text-emerald-700"
                  : "text-amber-800"
            }`}
          >
            {plusValue != null
              ? `${plusValue > 0 ? "+" : ""}${fmtMoney(plusValue, currency)}`
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Perf.</dt>
          <dd
            className={`mt-0.5 text-lg font-semibold ${
              perf == null
                ? "text-[var(--text)]"
                : perf >= 0
                  ? "text-emerald-700"
                  : "text-amber-800"
            }`}
          >
            {perf != null ? fmtPct(perf) : "—"}
          </dd>
        </div>
      </dl>
    </>
  );

  if (onSelect) {
    return (
      <button type="button" onClick={onSelect} className={className}>
        {body}
      </button>
    );
  }
  return <div className={className}>{body}</div>;
}

type WindowBucketItem = {
  kind: "purchase" | "cash";
  purchase?: Purchase;
  note?: string;
};

function PurchaseRows({
  purchases,
  currency,
  assetNames,
  windows,
}: {
  purchases: Purchase[];
  currency: string;
  assetNames?: Map<string, string>;
  windows?: BacktestResult["windows"];
}) {
  const purchasesByWindow = useMemo(() => {
    const m = new Map<string, Purchase[]>();
    for (const p of purchases) {
      const key = p.windowKey || monthKey(p.date);
      const list = m.get(key) ?? [];
      list.push(p);
      m.set(key, list);
    }
    for (const list of m.values()) {
      list.sort((a, b) => (a.date < b.date ? 1 : -1));
    }
    return m;
  }, [purchases]);

  /** Une ligne par fenêtre de la strat : total = versé (plannedBudget), pas seulement les achats. */
  const displayBuckets = useMemo((): MonthBucket<WindowBucketItem>[] => {
    const list = windows ?? [];
    if (list.length === 0) {
      // Fallback legacy : somme des achats seulement.
      return groupPurchasesByWindow(purchases).map((b) => ({
        key: b.key,
        title: b.title,
        total: b.total,
        items: b.items.map((p) => ({ kind: "purchase" as const, purchase: p })),
      }));
    }
    return [...list]
      .sort((a, b) => (a.start < b.start ? 1 : -1))
      .map((w) => {
        const buys = purchasesByWindow.get(w.key) ?? [];
        const items: WindowBucketItem[] =
          buys.length > 0
            ? buys.map((p) => ({ kind: "purchase", purchase: p }))
            : [
                {
                  kind: "cash",
                  note:
                    w.invested < 0.01
                      ? "Aucun achat — versement resté en cash (pas de signal / veto)."
                      : "Versement sans détail d’achat.",
                },
              ];
        return {
          key: w.key,
          title: formatWindowTitle(w.key, w.start),
          total: w.plannedBudget,
          items,
        };
      });
  }, [windows, purchases, purchasesByWindow]);

  return (
    <MonthBlocks
      buckets={displayBuckets}
      currency={currency}
      badge="versé"
      totalLabel="Somme des versements (stratégie)"
      empty={<p className="text-xs text-[var(--muted)]">Aucun versement sur la période.</p>}
      renderDetail={(items) => {
        const buys = items.filter((i) => i.kind === "purchase" && i.purchase);
        if (buys.length === 0) {
          return (
            <p className="px-1 py-2 text-[11px] leading-snug text-[var(--muted)]">
              {items[0]?.note ?? "Aucun achat sur cette fenêtre."}
            </p>
          );
        }
        return (
          <table className="w-full text-left text-xs">
            <thead className="text-[var(--muted)]">
              <tr>
                <th className="py-1.5 pr-2 font-normal">Motif</th>
                <th className="py-1.5 pr-2 font-normal">Part</th>
                <th className="py-1.5 pr-2 font-normal">Actif</th>
                <th className="py-1.5 font-normal">Date</th>
              </tr>
            </thead>
            <tbody>
              {buys.map((item, i) => {
                const p = item.purchase!;
                const triggerText = humanizePurchaseTrigger(p.kind, p.reason);
                const j = p.justification;
                const regimeFr = j ? REGIME_FR[j.regime] ?? j.regime : null;
                const isTriggered = p.kind === "trigger" || p.kind === "extra";
                return (
                  <tr key={`${p.date}-${p.asset}-${i}`} className="border-t border-[var(--border)]">
                    <td className="py-1.5 pr-2 align-top">
                      <div className="space-y-0.5">
                        <div>
                          <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text)]">
                            {KIND_LABEL[p.kind] ?? p.kind}
                          </span>
                          {isTriggered && (
                            <span className="ml-1.5 text-[var(--text)]">{triggerText}</span>
                          )}
                        </div>
                        {!isTriggered && (
                          <div className="text-[10px] leading-snug text-[var(--muted)]">
                            {triggerText}
                          </div>
                        )}
                        {j && (
                          <div className="text-[10px] leading-snug text-[var(--muted)]">
                            {j.summary}
                            {j.assetWeight != null && (
                              <>
                                {" "}
                                ·{" "}
                                {(j.assetWeight * 100).toLocaleString("fr-FR", {
                                  maximumFractionDigits: 2,
                                })}
                                % · {regimeFr} ×{j.multiplier}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-1.5 pr-2 whitespace-nowrap align-top text-[var(--text)]">
                      {fmtMoney(p.quoteAmount, currency, 2)}
                    </td>
                    <td className="py-1.5 pr-2 align-top text-[var(--text)]">
                      {assetLabel(p.asset, assetNames)}
                    </td>
                    <td className="py-1.5 whitespace-nowrap align-top text-[var(--text)]">
                      {p.date}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        );
      }}
    />
  );
}

function RealBuyRows({
  buys,
  currency,
  assetNames,
}: {
  buys: Transaction[];
  currency: string;
  assetNames?: Map<string, string>;
}) {
  const buckets = useMemo(
    () =>
      groupByMonth(
        buys,
        (t) => t.date,
        (t) => t.amount ?? t.quantity * (t.price ?? 0),
      ),
    [buys],
  );

  return (
    <MonthBlocks
      buckets={buckets}
      currency={currency}
      empty={<p className="text-xs text-[var(--muted)]">Aucun achat dans l’historique.</p>}
      renderDetail={(items) => (
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--muted)]">
            <tr>
              <th className="py-1.5 pr-2 font-normal">Moment</th>
              <th className="py-1.5 pr-2 font-normal">Montant</th>
              <th className="py-1.5 pr-2 font-normal">Actif</th>
              <th className="py-1.5 font-normal">Type</th>
            </tr>
          </thead>
          <tbody>
            {items.map((t, i) => (
              <tr
                key={`${t.date}-${t.asset}-${i}`}
                className="border-t border-[var(--border)]"
              >
                <td className="py-1.5 pr-2 whitespace-nowrap">{t.date}</td>
                <td className="py-1.5 pr-2 whitespace-nowrap">
                  {t.amount != null || t.price != null
                    ? fmtMoney(t.amount ?? t.quantity * (t.price ?? 0), currency, 2)
                    : "—"}
                </td>
                <td className="py-1.5 pr-2">{assetLabel(t.asset, assetNames)}</td>
                <td className="py-1.5 text-[var(--muted)]">Achat réel</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    />
  );
}

export function Results({
  result,
  baseline,
  real,
  realError,
  currency,
  assetNames,
  positions = [],
  transactions = [],
  importedSnapshot,
  simulationSummary,
  onEditSettings,
  onBackToChat,
  strategyEnabled = false,
  onToggleActivate,
  paperStatus = null,
  activateMessage = null,
}: ResultsProps) {
  const [tab, setTab] = useState<DetailTab>("strat");

  const actuelInvested =
    importedSnapshot?.netInvested ??
    (positions.length > 0
      ? positions.reduce((s, p) => s + (p.invested ?? 0), 0) || null
      : null);
  const actuelValue = importedSnapshot?.totalValue ?? real?.finalValue ?? null;
  const actuelPerf =
    importedSnapshot?.plPct ??
    real?.roiPct ??
    (actuelInvested != null && actuelInvested > 0 && actuelValue != null
      ? ((actuelValue - actuelInvested) / actuelInvested) * 100
      : null);

  const chartData = useMemo(() => {
    const byDate = new Map<
      string,
      {
        date: string;
        strategy?: number;
        classic?: number;
        actuel?: number;
        contributed?: number;
        actuelDot?: number;
      }
    >();
    // Cumul versé = uniquement la stratégie (jamais le DCA / portefeuille).
    for (const p of result.valueSeries) {
      byDate.set(p.date, {
        date: p.date,
        strategy: p.value,
        contributed: p.contributed,
      });
    }
    for (const p of baseline.valueSeries) {
      const row = byDate.get(p.date) ?? { date: p.date };
      row.classic = p.value;
      byDate.set(p.date, row);
    }
    if (real?.points?.length) {
      for (const p of real.points) {
        const row = byDate.get(p.date) ?? { date: p.date };
        row.actuel = p.value;
        byDate.set(p.date, row);
      }
    } else if (actuelValue != null && simulationSummary) {
      // Positions seules : marqueur final (pas d’historique jour par jour).
      const end = simulationSummary.to;
      const row = byDate.get(end) ?? { date: end };
      row.actuel = actuelValue;
      byDate.set(end, row);
    }
    const rows = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    // Forward-fill du cumul versé stratégie (trous après slim / jours sans cotation).
    let lastContrib: number | undefined;
    for (const row of rows) {
      if (row.contributed != null) lastContrib = row.contributed;
      else if (lastContrib != null) row.contributed = lastContrib;
    }
    // Ancre finale = Total versé de la carte « Ta stratégie ».
    if (rows.length > 0) {
      rows[rows.length - 1]!.contributed = result.contributed;
    }
    const step = Math.max(1, Math.floor(rows.length / 700));
    const slim = rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
    // Point rouge = dernière valeur « situation actuelle » connue.
    for (let i = slim.length - 1; i >= 0; i--) {
      const row = slim[i]!;
      if (row.actuel != null) {
        row.actuelDot = row.actuel;
        break;
      }
    }
    return slim;
  }, [result, baseline, real, actuelValue, simulationSummary]);

  const buyTxs = useMemo(
    () =>
      [...transactions]
        .filter((t) => t.side === "buy")
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [transactions],
  );

  const periodWord = simulationSummary?.period === "weekly" ? "semaine" : "mois";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-[var(--text)]">
            Comparaison
          </h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Situation actuelle, DCA classique et stratégie sur un même écran.
          </p>
        </div>
        {onToggleActivate && (
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              onClick={onToggleActivate}
              className={
                strategyEnabled
                  ? "rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-xs font-medium text-[var(--text)] hover:bg-[var(--bg-elevated)]"
                  : "rounded-xl bg-[var(--text)] px-3 py-2 text-xs font-medium text-white hover:bg-[#2a2a2a]"
              }
            >
              {strategyEnabled ? "Désactiver la stratégie" : "Activer la stratégie"}
            </button>
            <p className="max-w-[260px] text-right text-[10px] leading-snug text-[var(--muted)]">
              {strategyEnabled
                ? paperStatus?.nextRunAt
                  ? `Paper ${paperStatus.broker} auto · prochain run ${new Date(
                      paperStatus.nextRunAt,
                    ).toLocaleString("fr-FR")}`
                  : "Active — paper auto"
                : "Après analyse · Binance Testnet requis"}
            </p>
            {strategyEnabled && (
              <a
                href="/execution"
                className="text-[10px] font-medium text-[var(--accent)] hover:underline"
              >
                Voir l’exécution →
              </a>
            )}
          </div>
        )}
      </div>

      {(activateMessage || paperStatus?.lastError) && (
        <p
          className={`rounded-xl border px-3 py-2 text-xs ${
            paperStatus?.lastError
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-[var(--border)] bg-[var(--accent-soft)] text-[var(--text)]"
          }`}
        >
          {paperStatus?.lastError
            ? `Dernier run paper : ${paperStatus.lastError}`
            : activateMessage}
        </p>
      )}

      {[...(result.warnings ?? []), ...(baseline.warnings ?? [])].length > 0 && (
        <div className="space-y-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
          {[...new Set([...(result.warnings ?? []), ...(baseline.warnings ?? [])])]
            .slice(0, 8)
            .map((w) => (
              <p key={w} className="text-xs leading-snug text-amber-950">
                {w.replace(/^\[(warning|info|error)\]\s*/i, "")}
              </p>
            ))}
        </div>
      )}

      {/* Graphique */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 lg:p-5">
        <h3 className="mb-3 text-sm font-semibold text-[var(--text)]">Évolution</h3>
        <div className="h-80 lg:h-[34rem]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <defs>
                <linearGradient id="gStrat" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34d399" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={fmtMonth}
                stroke="var(--muted)"
                fontSize={11}
                minTickGap={48}
              />
              <YAxis
                stroke="var(--muted)"
                fontSize={11}
                width={70}
                tickFormatter={(v: number) => fmtMoney(v, currency)}
              />
              <ZAxis range={[90, 90]} />
              <Tooltip
                contentStyle={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value: number, name: string) => [fmtMoney(value, currency), name]}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line
                type="monotone"
                dataKey="contributed"
                name="Total versé (stratégie)"
                stroke="#94a3b8"
                strokeWidth={1.75}
                strokeDasharray="5 4"
                dot={false}
                connectNulls
                legendType="plainline"
              />
              <Area
                type="monotone"
                dataKey="actuel"
                name="Situation actuelle"
                stroke="#f59e0b"
                strokeWidth={2}
                fill="none"
                connectNulls
                dot={false}
              />
              <Area
                type="monotone"
                dataKey="classic"
                name="DCA classique"
                stroke="#818cf8"
                strokeWidth={1.5}
                fill="none"
                dot={false}
              />
              <Area
                type="monotone"
                dataKey="strategy"
                name="Stratégie"
                stroke="#34d399"
                strokeWidth={2}
                fill="url(#gStrat)"
                dot={false}
              />
              <Scatter
                dataKey="actuelDot"
                name="Aujourd’hui"
                fill="#ef4444"
                stroke="#ffffff"
                strokeWidth={2}
                legendType="circle"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-[11px] text-[var(--muted)]">
          Pointillés = cumul versé de ta stratégie (même total que la carte « Ta stratégie ») ·
          point rouge = situation actuelle en fin de période
          {!real && importedSnapshot ? " (snapshot positions, sans historique jour par jour)" : ""}.
        </p>
        {realError && <p className="mt-1 text-[11px] text-amber-800">{realError}</p>}
      </div>

      {/* 3 colonnes — cliquables */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <ColumnCard
          title="Situation actuelle"
          accent="bg-amber-500"
          invested={actuelInvested}
          perf={actuelPerf}
          finalValue={actuelValue}
          currency={currency}
          selected={tab === "actuel"}
          onSelect={() => setTab("actuel")}
          note={
            positions.length > 0
              ? `Somme réellement versée (portefeuille) · clique pour le détail`
              : "Importe un portefeuille pour remplir cette colonne"
          }
        />
        <ColumnCard
          title="DCA classique"
          accent="bg-indigo-400"
          invested={baseline.contributed}
          deployed={baseline.invested}
          perf={baseline.roiPct}
          finalValue={baseline.totalValue}
          currency={currency}
          selected={tab === "dca"}
          onSelect={() => setTab("dca")}
          note={
            simulationSummary
              ? `Base fixe ${fmtMoney(simulationSummary.budgetAmount, currency, 0)} / ${periodWord} × N périodes · clique pour le détail`
              : "Budget de base fixe, sans règles · clique pour le détail"
          }
        />
        <ColumnCard
          title="Ta stratégie"
          accent="bg-emerald-500"
          invested={result.contributed}
          deployed={result.invested}
          perf={result.roiPct}
          finalValue={result.totalValue}
          currency={currency}
          selected={tab === "strat"}
          onSelect={() => setTab("strat")}
          note="Base × multiplicateur de régime · clique pour le détail"
        />
      </div>

      <ScenarioDetail
        scenario={tab}
        currency={currency}
        assetNames={assetNames}
        result={result}
        baseline={baseline}
        real={real}
        positions={positions}
        buyTxs={buyTxs}
        purchaseRows={
          <PurchaseRows
            purchases={tab === "dca" ? baseline.purchases : result.purchases}
            currency={currency}
            assetNames={assetNames}
            windows={tab === "dca" ? baseline.windows : result.windows}
          />
        }
        realBuyRows={
          buyTxs.length > 0 ? (
            <RealBuyRows buys={buyTxs} currency={currency} assetNames={assetNames} />
          ) : positions.length > 0 ? (
            <div className="max-h-72 overflow-y-auto">
              <p className="mb-2 text-[11px] text-[var(--muted)]">
                Pas de dates d’achat — détail par position importée.
              </p>
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-[var(--bg-card)] text-[var(--muted)]">
                  <tr>
                    <th className="py-1.5 pr-2 font-normal">Actif</th>
                    <th className="py-1.5 pr-2 font-normal">Investi</th>
                    <th className="py-1.5 pr-2 font-normal">Valeur</th>
                    <th className="py-1.5 font-normal">Perf.</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => (
                    <tr key={p.asset} className="border-t border-[var(--border)]">
                      <td className="py-1.5 pr-2">{assetLabel(p.asset, assetNames)}</td>
                      <td className="py-1.5 pr-2">
                        {p.invested != null ? fmtMoney(p.invested, currency, 2) : "—"}
                      </td>
                      <td className="py-1.5 pr-2">
                        {p.value != null ? fmtMoney(p.value, currency, 2) : "—"}
                      </td>
                      <td className="py-1.5">
                        {p.plPct != null ? fmtPct(p.plPct) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-[var(--muted)]">
              Aucune position importée.
            </p>
          )
        }
      />
    </div>
  );
}

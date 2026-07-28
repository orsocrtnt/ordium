"use client";

import { useMemo, useState, type ReactNode, useEffect } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BacktestResult, Purchase } from "@ordium/engine";
import type { RealPortfolioSeries, Transaction } from "@ordium/portfolio";
import type { PositionValuation } from "@ordium/portfolio";
import { assetLabel } from "@/lib/assets";
import { MarketChart, type ChartPayload } from "@/components/MarketChart";
import { apiFetch } from "@/lib/api";
import { fmtMoney, fmtMonth, fmtNum, fmtPct } from "@/lib/format";

export type ScenarioId = "actuel" | "dca" | "strat";

type MarketChartResponse = ChartPayload & {
  symbol: string;
  quote: string;
  assetType: string;
  asOf: string;
};

type AssetRow = {
  asset: string;
  invested: number | null;
  value: number | null;
  plPct: number | null;
  quantity?: number | null;
  fees?: number | null;
  avgCost?: number | null;
  lastPrice?: number | null;
};

type SeriesPoint = {
  date: string;
  value: number;
  contributed: number;
  assets?: Record<string, { value: number; invested: number }>;
};

const ACCENT: Record<ScenarioId, { stroke: string; fillId: string; fill: string; label: string }> = {
  actuel: { stroke: "#f59e0b", fillId: "gActuel", fill: "#f59e0b", label: "Situation actuelle" },
  dca: { stroke: "#818cf8", fillId: "gDca", fill: "#818cf8", label: "DCA classique" },
  strat: { stroke: "#34d399", fillId: "gStratDetail", fill: "#34d399", label: "Ta stratégie" },
};

function slimPoints<T>(rows: T[], max = 400): T[] {
  if (rows.length <= max) return rows;
  const step = Math.ceil(rows.length / max);
  return rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: "pos" | "neg" | "muted";
}) {
  const color =
    tone === "pos"
      ? "text-emerald-700"
      : tone === "neg"
        ? "text-amber-800"
        : tone === "muted"
          ? "text-[var(--muted)]"
          : "text-[var(--text)]";
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function PortfolioChart({
  points,
  currency,
  accent,
}: {
  points: SeriesPoint[];
  currency: string;
  accent: (typeof ACCENT)[ScenarioId];
}) {
  const data = useMemo(
    () =>
      slimPoints(points).map((p) => ({
        date: p.date,
        value: p.value,
        contributed: p.contributed,
        roi:
          p.contributed > 0 ? ((p.value - p.contributed) / p.contributed) * 100 : null,
      })),
    [points],
  );

  if (data.length === 0) {
    return (
      <p className="text-xs text-[var(--muted)]">
        Pas de courbe jour par jour pour ce scénario.
      </p>
    );
  }

  return (
    <div className="h-72 lg:h-96">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id={accent.fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={accent.fill} stopOpacity={0.22} />
              <stop offset="100%" stopColor={accent.fill} stopOpacity={0} />
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
          <Tooltip
            contentStyle={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value: number, name: string) => {
              if (name === "Perf. cumulée") return [fmtPct(value), name];
              return [fmtMoney(value, currency), name];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area
            type="monotone"
            dataKey="contributed"
            name="Total versé"
            stroke="var(--muted)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            fill="none"
            dot={false}
          />
          <Area
            type="monotone"
            dataKey="value"
            name="Valeur"
            stroke={accent.stroke}
            strokeWidth={2}
            fill={`url(#${accent.fillId})`}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

type AssetPoint = {
  date: string;
  value: number;
  invested: number;
  plPct: number | null;
};

function lookupAssetSnap(
  assets: Record<string, { value: number; invested: number }> | undefined,
  asset: string,
): { value: number; invested: number } | null {
  if (!assets) return null;
  if (assets[asset]) return assets[asset]!;
  const want = asset.toUpperCase();
  for (const [k, v] of Object.entries(assets)) {
    if (k.toUpperCase() === want) return v;
  }
  return null;
}

/**
 * Série journalière depuis valueSeries.assets, sinon reconstruction depuis les achats
 * (valeur au prix d’achat + point final mark-to-market).
 */
function buildAssetHistory(
  asset: string,
  points: SeriesPoint[],
  purchases: Purchase[] | undefined,
  final: AssetRow | undefined,
  endDate: string | undefined,
): AssetPoint[] {
  const fromSeries = points
    .map((p) => {
      const a = lookupAssetSnap(p.assets, asset);
      if (!a) return null;
      return {
        date: p.date,
        value: a.value,
        invested: a.invested,
        plPct: a.invested > 0 ? ((a.value - a.invested) / a.invested) * 100 : null,
      };
    })
    .filter((r): r is AssetPoint => r != null);

  if (fromSeries.length >= 2) return slimPoints(fromSeries);

  const want = asset.toUpperCase();
  const buys = (purchases ?? [])
    .filter((p) => p.asset.toUpperCase() === want)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  if (buys.length === 0 && final && (final.value != null || final.invested != null)) {
    const invested = final.invested ?? 0;
    const value = final.value ?? 0;
    const date = endDate ?? points.at(-1)?.date ?? new Date().toISOString().slice(0, 10);
    return [
      {
        date,
        value,
        invested,
        plPct: invested > 0 ? ((value - invested) / invested) * 100 : null,
      },
    ];
  }

  let qty = 0;
  let invested = 0;
  const rows: AssetPoint[] = [];
  for (const p of buys) {
    qty += p.quantity;
    invested += p.quoteAmount;
    const value = qty * p.price;
    rows.push({
      date: p.date,
      value,
      invested,
      plPct: invested > 0 ? ((value - invested) / invested) * 100 : null,
    });
  }

  if (final && endDate) {
    const value = final.value ?? rows.at(-1)?.value ?? 0;
    const inv = final.invested ?? invested;
    const last = rows.at(-1);
    if (!last || last.date !== endDate) {
      rows.push({
        date: endDate,
        value,
        invested: inv,
        plPct: inv > 0 ? ((value - inv) / inv) * 100 : null,
      });
    } else {
      last.value = value;
      last.invested = inv;
      last.plPct = inv > 0 ? ((value - inv) / inv) * 100 : null;
    }
  }

  return slimPoints(rows);
}

function buildAssetHistoryFromTxs(
  asset: string,
  txs: Transaction[],
  final: AssetRow | undefined,
  endDate: string | undefined,
): AssetPoint[] {
  const want = asset.toUpperCase();
  const rows: AssetPoint[] = [];
  let qty = 0;
  let invested = 0;
  const sorted = [...txs]
    .filter((t) => t.asset.toUpperCase() === want)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  for (const t of sorted) {
    const amount = t.amount ?? t.quantity * (t.price ?? 0);
    if (t.side === "buy") {
      qty += t.quantity;
      invested += amount;
    } else {
      const prevQty = qty;
      qty = Math.max(0, qty - t.quantity);
      if (prevQty > 1e-12) invested = Math.max(0, invested * (qty / prevQty));
    }
    const price = t.price ?? (qty > 0 ? amount / Math.max(t.quantity, 1e-12) : 0);
    const value = qty * price;
    rows.push({
      date: t.date,
      value,
      invested,
      plPct: invested > 0 ? ((value - invested) / invested) * 100 : null,
    });
  }

  if (final && endDate) {
    const value = final.value ?? rows.at(-1)?.value ?? 0;
    const inv = final.invested ?? invested;
    const last = rows.at(-1);
    if (!last || last.date !== endDate) {
      rows.push({
        date: endDate,
        value,
        invested: inv,
        plPct: inv > 0 ? ((value - inv) / inv) * 100 : null,
      });
    }
  }

  return slimPoints(rows);
}

function AssetPerfChart({
  data,
  currency,
  purchases,
  accent,
  title,
  assetId,
}: {
  data: AssetPoint[];
  currency: string;
  purchases?: { date: string; amount: number; price: number }[];
  accent: (typeof ACCENT)[ScenarioId];
  title: string;
  assetId: string;
}) {
  const gradId = `${accent.fillId}-${assetId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--border)] p-3 lg:p-4">
        <h5 className="mb-2 text-xs font-semibold text-[var(--text)]">{title}</h5>
        <p className="text-xs text-[var(--muted)]">Pas encore d’historique pour cet actif.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border)] p-3 lg:p-4">
      <h5 className="mb-2 text-xs font-semibold text-[var(--text)]">{title}</h5>
      <div className="h-64 lg:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accent.fill} stopOpacity={0.2} />
                <stop offset="100%" stopColor={accent.fill} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={fmtMonth}
              stroke="var(--muted)"
              fontSize={10}
              minTickGap={28}
            />
            <YAxis
              yAxisId="eur"
              stroke="var(--muted)"
              fontSize={10}
              width={56}
              tickFormatter={(v: number) => fmtMoney(v, currency)}
            />
            <YAxis
              yAxisId="pct"
              orientation="right"
              stroke="var(--muted)"
              fontSize={10}
              width={40}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            />
            <Tooltip
              contentStyle={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 11,
              }}
              formatter={(value: number, name: string) => {
                if (name === "Perf.") return [fmtPct(value), name];
                return [fmtMoney(value, currency, 2), name];
              }}
            />
            <Area
              yAxisId="eur"
              type="monotone"
              dataKey="invested"
              name="Coût"
              stroke="var(--muted)"
              strokeWidth={1.25}
              strokeDasharray="4 4"
              fill="none"
              dot={false}
            />
            <Area
              yAxisId="eur"
              type="monotone"
              dataKey="value"
              name="Valeur"
              stroke={accent.stroke}
              strokeWidth={2}
              fill={`url(#${gradId})`}
              dot={false}
            />
            <Line
              yAxisId="pct"
              type="monotone"
              dataKey="plPct"
              name="Perf."
              stroke="#94a3b8"
              strokeWidth={1.1}
              dot={false}
              connectNulls
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {purchases && purchases.length > 0 && (
        <p className="mt-1 text-[10px] text-[var(--muted)]">
          {purchases.length} achat{purchases.length > 1 ? "s" : ""} · dernier{" "}
          {purchases[purchases.length - 1]!.date}
        </p>
      )}
    </div>
  );
}

export function ScenarioDetail({
  scenario,
  currency,
  assetNames,
  result,
  baseline,
  real,
  positions,
  buyTxs,
  purchaseRows,
  realBuyRows,
}: {
  scenario: ScenarioId;
  currency: string;
  assetNames?: Map<string, string>;
  result: BacktestResult;
  baseline: BacktestResult;
  real?: RealPortfolioSeries | null;
  positions: PositionValuation[];
  buyTxs: Transaction[];
  purchaseRows: ReactNode;
  realBuyRows: ReactNode;
}) {
  const accent = ACCENT[scenario];
  const bt = scenario === "dca" ? baseline : scenario === "strat" ? result : null;

  const points: SeriesPoint[] = useMemo(() => {
    if (scenario === "actuel") return real?.points ?? [];
    return bt?.valueSeries ?? [];
  }, [scenario, real, bt]);

  const assets: AssetRow[] = useMemo(() => {
    if (scenario === "actuel") {
      if (real?.perAsset?.length) {
        return real.perAsset.map((a) => ({
          asset: a.asset,
          invested: a.invested,
          value: a.value,
          plPct: a.plPct,
          quantity: a.quantity,
        }));
      }
      return positions.map((p) => ({
        asset: p.asset,
        invested: p.invested,
        value: p.value,
        plPct: p.plPct,
        quantity: p.quantity,
        avgCost: p.avgCost,
        lastPrice: p.lastPrice,
      }));
    }
    return (bt?.perAsset ?? []).map((a) => ({
      asset: a.asset,
      invested: a.invested,
      value: a.value,
      plPct: a.plPct,
      quantity: a.quantity,
      fees: a.fees,
      avgCost: a.avgCost,
      lastPrice: a.lastPrice,
    }));
  }, [scenario, real, positions, bt]);

  const sortedAssets = useMemo(
    () =>
      [...assets].sort((a, b) => {
        const av = a.value ?? 0;
        const bv = b.value ?? 0;
        return bv - av;
      }),
    [assets],
  );

  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [selectedMarketChart, setSelectedMarketChart] = useState<MarketChartResponse | null>(null);
  const [selectedMarketBusy, setSelectedMarketBusy] = useState(false);
  const [selectedMarketError, setSelectedMarketError] = useState<string | null>(null);
  useEffect(() => {
    setSelectedAsset(null);
    setSelectedMarketChart(null);
    setSelectedMarketError(null);
  }, [scenario]);

  const activeAsset =
    selectedAsset && sortedAssets.some((a) => a.asset === selectedAsset) ? selectedAsset : null;

  const purchases = bt?.purchases;
  const endDate =
    bt?.to ?? points.at(-1)?.date ?? real?.points?.at(-1)?.date ?? undefined;

  const assetHistories = useMemo(() => {
    return sortedAssets.map((row) => {
      const history =
        scenario === "actuel"
          ? (() => {
              const fromPoints = buildAssetHistory(
                row.asset,
                points,
                undefined,
                row,
                endDate,
              );
              // Snapshot réel: un seul point (final) est déjà une info utile.
              if (fromPoints.length >= 1) return fromPoints;
              return buildAssetHistoryFromTxs(row.asset, buyTxs, row, endDate);
            })()
          : buildAssetHistory(row.asset, points, purchases, row, endDate);

      const buyMarks = (purchases ?? [])
        .filter((p) => p.asset.toUpperCase() === row.asset.toUpperCase())
        .map((p) => ({ date: p.date, amount: p.quoteAmount, price: p.price }));

      return { row, history, buyMarks };
    });
  }, [sortedAssets, scenario, points, purchases, buyTxs, endDate]);
  const activeAssetHistory = activeAsset
    ? assetHistories.find(({ row }) => row.asset === activeAsset) ?? null
    : null;
  useEffect(() => {
    if (!activeAsset) {
      setSelectedMarketChart(null);
      setSelectedMarketError(null);
      setSelectedMarketBusy(false);
      return;
    }
    let cancelled = false;
    setSelectedMarketBusy(true);
    setSelectedMarketError(null);
    void (async () => {
      try {
        const res = await apiFetch("/api/markets/chart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: activeAsset, timeframe: "1d" }),
        });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error ?? "Chargement du graphique impossible");
        setSelectedMarketChart(json as MarketChartResponse);
      } catch (e) {
        if (cancelled) return;
        setSelectedMarketChart(null);
        setSelectedMarketError((e as Error).message);
      } finally {
        if (!cancelled) setSelectedMarketBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeAsset]);

  const invested =
    scenario === "actuel"
      ? real?.netInvested ??
        (positions.length
          ? positions.reduce((s, p) => s + (p.invested ?? 0), 0) || null
          : null)
      : bt?.contributed ?? null;
  const finalValue =
    scenario === "actuel"
      ? real?.finalValue ??
        (positions.length
          ? positions.reduce((s, p) => s + (p.value ?? 0), 0) || null
          : null)
      : bt?.totalValue ?? null;
  const perf =
    scenario === "actuel"
      ? real?.roiPct ??
        (invested != null && invested > 0 && finalValue != null
          ? ((finalValue - invested) / invested) * 100
          : null)
      : bt?.roiPct ?? null;

  return (
    <div className="space-y-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 lg:p-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: accent.stroke }}
            />
            <h3 className="text-sm font-semibold text-[var(--text)]">
              Détail — {accent.label}
            </h3>
          </div>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            Clique une ligne du tableau pour afficher directement le graphique de cet actif.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi
          label="Total versé"
          value={invested != null ? fmtMoney(invested, currency) : "—"}
        />
        <Kpi
          label="Valeur finale"
          value={finalValue != null ? fmtMoney(finalValue, currency) : "—"}
        />
        <Kpi
          label="Perf."
          value={perf != null ? fmtPct(perf) : "—"}
          tone={perf == null ? "muted" : perf >= 0 ? "pos" : "neg"}
        />
        {bt ? (
          <Kpi label="Max drawdown" value={fmtPct(-Math.abs(bt.maxDrawdownPct), false)} tone="neg" />
        ) : (
          <Kpi
            label="Actifs"
            value={sortedAssets.length > 0 ? String(sortedAssets.length) : "—"}
          />
        )}
      </div>

      {bt && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Kpi label="Cash restant" value={fmtMoney(bt.cash, currency, 2)} tone="muted" />
          <Kpi label="Investi (achats)" value={fmtMoney(bt.invested, currency, 2)} />
          <Kpi label="Frais" value={fmtMoney(bt.fees, currency, 2)} tone="muted" />
          <Kpi label="Achats" value={String(bt.purchases.length)} tone="muted" />
        </div>
      )}

      <div id="scenario-main-chart">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          {activeAssetHistory
            ? `Graphique — ${assetLabel(activeAssetHistory.row.asset, assetNames)}`
            : "Évolution du portefeuille"}
        </h4>
        {activeAssetHistory ? (
          <div className="space-y-2">
            {selectedMarketBusy ? (
              <div className="rounded-xl border border-[var(--border)] bg-white px-4 py-8 text-sm text-[var(--muted)]">
                Chargement du graphique…
              </div>
            ) : selectedMarketChart ? (
              <MarketChart
                data={{
                  timeframe: selectedMarketChart.timeframe,
                  candles: selectedMarketChart.candles,
                  indicators: selectedMarketChart.indicators,
                }}
              />
            ) : selectedMarketError ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {selectedMarketError}
              </div>
            ) : (
              <AssetPerfChart
                data={activeAssetHistory.history}
                currency={currency}
                purchases={activeAssetHistory.buyMarks}
                accent={accent}
                title={assetLabel(activeAssetHistory.row.asset, assetNames)}
                assetId={activeAssetHistory.row.asset}
              />
            )}
            <button
              type="button"
              onClick={() => setSelectedAsset(null)}
              className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)] hover:text-[var(--text)]"
            >
              Revenir au portefeuille
            </button>
          </div>
        ) : (
          <PortfolioChart points={points} currency={currency} accent={accent} />
        )}
        {!activeAssetHistory && scenario === "actuel" && !real?.points?.length && (
          <p className="mt-2 text-[11px] text-[var(--muted)]">
            Importe des transactions pour une courbe jour par jour (positions seules =
            snapshot).
          </p>
        )}
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Perf. par actif
        </h4>
        {sortedAssets.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">Aucun actif à afficher.</p>
        ) : (
          <div className="max-h-[28rem] overflow-y-auto rounded-xl border border-[var(--border)]">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-[var(--bg-elevated)] text-[var(--muted)]">
                <tr>
                  <th className="px-2 py-2 font-normal">Actif</th>
                  <th className="px-2 py-2 font-normal">Investi</th>
                  <th className="px-2 py-2 font-normal">Valeur</th>
                  <th className="px-2 py-2 font-normal">Perf.</th>
                  {bt && <th className="px-2 py-2 font-normal">Qty</th>}
                </tr>
              </thead>
              <tbody>
                {sortedAssets.map((a) => {
                  const selected = a.asset === activeAsset;
                  return (
                    <tr
                      key={a.asset}
                      className={`cursor-pointer border-t border-[var(--border)] ${
                        selected ? "bg-[var(--bg-elevated)]" : "hover:bg-[var(--bg-elevated)]/60"
                      }`}
                      onClick={() => {
                        if (selected) {
                          setSelectedAsset(null);
                          return;
                        }
                        setSelectedAsset(a.asset);
                        document
                          .getElementById("scenario-main-chart")
                          ?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    >
                      <td className="px-2 py-2 font-medium text-[var(--text)]">
                        {assetLabel(a.asset, assetNames)}
                      </td>
                      <td className="px-2 py-2 tabular-nums">
                        {a.invested != null ? fmtMoney(a.invested, currency, 2) : "—"}
                      </td>
                      <td className="px-2 py-2 tabular-nums">
                        {a.value != null ? fmtMoney(a.value, currency, 2) : "—"}
                      </td>
                      <td
                        className={`px-2 py-2 tabular-nums ${
                          a.plPct == null
                            ? ""
                            : a.plPct >= 0
                              ? "text-emerald-700"
                              : "text-amber-800"
                        }`}
                      >
                        {a.plPct != null ? fmtPct(a.plPct) : "—"}
                      </td>
                      {bt && (
                        <td className="px-2 py-2 tabular-nums text-[var(--muted)]">
                          {a.quantity != null ? fmtNum(a.quantity, 4) : "—"}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {scenario !== "actuel" && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Versements & parts
          </h4>
          {purchaseRows}
        </div>
      )}
    </div>
  );
}

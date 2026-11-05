"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MarketChart, type ChartPayload } from "@/components/MarketChart";
import { RequireAuth } from "@/components/RequireAuth";
import { assetLabel } from "@/lib/assets";
import { apiFetch } from "@/lib/api";
import { markMarketsVisited } from "@/lib/journeyProgress";

type ChartResponse = ChartPayload & {
  symbol: string;
  quote: string;
  assetType: string;
  asOf: string;
  snapshot: {
    price: number | null;
    rsi14: number | null;
    sma20: number | null;
    sma50: number | null;
    sma200: number | null;
    macd: { macd: number; signal: number; histogram: number } | null;
    bollinger: { mid: number; upper: number; lower: number; pctB: number } | null;
    vol20: number | null;
    pctFromAth252: number | null;
    regime: string | null;
  };
  signals: string[];
};

type FearGreed = { value: number; classification: string; timestamp: string };
type AssetOption = { symbol: string; label: string };

const DEFAULT_SYMBOLS = ["BTC", "ETH", "SPY", "AAPL"];
const POLL_MS = 60_000;

export default function MarketsPage() {
  return (
    <RequireAuth>
      <MarketsContent />
    </RequireAuth>
  );
}

function MarketsContent() {
  const [options, setOptions] = useState<AssetOption[]>(
    DEFAULT_SYMBOLS.map((symbol) => ({ symbol, label: assetLabel(symbol) })),
  );
  const [symbol, setSymbol] = useState("BTC");
  const [assetQuery, setAssetQuery] = useState(assetLabel("BTC"));
  const [searchOpen, setSearchOpen] = useState(false);
  const [timeframe, setTimeframe] = useState<"1d" | "1h">("1d");
  const [chart, setChart] = useState<ChartResponse | null>(null);
  const [fearGreed, setFearGreed] = useState<FearGreed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    markMarketsVisited();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [portfolioRes, assetsRes] = await Promise.all([
          apiFetch("/api/portfolio").catch(() => null),
          apiFetch("/api/assets").catch(() => null),
        ]);

        const holdingsOptions: AssetOption[] = [];
        if (portfolioRes?.ok) {
          const data = await portfolioRes.json();
          const holdings = data?.portfolio?.holdings as Array<{ asset?: string; name?: string }> | undefined;
          if (Array.isArray(holdings)) {
            for (const h of holdings) {
              const sym = (h.asset ?? "").trim().toUpperCase();
              if (!sym) continue;
              holdingsOptions.push({
                symbol: sym,
                label: assetLabel(sym, h.name ? { [sym]: h.name } : undefined),
              });
            }
          }
        }

        const assetApiOptions: AssetOption[] = [];
        if (assetsRes?.ok) {
          const data = (await assetsRes.json()) as Array<Record<string, unknown>>;
          if (Array.isArray(data)) {
            for (const row of data) {
              const sym = String(row.symbol ?? row.asset ?? "").trim().toUpperCase();
              if (!sym) continue;
              const explicitName =
                typeof row.name === "string"
                  ? row.name
                  : typeof row.label === "string"
                    ? row.label
                    : typeof row.displayName === "string"
                      ? row.displayName
                      : undefined;
              assetApiOptions.push({
                symbol: sym,
                label: assetLabel(sym, explicitName ? { [sym]: explicitName } : undefined),
              });
            }
          }
        }

        const merged = [...holdingsOptions, ...assetApiOptions, ...DEFAULT_SYMBOLS.map((s) => ({
          symbol: s,
          label: assetLabel(s),
        }))];
        const deduped = new Map<string, AssetOption>();
        for (const option of merged) {
          if (!deduped.has(option.symbol)) deduped.set(option.symbol, option);
        }
        const nextOptions = [...deduped.values()];
        if (nextOptions.length > 0) {
          setOptions(nextOptions);
          const preferred = holdingsOptions[0]?.symbol ?? nextOptions[0]!.symbol;
          setSymbol(preferred);
          setAssetQuery(nextOptions.find((o) => o.symbol === preferred)?.label ?? preferred);
        }
      } catch {
        // défauts
      }
    })();
  }, []);

  useEffect(() => {
    const current = options.find((o) => o.symbol === symbol);
    if (current) setAssetQuery(current.label);
  }, [symbol, options]);

  const loadFearGreed = useCallback(async () => {
    try {
      const res = await apiFetch("/api/markets/fear-greed");
      const json = await res.json();
      if (res.ok) setFearGreed(json as FearGreed);
    } catch {
      // ignore
    }
  }, []);

  const loadChart = useCallback(
    async (sym: string, tf: "1d" | "1h", silent = false) => {
      if (!silent) setBusy(true);
      setError(null);
      try {
        const res = await apiFetch("/api/markets/chart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: sym, timeframe: tf }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Chargement chart impossible");
        setChart(json as ChartResponse);
        setUpdatedAt(new Date().toISOString());
      } catch (e) {
        setError((e as Error).message);
      } finally {
        if (!silent) setBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadChart(symbol, timeframe);
    void loadFearGreed();
  }, [symbol, timeframe, loadChart, loadFearGreed]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void loadChart(symbol, timeframe, true);
      void loadFearGreed();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [symbol, timeframe, loadChart, loadFearGreed]);

  const chartData: ChartPayload | null = useMemo(() => {
    if (!chart) return null;
    return {
      timeframe: chart.timeframe,
      candles: chart.candles,
      indicators: chart.indicators,
    };
  }, [chart]);

  const filteredOptions = useMemo(() => {
    const q = assetQuery.trim().toLowerCase();
    if (!q) return options.slice(0, 12);
    return options
      .filter(
        (option) =>
          option.symbol.toLowerCase().includes(q) || option.label.toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [options, assetQuery]);

  const assetType = chart?.assetType?.toLowerCase() ?? "";
  const isCrypto = assetType.includes("crypto");
  const isEquityLike =
    assetType.includes("stock") ||
    assetType.includes("equity") ||
    assetType.includes("etf") ||
    assetType.includes("fund") ||
    assetType.includes("index");

  return (
    <AppShell>
      <section className="max-w-5xl">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">
          Marchés
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--text)]">
          Charts live
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">
          Optionnel — accessible à tout moment depuis la barre du haut. Mêmes indicateurs que ta
          stratégie (RSI, SMA, MACD, Bollinger), calculés par le moteur Ordium. Refresh toutes les
          60 s.
        </p>
        <p className="mt-3 max-w-3xl rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 text-sm leading-relaxed text-[var(--muted)]">
          Message de prévention : Essayer de surperformer simplement en lisant des graphiques n'est
          pas toujours une bonne idée pour performer sur la durée. Les charts live (1D/1H), RSI,
          MACD ou Bollinger servent surtout à lire le contexte ; pour investir sur le long terme,
          une stratégie claire compte bien davantage.
        </p>
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[18rem] flex-1 max-w-md">
              <label className="mb-1 block text-xs text-[var(--muted)]">Actif</label>
              <input
                value={assetQuery}
                onChange={(e) => {
                  setAssetQuery(e.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                onBlur={() => {
                  window.setTimeout(() => setSearchOpen(false), 120);
                }}
                placeholder="Rechercher un actif ou un ticker"
                className="ord-input w-full text-sm"
              />
              {searchOpen && (
                <div className="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-[var(--border)] bg-white shadow-sm">
                  {filteredOptions.map((option) => (
                    <button
                      key={option.symbol}
                      type="button"
                      onClick={() => {
                        setSymbol(option.symbol);
                        setAssetQuery(option.label);
                        setSearchOpen(false);
                      }}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-[var(--bg-elevated)] ${
                        option.symbol === symbol ? "bg-[var(--bg-elevated)]" : ""
                      }`}
                    >
                      <span className="truncate text-[var(--text)]">{option.label}</span>
                      <span className="shrink-0 font-mono text-xs text-[var(--muted)]">
                        {option.symbol}
                      </span>
                    </button>
                  ))}
                  {filteredOptions.length === 0 && (
                    <div className="px-3 py-2 text-sm text-[var(--muted)]">
                      Aucun actif trouvé.
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex rounded-lg border border-[var(--border)] p-0.5">
              {(["1d", "1h"] as const).map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => setTimeframe(tf)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                    timeframe === tf
                      ? "bg-zinc-900 text-white"
                      : "text-[var(--muted)] hover:text-[var(--text)]"
                  }`}
                >
                  {tf === "1d" ? "1D" : "1H"}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="ord-btn ord-btn-ghost !px-3 !py-1.5 text-xs"
              disabled={busy}
              onClick={() => void loadChart(symbol, timeframe)}
            >
              {busy ? "Chargement…" : "Actualiser"}
            </button>
            {updatedAt && (
              <span className="text-[11px] text-[var(--muted)]">
                {new Date(updatedAt).toLocaleTimeString("fr-FR")}
              </span>
            )}
          </div>

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          {chartData ? (
            <MarketChart data={chartData} />
          ) : (
            <div className="flex h-[560px] items-center justify-center rounded-xl border border-[var(--border)] bg-white text-sm text-[var(--muted)]">
              {busy ? "Chargement du chart…" : "Aucune donnée"}
            </div>
          )}

          <p className="text-[11px] text-[var(--muted)]">
            Prix · SMA20 (bleu) · SMA50 (violet) · SMA200 (or) · Bollinger · RSI · MACD — moteur
            @ordium/engine
          </p>
        </div>

        <aside className="space-y-4">
          {chart && (
            <div className="ord-card space-y-3 p-4">
              <div>
                <p className="text-lg font-semibold text-[var(--text)]">{chart.symbol}</p>
                <p className="text-xs text-[var(--muted)]">
                  {chart.assetType} · {chart.asOf}
                </p>
              </div>
              <p className="text-2xl font-semibold tabular-nums text-[var(--text)]">
                {chart.snapshot.price != null
                  ? chart.snapshot.price.toLocaleString("fr-FR", { maximumFractionDigits: 4 })
                  : "—"}{" "}
                <span className="text-sm font-normal text-[var(--muted)]">{chart.quote}</span>
              </p>
              {isCrypto && fearGreed && (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">
                        Fear &amp; Greed
                      </p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        Plus utile ici pour le sentiment crypto global.
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-3xl font-semibold tabular-nums text-[var(--text)]">
                        {fearGreed.value}
                      </p>
                      <p className="text-xs text-[var(--muted)]">{fearGreed.classification}</p>
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="h-3 overflow-hidden rounded-full bg-[#f4f4f1]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(0, Math.min(100, fearGreed.value))}%`,
                          background: fearGreedFillGradient(fearGreed.value),
                        }}
                      />
                    </div>
                    <div className="mt-1 flex justify-between text-[10px] text-[var(--muted)]">
                      <span>Peur</span>
                      <span>Neutre</span>
                      <span>Cupidité</span>
                    </div>
                  </div>
                </div>
              )}
              {isEquityLike && (
                <div className="grid grid-cols-2 gap-2">
                  <SignalPill
                    label="Régime"
                    value={chart.snapshot.regime ?? "—"}
                    tone={regimeTone(chart.snapshot.regime)}
                  />
                  <SignalPill
                    label="RSI"
                    value={describeRsi(chart.snapshot.rsi14)}
                    tone={rsiTone(chart.snapshot.rsi14)}
                  />
                  <SignalPill
                    label="Tendance"
                    value={describeTrend(chart.snapshot.price, chart.snapshot.sma200)}
                    tone={trendTone(chart.snapshot.price, chart.snapshot.sma200)}
                  />
                  <SignalPill
                    label="Bollinger"
                    value={describeBollinger(chart.snapshot.bollinger?.pctB ?? null)}
                    tone={bollingerTone(chart.snapshot.bollinger?.pctB ?? null)}
                  />
                </div>
              )}
              <dl className="grid grid-cols-2 gap-x-2 gap-y-1.5 text-xs text-[var(--muted)]">
                <div>
                  RSI{" "}
                  <span className="font-medium text-[var(--text)]">{fmt(chart.snapshot.rsi14)}</span>
                </div>
                <div>
                  Régime{" "}
                  <span className="font-medium text-[var(--text)]">
                    {chart.snapshot.regime ?? "—"}
                  </span>
                </div>
                <div>
                  SMA20{" "}
                  <span className="font-medium text-[var(--text)]">{fmt(chart.snapshot.sma20)}</span>
                </div>
                <div>
                  SMA200{" "}
                  <span className="font-medium text-[var(--text)]">{fmt(chart.snapshot.sma200)}</span>
                </div>
                <div>
                  MACD hist.{" "}
                  <span className="font-medium text-[var(--text)]">
                    {fmt(chart.snapshot.macd?.histogram ?? null)}
                  </span>
                </div>
                <div>
                  %B{" "}
                  <span className="font-medium text-[var(--text)]">
                    {chart.snapshot.bollinger
                      ? chart.snapshot.bollinger.pctB.toFixed(2)
                      : "—"}
                  </span>
                </div>
              </dl>
              <ul className="space-y-1 border-t border-[var(--border)] pt-3 text-xs leading-relaxed text-[var(--muted)]">
                {chart.signals.map((sig) => (
                  <li key={sig}>· {sig}</li>
                ))}
              </ul>
              <Link
                href="/learn"
                className="inline-flex w-full items-center justify-center rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--bg-elevated)]"
              >
                Comprendre les indicateurs
              </Link>
            </div>
          )}
        </aside>
      </div>
    </AppShell>
  );
}

function fmt(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

function SignalPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "good" | "warn";
}) {
  const toneClass =
    tone === "good"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text)]";
  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <p className="text-[10px] uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

function describeRsi(rsi: number | null): string {
  if (rsi == null || Number.isNaN(rsi)) return "—";
  if (rsi >= 70) return "Surchauffe";
  if (rsi <= 30) return "Survente";
  return "Zone neutre";
}

function rsiTone(rsi: number | null): "neutral" | "good" | "warn" {
  if (rsi == null || Number.isNaN(rsi)) return "neutral";
  return rsi >= 70 || rsi <= 30 ? "warn" : "good";
}

function describeTrend(price: number | null, sma200: number | null): string {
  if (price == null || sma200 == null || Number.isNaN(price) || Number.isNaN(sma200)) return "—";
  return price >= sma200 ? "Au-dessus SMA200" : "Sous SMA200";
}

function trendTone(price: number | null, sma200: number | null): "neutral" | "good" | "warn" {
  if (price == null || sma200 == null || Number.isNaN(price) || Number.isNaN(sma200)) {
    return "neutral";
  }
  return price >= sma200 ? "good" : "warn";
}

function describeBollinger(pctB: number | null): string {
  if (pctB == null || Number.isNaN(pctB)) return "—";
  if (pctB >= 1) return "Bande haute";
  if (pctB <= 0) return "Bande basse";
  return "Zone centrale";
}

function bollingerTone(pctB: number | null): "neutral" | "good" | "warn" {
  if (pctB == null || Number.isNaN(pctB)) return "neutral";
  return pctB >= 1 || pctB <= 0 ? "warn" : "good";
}

function regimeTone(regime: string | null): "neutral" | "good" | "warn" {
  const value = regime?.toLowerCase() ?? "";
  if (!value) return "neutral";
  if (value.includes("bull")) return "good";
  if (value.includes("bear")) return "warn";
  return "neutral";
}

function fearGreedFillGradient(value: number): string {
  // Dégradé volontairement "sans vert" pour les valeurs faibles,
  // pour éviter l’impression trompeuse de tendance haussière.
  if (value < 25) return "linear-gradient(90deg, #ef4444 0%, #f97316 100%)"; // rouge -> orange
  if (value < 45) return "linear-gradient(90deg, #ef4444 0%, #f59e0b 100%)"; // rouge -> ambre
  if (value < 55) return "linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%)"; // ambre -> jaune
  if (value < 75) return "linear-gradient(90deg, #fbbf24 0%, #a3e635 100%)"; // jaune -> lime
  return "linear-gradient(90deg, #a3e635 0%, #10b981 100%)"; // lime -> vert/émeraude
}

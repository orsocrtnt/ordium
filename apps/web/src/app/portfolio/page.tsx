"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Holding } from "@ordium/portfolio";
import { AppShell } from "@/components/AppShell";
import { HoldingsEditor, withDerivedPnl } from "@/components/HoldingsEditor";
import { RequireAuth } from "@/components/RequireAuth";
import { apiFetch } from "@/lib/api";
import { fmtMoney, fmtPct } from "@/lib/format";
import type { PortfolioPayload } from "@/lib/types";

/** Fusionne holdings enrichis + valorisation marché pour le tableau. */
function rowsFromPayload(payload: PortfolioPayload): Holding[] {
  const byAsset = new Map(payload.portfolio.holdings.map((h) => [h.asset, h]));
  return payload.valuation.positions.map((p) => {
    const base = byAsset.get(p.asset);
    const invested = p.invested ?? base?.invested;
    const value = p.value ?? base?.value;
    const pnl =
      value != null && invested != null ? value - invested : (base?.pnl ?? undefined);
    const pnlPct = p.plPct ?? base?.pnlPct;
    return withDerivedPnl({
      asset: p.asset,
      name: base?.name,
      quantity: p.quantity,
      price: p.lastPrice ?? base?.price,
      avgPrice: p.avgCost ?? base?.avgPrice,
      invested: invested ?? undefined,
      value: value ?? undefined,
      pnl: pnl ?? undefined,
      pnlPct: pnlPct ?? undefined,
    });
  });
}

export default function PortfolioPage() {
  return (
    <RequireAuth>
      <PortfolioContent />
    </RequireAuth>
  );
}

function PortfolioContent() {
  const router = useRouter();
  const [payload, setPayload] = useState<PortfolioPayload | null>(null);
  const [rows, setRows] = useState<Holding[]>([]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/portfolio");
      const data = await res.json();
      if (!res.ok || !data?.portfolio) {
        router.replace("/positions");
        return;
      }
      const p = data as PortfolioPayload;
      setPayload(p);
      setRows(rowsFromPayload(p));
      setEditing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const v = payload?.valuation;
  const portfolio = payload?.portfolio;

  const weightMap = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const p of v?.positions ?? []) m.set(p.asset, p.weightPct);
    return m;
  }, [v]);

  const saveEdits = async () => {
    if (!portfolio) return;
    const cleaned = rows.filter((h) => h.asset.trim() && h.quantity > 0).map(withDerivedPnl);
    if (cleaned.length === 0) {
      setError("Il faut au moins une position.");
      return;
    }
    setBusy("Enregistrement…");
    setError(null);
    try {
      const res = await apiFetch("/api/portfolio/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usedLlm: false,
          source: "manual",
          kind: "holdings",
          currency: portfolio.currency,
          name: portfolio.name,
          transactions: [],
          holdings: cleaned,
          warnings: portfolio.warnings,
          summary: "Portefeuille mis à jour.",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Erreur inconnue");
        return;
      }
      const p = data as PortfolioPayload;
      setPayload(p);
      setRows(rowsFromPayload(p));
      setEditing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (then: "home" | "import" = "home") => {
    if (
      !confirm(
        then === "import"
          ? "Supprimer le portefeuille actuel pour en importer un nouveau ?"
          : "Supprimer définitivement ce portefeuille ?",
      )
    ) {
      return;
    }
    setBusy("Suppression…");
    setError(null);
    try {
      const res = await apiFetch("/api/portfolio", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "Suppression impossible");
        setBusy(null);
        return;
      }
      router.replace(then === "import" ? "/positions" : "/start");
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  };

  const refreshMarket = async () => {
    setBusy("Cours live…");
    setError(null);
    try {
      const res = await apiFetch("/api/portfolio?market=1");
      const data = await res.json();
      if (!res.ok || !data?.portfolio) {
        setError((data as { error?: string }).error ?? "Actualisation impossible");
        return;
      }
      const p = data as PortfolioPayload;
      setPayload(p);
      setRows(rowsFromPayload(p));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!loaded || !payload || !v || !portfolio) {
    return (
      <AppShell>
        <p className="text-sm text-[var(--muted)]">{error ?? "Chargement du portefeuille…"}</p>
      </AppShell>
    );
  }

  return (
    <AppShell
      right={
        <Link href="/start" className="hover:text-[var(--text)]">
          ← Hub
        </Link>
      }
    >
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">
            Étape 1 · Positions
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[var(--text)]">
            {portfolio.name}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {portfolio.currency} · {portfolio.holdings.length} positions · importé{" "}
            {portfolio.importedAt.slice(0, 10)} · source {portfolio.source}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!editing ? (
            <>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="ord-btn ord-btn-ghost !px-3 !py-1.5 text-xs"
              >
                Modifier les lignes
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => void remove("import")}
                className="ord-btn ord-btn-ghost !px-3 !py-1.5 text-xs disabled:opacity-40"
              >
                Importer un autre
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => void remove("home")}
                className="rounded-full border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] px-3 py-1.5 text-xs text-red-700 hover:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] disabled:opacity-40"
              >
                Supprimer le portefeuille
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => void saveEdits()}
                className="ord-btn ord-btn-primary !px-3 !py-1.5 text-xs disabled:opacity-40"
              >
                {busy ?? "Enregistrer"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setRows(rowsFromPayload(payload));
                  setEditing(false);
                  setError(null);
                }}
                className="ord-btn ord-btn-ghost !px-3 !py-1.5 text-xs"
              >
                Annuler
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Valeur totale" value={fmtMoney(v.totalValue, v.currency, 2)} />
        <Stat
          label="Investi net"
          value={v.netInvested != null ? fmtMoney(v.netInvested, v.currency, 2) : "—"}
        />
        <Stat
          label="P&L"
          value={
            v.netInvested != null
              ? fmtMoney(v.totalValue - v.netInvested, v.currency, 2)
              : "—"
          }
          tone={
            v.netInvested == null
              ? undefined
              : v.totalValue - v.netInvested >= 0
                ? "up"
                : "down"
          }
        />
        <Stat
          label="P&L %"
          value={v.plPct != null ? fmtPct(v.plPct) : "—"}
          tone={v.plPct == null ? undefined : v.plPct >= 0 ? "up" : "down"}
        />
      </div>

      <p className="mb-4 text-xs text-[var(--muted)]">
        {payload.valuationSource === "market"
          ? "Totaux recalculés avec les cours de marché (peuvent différer du broker)."
          : "Totaux issus de votre import (mêmes chiffres que la revue) — pas de recalcul marché."}
        {payload.valuationSource !== "market" && (
          <>
            {" "}
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void refreshMarket()}
              className="text-[var(--accent)] underline-offset-2 hover:underline disabled:opacity-40"
            >
              Actualiser aux cours live
            </button>
          </>
        )}
      </p>

      {payload.dataErrors.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Données de marché incomplètes pour : {payload.dataErrors.slice(0, 8).join(" · ")}
          {payload.dataErrors.length > 8 ? "…" : ""}
        </div>
      )}

      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-medium text-[var(--muted)]">Positions</h2>
        <div className="ord-card overflow-hidden p-1">
          <HoldingsEditor
            holdings={rows}
            currency={portfolio.currency}
            editable={editing}
            onChange={editing ? setRows : undefined}
            maxHeightClass="max-h-[36rem]"
          />
        </div>
        {!editing && (
          <ul className="mt-3 space-y-1 text-[11px] text-[var(--muted)]">
            {rows.map((h) => {
              const w = weightMap.get(h.asset);
              if (w == null) return null;
              return (
                <li key={h.asset} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-[var(--muted)]">{h.asset}</span>
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-[#efefec]">
                    <div
                      className="h-full rounded-full bg-[var(--accent)]"
                      style={{ width: `${Math.min(100, w)}%` }}
                    />
                  </div>
                  <span className="w-12 text-right">{w.toFixed(1)} %</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="ord-card p-5">
        <h2 className="text-sm font-medium text-[var(--text)]">Tester une autre stratégie</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Ce portefeuille est votre situation actuelle (référence). Le backtest simule d’autres
          règles d’achat sur les mêmes actifs et compare le résultat.
        </p>
        <Link href="/strategy" className="ord-btn ord-btn-primary mt-4 !px-4 !py-2 text-xs">
          Configurer le backtest →
        </Link>
      </section>
    </AppShell>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
}) {
  return (
    <div className="ord-card px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p
        className={`mt-1 text-xl font-semibold tabular-nums ${
          tone === "up"
            ? "text-[var(--accent)]"
            : tone === "down"
              ? "text-[var(--danger)]"
              : "text-[var(--text)]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

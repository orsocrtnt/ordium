"use client";

import { useMemo, useState } from "react";
import type { Holding, PositionValuation } from "@ordium/portfolio";
import { normalizeAsset } from "@ordium/portfolio/normalize";
import { assetLabel } from "@/lib/assets";
import { fmtMoney } from "@/lib/format";
import type { AllocationRow } from "@/lib/strategy";

export type AllocationQuizRow = {
  asset: string;
  included: boolean;
  /** Part du budget périodique (0–100). */
  pct: number;
  fromPortfolio: boolean;
};

function normalizePct(rows: AllocationQuizRow[]): AllocationRow[] {
  const active = rows.filter((r) => r.included && r.pct > 0 && r.asset.trim());
  const sum = active.reduce((s, r) => s + r.pct, 0);
  if (active.length === 0 || sum <= 0) return [];
  const rounded = active.map((r, i) => {
    if (i === active.length - 1) {
      const prev = active
        .slice(0, -1)
        .reduce((s, x) => s + Math.round((x.pct / sum) * 1000) / 10, 0);
      return {
        asset: normalizeAsset(r.asset.trim()),
        pct: Math.round((100 - prev) * 10) / 10,
      };
    }
    return {
      asset: normalizeAsset(r.asset.trim()),
      pct: Math.round((r.pct / sum) * 1000) / 10,
    };
  });
  return rounded.filter((r) => r.pct > 0);
}

type PortfolioLine = {
  asset: string;
  quantity: number;
  value: number;
  weightPct: number;
  invested: number;
};

/** Union positions valorisées + holdings bruts (pour ne rien oublier). */
function collectPortfolioLines(
  positions: PositionValuation[],
  holdings: Holding[],
): PortfolioLine[] {
  const byAsset = new Map<string, PortfolioLine>();

  for (const h of holdings) {
    if (!(h.quantity > 0)) continue;
    const asset = normalizeAsset(h.asset);
    const value = h.value ?? (h.price != null ? h.quantity * h.price : 0);
    byAsset.set(asset, {
      asset,
      quantity: h.quantity,
      value: value > 0 ? value : 0,
      weightPct: 0,
      invested: h.invested ?? 0,
    });
  }

  for (const p of positions) {
    if (!(p.quantity > 0)) continue;
    const asset = normalizeAsset(p.asset);
    const prev = byAsset.get(asset);
    byAsset.set(asset, {
      asset,
      quantity: p.quantity,
      value: p.value ?? prev?.value ?? 0,
      weightPct: p.weightPct ?? 0,
      invested: p.invested ?? prev?.invested ?? 0,
    });
  }

  const lines = [...byAsset.values()];
  const valueSum = lines.reduce((s, l) => s + (l.value > 0 ? l.value : 0), 0);
  const weightSum = lines.reduce((s, l) => s + (l.weightPct > 0 ? l.weightPct : 0), 0);

  return lines
    .map((l) => {
      let weightPct = l.weightPct;
      if (!(weightPct > 0) && valueSum > 0 && l.value > 0) {
        weightPct = (l.value / valueSum) * 100;
      } else if (!(weightPct > 0) && weightSum <= 0 && lines.length > 0) {
        weightPct = 100 / lines.length;
      }
      return { ...l, weightPct };
    })
    .sort((a, b) => (b.weightPct || b.value) - (a.weightPct || a.value));
}

/**
 * Liste = UNIQUEMENT les lignes du portefeuille.
 * `existing` préremplit les % — y compris BTC/ETH/SOL si l’utilisateur les a choisis (chat).
 */
function seedFromPortfolio(
  positions: PositionValuation[],
  holdings: Holding[],
  existing?: AllocationRow[],
): AllocationQuizRow[] {
  const lines = collectPortfolioLines(positions, holdings);
  const usableExisting =
    existing && existing.some((a) => a.pct > 0) ? existing : undefined;
  const existingByAsset = new Map(
    (usableExisting ?? []).map((a) => [normalizeAsset(a.asset), a.pct]),
  );

  if (lines.length === 0) {
    // Pas de portefeuille : actifs du chat / ajouts manuels.
    if (usableExisting?.length) {
      return usableExisting.map((a) => ({
        asset: normalizeAsset(a.asset),
        included: a.pct > 0,
        pct: a.pct,
        fromPortfolio: false,
      }));
    }
    return [];
  }

  const weightSum = lines.reduce((s, p) => s + (p.weightPct > 0 ? p.weightPct : 0), 0);

  const fromPortfolio = lines.map((p) => {
    const fromExisting = existingByAsset.get(p.asset);
    const portfolioPct =
      weightSum > 0 ? (p.weightPct / weightSum) * 100 : 100 / lines.length;
    return {
      asset: p.asset,
      included: fromExisting != null ? fromExisting > 0 : true,
      pct:
        fromExisting != null
          ? fromExisting
          : Math.round(portfolioPct * 10) / 10,
      fromPortfolio: true,
    };
  });

  // Actifs cités hors portefeuille (ex. BTC alors que le PF n’a que des ETF).
  const extras = (usableExisting ?? [])
    .filter((a) => !fromPortfolio.some((r) => r.asset === normalizeAsset(a.asset)))
    .map((a) => ({
      asset: normalizeAsset(a.asset),
      included: a.pct > 0,
      pct: a.pct,
      fromPortfolio: false,
    }));

  return [...fromPortfolio, ...extras];
}

function equalize(rows: AllocationQuizRow[]): AllocationQuizRow[] {
  const n = rows.filter((r) => r.included).length;
  if (n === 0) return rows;
  const each = Math.round((100 / n) * 10) / 10;
  let remaining = 100;
  let seen = 0;
  return rows.map((r) => {
    if (!r.included) return { ...r, pct: 0 };
    seen += 1;
    if (seen === n) return { ...r, pct: Math.round(remaining * 10) / 10 };
    remaining -= each;
    return { ...r, pct: each };
  });
}

/** Répartit les inclus selon les poids / valeurs du portefeuille. */
function byPortfolioWeight(
  rows: AllocationQuizRow[],
  positions: PositionValuation[],
  holdings: Holding[],
): AllocationQuizRow[] {
  const lines = collectPortfolioLines(positions, holdings);
  const weightByAsset = new Map(lines.map((l) => [l.asset, l.weightPct || l.value]));

  const included = rows.filter((r) => r.included);
  if (included.length === 0) return rows;

  const weights = included.map((r) => weightByAsset.get(normalizeAsset(r.asset)) ?? 0);
  const sum = weights.reduce((s, w) => s + w, 0);

  if (sum <= 0) return equalize(rows);

  let remaining = 100;
  let assigned = 0;
  const nWeighted = weights.filter((w) => w > 0).length;

  const pctByAsset = new Map<string, number>();
  for (let i = 0; i < included.length; i++) {
    const r = included[i]!;
    const w = weights[i] ?? 0;
    if (w <= 0) {
      pctByAsset.set(r.asset, 0);
      continue;
    }
    assigned += 1;
    if (assigned === nWeighted) {
      pctByAsset.set(r.asset, Math.round(remaining * 10) / 10);
    } else {
      const pct = Math.round(((w / sum) * 100) * 10) / 10;
      remaining -= pct;
      pctByAsset.set(r.asset, pct);
    }
  }

  return rows.map((r) => {
    if (!r.included) return { ...r, pct: 0 };
    return { ...r, pct: pctByAsset.get(r.asset) ?? 0 };
  });
}

export function AllocationQuestionnaire({
  positions,
  holdings = [],
  assetNames,
  budgetAmount,
  currency,
  period,
  initialAllocation,
  onConfirm,
  onCancel,
}: {
  positions: PositionValuation[];
  /** Holdings bruts — complète les positions (actifs sans cours, etc.). */
  holdings?: Holding[];
  assetNames?: Map<string, string>;
  budgetAmount: number;
  currency: string;
  period: "weekly" | "monthly";
  initialAllocation?: AllocationRow[];
  onConfirm: (allocation: AllocationRow[]) => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState<AllocationQuizRow[]>(() =>
    seedFromPortfolio(positions, holdings, initialAllocation),
  );
  const [addSymbol, setAddSymbol] = useState("");
  const [weightMode, setWeightMode] = useState<"pct" | "amount">("pct");
  const [error, setError] = useState<string | null>(null);

  const periodWord = period === "weekly" ? "semaine" : "mois";
  const includedCount = rows.filter((r) => r.included).length;
  const pctSum = rows.filter((r) => r.included).reduce((s, r) => s + r.pct, 0);
  const preview = useMemo(() => normalizePct(rows), [rows]);
  const searchQ = addSymbol.trim().toLowerCase();
  const visibleRows = useMemo(() => {
    if (!searchQ) return rows;
    return rows.filter((r) => {
      const label = assetLabel(r.asset, assetNames).toLowerCase();
      return (
        r.asset.toLowerCase().includes(searchQ) ||
        label.includes(searchQ) ||
        normalizeAsset(searchQ) === normalizeAsset(r.asset)
      );
    });
  }, [rows, searchQ, assetNames]);

  const setIncluded = (asset: string, included: boolean) => {
    setRows((prev) => {
      const next = prev.map((r) =>
        r.asset === asset ? { ...r, included, pct: included ? (r.pct || 0) : 0 } : r,
      );
      // Si on vient d’activer sans poids → répartir équitablement les inclus.
      const row = next.find((r) => r.asset === asset);
      if (included && row && row.pct <= 0) return equalize(next);
      return next;
    });
    setError(null);
  };

  const setPct = (asset: string, pct: number) => {
    const v = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
    setRows((prev) =>
      prev.map((r) =>
        r.asset === asset ? { ...r, pct: v, included: v > 0 ? true : r.included } : r,
      ),
    );
    setError(null);
  };

  const setAmount = (asset: string, amount: number) => {
    if (!(budgetAmount > 0)) return;
    const pct = (Math.max(0, amount) / budgetAmount) * 100;
    setPct(asset, Math.round(pct * 10) / 10);
  };

  const addAsset = () => {
    const symbol = normalizeAsset(addSymbol.trim().replace(/\s+/g, ""));
    if (!symbol) return;
    if (rows.some((r) => normalizeAsset(r.asset) === symbol)) {
      setError(`${symbol} est déjà dans la liste.`);
      return;
    }
    setRows((prev) => {
      const next = [
        ...prev,
        { asset: symbol, included: true, pct: 0, fromPortfolio: false },
      ];
      return equalize(next);
    });
    setAddSymbol("");
    setError(null);
  };

  const confirm = () => {
    const allocation = normalizePct(rows);
    if (allocation.length === 0) {
      setError("Coche au moins un actif et donne-lui une part.");
      return;
    }
    onConfirm(allocation);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-[var(--text)]">
          Dans quoi continues-tu d’investir ?
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Liste = tes positions actuelles. Coche oui/non, règle la part du budget (
          {fmtMoney(budgetAmount, currency, 0)} / {periodWord}). Tu peux aussi ajouter un
          actif qui n’est pas encore dans le portefeuille.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-[var(--muted)]">Saisir en</span>
        <div className="flex rounded-lg border border-[var(--border)] p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setWeightMode("pct")}
            className={`rounded-md px-2.5 py-1 ${
              weightMode === "pct"
                ? "bg-[var(--text)] text-white"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            %
          </button>
          <button
            type="button"
            onClick={() => setWeightMode("amount")}
            className={`rounded-md px-2.5 py-1 ${
              weightMode === "amount"
                ? "bg-[var(--text)] text-white"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            {currency}
          </button>
        </div>
        <button
          type="button"
          onClick={() => setRows((r) => byPortfolioWeight(r, positions, holdings))}
          disabled={positions.length === 0 && holdings.length === 0}
          className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40"
        >
          Répartir en poids
        </button>
        <button
          type="button"
          onClick={() => setRows((r) => equalize(r))}
          className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)] hover:text-[var(--text)]"
        >
          Parts égales
        </button>
        <button
          type="button"
          onClick={() =>
            setRows((prev) =>
              prev.map((r) => ({
                ...r,
                included: r.fromPortfolio ? true : r.included,
              })),
            )
          }
          className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)] hover:text-[var(--text)]"
        >
          Tout cocher (portefeuille)
        </button>
        <button
          type="button"
          onClick={() =>
            setRows((prev) => prev.map((r) => ({ ...r, included: false, pct: 0 })))
          }
          className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)] hover:text-[var(--text)]"
        >
          Tout décocher
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
        <div className="grid grid-cols-[auto_1fr_7rem_auto] gap-2 border-b border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[10px] uppercase tracking-wide text-[var(--muted)]">
          <span>Oui</span>
          <span>Actif</span>
          <span className="text-right">{weightMode === "pct" ? "Part %" : `Montant`}</span>
          <span className="w-16 text-right">≈</span>
        </div>
        <ul className="max-h-[min(28rem,55vh)] divide-y divide-[var(--border)] overflow-y-auto">
          {rows.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-[var(--muted)]">
              Aucune position — ajoute des actifs ci-dessous.
            </li>
          ) : visibleRows.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-[var(--muted)]">
              Aucun résultat pour « {addSymbol.trim()} ». Tu peux l’ajouter avec le bouton.
            </li>
          ) : (
            visibleRows.map((r) => {
              const amount = (budgetAmount * (r.included ? r.pct : 0)) / 100;
              return (
                <li
                  key={r.asset}
                  className={`grid grid-cols-[auto_1fr_7rem_auto] items-center gap-2 px-3 py-2.5 ${
                    r.included ? "" : "opacity-55"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={r.included}
                    onChange={(e) => setIncluded(r.asset, e.target.checked)}
                    className="h-4 w-4 rounded border-[var(--border)]"
                    aria-label={`Inclure ${r.asset}`}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-[var(--text)]">
                      {assetLabel(r.asset, assetNames)}
                    </div>
                    <div className="text-[11px] text-[var(--muted)]">
                      {r.asset}
                      {!r.fromPortfolio && " · ajouté"}
                    </div>
                  </div>
                  {weightMode === "pct" ? (
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      disabled={!r.included}
                      value={r.included ? r.pct : 0}
                      onChange={(e) => setPct(r.asset, Number(e.target.value))}
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1.5 text-right text-sm tabular-nums outline-none focus:border-[var(--text)]"
                    />
                  ) : (
                    <input
                      type="number"
                      min={0}
                      step={1}
                      disabled={!r.included}
                      value={r.included ? Math.round(amount * 100) / 100 : 0}
                      onChange={(e) => setAmount(r.asset, Number(e.target.value))}
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1.5 text-right text-sm tabular-nums outline-none focus:border-[var(--text)]"
                    />
                  )}
                  <span className="w-16 text-right text-[11px] tabular-nums text-[var(--muted)]">
                    {r.included
                      ? weightMode === "pct"
                        ? fmtMoney(amount, currency, 0)
                        : `${r.pct.toFixed(0)}%`
                      : "—"}
                  </span>
                </li>
              );
            })
          )}
        </ul>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[12rem] flex-1 text-xs text-[var(--muted)]">
          Rechercher ou ajouter un actif
          <input
            type="text"
            value={addSymbol}
            onChange={(e) => setAddSymbol(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (visibleRows.length === 1 && searchQ) {
                  const only = visibleRows[0]!;
                  setIncluded(only.asset, true);
                  setAddSymbol("");
                  return;
                }
                addAsset();
              }
            }}
            placeholder="Filtrer la liste ou ajouter (ex. BTC, NVDA…)"
            className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--text)]"
          />
        </label>
        <button
          type="button"
          onClick={addAsset}
          className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg-elevated)]"
        >
          Ajouter
        </button>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--muted)]">
        {includedCount} actif{includedCount > 1 ? "s" : ""} · parts affichées{" "}
        {pctSum.toFixed(0)}%
        {preview.length > 0 && (
          <>
            {" "}
            → après normalisation :{" "}
            <span className="text-[var(--text)]">
              {preview.map((a) => `${assetLabel(a.asset, assetNames)} ${a.pct}%`).join(" · ")}
            </span>
          </>
        )}
        {includedCount > 8 && (
          <span className="mt-1 block text-amber-800">
            Au-delà de 8 actifs, le temps de chargement de la simulation sera plus
            long ({includedCount} sélectionnés).
          </span>
        )}
      </div>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={confirm}
          className="rounded-xl bg-[var(--text)] px-4 py-2.5 text-sm font-medium text-white"
        >
          Lancer la simulation
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--muted)] hover:text-[var(--text)]"
        >
          Retour au chat
        </button>
      </div>
    </div>
  );
}

"use client";

import type { Holding } from "@ordium/portfolio";
import { useMemo } from "react";

const inputCls =
  "rounded-md border border-[var(--border-strong)] bg-white px-1.5 py-1 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]";

function fmtMoney(n: number | undefined | null, currency: string): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: currency || "EUR",
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtPct(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)} %`;
}

function numOrEmpty(v: number | undefined): string {
  return v == null || !Number.isFinite(v) ? "" : String(v);
}

function parseOptionalNumber(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

/** Recalcule P&L si value / invested changent. */
export function withDerivedPnl(h: Holding): Holding {
  const next = { ...h };
  if (next.value != null && next.invested != null) {
    next.pnl = next.value - next.invested;
    next.pnlPct = next.invested > 0 ? (next.pnl / next.invested) * 100 : undefined;
  }
  if (next.avgPrice == null && next.invested != null && next.quantity > 0) {
    next.avgPrice = next.invested / next.quantity;
  }
  if (next.invested == null && next.avgPrice != null && next.quantity > 0) {
    next.invested = next.avgPrice * next.quantity;
  }
  if (next.value == null && next.price != null && next.quantity > 0) {
    next.value = next.price * next.quantity;
  }
  return next;
}

export function emptyHolding(): Holding {
  return { asset: "", quantity: 0, name: "" };
}

interface HoldingsEditorProps {
  holdings: Holding[];
  currency: string;
  editable?: boolean;
  onChange?: (holdings: Holding[]) => void;
  maxHeightClass?: string;
}

export function HoldingsEditor({
  holdings,
  currency,
  editable = true,
  onChange,
  maxHeightClass = "max-h-[28rem]",
}: HoldingsEditorProps) {
  const totals = useMemo(() => {
    const invested = holdings.reduce((s, h) => s + (h.invested ?? 0), 0);
    const value = holdings.reduce((s, h) => s + (h.value ?? 0), 0);
    const hasInvested = holdings.some((h) => h.invested != null);
    const hasValue = holdings.some((h) => h.value != null);
    const pnl = hasInvested && hasValue ? value - invested : null;
    const pnlPct = invested > 0 && pnl != null ? (pnl / invested) * 100 : null;
    return {
      invested: hasInvested ? invested : null,
      value: hasValue ? value : null,
      pnl,
      pnlPct,
      count: holdings.length,
    };
  }, [holdings]);

  const update = (index: number, patch: Partial<Holding>) => {
    if (!onChange) return;
    onChange(
      holdings.map((h, i) => (i === index ? withDerivedPnl({ ...h, ...patch }) : h)),
    );
  };

  const remove = (index: number) => {
    if (!onChange) return;
    onChange(holdings.filter((_, i) => i !== index));
  };

  const add = () => {
    if (!onChange) return;
    onChange([...holdings, emptyHolding()]);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-4 rounded-lg border border-[var(--border)] bg-[#f3f3f0] px-3 py-2 text-xs text-[var(--muted)]">
        <span>
          Lignes <span className="font-medium text-[var(--text)]">{totals.count}</span>
        </span>
        {totals.invested != null && (
          <span>
            Investi{" "}
            <span className="font-medium text-[var(--text)]">{fmtMoney(totals.invested, currency)}</span>
          </span>
        )}
        {totals.value != null && (
          <span>
            Valeur (somme des lignes){" "}
            <span className="font-medium text-[var(--text)]">{fmtMoney(totals.value, currency)}</span>
          </span>
        )}
        {totals.pnl != null && (
          <span className={totals.pnl >= 0 ? "text-[var(--accent)]" : "text-[var(--danger)]"}>
            P&L {fmtMoney(totals.pnl, currency)}
            {totals.pnlPct != null ? ` (${fmtPct(totals.pnlPct)})` : ""}
          </span>
        )}
      </div>

      <div className={`${maxHeightClass} overflow-auto rounded-lg border border-[var(--border)]`}>
        {holdings.length === 0 ? (
          <p className="p-4 text-sm text-[var(--muted)]">Aucune position.</p>
        ) : (
          <table className="w-full min-w-[52rem] border-collapse text-left text-[11px]">
            <thead className="sticky top-0 z-10 bg-white text-[var(--muted)]">
              <tr>
                <th className="px-2 py-2 font-medium">Ticker</th>
                <th className="px-2 py-2 font-medium">Nom</th>
                <th className="px-2 py-2 font-medium text-right">Qté</th>
                <th className="px-2 py-2 font-medium text-right">Cours</th>
                <th className="px-2 py-2 font-medium text-right">PRU</th>
                <th className="px-2 py-2 font-medium text-right">Investi</th>
                <th className="px-2 py-2 font-medium text-right">Valeur</th>
                <th className="px-2 py-2 font-medium text-right">P&L</th>
                <th className="px-2 py-2 font-medium text-right">P&L %</th>
                {editable && <th className="px-2 py-2" />}
              </tr>
            </thead>
            <tbody>
              {holdings.map((h, i) => {
                const pnl =
                  h.pnl ?? (h.value != null && h.invested != null ? h.value - h.invested : null);
                const pnlPct =
                  h.pnlPct ??
                  (h.invested != null && h.invested > 0 && pnl != null
                    ? (pnl / h.invested) * 100
                    : null);
                const inconsistent =
                  h.quantity > 0 &&
                  h.price != null &&
                  h.value != null &&
                  Math.abs(h.quantity * h.price - h.value) / Math.max(h.value, 1) > 0.03;

                return (
                  <tr
                    key={`${h.asset}-${i}`}
                    className={`border-t border-[var(--border)] ${
                      inconsistent ? "bg-[color-mix(in_srgb,var(--warning)_10%,transparent)]" : "bg-[#fafaf8]"
                    }`}
                  >
                    <td className="px-1.5 py-1">
                      {editable ? (
                        <input
                          value={h.asset}
                          onChange={(e) => update(i, { asset: e.target.value.toUpperCase() })}
                          className={`${inputCls} w-[4.75rem] font-medium`}
                        />
                      ) : (
                        <span className="font-medium text-[var(--text)]">{h.asset}</span>
                      )}
                    </td>
                    <td className="px-1.5 py-1">
                      {editable ? (
                        <input
                          value={h.name ?? ""}
                          onChange={(e) =>
                            update(i, {
                              name: e.target.value.trim() === "" ? undefined : e.target.value,
                            })
                          }
                          className={`${inputCls} w-40`}
                          placeholder="Nom complet"
                        />
                      ) : (
                        <span className="text-[var(--muted)]">{h.name ?? "—"}</span>
                      )}
                    </td>
                    {(
                      [
                        ["quantity", h.quantity, false],
                        ["price", h.price, true],
                        ["avgPrice", h.avgPrice, true],
                        ["invested", h.invested, true],
                        ["value", h.value, true],
                      ] as const
                    ).map(([key, val, optional]) => (
                      <td key={key} className="px-1.5 py-1">
                        {editable ? (
                          <input
                            type="number"
                            step="any"
                            value={optional ? numOrEmpty(val as number | undefined) : (val as number)}
                            placeholder="—"
                            onChange={(e) => {
                              if (key === "quantity") {
                                update(i, { quantity: Number(e.target.value) || 0 });
                              } else {
                                update(i, { [key]: parseOptionalNumber(e.target.value) });
                              }
                            }}
                            className={`${inputCls} w-[4.75rem] text-right`}
                          />
                        ) : (
                          <span className="block text-right tabular-nums text-[var(--muted)]">
                            {val == null ? "—" : Number(val).toLocaleString("fr-FR")}
                          </span>
                        )}
                      </td>
                    ))}
                    <td
                      className={`px-2 py-1 text-right tabular-nums ${
                        pnl == null
                          ? "text-[var(--muted)]"
                          : pnl >= 0
                            ? "text-[var(--accent)]"
                            : "text-[var(--danger)]"
                      }`}
                    >
                      {fmtMoney(pnl, currency)}
                    </td>
                    <td
                      className={`px-2 py-1 text-right tabular-nums ${
                        pnlPct == null
                          ? "text-[var(--muted)]"
                          : pnlPct >= 0
                            ? "text-[var(--accent)]"
                            : "text-[var(--danger)]"
                      }`}
                    >
                      {fmtPct(pnlPct)}
                    </td>
                    {editable && (
                      <td className="px-1.5 py-1">
                        <button
                          type="button"
                          onClick={() => remove(i)}
                          className="text-[var(--muted)] hover:text-[var(--danger)]"
                          aria-label="Supprimer"
                        >
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editable && onChange && (
        <button
          type="button"
          onClick={add}
          className="text-xs text-[var(--accent)] hover:text-[var(--accent-hover)]"
        >
          + Ajouter une ligne
        </button>
      )}
    </div>
  );
}

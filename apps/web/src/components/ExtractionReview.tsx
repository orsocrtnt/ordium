"use client";

import { useState } from "react";
import type { Holding, Transaction } from "@ordium/portfolio";
import { HoldingsEditor } from "./HoldingsEditor";

export interface ExtractionDraft {
  usedLlm: boolean;
  kind: "transactions" | "holdings";
  currency: string;
  name: string;
  transactions: Transaction[];
  holdings: Holding[];
  warnings: string[];
  summary: string;
}

const inputCls =
  "rounded-md border border-[var(--border-strong)] bg-white px-1.5 py-1 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]";

interface ExtractionReviewProps {
  draft: ExtractionDraft;
  busy: boolean;
  onChange: (draft: ExtractionDraft) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ExtractionReview({
  draft,
  busy,
  onChange,
  onConfirm,
  onCancel,
}: ExtractionReviewProps) {
  const [tab, setTab] = useState<"transactions" | "holdings">(
    draft.kind === "holdings" && draft.transactions.length === 0 ? "holdings" : "transactions",
  );

  const updateTx = (index: number, patch: Partial<Transaction>) => {
    const transactions = draft.transactions.map((t, i) => (i === index ? { ...t, ...patch } : t));
    onChange({ ...draft, transactions, kind: "transactions" });
  };

  const removeTx = (index: number) => {
    onChange({
      ...draft,
      transactions: draft.transactions.filter((_, i) => i !== index),
    });
  };

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--accent-soft)] p-4">
      <div>
        <h4 className="text-sm font-semibold text-[var(--accent)]">Vérifiez les lignes</h4>
        <p className="mt-0.5 text-xs text-[var(--muted)]">{draft.summary}</p>
        <p className="mt-1 text-[11px] text-[var(--muted)]">
          {draft.usedLlm ? "Analysé par Gemini" : "Lu sans IA"} · {draft.currency} — corrigez tout
          écart avant de valider (lignes ambre = incohérence qté×cours).
        </p>
        <label className="mt-2 block text-[11px] text-[var(--muted)]">
          Nom du portefeuille
          <input
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            className={`${inputCls} mt-1 block w-full max-w-md text-sm`}
          />
        </label>
      </div>

      {draft.warnings.length > 0 && (
        <ul className="max-h-28 space-y-0.5 overflow-y-auto text-xs text-amber-800">
          {draft.warnings.map((w, i) => (
            <li key={i}>• {w}</li>
          ))}
        </ul>
      )}

      <div className="flex gap-2 text-xs">
        <button
          type="button"
          onClick={() => setTab("transactions")}
          className={`rounded-full px-3 py-1 ${
            tab === "transactions"
              ? "bg-[#efefec] text-[var(--text)]"
              : "text-[var(--muted)] hover:text-[var(--text)]"
          }`}
        >
          Transactions ({draft.transactions.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("holdings")}
          className={`rounded-full px-3 py-1 ${
            tab === "holdings" ? "bg-[#efefec] text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]"
          }`}
        >
          Positions ({draft.holdings.length})
        </button>
      </div>

      {tab === "transactions" ? (
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {draft.transactions.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">Aucune transaction — basculez sur Positions.</p>
          ) : (
            draft.transactions.map((t, i) => (
              <div
                key={i}
                className="flex flex-wrap items-center gap-1 rounded-lg border border-[var(--border)] bg-[#fafaf8] p-1.5"
              >
                <input
                  type="date"
                  value={t.date}
                  onChange={(e) => updateTx(i, { date: e.target.value })}
                  className={`${inputCls} w-[7.5rem]`}
                />
                <select
                  value={t.side}
                  onChange={(e) => updateTx(i, { side: e.target.value as "buy" | "sell" })}
                  className={inputCls}
                >
                  <option value="buy">achat</option>
                  <option value="sell">vente</option>
                </select>
                <input
                  value={t.asset}
                  onChange={(e) => updateTx(i, { asset: e.target.value.toUpperCase() })}
                  className={`${inputCls} w-14`}
                />
                <input
                  type="number"
                  step="any"
                  value={t.quantity}
                  onChange={(e) => updateTx(i, { quantity: Number(e.target.value) })}
                  className={`${inputCls} w-16 text-right`}
                />
                <input
                  type="number"
                  step="any"
                  value={t.price ?? ""}
                  placeholder="prix"
                  onChange={(e) =>
                    updateTx(i, {
                      price: e.target.value === "" ? undefined : Number(e.target.value),
                    })
                  }
                  className={`${inputCls} w-16 text-right`}
                />
                <button
                  type="button"
                  onClick={() => removeTx(i)}
                  className="ml-auto text-[var(--muted)] hover:text-[var(--danger)]"
                  aria-label="Supprimer"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>
      ) : (
        <HoldingsEditor
          holdings={draft.holdings}
          currency={draft.currency}
          editable
          onChange={(holdings) =>
            onChange({
              ...draft,
              holdings,
              kind: draft.transactions.length ? draft.kind : "holdings",
            })
          }
        />
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="ord-btn ord-btn-primary !px-3 !py-1.5 text-xs disabled:opacity-40"
        >
          {busy ? "Enregistrement…" : "Valider le portefeuille"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="ord-btn ord-btn-ghost !px-3 !py-1.5 text-xs"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}

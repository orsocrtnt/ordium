"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { PortfolioPayload } from "@/lib/types";
import { fmtMoney, fmtNum, fmtPct } from "@/lib/format";
import { ExtractionReview, type ExtractionDraft } from "./ExtractionReview";

const inputCls =
  "rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 outline-none focus:border-emerald-500";

interface PortfolioPanelProps {
  currency: string;
  onPortfolioChange: (
    payload: PortfolioPayload | null,
    reason?: "load" | "import" | "delete",
  ) => void;
  onUseAllocation: (rows: { asset: string; pct: number }[]) => void;
}

export function PortfolioPanel({ currency, onPortfolioChange, onUseAllocation }: PortfolioPanelProps) {
  const [payload, setPayload] = useState<PortfolioPayload | null>(null);
  const [draft, setDraft] = useState<ExtractionDraft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"api" | null>(null);
  const [exchange, setExchange] = useState("trading212");
  const [apiEnvironment, setApiEnvironment] = useState<"paper" | "live">("paper");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const apply = (data: PortfolioPayload | null, reason: "load" | "import" | "delete") => {
    setPayload(data);
    onPortfolioChange(data, reason);
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch("/api/portfolio");
        const data = await res.json();
        if (res.ok && data) apply(data as PortfolioPayload, "load");
      } catch {
        // pas de portefeuille : état initial normal
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Extraction intelligente → revue des lignes (1 ou N fichiers). */
  const extractFiles = async (fileList: FileList | File[]) => {
    const files = [...fileList];
    if (files.length === 0) return;
    setBusy(
      files.some((f) => /\.(pdf|png|jpe?g|webp|gif|heic)$/i.test(f.name))
        ? `Analyse Gemini (${files.length} fichier${files.length > 1 ? "s" : ""})…`
        : `Lecture de ${files.length} fichier${files.length > 1 ? "s" : ""}…`,
    );
    setError(null);
    setDraft(null);
    try {
      const form = new FormData();
      for (const file of files) form.append("file", file);
      form.set("currency", currency);
      const res = await apiFetch("/api/portfolio/extract", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Erreur inconnue");
        return;
      }
      setDraft(data as ExtractionDraft);
      setMode(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const confirmDraft = async () => {
    if (!draft) return;
    setBusy("Enregistrement du portefeuille…");
    setError(null);
    try {
      const res = await apiFetch("/api/portfolio/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Erreur inconnue");
        return;
      }
      apply(data as PortfolioPayload, "import");
      setDraft(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const connect = async () => {
    setBusy("Connexion au broker…");
    setError(null);
    try {
      const res = await apiFetch("/api/portfolio/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exchange,
          apiKey,
          apiSecret,
          currency,
          ...((exchange === "alpaca" || exchange === "trading212")
            ? { environment: apiEnvironment }
            : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Erreur inconnue");
      else {
        apply(data as PortfolioPayload, "import");
        setMode(null);
        setDraft(null);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApiKey("");
      setApiSecret("");
      setBusy(null);
    }
  };

  const remove = async () => {
    await apiFetch("/api/portfolio", { method: "DELETE" });
    apply(null, "delete");
    setDraft(null);
  };

  const v = payload?.valuation;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">Mon portefeuille</h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            {payload
              ? `${payload.portfolio.name} · importé ${payload.portfolio.importedAt.slice(0, 10)}`
              : "PDF, Excel, screenshot ou clé API lecture seule"}
          </p>
        </div>
        {payload && (
          <button
            type="button"
            onClick={remove}
            className="text-xs text-zinc-600 hover:text-red-600"
          >
            supprimer
          </button>
        )}
      </div>

      {payload && v && !draft && (
        <div className="mt-3 space-y-3">
          <div className="flex items-baseline gap-3">
            <span className="text-xl font-semibold text-zinc-900">
              {fmtMoney(v.totalValue, v.currency)}
            </span>
            {v.plPct != null && (
              <span className={v.plPct >= 0 ? "text-sm text-emerald-700" : "text-sm text-red-600"}>
                {fmtPct(v.plPct)}
              </span>
            )}
            {v.netInvested != null && (
              <span className="text-xs text-zinc-500">
                investi net : {fmtMoney(v.netInvested, v.currency)}
              </span>
            )}
          </div>

          <div className="space-y-1">
            {v.positions.map((p) => {
              const name = payload.portfolio.holdings.find((h) => h.asset === p.asset)?.name;
              return (
              <div key={p.asset} className="flex items-center gap-2 text-xs">
                <span className="w-28 shrink-0 truncate" title={name ? `${p.asset} — ${name}` : p.asset}>
                  <span className="font-medium text-zinc-800">{p.asset}</span>
                  {name && <span className="ml-1 text-zinc-500">{name}</span>}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className="h-full rounded-full bg-emerald-500"
                    style={{ width: `${Math.min(100, p.weightPct ?? 0)}%` }}
                  />
                </div>
                <span className="w-12 shrink-0 text-right text-zinc-600">
                  {p.weightPct != null ? `${p.weightPct.toFixed(1)} %` : "—"}
                </span>
                <span className="w-20 shrink-0 text-right text-zinc-700">
                  {p.value != null ? fmtMoney(p.value, v.currency) : "sans prix"}
                </span>
                <span className="w-14 shrink-0 text-right text-zinc-500" title="P&L vs coût moyen">
                  {p.plPct != null ? fmtPct(p.plPct) : ""}
                </span>
              </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span>
              {payload.portfolio.transactions.length > 0
                ? `${payload.portfolio.transactions.length} transactions depuis ${payload.firstTransactionDate}`
                : "positions seules (pas d'historique de transactions)"}
            </span>
            {v.positions.some((p) => p.avgCost != null) && (
              <span>
                · coût moyen :{" "}
                {v.positions
                  .filter((p) => p.avgCost != null)
                  .map((p) => `${p.asset} ${fmtNum(p.avgCost!)}`)
                  .join(", ")}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() =>
              onUseAllocation(
                v.positions
                  .filter((p) => p.weightPct != null && p.weightPct >= 0.5)
                  .map((p) => ({ asset: p.asset, pct: Math.round(p.weightPct!) })),
              )
            }
            className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-200"
          >
            Utiliser comme répartition de la stratégie
          </button>

          {(payload.portfolio.warnings.length > 0 || payload.dataErrors.length > 0) && (
            <div className="space-y-1 text-xs text-amber-700">
              {[...payload.portfolio.warnings, ...payload.dataErrors].map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {draft && (
        <ExtractionReview
          draft={draft}
          busy={Boolean(busy)}
          onChange={setDraft}
          onConfirm={() => void confirmDraft()}
          onCancel={() => setDraft(null)}
        />
      )}

      <div className="mt-3 space-y-2">
        {busy && !draft ? (
          <p className="text-xs text-amber-700">{busy}</p>
        ) : mode === null && !draft ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
            >
              {payload ? "Réimporter" : "Importer"} PDF / Excel / screenshots
            </button>
            <button
              type="button"
              onClick={() => setMode("api")}
              className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-200"
            >
              Connecter un broker
            </button>
          </div>
        ) : mode === "api" ? (
          <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-700">Connexion par clé API</span>
              <button
                type="button"
                onClick={() => setMode(null)}
                className="text-xs text-zinc-600 hover:text-zinc-600"
              >
                annuler
              </button>
            </div>
            <p className="text-xs text-zinc-500">
              Créez une clé <strong className="text-zinc-700">en lecture seule</strong> (sans droit
              de trade ni de retrait). Elle sert uniquement à lire vos positions, puis est
              immédiatement oubliée — jamais stockée. Paper/demo OK pour Alpaca et Trading 212.
            </p>
            <select
              value={exchange}
              onChange={(e) => setExchange(e.target.value)}
              className={`${inputCls} w-full`}
            >
              <optgroup label="Actions / ETF">
                <option value="trading212">Trading 212</option>
                <option value="alpaca">Alpaca</option>
                <option value="ibkr">Interactive Brokers (Flex)</option>
              </optgroup>
              <optgroup label="Crypto">
                <option value="binance">Binance</option>
                <option value="kraken">Kraken</option>
                <option value="coinbase">Coinbase (clé CDP)</option>
              </optgroup>
            </select>
            {(exchange === "alpaca" || exchange === "trading212") && (
              <select
                value={apiEnvironment}
                onChange={(e) => setApiEnvironment(e.target.value as "paper" | "live")}
                className={`${inputCls} w-full`}
              >
                <option value="paper">Paper / demo</option>
                <option value="live">Live</option>
              </select>
            )}
            <input
              type="text"
              placeholder={
                exchange === "coinbase"
                  ? "Nom de la clé (organizations/…)"
                  : exchange === "ibkr"
                    ? "Token Flex Web Service"
                    : exchange === "alpaca"
                      ? "APCA-API-KEY-ID"
                      : "Clé API"
              }
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className={`${inputCls} w-full`}
            />
            <textarea
              placeholder={
                exchange === "coinbase"
                  ? "Clé privée (PEM)"
                  : exchange === "ibkr"
                    ? "Query ID (Flex Query)"
                    : exchange === "alpaca"
                      ? "APCA-API-SECRET-KEY"
                      : "Secret API"
              }
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              rows={exchange === "coinbase" ? 3 : 1}
              className={`${inputCls} w-full resize-none`}
            />
            <button
              type="button"
              onClick={connect}
              disabled={!apiKey.trim() || !apiSecret.trim()}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              Récupérer mon portefeuille
            </button>
          </div>
        ) : null}
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".csv,.tsv,.txt,.xlsx,.xls,.pdf,.png,.jpg,.jpeg,.webp,.gif,.heic,image/*,application/pdf"
          className="hidden"
          onChange={(e) => {
            const list = e.target.files;
            if (list && list.length > 0) void extractFiles(list);
            e.target.value = "";
          }}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        {!payload && !mode && !draft && (
          <p className="text-xs text-zinc-600">
            Sélectionnez un ou plusieurs fichiers (captures d&apos;écran successives OK). CSV/Excel
            lus directement ; PDF et images analysés par Gemini — vous validez les lignes avant
            enregistrement.
          </p>
        )}
      </div>
    </div>
  );
}

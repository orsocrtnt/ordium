"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { BROKER_AUTH } from "@/lib/broker-auth";
import { brokerById, type ConnectableBrokerId } from "@/lib/broker-guide";
import { openBrokerSite, saveBrokerChoice } from "@/lib/broker-links";

type Props = {
  brokerId: ConnectableBrokerId;
  currency?: string;
  onLinked?: (brokerId: ConnectableBrokerId) => void;
};

/** Un bouton Connecter + tutoriel libellés officiels (interfaces brokers). */
export function BrokerConnectFlow({ brokerId, currency = "EUR", onLinked }: Props) {
  const broker = brokerById(brokerId);
  const auth = BROKER_AUTH[brokerId];

  const [started, setStarted] = useState(false);
  const [environment, setEnvironment] = useState<"paper" | "live">("paper");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStarted(false);
    setApiKey("");
    setApiSecret("");
    setError(null);
    setEnvironment("paper");
  }, [brokerId]);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/portfolio/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exchange: brokerId,
          apiKey: apiKey.trim(),
          apiSecret: apiSecret.trim(),
          currency,
          ...(auth.hasEnvironment ? { environment } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Connexion impossible");
        return;
      }
      saveBrokerChoice(brokerId, "opened");
      onLinked?.(brokerId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = apiKey.trim().length > 0 && apiSecret.trim().length > 0;

  return (
    <div className="space-y-4 border-t border-[var(--border)] pt-4">
      {!started ? (
        <>
          <p className="text-sm text-[var(--muted)]">
            Guide pas-à-pas avec les libellés exacts de l’interface {broker.name}, puis collage de
            votre clé.
          </p>
          <button type="button" className="ord-btn ord-btn-primary" onClick={() => setStarted(true)}>
            Connecter {broker.name}
          </button>
        </>
      ) : (
        <>
          <div>
            <p className="text-sm font-medium text-[var(--text)]">
              Guide {broker.name}
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Les noms entre guillemets (« … ») sont ceux affichés sur le site / l’app du broker
              (souvent en anglais).
            </p>
            <ol className="mt-4 list-decimal space-y-4 pl-5 text-sm leading-relaxed text-[var(--muted)]">
              {auth.tutorial.map((s, i) => (
                <li key={`${i}-${s.title}`}>
                  <span className="font-medium text-[var(--text)]">{s.title}</span>
                  <p className="mt-1">{s.body}</p>
                  {s.linkUrl && (
                    <button
                      type="button"
                      className="mt-1.5 text-xs text-[var(--accent)] underline"
                      onClick={() => openBrokerSite(s.linkUrl!)}
                    >
                      {s.linkLabel ?? "Ouvrir le lien"}
                    </button>
                  )}
                </li>
              ))}
            </ol>
          </div>

          <div className="space-y-3 border-t border-[var(--border)] pt-4">
            <p className="text-sm font-medium text-[var(--text)]">Coller vos identifiants</p>

            {auth.hasEnvironment && (
              <label className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                Environnement
                <select
                  className="ord-input w-auto py-1"
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value as "paper" | "live")}
                >
                  <option value="paper">{auth.paperLabel ?? "Paper / demo"}</option>
                  <option value="live">{auth.liveLabel ?? "Live"}</option>
                </select>
              </label>
            )}

            <input
              className="ord-input font-mono text-sm"
              placeholder={auth.keyHint}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <textarea
              className="ord-input min-h-[2.5rem] resize-y font-mono text-sm"
              placeholder={auth.secretHint}
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              rows={brokerId === "coinbase" ? 5 : 2}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="button"
            className="ord-btn ord-btn-primary disabled:opacity-40"
            disabled={busy || !canSubmit}
            onClick={() => void connect()}
          >
            {busy ? "Connexion…" : `Connecter ${broker.name}`}
          </button>

          {(brokerId === "alpaca" || brokerId === "binance") && (
            <p className="text-xs text-[var(--muted)]">
              Pour placer des ordres, programmer un DCA ou retirer :{" "}
              <Link href="/execution" className="text-[var(--accent)] underline">
                page Exécution
              </Link>{" "}
              (activer la même clé en mode paper d’abord).
            </p>
          )}
        </>
      )}
    </div>
  );
}

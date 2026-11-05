"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { Holding } from "@ordium/portfolio";
import { AppShell } from "@/components/AppShell";
import { ExtractionReview, type ExtractionDraft } from "@/components/ExtractionReview";
import { emptyHolding, HoldingsEditor } from "@/components/HoldingsEditor";
import { RequireAuth } from "@/components/RequireAuth";
import { apiFetch } from "@/lib/api";

export default function CreatePage() {
  return (
    <RequireAuth>
      <CreateContent />
    </RequireAuth>
  );
}

function CreateContent() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("Mon portefeuille");
  const [currency, setCurrency] = useState("EUR");
  const [holdings, setHoldings] = useState<Holding[]>([emptyHolding()]);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ExtractionDraft | null>(null);

  const save = async () => {
    const cleaned = holdings.filter((h) => h.asset.trim() && h.quantity > 0);
    if (cleaned.length === 0) {
      setError("Ajoutez au moins une position (ticker + quantité).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/portfolio/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usedLlm: false,
          source: "manual",
          kind: "holdings",
          currency,
          name: name.trim() || "Mon portefeuille",
          transactions: [],
          holdings: cleaned,
          warnings: [],
          summary: "Portefeuille créé manuellement.",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Erreur inconnue");
        return;
      }
      router.push("/portfolio");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const uploadTemplate = async (fileList: FileList | File[]) => {
    const files = [...fileList];
    if (files.length === 0) return;
    setBusyLabel("Lecture du fichier…");
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
      const extracted = data as ExtractionDraft;
      setDraft({
        ...extracted,
        name: name.trim() || extracted.name || "Mon portefeuille",
        currency,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyLabel(null);
    }
  };

  const confirmDraft = async () => {
    if (!draft) return;
    setBusyLabel("Enregistrement…");
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
      router.push("/portfolio");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyLabel(null);
    }
  };

  return (
    <AppShell
      right={
        <Link href="/positions" className="hover:text-[var(--text)]">
          ← Positions
        </Link>
      }
    >
      <div className="mb-8 max-w-2xl">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">
          Étape 1 · Saisie manuelle
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-[var(--text)] sm:text-3xl">
          Nouveau portefeuille
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Saisie manuelle ligne à ligne, ou modèle Excel à télécharger, remplir, puis re-uploader.
          Aucune clé API.
        </p>
        <p className="mt-2 text-xs text-[var(--muted)]">
          Vous avez déjà un export broker ?{" "}
          <Link href="/import" className="text-[var(--accent)] underline">
            Importer un fichier
          </Link>
        </p>
      </div>

      {/* Modèle Excel */}
      <section className="ord-card mb-8 p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-[var(--text)]">Modèle Excel Ordium</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Fichier vide à remplir : Actif, Quantité, prix d’achat, investi, cours, valeur, P&amp;L…
          Seuls Actif et Quantité sont indispensables. Onglets Accueil (consignes) et Positions.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href="/templates/Ordium-%C3%A9tat%20portefeuille%20actuel.xlsx"
            download="Ordium-état portefeuille actuel.xlsx"
            className="ord-btn ord-btn-primary !px-4 !py-2 text-xs"
          >
            Télécharger le modèle (.xlsx)
          </a>
          <a
            href="/templates/Ordium-%C3%A9tat%20portefeuille%20actuel.csv"
            download="Ordium-état portefeuille actuel.csv"
            className="ord-btn ord-btn-ghost !px-4 !py-2 text-xs"
          >
            Version CSV
          </a>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const list = e.target.files;
              if (list && list.length > 0) void uploadTemplate(list);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={!!busyLabel}
            onClick={() => fileRef.current?.click()}
            className="ord-btn ord-btn-ghost !px-4 !py-2 text-xs disabled:opacity-40"
          >
            {busyLabel ?? "Uploader mon fichier rempli"}
          </button>
        </div>
      </section>

      {draft && (
        <div className="mb-8">
          <ExtractionReview
            draft={draft}
            busy={!!busyLabel}
            onChange={setDraft}
            onConfirm={() => void confirmDraft()}
            onCancel={() => setDraft(null)}
          />
        </div>
      )}

      {!draft && (
        <>
          <div className="mb-4 flex flex-wrap gap-4">
            <label className="block text-xs text-[var(--muted)]">
              Nom
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="ord-input mt-1 w-56"
              />
            </label>
            <label className="block text-xs text-[var(--muted)]">
              Devise
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="ord-input mt-1 w-28"
              >
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
              </select>
            </label>
          </div>

          <div className="ord-card overflow-hidden p-1">
            <HoldingsEditor holdings={holdings} currency={currency} onChange={setHoldings} />
          </div>

          {error && (
            <p className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="mt-6 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void save()}
              className="ord-btn ord-btn-primary disabled:opacity-40"
            >
              {busy ? "Enregistrement…" : "Enregistrer"}
            </button>
            <Link href="/start" className="ord-btn ord-btn-ghost">
              Annuler
            </Link>
          </div>
        </>
      )}

      {error && draft && (
        <p className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </AppShell>
  );
}

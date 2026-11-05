"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ExtractionReview, type ExtractionDraft } from "@/components/ExtractionReview";
import { RequireAuth } from "@/components/RequireAuth";
import { apiFetch } from "@/lib/api";
import type { PortfolioPayload } from "@/lib/types";

export default function ImportPage() {
  return (
    <RequireAuth>
      <ImportContent />
    </RequireAuth>
  );
}

function ImportContent() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [currency, setCurrency] = useState("EUR");
  const [draft, setDraft] = useState<ExtractionDraft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [existingName, setExistingName] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch("/api/portfolio");
        const data = await res.json();
        if (res.ok && data?.portfolio?.name) {
          setExistingName(String(data.portfolio.name));
        }
      } catch {
        // ignore
      }
    })();
  }, []);

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
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const confirmDraft = async () => {
    if (!draft) return;
    if (
      existingName &&
      !confirm(
        `Un portefeuille « ${existingName} » existe déjà. Le valider le remplacera entièrement. Continuer ?`,
      )
    ) {
      return;
    }
    setBusy("Enregistrement…");
    setError(null);
    try {
      if (existingName) {
        await apiFetch("/api/portfolio", { method: "DELETE" });
      }
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
      void (data as PortfolioPayload);
      router.push("/portfolio");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const deleteExisting = async () => {
    if (!existingName) return;
    if (!confirm(`Supprimer « ${existingName} » ?`)) return;
    setBusy("Suppression…");
    setError(null);
    try {
      const res = await apiFetch("/api/portfolio", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "Suppression impossible");
        return;
      }
      setExistingName(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <AppShell
      right={
        <Link href={existingName ? "/portfolio" : "/positions"} className="hover:text-[var(--text)]">
          {existingName ? "← Portefeuille" : "← Positions"}
        </Link>
      }
    >
      <div className="mb-6 max-w-2xl">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">
          Étape 1 · Import fichier
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-[var(--text)] sm:text-3xl">
          Importer un portefeuille
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          PDF, Excel, CSV ou captures d’écran. Vérifiez puis corrigez les lignes avant de valider.
          Pas de clé API.
        </p>
        <p className="mt-2 text-xs text-[var(--muted)]">
          Préférez la saisie ligne à ligne ?{" "}
          <Link href="/create" className="text-[var(--accent)] underline">
            Saisie manuelle
          </Link>
        </p>
      </div>

      <section className="ord-card mb-6 p-5">
        <h2 className="text-sm font-semibold text-[var(--text)]">Pas encore de fichier broker ?</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Téléchargez le modèle Excel Ordium (vide), remplissez vos positions, puis uploadez-le
          ci-dessous. Seuls Actif et Quantité sont indispensables — plus vous ajoutez de détails,
          mieux c’est.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href="/templates/Ordium-%C3%A9tat%20portefeuille%20actuel.xlsx"
            download="Ordium-état portefeuille actuel.xlsx"
            className="ord-btn ord-btn-primary !px-4 !py-2 text-xs"
          >
            Télécharger le modèle Excel
          </a>
          <a
            href="/templates/Ordium-%C3%A9tat%20portefeuille%20actuel.csv"
            download="Ordium-état portefeuille actuel.csv"
            className="ord-btn ord-btn-ghost !px-4 !py-2 text-xs"
          >
            Version CSV
          </a>
        </div>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-[var(--muted)]">
          <li>
            <span className="text-[var(--text)]">Accueil</span> — logo, titre et légende des
            colonnes
          </li>
          <li>
            <span className="text-[var(--text)]">Positions</span> — tableau vide à remplir (Actif,
            prix d’achat, investi, cours, valeur, P&amp;L…)
          </li>
        </ul>
      </section>

      {existingName && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-4 py-3 text-sm text-amber-800">
          <p>
            Portefeuille actuel : <span className="font-medium text-[var(--text)]">{existingName}</span>.
            Valider un import le remplacera.
          </p>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void deleteExisting()}
            className="rounded-full border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] px-3 py-1.5 text-xs text-red-700 hover:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] disabled:opacity-40"
          >
            Supprimer l’actuel
          </button>
        </div>
      )}

      <div className="ord-card flex flex-wrap items-end gap-3 p-4">
        <label className="text-xs text-[var(--muted)]">
          Devise
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="ord-input mt-1 block w-28"
          >
            <option value="EUR">EUR</option>
            <option value="USD">USD</option>
          </select>
        </label>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".csv,.tsv,.txt,.xlsx,.xls,.pdf,.png,.jpg,.jpeg,.webp,.gif,.heic,image/*"
          className="hidden"
          onChange={(e) => {
            const list = e.target.files;
            if (list && list.length > 0) void extractFiles(list);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={!!busy}
          onClick={() => fileRef.current?.click()}
          className="ord-btn ord-btn-primary disabled:opacity-40"
        >
          {busy ?? "Choisir des fichiers"}
        </button>
      </div>

      {error && (
        <p className="mt-3 whitespace-pre-wrap rounded-lg border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {draft && (
        <div className="mt-6">
          <ExtractionReview
            draft={draft}
            busy={!!busy}
            onChange={setDraft}
            onConfirm={() => void confirmDraft()}
            onCancel={() => setDraft(null)}
          />
        </div>
      )}
    </AppShell>
  );
}

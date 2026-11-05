"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { apiFetch } from "@/lib/api";
import { hasSkippedPositions, markPositionsSkipped } from "@/lib/journeyProgress";

/**
 * Étape 1 du parcours : lignes de position, sans clé API broker.
 * Tous les modes d’import déjà en place (fichier, modèle, saisie manuelle).
 */
export default function PositionsPage() {
  return (
    <RequireAuth>
      <PositionsContent />
    </RequireAuth>
  );
}

function PositionsContent() {
  const router = useRouter();
  const [hasPortfolio, setHasPortfolio] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSkipped(hasSkippedPositions());
    (async () => {
      try {
        const res = await apiFetch("/api/portfolio");
        const data = await res.json();
        if (res.ok && data?.portfolio) {
          setHasPortfolio(true);
          setName(String(data.portfolio.name ?? "Portefeuille"));
          setCount(Array.isArray(data.portfolio.holdings) ? data.portfolio.holdings.length : 0);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const skipNoPositions = () => {
    markPositionsSkipped();
    setSkipped(true);
    router.push("/strategy");
  };

  return (
    <AppShell
      right={
        <Link href="/start" className="hover:text-[var(--text)]">
          ← Parcours
        </Link>
      }
    >
      <section className="max-w-2xl">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">
          Étape 1 · Positions
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--text)] sm:text-4xl">
          Vos lignes de position
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">
          Pas besoin de clé API pour démarrer. Importez ou saisissez ce que vous détenez — la
          stratégie et le backtest s’appuient sur ces lignes. La connexion broker vient à la fin,
          seulement pour automatiser les ordres.
        </p>
      </section>

      {loading ? (
        <p className="mt-8 text-sm text-[var(--muted)]">Chargement…</p>
      ) : hasPortfolio ? (
        <div className="mt-8 max-w-2xl rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
          <p className="text-sm text-[var(--muted)]">Portefeuille actuel</p>
          <p className="mt-1 text-lg font-semibold text-[var(--text)]">
            {name}
            <span className="ml-2 text-sm font-normal text-[var(--muted)]">
              · {count} ligne{count > 1 ? "s" : ""}
            </span>
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/portfolio" className="ord-btn ord-btn-primary !px-4 !py-2 text-xs">
              Voir / modifier les lignes
            </Link>
            <Link href="/strategy" className="ord-btn ord-btn-ghost !px-4 !py-2 text-xs">
              Continuer →
            </Link>
          </div>
        </div>
      ) : skipped ? (
        <div className="mt-8 max-w-2xl rounded-xl border border-emerald-200 bg-emerald-50/80 p-5">
          <p className="text-sm font-medium text-emerald-800">Pas de positions enregistrées</p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Tu pourras en ajouter plus tard. En attendant, enchaîne sur la stratégie.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/strategy" className="ord-btn ord-btn-primary !px-4 !py-2 text-xs">
              Continuer →
            </Link>
          </div>
        </div>
      ) : null}

      {!hasPortfolio && (
        <>
          <div className="mt-8 grid max-w-2xl gap-4">
            <MethodCard
              title="Importer un fichier"
              body="Export broker, Excel, CSV, PDF ou captures d’écran. Ordium extrait les lignes ; vous vérifiez avant de valider."
              href="/import"
              cta="Choisir des fichiers"
              primary
            />
            <MethodCard
              title="Remplir le modèle Ordium"
              body="Téléchargez un Excel ou CSV vide, saisissez Actif + Quantité (et le reste si vous l’avez), puis uploadez-le."
              href="/import"
              cta="Modèle + upload"
            />
            <MethodCard
              title="Saisie manuelle"
              body="Ajoutez ticker et quantité ligne par ligne — idéal pour peu de positions ou un portefeuille simple."
              href="/create"
              cta="Créer les lignes"
            />
          </div>

          <div className="mt-6 max-w-2xl border-t border-[var(--border)] pt-6">
            <button
              type="button"
              onClick={skipNoPositions}
              className="ord-btn ord-btn-ghost w-full !px-4 !py-3 text-sm sm:w-auto"
            >
              Je n’ai pas de position — passer à la suite
            </button>
            <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
              Idéal pour un compte neuf : tu définis d’abord ta stratégie, tu importeras tes lignes
              plus tard si besoin.
            </p>
          </div>
        </>
      )}

      <p className="mt-8 max-w-2xl text-xs leading-relaxed text-[var(--muted)]">
        Sync automatique via clé API broker ? C’est possible plus tard, à l’étape « Connecter &
        automatiser » — une fois la stratégie validée.
      </p>
    </AppShell>
  );
}

function MethodCard({
  title,
  body,
  href,
  cta,
  primary,
}: {
  title: string;
  body: string;
  href: string;
  cta: string;
  primary?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-[var(--text)]">{title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{body}</p>
        </div>
        <Link
          href={href}
          className={`ord-btn shrink-0 !px-4 !py-2 text-xs ${
            primary ? "ord-btn-primary" : "ord-btn-ghost"
          }`}
        >
          {cta}
        </Link>
      </div>
    </div>
  );
}

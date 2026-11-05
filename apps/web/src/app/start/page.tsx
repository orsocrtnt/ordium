"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { StepBadge } from "@/components/StepBadge";
import { apiFetch } from "@/lib/api";
import { loadBrokerLinks } from "@/lib/broker-links";
import {
  hasCompletedPositionsStep,
  hasCreatedStrategy,
  hasSkippedPositions,
} from "@/lib/journeyProgress";

/**
 * Parcours Ordium :
 * 1 Positions → 2 Stratégie → 3 Broker & automatisation
 * (Marchés = option dans la barre de nav, hors parcours.)
 */
export default function StartPage() {
  return (
    <RequireAuth>
      <StartContent />
    </RequireAuth>
  );
}

function StartContent() {
  const [hasPortfolio, setHasPortfolio] = useState(false);
  const [positionsDone, setPositionsDone] = useState(false);
  const [hasBroker, setHasBroker] = useState(false);
  const [hasExecution, setHasExecution] = useState(false);
  const [hasStrategy, setHasStrategy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      let portfolio = false;
      try {
        const [pf, ex] = await Promise.all([
          apiFetch("/api/portfolio").then((r) => r.json()).catch(() => null),
          apiFetch("/api/execution/status").then((r) => r.json()).catch(() => null),
        ]);
        portfolio = Boolean(pf?.portfolio);
        setHasPortfolio(portfolio);
        setHasExecution(Boolean(ex?.connections?.length));
      } catch {
        // ignore
      }
      setPositionsDone(hasCompletedPositionsStep(portfolio));
      setHasBroker((loadBrokerLinks()?.brokers?.length ?? 0) > 0);
      setHasStrategy(hasCreatedStrategy());
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <AppShell>
        <p className="text-sm text-[var(--muted)]">Chargement…</p>
      </AppShell>
    );
  }

  const skippedPositions = !hasPortfolio && hasSkippedPositions();

  const steps = [
    {
      n: 1,
      title: "Vos positions",
      body: skippedPositions
        ? "Aucune position pour l’instant — tu pourras en ajouter plus tard."
        : "Fichier (CSV, Excel, PDF, captures), modèle Ordium, ou saisie manuelle. Aucune clé API requise.",
      href: hasPortfolio ? "/portfolio" : "/positions",
      cta: hasPortfolio
        ? "Voir / modifier"
        : skippedPositions
          ? "Ajouter plus tard"
          : "Importer ou saisir",
      done: positionsDone,
      secondary: hasPortfolio
        ? { href: "/positions", label: "Réimporter autrement" }
        : skippedPositions
          ? { href: "/strategy", label: "Continuer vers la stratégie" }
          : { href: "/create", label: "Ou saisie manuelle directe" },
    },
    {
      n: 2,
      title: "Définir une stratégie",
      body: "Règles claires : RSI, dips, Fear & Greed, régime SMA… Backtest avant d’automatiser.",
      href: "/strategy",
      cta: "Ouvrir le builder",
      done: hasStrategy,
    },
    {
      n: 3,
      title: "Connecter & automatiser",
      body: "Étape la plus technique : clé API broker, puis DCA / ordres. Paper d’abord, live ensuite.",
      href: "/execution",
      cta: hasExecution || hasBroker ? "Ouvrir l’exécution" : "Connecter un broker",
      done: hasExecution,
      secondary: { href: "/dashboard", label: "Guide + sync portefeuille via API" },
    },
  ];

  return (
    <AppShell>
      <section className="max-w-2xl">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">
          Parcours Ordium
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--text)] sm:text-4xl">
          Conviction → exécution
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">
          D’abord vos lignes et vos règles — sans friction API. La connexion broker arrive en
          dernier, seulement pour exécuter. L’analyse des marchés reste disponible quand tu veux,
          via Marchés dans la barre du haut.
        </p>
      </section>

      <ol className="mt-10 max-w-2xl space-y-4">
        {steps.map((s) => (
          <li
            key={s.n}
            className={
              s.done
                ? "rounded-xl border border-emerald-200 bg-emerald-50/80 p-5 sm:p-6"
                : "rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 sm:p-6"
            }
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-1 gap-3">
                <StepBadge n={s.n} done={s.done} />
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-[11px] font-medium uppercase tracking-[0.16em] ${
                      s.done ? "text-emerald-700" : "text-[var(--muted)]"
                    }`}
                  >
                    Étape {s.n}
                    {s.done ? " · fait" : ""}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-[var(--text)]">{s.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{s.body}</p>
                </div>
              </div>
              <Link href={s.href} className="ord-btn ord-btn-primary shrink-0 !px-4 !py-2 text-xs">
                {s.cta}
              </Link>
            </div>
            {"secondary" in s && s.secondary && (
              <Link
                href={s.secondary.href}
                className="mt-3 ml-11 inline-block text-xs text-[var(--accent)] underline"
              >
                {s.secondary.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </AppShell>
  );
}

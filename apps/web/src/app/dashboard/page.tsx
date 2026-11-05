"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { BrokerConnectFlow } from "@/components/BrokerConnectFlow";
import { RequireAuth } from "@/components/RequireAuth";
import {
  MVP_BROKERS,
  QUIZ_LABELS,
  brokerById,
  recommendBroker,
  type AssetInterest,
  type ConnectableBrokerId,
  type EconomyFocus,
  type Horizon,
  type InitialBudget,
  type Knowledge,
  type MonthlyBudget,
  type QuizAnswers,
  type Risk,
} from "@/lib/broker-guide";
import { loadBrokerLinks, saveBrokerChoice, type LinkedBroker } from "@/lib/broker-links";

type Step =
  | "intro"
  | "knowledge"
  | "interests"
  | "initialBudget"
  | "monthlyBudget"
  | "economy"
  | "horizon"
  | "risk"
  | "result";

const STEPS: Step[] = [
  "intro",
  "knowledge",
  "interests",
  "initialBudget",
  "monthlyBudget",
  "economy",
  "horizon",
  "risk",
  "result",
];

const emptyAnswers = (): QuizAnswers => ({
  knowledge: null,
  interests: [],
  initialBudget: null,
  monthlyBudget: null,
  economy: [],
  horizon: null,
  risk: null,
});

const STOCK = MVP_BROKERS.filter((b) => b.kind === "securities");
const CRYPTO = MVP_BROKERS.filter((b) => b.kind === "crypto");

export default function DashboardPage() {
  return (
    <RequireAuth>
      <Suspense
        fallback={
          <AppShell>
            <p className="text-sm text-[var(--muted)]">Chargement…</p>
          </AppShell>
        }
      >
        <DashboardContent />
      </Suspense>
    </RequireAuth>
  );
}

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>("intro");
  const [answers, setAnswers] = useState<QuizAnswers>(emptyAnswers);
  const [selectedId, setSelectedId] = useState<ConnectableBrokerId | null>(null);
  const [linked, setLinked] = useState<LinkedBroker[]>([]);
  const [oauthBanner, setOauthBanner] = useState<string | null>(null);

  useEffect(() => {
    setLinked(loadBrokerLinks()?.brokers ?? []);
  }, []);

  useEffect(() => {
    const oauth = searchParams.get("oauth");
    const broker = searchParams.get("broker") as ConnectableBrokerId | null;
    const msg = searchParams.get("msg");
    if (oauth === "ok" && broker) {
      saveBrokerChoice(broker, "opened");
      setLinked(loadBrokerLinks()?.brokers ?? []);
      setSelectedId(broker);
      setStep("result");
      const imported = searchParams.get("imported") === "1";
      const extra = searchParams.get("msg");
      setOauthBanner(
        imported
          ? `Compte ${brokerById(broker).name} autorisé et positions importées.`
          : extra
            ? `Compte ${brokerById(broker).name} autorisé. ${extra}`
            : `Compte ${brokerById(broker).name} autorisé. Vous pouvez continuer.`,
      );
    } else if (oauth === "error") {
      setStep("result");
      setOauthBanner(msg ? `OAuth : ${msg}` : "Échec de l’autorisation OAuth.");
    }
  }, [searchParams]);

  const stepIndex = STEPS.indexOf(step);
  const progress =
    step === "intro" ? 0 : step === "result" ? 100 : (stepIndex / (STEPS.length - 1)) * 100;

  const recommendation = useMemo(() => recommendBroker(answers), [answers]);
  const hasLinked = linked.length > 0;

  const goNext = () => {
    const i = STEPS.indexOf(step);
    if (i < STEPS.length - 1) setStep(STEPS[i + 1]!);
  };
  const goBack = () => {
    const i = STEPS.indexOf(step);
    if (i > 0) setStep(STEPS[i - 1]!);
  };
  const skipQuestionnaire = () => {
    setStep("result");
  };

  useEffect(() => {
    if (step !== "result" || selectedId) return;
    const first = recommendation?.recommended[0]?.id;
    if (first) setSelectedId(first);
  }, [step, recommendation, selectedId]);

  const restart = () => {
    setAnswers(emptyAnswers());
    setStep("intro");
    setSelectedId(null);
    setOauthBanner(null);
  };

  const toggleInterest = (id: AssetInterest) => {
    setAnswers((prev) => {
      const has = prev.interests.includes(id);
      if (id === "mixed") return { ...prev, interests: has ? [] : ["mixed"] };
      const withoutMixed = prev.interests.filter((x) => x !== "mixed");
      return {
        ...prev,
        interests: has ? withoutMixed.filter((x) => x !== id) : [...withoutMixed, id],
      };
    });
  };

  const toggleEconomy = (id: EconomyFocus) => {
    setAnswers((prev) => {
      const has = prev.economy.includes(id);
      if (id === "no_preference") {
        return { ...prev, economy: has ? [] : ["no_preference"] };
      }
      const withoutNone = prev.economy.filter((x) => x !== "no_preference");
      return {
        ...prev,
        economy: has ? withoutNone.filter((x) => x !== id) : [...withoutNone, id],
      };
    });
  };

  return (
    <AppShell
      right={
        <Link href="/start" className="hover:text-[var(--text)]">
          ← Retour
        </Link>
      }
    >
      <section className="max-w-2xl">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">
          Étape 4 · Broker
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--text)] sm:text-4xl">
          Connecter un broker
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">
          Étape la plus technique : on vous suggère une plateforme, puis un guide pour brancher
          votre clé API (sync portefeuille et/ou exécution).
        </p>

        {step !== "intro" && (
          <div className="mt-6 h-1 overflow-hidden rounded-full bg-[var(--border)]">
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </section>

      <section className="mt-8 max-w-2xl">
        {step === "intro" && (
          <div className="ord-card space-y-5 p-6 sm:p-8">
            <h2 className="text-lg font-semibold text-[var(--text)]">
              Quand vous êtes prêt à automatiser
            </h2>
            <p className="text-sm leading-relaxed text-[var(--muted)]">
              Pas besoin d’être ici pour définir positions et stratégie. Quelques questions pour
              suggérer un broker, puis tutoriel clé API pas-à-pas.
            </p>
            <div className="space-y-3 rounded-lg bg-[var(--accent-soft)] px-4 py-3 text-sm">
              <p className="font-medium text-[var(--accent)]">Plateformes</p>
              <p className="text-xs text-[var(--muted)]">
                Actions : {STOCK.map((b) => b.name).join(", ")}. Crypto :{" "}
                {CRYPTO.map((b) => b.name).join(", ")}.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={goNext} className="ord-btn ord-btn-primary">
                Commencer le questionnaire
              </button>
              <button type="button" onClick={skipQuestionnaire} className="ord-btn ord-btn-ghost">
                Passer
              </button>
            </div>
          </div>
        )}

        {step === "knowledge" && (
          <Question
            title="Où en êtes-vous avec l’investissement ?"
            subtitle="On adapte les suggestions à votre niveau."
            onBack={goBack}
            onNext={goNext}
            onSkip={skipQuestionnaire}
            nextDisabled={!answers.knowledge}
          >
            <OptionGrid
              options={(Object.keys(QUIZ_LABELS.knowledge) as Knowledge[]).map((id) => ({
                id,
                label: QUIZ_LABELS.knowledge[id],
              }))}
              value={answers.knowledge}
              onChange={(id) => setAnswers((a) => ({ ...a, knowledge: id }))}
            />
          </Question>
        )}

        {step === "interests" && (
          <Question
            title="Dans quoi aimeriez-vous investir ?"
            subtitle="Plusieurs choix possibles."
            onBack={goBack}
            onNext={goNext}
            onSkip={skipQuestionnaire}
            nextDisabled={answers.interests.length === 0}
          >
            <MultiGrid
              options={(Object.keys(QUIZ_LABELS.interest) as AssetInterest[]).map((id) => ({
                id,
                label: QUIZ_LABELS.interest[id],
              }))}
              selected={answers.interests}
              onToggle={toggleInterest}
            />
          </Question>
        )}

        {step === "initialBudget" && (
          <Question
            title="Combien voulez-vous investir au total pour commencer ?"
            subtitle="Une fourchette suffit."
            onBack={goBack}
            onNext={goNext}
            onSkip={skipQuestionnaire}
            nextDisabled={!answers.initialBudget}
          >
            <OptionGrid
              options={(Object.keys(QUIZ_LABELS.initialBudget) as InitialBudget[]).map((id) => ({
                id,
                label: QUIZ_LABELS.initialBudget[id],
              }))}
              value={answers.initialBudget}
              onChange={(id) => setAnswers((a) => ({ ...a, initialBudget: id }))}
            />
          </Question>
        )}

        {step === "monthlyBudget" && (
          <Question
            title="Combien voulez-vous investir par mois ?"
            subtitle="Ou rien si apport unique."
            onBack={goBack}
            onNext={goNext}
            onSkip={skipQuestionnaire}
            nextDisabled={!answers.monthlyBudget}
          >
            <OptionGrid
              options={(Object.keys(QUIZ_LABELS.monthlyBudget) as MonthlyBudget[]).map((id) => ({
                id,
                label: QUIZ_LABELS.monthlyBudget[id],
              }))}
              value={answers.monthlyBudget}
              onChange={(id) => setAnswers((a) => ({ ...a, monthlyBudget: id }))}
            />
          </Question>
        )}

        {step === "economy" && (
          <Question
            title="Vers quelle économie êtes-vous plutôt tourné ?"
            subtitle="Plusieurs réponses possibles."
            onBack={goBack}
            onNext={goNext}
            onSkip={skipQuestionnaire}
            nextDisabled={answers.economy.length === 0}
          >
            <MultiGrid
              options={(Object.keys(QUIZ_LABELS.economy) as EconomyFocus[]).map((id) => ({
                id,
                label: QUIZ_LABELS.economy[id],
              }))}
              selected={answers.economy}
              onToggle={toggleEconomy}
            />
          </Question>
        )}

        {step === "horizon" && (
          <Question
            title="Sur quel horizon pensez-vous investir ?"
            subtitle="Court terme ≠ long terme."
            onBack={goBack}
            onNext={goNext}
            onSkip={skipQuestionnaire}
            nextDisabled={!answers.horizon}
          >
            <OptionGrid
              options={(Object.keys(QUIZ_LABELS.horizon) as Horizon[]).map((id) => ({
                id,
                label: QUIZ_LABELS.horizon[id],
              }))}
              value={answers.horizon}
              onChange={(id) => setAnswers((a) => ({ ...a, horizon: id }))}
            />
          </Question>
        )}

        {step === "risk" && (
          <Question
            title="Quel niveau de variation êtes-vous capable d’encaisser ?"
            subtitle="Soyez honnête avec vous-même."
            onBack={goBack}
            onNext={goNext}
            onSkip={skipQuestionnaire}
            nextDisabled={!answers.risk}
            nextLabel="Voir les suggestions"
          >
            <OptionGrid
              options={(Object.keys(QUIZ_LABELS.risk) as Risk[]).map((id) => ({
                id,
                label: QUIZ_LABELS.risk[id],
              }))}
              value={answers.risk}
              onChange={(id) => setAnswers((a) => ({ ...a, risk: id }))}
            />
          </Question>
        )}

        {step === "result" && (
          <div className="space-y-6">
            {oauthBanner && (
              <p
                className={`rounded-xl px-4 py-3 text-sm ${
                  oauthBanner.startsWith("OAuth :") || oauthBanner.startsWith("Échec")
                    ? "border border-red-200 bg-red-50 text-red-800"
                    : "border border-[var(--border)] bg-[var(--accent-soft)] text-[var(--accent)]"
                }`}
              >
                {oauthBanner}
              </p>
            )}

            {recommendation ? (
              <div className="ord-card p-6 sm:p-8">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">
                  {recommendation.recommended.length > 1 ? "Suggestions" : "Suggestion"}
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-[var(--text)]">
                  {recommendation.recommended.map((b) => `« ${b.name} »`).join(" et ")}
                </h2>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  Sélectionnez un broker — le guide de connexion s’affiche ensuite.
                </p>
                <ul className="mt-5 space-y-2 text-sm leading-relaxed text-[var(--muted)]">
                  {recommendation.rationale.map((line) => (
                    <li key={line} className="flex gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="ord-card p-6 sm:p-8">
                <h2 className="text-xl font-semibold text-[var(--text)]">Choisir un broker</h2>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  Questionnaire passé : sélectionnez la plateforme à connecter.
                </p>
              </div>
            )}

            <div className="ord-card space-y-4 p-5 sm:p-6">
              <h3 className="text-sm font-semibold text-[var(--text)]">Quel broker connecter ?</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {MVP_BROKERS.map((b) => {
                  const suggested = recommendation?.recommended.some((r) => r.id === b.id);
                  const isSelected = selectedId === b.id;
                  const isLinked = linked.some((l) => l.id === b.id);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setSelectedId(b.id)}
                      className={`rounded-xl border px-3 py-3 text-left transition ${
                        isSelected
                          ? "border-[var(--text)] bg-[var(--bg)]"
                          : suggested
                            ? "border-[var(--accent)] bg-[var(--accent-soft)]/40"
                            : "border-[var(--border)] hover:border-[var(--border-strong)]"
                      }`}
                    >
                      <p className="text-sm font-semibold text-[var(--text)]">{b.name}</p>
                      {(suggested || isLinked) && (
                        <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                          {[suggested ? "suggéré" : null, isLinked ? "lié" : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>

              {selectedId && (
                <BrokerConnectFlow
                  brokerId={selectedId}
                  onLinked={(id) => {
                    setLinked(loadBrokerLinks()?.brokers ?? []);
                    router.push(`/execution?linked=${id}`);
                  }}
                />
              )}
            </div>

            {hasLinked && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="ord-btn ord-btn-primary"
                  onClick={() => router.push("/execution")}
                >
                  Activer l’exécution →
                </button>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {recommendation && (
                <button type="button" onClick={goBack} className="ord-btn ord-btn-ghost">
                  ← Modifier
                </button>
              )}
              <button type="button" onClick={restart} className="ord-btn ord-btn-ghost">
                {recommendation ? "Refaire le questionnaire" : "Faire le questionnaire"}
              </button>
              <Link href="/positions" className="ord-btn ord-btn-ghost">
                Plutôt importer sans API
              </Link>
            </div>
          </div>
        )}
      </section>
    </AppShell>
  );
}

function Question({
  title,
  subtitle,
  children,
  onBack,
  onNext,
  onSkip,
  nextDisabled,
  nextLabel = "Continuer",
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  onBack: () => void;
  onNext: () => void;
  onSkip?: () => void;
  nextDisabled: boolean;
  nextLabel?: string;
}) {
  return (
    <div className="ord-card space-y-5 p-6 sm:p-8">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text)]">{title}</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">{subtitle}</p>
      </div>
      {children}
      <div className="flex flex-wrap gap-2 pt-2">
        <button type="button" onClick={onBack} className="ord-btn ord-btn-ghost">
          Retour
        </button>
        <button
          type="button"
          disabled={nextDisabled}
          onClick={onNext}
          className="ord-btn ord-btn-primary disabled:opacity-40"
        >
          {nextLabel}
        </button>
        {onSkip && (
          <button type="button" onClick={onSkip} className="ord-btn ord-btn-ghost">
            Passer
          </button>
        )}
      </div>
    </div>
  );
}

function OptionGrid<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T | null;
  onChange: (id: T) => void;
}) {
  return (
    <div className="grid gap-2">
      {options.map((opt) => {
        const selected = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`rounded-xl border px-4 py-3 text-left text-sm transition ${
              selected
                ? "border-[var(--text)] bg-[var(--bg)]"
                : "border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--border-strong)]"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function MultiGrid<T extends string>({
  options,
  selected,
  onToggle,
}: {
  options: { id: T; label: string }[];
  selected: T[];
  onToggle: (id: T) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((opt) => {
        const on = selected.includes(opt.id);
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onToggle(opt.id)}
            className={`rounded-xl border px-4 py-3 text-left text-sm transition ${
              on
                ? "border-[var(--text)] bg-[var(--bg)]"
                : "border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--border-strong)]"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

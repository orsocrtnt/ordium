"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { StepBadge } from "@/components/StepBadge";
import { apiFetch } from "@/lib/api";
import { openBrokerSite } from "@/lib/broker-links";
import {
  checkSavedStrategyBrokerCompat,
  checkStrategyBrokerCompatibility,
  isStrategyCompatibleWithBroker,
} from "@/lib/brokerCompatibility";
import { syncStrategyPaperSchedule } from "@/lib/executionPaper";
import {
  loadExecTutorialDone,
  saveExecTutorialDone,
} from "@/lib/journeyProgress";
import { toStrategyDocument } from "@/lib/strategy";
import {
  loadStrategyStore,
  saveStrategyStore,
  withExclusiveEnabled,
  type SavedStrategy,
} from "@/lib/strategyStore";
import { scopedStorageKey } from "@/lib/userScope";
import { OrderHistoryPanel } from "@/components/OrderHistoryPanel";

type Broker = "alpaca" | "binance";
type Env = "paper" | "live";

type Status = {
  killSwitch: { engaged: boolean; reason?: string };
  connections: Array<{
    id: string;
    broker: Broker;
    environment: Env;
    scopes: string[];
    label?: string;
  }>;
  schedules: Array<{
    id: string;
    kind: string;
    enabled: boolean;
    broker: Broker;
    environment: Env;
    symbol?: string;
    amount?: number;
    intervalMinutes: number;
    strategyId?: string;
    strategyJson?: unknown;
    nextRunAt: string;
    lastRunAt?: string;
    lastError?: string;
  }>;
  limits: {
    dailyNotionalLimitUsd: number;
    dailyNotionalUsedUsd: number;
  };
  allowlistCount: number;
  vaultKeyConfigured: boolean;
  withdrawConfirmPhrase: string;
};

const TESTNET_URL = "https://testnet.binance.vision/";

const TUTORIAL_STEPS: {
  title: string;
  body: string;
  linkLabel?: string;
  linkUrl?: string;
}[] = [
  {
    title: "Ouvre le Spot Testnet Binance",
    body: "Ce n’est pas le site Binance habituel. Le testnet sert uniquement aux essais — argent fictif.",
    linkLabel: "Ouvrir testnet.binance.vision",
    linkUrl: TESTNET_URL,
  },
  {
    title: "Connecte-toi (souvent via GitHub)",
    body: "Sur la page d’accueil du Testnet, clique sur « Log In » / « Login with GitHub ». Utilise un compte GitHub : ce n’est pas ta session Binance prod.",
  },
  {
    title: "Génère une clé API HMAC",
    body: "Une fois connecté, va dans la zone API Keys / Generate HMAC_SHA256 Key. Donne un label du type « Ordium ». Valide.",
  },
  {
    title: "Copie API Key + Secret Key",
    body: "Le Secret ne s’affiche qu’une fois. Copie les deux dans un endroit sûr, puis colle-les dans Ordium ci-dessous. Ne coche pas de permissions live : c’est déjà du paper.",
  },
];

export default function ExecutionPage() {
  return (
    <RequireAuth>
      <ExecutionContent />
    </RequireAuth>
  );
}

function ExecutionContent() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [strategies, setStrategies] = useState<SavedStrategy[]>([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState<string>("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [stepDone, setStepDone] = useState(false);
  const [tutorialDone, setTutorialDone] = useState<boolean[]>([false, false, false, false]);
  const pausedIncompatRef = useRef<Set<string>>(new Set());

  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");

  const [orderSymbol, setOrderSymbol] = useState("BTCUSDT");
  const [orderSide, setOrderSide] = useState<"buy" | "sell">("buy");
  const [orderNotional, setOrderNotional] = useState("10");
  const [orderQty, setOrderQty] = useState("");
  const [confirmLive, setConfirmLive] = useState(false);
  const [orderEnv, setOrderEnv] = useState<Env>("paper");
  const [orderHistoryKey, setOrderHistoryKey] = useState(0);

  const refresh = useCallback(async () => {
    const res = await apiFetch("/api/execution/status");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Status impossible");
    setStatus(data);
  }, []);

  useEffect(() => {
    void refresh().catch((e) => setError((e as Error).message));
    setTutorialDone(loadExecTutorialDone());
    try {
      const store = loadStrategyStore();
      const list = [...store.strategies].sort((a, b) =>
        a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
      );
      setStrategies(list);
      let prefer = store.activeId;
      try {
        const raw = sessionStorage.getItem(scopedStorageKey("ordium_pending_strategy"));
        if (raw) {
          const pending = JSON.parse(raw) as { name?: string };
          const byName = list.find((s) => s.name === pending.name);
          if (byName) prefer = byName.id;
        }
      } catch {
        // ignore
      }
      const enabled = list.find((s) => s.enabled);
      setSelectedStrategyId(enabled?.id ?? prefer ?? list[0]?.id ?? "");
    } catch {
      setStrategies([]);
    }
  }, [refresh]);

  const toggleTutorialStep = (index: number) => {
    setTutorialDone((prev) => {
      const next = [...prev];
      next[index] = !next[index];
      saveExecTutorialDone(next);
      return next;
    });
  };

  const selectedStrategy = useMemo(
    () => strategies.find((s) => s.id === selectedStrategyId) ?? null,
    [strategies, selectedStrategyId],
  );

  const strategyNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of strategies) m.set(s.id, s.name);
    return m;
  }, [strategies]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const paperConn =
    status?.connections.find((c) => c.environment === "paper" && c.broker === "binance") ??
    status?.connections.find((c) => c.environment === "paper") ??
    null;

  useEffect(() => {
    if (!paperConn || strategies.length === 0) return;
    // Garde la sélection même si incompatible (pour afficher le refus clairement).
    if (!selectedStrategyId || !strategies.some((s) => s.id === selectedStrategyId)) {
      const enabledCompat = strategies.find(
        (s) => s.enabled && isStrategyCompatibleWithBroker(s, paperConn.broker),
      );
      setSelectedStrategyId(enabledCompat?.id ?? strategies[0]!.id);
    }
  }, [paperConn, strategies, selectedStrategyId]);

  // Pause auto les schedules incompatibles avec le broker connecté.
  useEffect(() => {
    if (!paperConn || !status) return;
    const bad = (status.schedules ?? []).filter((s) => {
      if (s.kind !== "strategy_live" || !s.enabled) return false;
      if (pausedIncompatRef.current.has(s.id)) return false;
      const strat = strategies.find((x) => x.id === s.strategyId);
      if (strat) return !isStrategyCompatibleWithBroker(strat, paperConn.broker);
      if (s.strategyJson) {
        return !checkStrategyBrokerCompatibility(
          s.strategyJson as { allocation?: Array<{ asset?: string; weight?: number }> },
          paperConn.broker,
        ).ok;
      }
      return true;
    });
    if (bad.length === 0) return;
    for (const s of bad) pausedIncompatRef.current.add(s.id);
    void (async () => {
      for (const s of bad) {
        await apiFetch(`/api/execution/schedules/${s.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: false }),
        }).catch(() => null);
      }
      const store = loadStrategyStore();
      const next = withExclusiveEnabled(store.strategies, null);
      saveStrategyStore({ version: 3, activeId: store.activeId, strategies: next });
      setStrategies(next);
      await refresh().catch(() => null);
      setMsg(
        "Auto paper en pause : strat incompatible avec le broker (crypto seulement sur Binance).",
      );
    })();
  }, [paperConn, status, strategies, refresh]);

  const strategySchedules = (status?.schedules ?? []).filter((s) => s.kind === "strategy_live");
  const canSubmit = apiKey.trim().length > 0 && apiSecret.trim().length > 0;
  const keysStepDone = stepDone;

  const paperBroker = paperConn?.broker ?? "binance";
  const compatibleStrategies = strategies.filter((s) =>
    isStrategyCompatibleWithBroker(s, paperBroker),
  );
  const selectedCompat = selectedStrategy
    ? checkSavedStrategyBrokerCompat(selectedStrategy, paperBroker)
    : null;

  /** Vert seulement si LA strat sélectionnée est compatible ET a une auto active. */
  const selectedScheduleActive = Boolean(
    selectedStrategy &&
      selectedCompat?.ok &&
      strategySchedules.some(
        (s) => s.enabled && s.strategyId === selectedStrategy.id,
      ),
  );
  const hasActivePaperStrategy = selectedScheduleActive;
  const hasAnyPaperStrategy = selectedScheduleActive;

  return (
    <AppShell>
      <div className="relative min-h-[calc(100vh-3.5rem)] overflow-hidden">
        {/* Atmosphere */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 50% -10%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 55%), linear-gradient(180deg, #f3f6f4 0%, var(--bg) 40%)",
          }}
        />

        <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
          <header className="text-center">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
              Exécution paper
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--text)] sm:text-4xl">
              Connecte Binance Testnet
            </h1>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[var(--muted)]">
              Quatre étapes, puis tu colles tes clés. Ordium placera les ordres crypto tout seul —
              sans argent réel.
            </p>
          </header>

          {error && (
            <p className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          )}
          {msg && (
            <p className="mt-6 whitespace-pre-wrap rounded-2xl border border-[var(--border)] bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--accent)]">
              {msg}
            </p>
          )}

          {/* Connected state */}
          {paperConn ? (
            <section className="mt-10 space-y-4">
              <ol className="mb-2 flex flex-wrap items-center justify-center gap-2 text-[11px] text-[var(--muted)]">
                {[
                  { n: 1, label: "Testnet", done: true },
                  { n: 2, label: "Stratégie", done: hasActivePaperStrategy },
                  { n: 3, label: "Auto", done: hasAnyPaperStrategy },
                ].map((s, i, arr) => (
                  <li key={s.n} className="flex items-center gap-2">
                    <span
                      className={
                        s.done
                          ? "inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-2.5 py-1 font-medium text-white"
                          : "inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 py-1 font-medium text-[var(--muted)]"
                      }
                    >
                      {s.done ? "✓" : s.n} {s.label}
                    </span>
                    {i < arr.length - 1 && <span aria-hidden className="text-[var(--border-strong)]">→</span>}
                  </li>
                ))}
              </ol>

              <div className="rounded-3xl border border-emerald-200 bg-emerald-50/80 p-6 sm:p-8">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex gap-3">
                    <StepBadge n={1} done />
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">
                        Connecté
                      </p>
                      <h2 className="mt-1 text-lg font-semibold text-[var(--text)]">
                        Binance Testnet (paper)
                      </h2>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        Permissions : {paperConn.scopes.join(", ")}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const res = await apiFetch(
                          `/api/execution/connection?broker=${paperConn.broker}&environment=paper`,
                          { method: "DELETE" },
                        );
                        const data = await res.json();
                        if (!res.ok) throw new Error(data.error);
                        setMsg("Déconnecté. Tu peux coller de nouvelles clés.");
                        setStepDone(false);
                        setApiKey("");
                        setApiSecret("");
                      })
                    }
                    className="text-xs text-[var(--muted)] underline hover:text-[var(--text)]"
                  >
                    Déconnecter
                  </button>
                </div>

                <div className="mt-6 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy || Boolean(status?.killSwitch.engaged)}
                    title={
                      status?.killSwitch.engaged
                        ? "Lève le kill switch avant de tester un run"
                        : undefined
                    }
                    onClick={() =>
                      void run(async () => {
                        if (status?.killSwitch.engaged) {
                          throw new Error(
                            "Kill switch actif : lève-le (bouton Lever), puis relance l’auto paper si besoin.",
                          );
                        }
                        const res = await apiFetch("/api/execution/schedules/run-due", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ force: true }),
                        });
                        const data = (await res.json()) as {
                          error?: string;
                          ran?: string[];
                          errors?: { id: string; error: string }[];
                        };
                        if (!res.ok) throw new Error(data.error);
                        const errMsgs = (data.errors ?? [])
                          .map((e) => e.error)
                          .filter(Boolean);
                        const summary = `Run forcé : ${data.ran?.length ?? 0} ok · ${data.errors?.length ?? 0} erreur(s)`;
                        setMsg(
                          errMsgs.length > 0 ? `${summary}\n${errMsgs.join("\n")}` : summary,
                        );
                        setOrderHistoryKey((k) => k + 1);
                      })
                    }
                    className="rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--bg)] disabled:opacity-50"
                  >
                    Tester un run maintenant
                  </button>
                  {status?.killSwitch.engaged && (
                    <p className="w-full text-xs text-amber-800">
                      Kill switch actif → aucun ordre. Clique <strong>Lever</strong>, puis{" "}
                      <strong>Lancer l’auto paper</strong> si l’auto est en pause.
                    </p>
                  )}
                </div>
              </div>

              <div
                className={
                  hasActivePaperStrategy
                    ? "rounded-3xl border border-emerald-200 bg-emerald-50/80 p-5"
                    : "rounded-3xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5"
                }
              >
                <div className="flex gap-3">
                  <StepBadge n={2} done={hasActivePaperStrategy} />
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-[11px] font-medium uppercase tracking-wide ${
                        hasActivePaperStrategy
                          ? "text-emerald-700"
                          : selectedCompat?.ok === false
                            ? "text-amber-800"
                            : "text-[var(--muted)]"
                      }`}
                    >
                      {hasActivePaperStrategy
                        ? "Stratégie validée"
                        : selectedCompat?.ok === false
                          ? "Non activable"
                          : "Choisir la strat"}
                    </p>
                    <p className="mt-1 text-sm font-medium text-[var(--text)]">
                      {hasActivePaperStrategy
                        ? "Auto paper active"
                        : selectedCompat?.ok === false
                          ? "Cette strat ne peut pas tourner sur ce broker"
                          : "Sélectionne une strat puis lance l’auto"}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {paperBroker === "binance"
                        ? "Binance paper : une seule strat, 100 % crypto."
                        : "Alpaca paper : une seule strat, actions / ETF."}
                    </p>
                    {strategies.length === 0 ? (
                      <p className="mt-3 text-xs text-[var(--muted)]">
                        Aucune stratégie créée.{" "}
                        <Link href="/strategy" className="underline hover:text-[var(--text)]">
                          En créer une
                        </Link>
                      </p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="sr-only" htmlFor="execution-strategy-pick">
                            Stratégie
                          </label>
                          <select
                            id="execution-strategy-pick"
                            value={selectedStrategyId}
                            onChange={(e) => setSelectedStrategyId(e.target.value)}
                            className={`min-w-[12rem] max-w-full rounded-full border px-4 py-2 text-xs font-medium shadow-sm outline-none ${
                              selectedCompat?.ok === false
                                ? "border-amber-300 bg-amber-50 text-amber-950"
                                : hasActivePaperStrategy
                                  ? "border-emerald-300 bg-emerald-50 text-emerald-950"
                                  : "border-[var(--border)] bg-white text-[var(--text)] focus:border-[var(--text)]"
                            }`}
                          >
                            {strategies.map((s) => {
                              const ok = isStrategyCompatibleWithBroker(s, paperBroker);
                              return (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                  {!ok
                                    ? " · non activable"
                                    : s.enabled
                                      ? " · active"
                                      : ""}
                                </option>
                              );
                            })}
                          </select>
                          <button
                            type="button"
                            disabled={
                              busy || !selectedStrategy || selectedCompat?.ok !== true
                            }
                            className="rounded-xl bg-[var(--text)] px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
                            onClick={() =>
                              void run(async () => {
                                if (!selectedStrategy) return;
                                const compat = checkSavedStrategyBrokerCompat(
                                  selectedStrategy,
                                  paperBroker,
                                );
                                if (!compat.ok) throw new Error(compat.message);
                                const amount = Math.max(
                                  5,
                                  Number(selectedStrategy.state.budgetAmount ?? 100),
                                );
                                const sync = await syncStrategyPaperSchedule({
                                  strategyId: selectedStrategy.id,
                                  strategyJson: toStrategyDocument(selectedStrategy.state),
                                  amount,
                                  enabled: true,
                                });
                                if ("error" in sync) throw new Error(sync.error);
                                const store = loadStrategyStore();
                                const next = withExclusiveEnabled(
                                  store.strategies,
                                  selectedStrategy.id,
                                );
                                saveStrategyStore({
                                  version: 3,
                                  activeId: selectedStrategy.id,
                                  strategies: next,
                                });
                                setStrategies(next);
                                try {
                                  sessionStorage.removeItem(scopedStorageKey("ordium_pending_strategy"));
                                } catch {
                                  // ignore
                                }
                                setMsg(
                                  `Auto paper lancée — « ${selectedStrategy.name} » (les autres sont en pause).`,
                                );
                              })
                            }
                          >
                            Lancer l’auto paper
                          </button>
                        </div>
                        {selectedCompat && !selectedCompat.ok && (
                          <p className="text-[11px] leading-relaxed text-amber-800">
                            {selectedCompat.message}
                          </p>
                        )}
                        {compatibleStrategies.length === 0 && (
                          <p className="text-[11px] text-amber-800">
                            Aucune strat 100 % crypto.{" "}
                            <Link href="/strategy" className="underline">
                              Créer une strat crypto
                            </Link>
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div
                className={
                  hasAnyPaperStrategy
                    ? "rounded-3xl border border-emerald-200 bg-emerald-50/80 p-5"
                    : "rounded-3xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5"
                }
              >
                <div className="flex gap-3">
                  <StepBadge n={3} done={hasAnyPaperStrategy} />
                  <div className="min-w-0 flex-1">
                    <h3
                      className={`text-sm font-semibold ${
                        hasAnyPaperStrategy ? "text-emerald-800" : "text-[var(--text)]"
                      }`}
                    >
                      Automatisations
                    </h3>
                    {strategySchedules.length === 0 ? (
                      <p className="mt-2 text-sm text-[var(--muted)]">
                        Aucune pour l’instant. Choisis une strat ci-dessus, puis lance l’auto paper.
                      </p>
                    ) : (
                      <ul className="mt-3 space-y-2">
                        {strategySchedules.map((s) => (
                          <li
                            key={s.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--border)] bg-white px-3 py-2.5 text-xs"
                          >
                            <div>
                              <p className="font-medium text-[var(--text)]">
                                {s.enabled ? "Active" : "En pause"}
                                {s.strategyId
                                  ? ` · ${strategyNameById.get(s.strategyId) ?? s.strategyId.slice(0, 10) + "…"}`
                                  : ""}
                              </p>
                          <p className="text-[var(--muted)]">
                            Prochain : {new Date(s.nextRunAt).toLocaleString("fr-FR")}
                            {s.lastError ? ` · ${s.lastError}` : ""}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={busy}
                          className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[10px] hover:bg-[var(--bg)]"
                          onClick={() =>
                            void run(async () => {
                              const res = await apiFetch(`/api/execution/schedules/${s.id}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ enabled: !s.enabled }),
                              });
                              const data = await res.json();
                              if (!res.ok) throw new Error(data.error);
                              setMsg(data.enabled ? "Auto reprise." : "Auto en pause.");
                            })
                          }
                        >
                          {s.enabled ? "Pause" : "Reprendre"}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                  </div>
                </div>
              </div>

              <KillSwitchCard
                engaged={Boolean(status?.killSwitch.engaged)}
                reason={status?.killSwitch.reason}
                busy={busy}
                onToggle={() =>
                  void run(async () => {
                    const engaged = !status?.killSwitch.engaged;
                    const res = await apiFetch("/api/execution/killswitch", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ engaged, reason: "Action utilisateur" }),
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error);
                    setMsg(
                      data.engaged
                        ? "Kill switch engagé — autos mises en pause."
                        : "Kill switch levé. Si l’auto est en pause, reclique « Lancer l’auto paper », puis « Tester un run ».",
                    );
                  })
                }
              />

              <OrderHistoryPanel refreshKey={orderHistoryKey} />
            </section>
          ) : (
            /* Not connected — tutorial */
            <section className="mt-10 space-y-6">
              <ol className="space-y-3">
                {TUTORIAL_STEPS.map((s, i) => {
                  const done = Boolean(tutorialDone[i]);
                  return (
                  <li
                    key={s.title}
                    className={
                      done
                        ? "flex gap-4 rounded-3xl border border-emerald-200 bg-emerald-50/80 p-5"
                        : "flex gap-4 rounded-3xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5"
                    }
                  >
                    <button
                      type="button"
                      onClick={() => toggleTutorialStep(i)}
                      className="shrink-0 self-start"
                      title={done ? "Marquer non fait" : "Marquer comme fait"}
                    >
                      <StepBadge n={i + 1} done={done} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[var(--text)]">{s.title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{s.body}</p>
                      {s.linkUrl && (
                        <button
                          type="button"
                          onClick={() => openBrokerSite(s.linkUrl!)}
                          className="mt-3 inline-flex items-center rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-xs font-medium text-[var(--text)] hover:border-[var(--border-strong)]"
                        >
                          {s.linkLabel ?? "Ouvrir"}
                        </button>
                      )}
                      {!done && (
                        <button
                          type="button"
                          onClick={() => toggleTutorialStep(i)}
                          className="mt-3 ml-0 block text-xs text-[var(--muted)] underline hover:text-[var(--text)] sm:ml-0"
                        >
                          Marquer comme fait
                        </button>
                      )}
                    </div>
                  </li>
                  );
                })}
              </ol>

              <div
                className={
                  keysStepDone
                    ? "rounded-3xl border border-emerald-200 bg-emerald-50/80 p-5 sm:p-6"
                    : "rounded-3xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 sm:p-6"
                }
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <StepBadge n={5} done={keysStepDone} />
                    <div>
                      <p
                        className={`text-[11px] font-medium uppercase tracking-wide ${
                          keysStepDone ? "text-emerald-700" : "text-[var(--muted)]"
                        }`}
                      >
                        Étape 5
                      </p>
                      <h2 className="mt-0.5 text-sm font-semibold text-[var(--text)]">
                        Colle tes clés Testnet ici
                      </h2>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                    <input
                      type="checkbox"
                      checked={stepDone}
                      onChange={(e) => setStepDone(e.target.checked)}
                      className="rounded border-[var(--border-strong)]"
                    />
                    J’ai mes clés
                  </label>
                </div>

                <div
                  className={`mt-4 space-y-3 transition ${
                    stepDone ? "opacity-100" : "pointer-events-none opacity-40"
                  }`}
                >
                  <div>
                    <label className="text-[11px] text-[var(--muted)]">API Key</label>
                    <input
                      className="ord-input mt-1 font-mono text-sm"
                      placeholder="Colle l’API Key Testnet"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      disabled={!stepDone}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-[var(--muted)]">Secret Key</label>
                    <textarea
                      className="ord-input mt-1 min-h-[2.75rem] resize-y font-mono text-sm"
                      placeholder="Colle le Secret Key (affiché une seule fois)"
                      value={apiSecret}
                      onChange={(e) => setApiSecret(e.target.value)}
                      rows={2}
                      autoComplete="off"
                      spellCheck={false}
                      disabled={!stepDone}
                    />
                  </div>
                  <p className="text-[11px] leading-relaxed text-[var(--muted)]">
                    Ordium chiffre et stocke ces clés localement pour le paper uniquement. Pas de
                    live tant que tu ne le demandes pas.
                  </p>
                  <button
                    type="button"
                    disabled={busy || !canSubmit || !stepDone}
                    onClick={() =>
                      void run(async () => {
                        const res = await apiFetch("/api/execution/enable", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            broker: "binance",
                            environment: "paper",
                            apiKey: apiKey.trim(),
                            apiSecret: apiSecret.trim(),
                            label: "Binance Testnet",
                          }),
                        });
                        const data = await res.json();
                        if (!res.ok) throw new Error(data.error);
                        setMsg(
                          `Paper connecté (${data.scopes?.join(", ")}).${
                            data.note ? ` ${data.note}` : ""
                          }`,
                        );
                        const allDone = [true, true, true, true];
                        setTutorialDone(allDone);
                        saveExecTutorialDone(allDone);
                        setApiKey("");
                        setApiSecret("");
                      })
                    }
                    className="w-full rounded-xl bg-[var(--text)] px-4 py-3 text-sm font-medium text-white hover:bg-[#2a2a2a] disabled:opacity-40"
                  >
                    {busy ? "Connexion…" : "Connecter le paper"}
                  </button>
                </div>
              </div>

              <p className="text-center text-[11px] text-[var(--muted)]">
                Compte Binance prod inutile pour cette étape — uniquement le Testnet.
              </p>
            </section>
          )}

          {/* Advanced — collapsed */}
          <div className="mt-12 border-t border-[var(--border)] pt-6">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex w-full items-center justify-between text-left text-sm text-[var(--muted)] hover:text-[var(--text)]"
            >
              <span>Options avancées</span>
              <span className="text-xs">{showAdvanced ? "Masquer" : "Afficher"}</span>
            </button>
            {showAdvanced && (
              <div className="mt-4 space-y-4 rounded-3xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5">
                {!paperConn && status && (
                  <KillSwitchCard
                    engaged={Boolean(status.killSwitch.engaged)}
                    reason={status.killSwitch.reason}
                    busy={busy}
                    onToggle={() =>
                      void run(async () => {
                        const engaged = !status.killSwitch.engaged;
                        const res = await apiFetch("/api/execution/killswitch", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ engaged, reason: "Action utilisateur" }),
                        });
                        const data = await res.json();
                        if (!res.ok) throw new Error(data.error);
                        setMsg(
                      data.engaged
                        ? "Kill switch engagé — autos mises en pause."
                        : "Kill switch levé. Si l’auto est en pause, reclique « Lancer l’auto paper », puis « Tester un run ».",
                    );
                      })
                    }
                  />
                )}

                <div className="space-y-3">
                  <h3 className="text-xs font-semibold text-[var(--text)]">Ticket d’ordre manuel</h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <select
                      className="ord-input"
                      value={orderEnv}
                      onChange={(e) => setOrderEnv(e.target.value as Env)}
                    >
                      <option value="paper">Paper / testnet</option>
                      <option value="live">Live</option>
                    </select>
                    <select
                      className="ord-input"
                      value={orderSide}
                      onChange={(e) => setOrderSide(e.target.value as "buy" | "sell")}
                    >
                      <option value="buy">Buy</option>
                      <option value="sell">Sell</option>
                    </select>
                    <input
                      className="ord-input"
                      value={orderSymbol}
                      onChange={(e) => setOrderSymbol(e.target.value)}
                      placeholder="BTCUSDT"
                    />
                    <input
                      className="ord-input"
                      value={orderNotional}
                      onChange={(e) => setOrderNotional(e.target.value)}
                      placeholder="Notional USDT"
                    />
                    <input
                      className="ord-input sm:col-span-2"
                      value={orderQty}
                      onChange={(e) => setOrderQty(e.target.value)}
                      placeholder="Quantity (optionnel)"
                    />
                  </div>
                  {orderEnv === "live" && (
                    <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                      <input
                        type="checkbox"
                        checked={confirmLive}
                        onChange={(e) => setConfirmLive(e.target.checked)}
                      />
                      Je confirme un ordre live (argent réel)
                    </label>
                  )}
                  <button
                    type="button"
                    className="ord-btn ord-btn-primary"
                    disabled={busy || !paperConn}
                    onClick={() =>
                      void run(async () => {
                        const res = await apiFetch("/api/execution/orders", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            broker: "binance",
                            environment: orderEnv,
                            symbol: orderSymbol,
                            side: orderSide,
                            type: "market",
                            notional: orderNotional ? Number(orderNotional) : undefined,
                            quantity: orderQty ? Number(orderQty) : undefined,
                            confirmLive: orderEnv === "live" ? confirmLive : undefined,
                          }),
                        });
                        const data = await res.json();
                        if (!res.ok) throw new Error(data.error);
                        setMsg(`Ordre ${data.orderId} — ${data.status}`);
                        setOrderHistoryKey((k) => k + 1);
                      })
                    }
                  >
                    Envoyer l’ordre
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function KillSwitchCard({
  engaged,
  reason,
  busy,
  onToggle,
}: {
  engaged: boolean;
  reason?: string;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-3xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text)]">Kill switch</h3>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            {engaged
              ? `Actif — ${reason ?? "tout est stoppé"}`
              : "Inactif — ordres paper autorisés"}
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onToggle}
          className={`rounded-xl px-3 py-2 text-xs font-medium ${
            engaged
              ? "bg-[var(--text)] text-white"
              : "border border-[var(--border)] text-[var(--text)] hover:bg-[var(--bg)]"
          }`}
        >
          {engaged ? "Lever" : "Engager"}
        </button>
      </div>
    </div>
  );
}

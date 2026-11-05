"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssetInfo } from "@ordium/data/types";
import type { BacktestResult } from "@ordium/engine";
import type { Holding, RealPortfolioSeries } from "@ordium/portfolio";
import { apiFetch } from "@/lib/api";
import { assetLabel, nameMapFromHoldings } from "@/lib/assets";
import type { PortfolioPayload } from "@/lib/types";
import {
  allocationFromPortfolio,
  horizonLabel,
  seedStateFromPortfolio,
  toStrategyDocument,
  type AllocationRow,
  type EditorState,
} from "@/lib/strategy";
import {
  createStrategy,
  loadStrategyStore,
  sanitizeStrategyName,
  saveStrategyStore,
  withExclusiveEnabled,
  type SavedStrategy,
  type StoredChatMessage,
} from "@/lib/strategyStore";
import { scrubYearBudget, isSuspiciousYearBudget } from "@/lib/strategyRequired";
import { checkStrategyBrokerCompatibility } from "@/lib/brokerCompatibility";
import { scopedStorageKey } from "@/lib/userScope";
import {
  fetchExecutionStatus,
  hasPaperExecutionConnection,
  pickPaperConnection,
  syncStrategyPaperSchedule,
  type ExecutionScheduleInfo,
} from "@/lib/executionPaper";
import { AllocationQuestionnaire } from "./AllocationQuestionnaire";
import { Editor } from "./Editor";
import { emptyHolding, HoldingsEditor, withDerivedPnl } from "./HoldingsEditor";
import { PortfolioPanel } from "./PortfolioPanel";
import { Results } from "./Results";
import { StrategyChat } from "./StrategyChat";

interface BacktestPayload {
  result: BacktestResult;
  baseline: BacktestResult;
  real?: RealPortfolioSeries | null;
  realError?: string | null;
  calibration?: {
    netInvested: number;
    windowCount: number;
    budgetAmount: number;
  } | null;
}

interface BuilderProps {
  hidePortfolioPanel?: boolean;
}

function rowsFromPayload(payload: PortfolioPayload): Holding[] {
  const byAsset = new Map(payload.portfolio.holdings.map((h) => [h.asset, h]));
  return payload.valuation.positions.map((p) => {
    const base = byAsset.get(p.asset);
    const invested = p.invested ?? base?.invested;
    const value = p.value ?? base?.value;
    const pnl =
      value != null && invested != null ? value - invested : (base?.pnl ?? undefined);
    return withDerivedPnl({
      asset: p.asset,
      name: base?.name,
      quantity: p.quantity,
      price: p.lastPrice ?? base?.price,
      avgPrice: p.avgCost ?? base?.avgPrice,
      invested: invested ?? undefined,
      value: value ?? undefined,
      pnl: pnl ?? undefined,
      pnlPct: p.plPct ?? base?.pnlPct,
    });
  });
}

export function Builder({ hidePortfolioPanel = false }: BuilderProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [showAllocQuiz, setShowAllocQuiz] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  const [strategies, setStrategies] = useState<SavedStrategy[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [hydrated, setHydrated] = useState(false);
  /** Brouillon de nom (espaces OK pendant la frappe ; trim au blur). */
  const [nameDraft, setNameDraft] = useState("");

  const active = strategies.find((s) => s.id === activeId) ?? strategies[0];
  const state = active?.state;

  const [assets, setAssets] = useState<AssetInfo[]>([]);
  const [payload, setPayload] = useState<BacktestPayload | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** true = réglages changés depuis le dernier backtest affiché. */
  const [stale, setStale] = useState(false);
  const [apiDown, setApiDown] = useState(false);
  const [positionsOpen, setPositionsOpen] = useState(false);
  /** Popup : activation impossible sans broker. */
  const [brokerRequiredOpen, setBrokerRequiredOpen] = useState(false);
  /** Popup : il faut d’abord avoir simulé. */
  const [needSimulationOpen, setNeedSimulationOpen] = useState(false);
  /** Schedule paper lié à la strat active (feedback UI). */
  const [paperSchedule, setPaperSchedule] = useState<ExecutionScheduleInfo | null>(null);
  const [activateMsg, setActivateMsg] = useState<string | null>(null);
  const [draftHoldings, setDraftHoldings] = useState<Holding[]>([]);
  const [positionsBusy, setPositionsBusy] = useState(false);
  const [positionsError, setPositionsError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const seededRef = useRef(false);
  const hasRealHistory = (portfolio?.portfolio.transactions.length ?? 0) > 0;
  /** Empreinte du dernier run réussi — pour marquer stale sans recalcul auto. */
  const lastRunKeyRef = useRef<string | null>(null);
  const activeNav: "chat" | "positions" | "assets" | "simulation" | "settings" =
    settingsOpen
      ? "settings"
      : positionsOpen
        ? "positions"
        : showAllocQuiz
          ? "assets"
          : !chatOpen && showResults
            ? "simulation"
            : "chat";

  useEffect(() => {
    const store = loadStrategyStore();
    setStrategies(store.strategies);
    setActiveId(store.activeId);
    const current = store.strategies.find((s) => s.id === store.activeId) ?? store.strategies[0];
    setNameDraft(current?.name ?? "");
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!active) return;
    setNameDraft(active.name);
  }, [active?.id, active?.name]);

  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStoreRef = useRef<{ activeId: string; strategies: SavedStrategy[] } | null>(
    null,
  );

  const flushStore = useCallback(() => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    const pending = pendingStoreRef.current;
    if (!pending) return;
    pendingStoreRef.current = null;
    saveStrategyStore({
      version: 3,
      activeId: pending.activeId,
      strategies: pending.strategies,
    });
  }, []);

  const scheduleStore = useCallback(
    (nextStrategies: SavedStrategy[], nextActiveId: string) => {
      pendingStoreRef.current = { strategies: nextStrategies, activeId: nextActiveId };
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(() => flushStore(), 350);
    },
    [flushStore],
  );

  const persist = useCallback(
    (nextStrategies: SavedStrategy[], nextActiveId: string) => {
      setStrategies(nextStrategies);
      setActiveId(nextActiveId);
      pendingStoreRef.current = { strategies: nextStrategies, activeId: nextActiveId };
      flushStore();
    },
    [flushStore],
  );

  const setState = useCallback(
    (updater: EditorState | ((s: EditorState) => EditorState)) => {
      if (!activeId) return;
      setStrategies((prev) => {
        const next = prev.map((s) => {
          if (s.id !== activeId) return s;
          const nextState = typeof updater === "function" ? updater(s.state) : updater;
          return { ...s, state: nextState, updatedAt: new Date().toISOString() };
        });
        // Debounce disque : un slider ne doit pas JSON.stringify à chaque tick.
        scheduleStore(next, activeId);
        return next;
      });
      // Réglages enregistrés, mais le graphique ne bouge qu’au clic « Recalculer ».
      if (lastRunKeyRef.current != null) setStale(true);
    },
    [activeId, scheduleStore],
  );

  /** Patch partiel sûr (réglages) — évite d’écraser avec un state React périmé. */
  const patchState = useCallback(
    (patch: Partial<EditorState>) => {
      setState((s) => ({ ...s, ...patch }));
    },
    [setState],
  );

  const assetNames = useMemo(
    () => nameMapFromHoldings(portfolio?.portfolio.holdings ?? []),
    [portfolio],
  );

  const refreshAssets = async () => {
    try {
      const res = await apiFetch("/api/assets");
      if (res.ok) setAssets((await res.json()) as AssetInfo[]);
    } catch {
      // inventaire non critique
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        const res = await apiFetch("/health");
        setApiDown(!res.ok);
        if (res.ok) await refreshAssets();
      } catch {
        setApiDown(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (apiDown) return;
    void (async () => {
      try {
        const res = await apiFetch("/api/portfolio");
        const data = await res.json();
        if (res.ok && data?.portfolio) {
          applyPortfolio(data as PortfolioPayload, "load");
        }
      } catch {
        // pas de portefeuille
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiDown]);

  const applyPortfolio = (
    next: PortfolioPayload | null,
    reason: "load" | "import" | "delete",
  ) => {
    setPortfolio(next);
    if (reason === "delete" || !next) {
      seededRef.current = false;
      return;
    }

    const firstSeed = reason === "import" || !seededRef.current;
    // Ne plafonne plus : l’utilisateur choisit les actifs dans le questionnaire.
    const patch = seedStateFromPortfolio(next, {
      replacePeriod: firstSeed,
    });

    setState((s) => {
      if (firstSeed) return { ...s, ...patch };
      // Import ultérieur : ne touche pas une allocation déjà choisie.
      return {
        ...s,
        currency: patch.currency ?? s.currency,
      };
    });
    seededRef.current = true;
    void refreshAssets();
  };

  const onPortfolioImported = (
    next: PortfolioPayload | null,
    reason?: "load" | "import" | "delete",
  ) => {
    applyPortfolio(next, reason ?? "load");
  };

  const resyncAllocation = () => {
    setShowAllocQuiz(true);
    setShowResults(false);
  };

  // Plus de forçage silencieux top-N : l’allocation est choisie explicitement.
  const openPositions = () => {
    if (portfolio) {
      setDraftHoldings(rowsFromPayload(portfolio));
    } else {
      setDraftHoldings([emptyHolding()]);
    }
    setPositionsError(null);
    setPositionsOpen(true);
  };

  const savePositions = async () => {
    if (!state) return;
    const cleaned = draftHoldings
      .filter((h) => h.asset.trim() && h.quantity > 0)
      .map(withDerivedPnl);
    if (cleaned.length === 0) {
      setPositionsError("Il faut au moins une position.");
      return;
    }
    setPositionsBusy(true);
    setPositionsError(null);
    try {
      const res = await apiFetch("/api/portfolio/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usedLlm: false,
          source: portfolio?.portfolio.source ?? "manual",
          kind: "holdings",
          currency: portfolio?.portfolio.currency ?? state.currency,
          name: portfolio?.portfolio.name ?? "Mon portefeuille",
          transactions: portfolio?.portfolio.transactions ?? [],
          holdings: cleaned,
          warnings: portfolio?.portfolio.warnings ?? [],
          summary: "Positions mises à jour depuis la stratégie.",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPositionsError(data.error ?? "Enregistrement impossible");
        return;
      }
      const next = data as PortfolioPayload;
      setPortfolio(next);
      const patch = seedStateFromPortfolio(next, {
        replacePeriod: false,
      });
      // Ne force plus l’allocation : l’utilisateur la confirme au questionnaire.
      setState((s) => ({
        ...s,
        currency: patch.currency ?? s.currency,
      }));
      seededRef.current = true;
      setPositionsOpen(false);
      void refreshAssets();
      // Première sim uniquement : sinon on garde les actifs déjà choisis.
      if (!active?.assetsConfirmed) {
        setShowAllocQuiz(true);
        setShowResults(false);
      }
    } catch (err) {
      setPositionsError((err as Error).message);
    } finally {
      setPositionsBusy(false);
    }
  };

  const backtestKey = useCallback(
    (s: EditorState) =>
      JSON.stringify({
        doc: toStrategyDocument(s),
        from: s.from,
        to: s.to,
        feePct: s.feePct,
        includePortfolio: hasRealHistory,
      }),
    [hasRealHistory],
  );

  /** Lance (ou relance) le backtest — uniquement sur action explicite. */
  const runBacktest = useCallback(
    async (override?: Partial<EditorState>) => {
      const s = state ? { ...state, ...override } : null;
      if (!s || apiDown) return;

      if (isSuspiciousYearBudget(s.budgetAmount)) {
        setError(
          `Le budget (${s.budgetAmount}) ressemble à une année, pas à un montant. Indique le vrai montant de base (ex. 200) dans le chat ou les réglages.`,
        );
        setPayload(null);
        setLoading(false);
        return;
      }

      const from = s.from?.slice(0, 10);
      const to = s.to?.slice(0, 10);
      if (!from || !to || from > to) {
        setError("Dates de backtest invalides — indique une date de début (avant la date de fin).");
        setLoading(false);
        setPayload(null);
        return;
      }
      if (!s.allocation.some((a) => a.pct > 0)) {
        setError("Allocation vide — importe un portefeuille ou choisis des actifs.");
        setLoading(false);
        setPayload(null);
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const key = backtestKey(s);
      setLoading(true);
      setChatOpen(false);
      setShowResults(true);
      setShowAllocQuiz(false);
      try {
        const strategyDoc = toStrategyDocument(s);
        const res = await apiFetch("/api/backtest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strategy: strategyDoc,
            from: s.from,
            to: s.to,
            feePct: s.feePct,
            includePortfolio: hasRealHistory,
          }),
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        const data = await res.json();
        if (controller.signal.aborted) return;
        if (!res.ok) {
          setError(data.error ?? "Erreur inconnue");
          setPayload(null);
        } else {
          setPayload(data as BacktestPayload);
          setError(null);
          lastRunKeyRef.current = key;
          setStale(false);
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError(
          (err as Error).message.includes("fetch")
            ? "API injoignable — lancez `pnpm dev` (API :4000 + web :3000)."
            : (err as Error).message,
        );
        setPayload(null);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [state, apiDown, hasRealHistory, backtestKey],
  );

  const markAssetsConfirmed = useCallback(() => {
    if (!activeId) return;
    setStrategies((prev) => {
      const next = prev.map((s) =>
        s.id === activeId
          ? { ...s, assetsConfirmed: true, updatedAt: new Date().toISOString() }
          : s,
      );
      scheduleStore(next, activeId);
      return next;
    });
  }, [activeId, scheduleStore]);

  /** Garantit une allocation = tous les actifs du portefeuille si vide. */
  const ensureAllAssetsAllocation = useCallback((): AllocationRow[] | null => {
    if (!state) return null;
    if (state.allocation.some((a) => a.pct > 0)) return state.allocation;
    if (!portfolio) return null;
    return allocationFromPortfolio(portfolio);
  }, [state, portfolio]);

  /**
   * Lance la simulation. Première fois d’une strat → questionnaire d’actifs.
   * Ensuite → on garde l’allocation (tous les actifs par défaut).
   */
  const startSimulation = useCallback(() => {
    if (!state || apiDown) return;

    if (!active?.assetsConfirmed) {
      if (portfolio && !state.allocation.some((a) => a.pct > 0)) {
        const alloc = allocationFromPortfolio(portfolio);
        if (alloc?.length) setState((s) => ({ ...s, allocation: alloc }));
      }
      setChatOpen(false);
      setShowResults(false);
      setShowAllocQuiz(true);
      return;
    }

    const alloc = ensureAllAssetsAllocation();
    if (alloc && alloc !== state.allocation) {
      setState((s) => ({ ...s, allocation: alloc }));
      void runBacktest({ allocation: alloc });
      return;
    }
    void runBacktest();
  }, [
    state,
    apiDown,
    active?.assetsConfirmed,
    portfolio,
    setState,
    ensureAllAssetsAllocation,
    runBacktest,
  ]);

  const selectStrategy = (id: string) => {
    persist(strategies, id);
    setPayload(null);
    lastRunKeyRef.current = null;
    setStale(false);
    setChatOpen(false);
    setShowResults(false);
    setShowAllocQuiz(false);
  };

  const addStrategy = () => {
    const s = createStrategy(`Stratégie ${strategies.length + 1}`);
    persist([...strategies, s], s.id);
    setPayload(null);
    lastRunKeyRef.current = null;
    setStale(false);
    setChatOpen(false);
    setShowResults(false);
    setShowAllocQuiz(false);
  };

  const refreshPaperSchedule = useCallback(async (strategyId: string) => {
    const status = await fetchExecutionStatus();
    const found =
      status?.schedules.find((s) => s.strategyId === strategyId && s.enabled) ?? null;
    setPaperSchedule(found);
  }, []);

  useEffect(() => {
    if (!activeId || !active?.enabled) {
      setPaperSchedule(null);
      return;
    }
    void refreshPaperSchedule(activeId);
  }, [activeId, active?.enabled, refreshPaperSchedule]);

  const checkBrokerConnected = useCallback(async (): Promise<boolean> => {
    return hasPaperExecutionConnection();
  }, []);

  const toggleEnabled = (id: string) => {
    void (async () => {
      const target = strategies.find((s) => s.id === id);
      const turningOn = target ? !target.enabled : true;
      if (turningOn) {
        if (id !== activeId || !payload) {
          setNeedSimulationOpen(true);
          return;
        }
        const ok = await checkBrokerConnected();
        if (!ok) {
          setBrokerRequiredOpen(true);
          return;
        }
        const status = await fetchExecutionStatus();
        const conn = status ? pickPaperConnection(status.connections) : null;
        if (conn && state) {
          const compat = checkStrategyBrokerCompatibility(
            toStrategyDocument(state) as {
              allocation?: Array<{ asset?: string; weight?: number }>;
            },
            conn.broker,
          );
          if (!compat.ok) {
            setActivateMsg(compat.message ?? "Stratégie incompatible avec le broker.");
            return;
          }
        }
      }
      const next = withExclusiveEnabled(strategies, turningOn ? id : null);
      persist(next, activeId);

      if (state && id === activeId) {
        const sync = await syncStrategyPaperSchedule({
          strategyId: id,
          strategyJson: toStrategyDocument(state),
          amount: state.budgetAmount,
          enabled: turningOn,
        });
        if ("error" in sync) {
          setActivateMsg(sync.error);
          if (turningOn) {
            persist(withExclusiveEnabled(next, null), activeId);
          }
          return;
        }
        setPaperSchedule(sync.schedule.enabled ? sync.schedule : null);
        setActivateMsg(
          turningOn
            ? `Paper ${sync.connection.broker} activé — une seule strat à la fois.`
            : "Automatisation paper en pause.",
        );
      }
    })();
  };

  /** Activer depuis la simulation (après analyse) — sinon popup broker. */
  const activateFromSimulation = () => {
    if (!activeId || !state) return;
    void (async () => {
      setActivateMsg(null);
      if (active?.enabled) {
        const sync = await syncStrategyPaperSchedule({
          strategyId: activeId,
          strategyJson: toStrategyDocument(state),
          amount: state.budgetAmount,
          enabled: false,
        });
        const next = withExclusiveEnabled(strategies, null);
        persist(next, activeId);
        setPaperSchedule(null);
        setActivateMsg(
          "error" in sync ? sync.error : "Stratégie désactivée — paper en pause.",
        );
        return;
      }
      const ok = await checkBrokerConnected();
      if (!ok) {
        setBrokerRequiredOpen(true);
        return;
      }
      const status = await fetchExecutionStatus();
      const conn = status ? pickPaperConnection(status.connections) : null;
      if (conn) {
        const compat = checkStrategyBrokerCompatibility(
          toStrategyDocument(state) as {
            allocation?: Array<{ asset?: string; weight?: number }>;
          },
          conn.broker,
        );
        if (!compat.ok) {
          setActivateMsg(compat.message ?? "Stratégie incompatible avec le broker.");
          return;
        }
      }
      const sync = await syncStrategyPaperSchedule({
        strategyId: activeId,
        strategyJson: toStrategyDocument(state),
        amount: state.budgetAmount,
        enabled: true,
      });
      if ("error" in sync) {
        setActivateMsg(sync.error);
        setBrokerRequiredOpen(true);
        return;
      }
      const next = withExclusiveEnabled(strategies, activeId);
      persist(next, activeId);
      setPaperSchedule(sync.schedule);
      setActivateMsg(
        `Paper ${sync.connection.broker} · auto active (seule strat). Prochain run : ${new Date(
          sync.schedule.nextRunAt,
        ).toLocaleString("fr-FR")}.`,
      );
    })();
  };

  const renameStrategy = (id: string, name: string, { commit }: { commit: boolean }) => {
    if (!commit) {
      setNameDraft(name);
      return;
    }
    const finalName = sanitizeStrategyName(name, "Sans titre");
    setNameDraft(finalName);
    const next = strategies.map((s) =>
      s.id === id ? { ...s, name: finalName, updatedAt: new Date().toISOString() } : s,
    );
    persist(next, activeId);
  };

  const setChatMessages = (messages: StoredChatMessage[]) => {
    if (!activeId) return;
    setStrategies((prev) => {
      const next = prev.map((s) =>
        s.id === activeId
          ? { ...s, messages, updatedAt: new Date().toISOString() }
          : s,
      );
      saveStrategyStore({ version: 3, activeId, strategies: next });
      return next;
    });
  };

  const deleteStrategy = (id: string) => {
    if (strategies.length <= 1) return;
    const next = strategies.filter((s) => s.id !== id);
    const nextActive = id === activeId ? next[0]!.id : activeId;
    persist(next, nextActive);
  };

  if (!hydrated || !state || !active) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center text-sm text-[var(--muted)]">
        Chargement…
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-0 overflow-hidden bg-[var(--bg)]">
      {/* Sidebar strats — style GPT */}
      <aside
        className={`flex shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-elevated)] transition-[width] duration-200 ${
          sidebarOpen ? "w-[260px]" : "w-0 overflow-hidden border-r-0"
        }`}
      >
        <div className="flex items-center justify-between gap-2 px-3 py-3">
          <p className="text-xs font-medium text-[var(--muted)]">Stratégies</p>
          <button
            type="button"
            onClick={addStrategy}
            className="rounded-md px-2 py-1 text-xs text-[var(--text)] hover:bg-[#efefec]"
            title="Nouvelle stratégie"
          >
            + Nouveau
          </button>
        </div>
        <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {[...strategies]
            .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
            .map((s) => {
            const selected = s.id === activeId;
            return (
              <div
                key={s.id}
                className={`group flex items-center gap-2 rounded-lg px-2 py-2 text-sm ${
                  selected
                    ? "bg-[#efefec] text-[var(--text)]"
                    : "text-[var(--muted)] hover:bg-[#f4f4f1] hover:text-[var(--text)]"
                }`}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left"
                  onClick={() => selectStrategy(s.id)}
                  title={s.name}
                >
                  {s.name}
                </button>
                <button
                  type="button"
                  title={s.enabled ? "Activée — cliquer pour désactiver" : "Inactive — cliquer pour activer"}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleEnabled(s.id);
                  }}
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    s.enabled ? "bg-[var(--accent)]" : "bg-[var(--border-strong)]"
                  }`}
                  aria-label={s.enabled ? "Stratégie activée" : "Stratégie inactive"}
                />
              </div>
            );
          })}
        </div>
        <div className="border-t border-[var(--border)] px-3 py-3 text-[10px] leading-relaxed text-[var(--muted)]">
          Pastille verte = stratégie activée (après simulation + broker). Une seule à la fois.
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--bg-elevated)] px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--text)]"
              title={sidebarOpen ? "Replier" : "Stratégies"}
            >
              {sidebarOpen ? "⟨" : "⟩"}
            </button>
            <input
              value={nameDraft}
              onChange={(e) => renameStrategy(active.id, e.target.value, { commit: false })}
              onBlur={() => renameStrategy(active.id, nameDraft, { commit: true })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                }
              }}
              placeholder="Nom de la stratégie"
              className="min-w-0 max-w-[200px] bg-transparent text-sm font-medium text-[var(--text)] outline-none sm:max-w-xs"
              title="Renommer"
            />
            <button
              type="button"
              disabled={loading || apiDown}
              onClick={() => void (active?.assetsConfirmed ? runBacktest() : startSimulation())}
              className="rounded-full border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--muted)] transition hover:text-[var(--text)] disabled:opacity-50"
            >
              {loading ? "Calcul…" : "Recalculer"}
            </button>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => {
                setChatOpen(true);
                setShowAllocQuiz(false);
              }}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                activeNav === "chat"
                  ? "border-[var(--border)] bg-[#efefec] text-[var(--text)]"
                  : "border-[var(--border)] bg-white text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              Chat
            </button>
            <button
              type="button"
              onClick={openPositions}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                activeNav === "positions"
                  ? "border-[var(--border)] bg-[#efefec] text-[var(--text)]"
                  : "border-[var(--border)] bg-white text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              Positions
            </button>
            <button
              type="button"
              onClick={() => {
                setChatOpen(false);
                setShowResults(false);
                setShowAllocQuiz(true);
              }}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                activeNav === "assets"
                  ? "border-[var(--border)] bg-[#efefec] text-[var(--text)]"
                  : "border-[var(--border)] bg-white text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              Changer les actifs
            </button>
            <button
              type="button"
              onClick={() => {
                setChatOpen(false);
                // Si on vient du changement d’actifs sans recalcul, on revient sur la dernière
                // simulation affichée (payload conservé) — sans repasser par un backtest.
                if (showAllocQuiz) {
                  if (payload) {
                    setShowAllocQuiz(false);
                    setShowResults(true);
                  }
                  return;
                }
                if (showResults) return;
                startSimulation();
              }}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                activeNav === "simulation"
                  ? "border-[var(--border)] bg-[#efefec] text-[var(--text)]"
                  : "border-[var(--border)] bg-white text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              Simulation
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                activeNav === "settings"
                  ? "border-[var(--border)] bg-[#efefec] text-[var(--text)]"
                  : "border-[var(--border)] bg-white text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              Réglages
            </button>
            <button
              type="button"
              onClick={() => {
                try {
                  sessionStorage.setItem(
                    scopedStorageKey("ordium_pending_strategy"),
                    JSON.stringify(toStrategyDocument(state)),
                  );
                } catch {
                  // ignore
                }
                window.location.href = "/execution?from=strategy";
              }}
              className="rounded-full border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--muted)] transition hover:text-[var(--text)]"
            >
              Automatiser
            </button>
            {showResults && stale && payload ? (
              <span className="text-xs text-amber-700 whitespace-nowrap">Réglages modifiés</span>
            ) : null}
          </div>
        </header>

        {apiDown && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
            API (:4000) injoignable — lance <code className="rounded bg-white px-1">pnpm dev</code>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden">
          {showAllocQuiz ? (
            <div className="h-full overflow-y-auto px-4 py-6 sm:px-8">
              <AllocationQuestionnaire
                positions={portfolio?.valuation.positions ?? []}
                holdings={portfolio?.portfolio.holdings ?? []}
                assetNames={assetNames}
                budgetAmount={state.budgetAmount}
                currency={state.currency}
                period={state.period}
                initialAllocation={state.allocation}
                onCancel={() => setShowAllocQuiz(false)}
                onConfirm={(allocation: AllocationRow[]) => {
                  setState((s) => ({ ...s, allocation }));
                  markAssetsConfirmed();
                  seededRef.current = true;
                  setChatOpen(false);
                  setShowAllocQuiz(false);
                  void runBacktest({ allocation });
                  void refreshAssets();
                }}
              />
            </div>
          ) : !chatOpen && showResults ? (
            <div className="h-full overflow-y-auto px-3 py-5 sm:px-5 lg:px-6">
              <div className="mx-auto w-full max-w-[1600px]">
                <div className="mb-6 text-center">
                  <h1 className="text-xl font-semibold tracking-tight text-[var(--text)] sm:text-2xl">
                    Test de votre stratégie
                  </h1>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Les performances passées ne présagent pas des performances futures.
                  </p>
                </div>
                {error ? (
                  <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    {error}
                  </p>
                ) : payload ? (
                  <div className={loading ? "opacity-60" : ""}>
                    <Results
                      result={payload.result}
                      baseline={payload.baseline}
                      real={payload.real ?? null}
                      realError={payload.realError ?? null}
                      currency={state.currency}
                      assetNames={assetNames}
                      positions={portfolio?.valuation.positions ?? []}
                      transactions={portfolio?.portfolio.transactions ?? []}
                      simulationSummary={{
                        from: state.from,
                        to: state.to,
                        budgetAmount: state.budgetAmount,
                        currency: state.currency,
                        period: state.period,
                        windowFrom: state.windowFrom,
                        windowTo: state.windowTo,
                        assets: state.allocation.map((a) => a.asset),
                        horizonLabel: horizonLabel(state.horizon),
                      }}
                      onEditSettings={() => setSettingsOpen(true)}
                      onBackToChat={() => setChatOpen(true)}
                      strategyEnabled={Boolean(active.enabled)}
                      onToggleActivate={activateFromSimulation}
                      paperStatus={
                        active.enabled && paperSchedule
                          ? {
                              broker: paperSchedule.broker,
                              nextRunAt: paperSchedule.nextRunAt,
                              lastError: paperSchedule.lastError,
                            }
                          : active.enabled
                            ? { broker: "paper", nextRunAt: null }
                            : null
                      }
                      activateMessage={activateMsg}
                      importedSnapshot={
                        portfolio
                          ? {
                              name: portfolio.portfolio.name,
                              totalValue: portfolio.valuation.totalValue,
                              netInvested: portfolio.valuation.netInvested,
                              plPct: portfolio.valuation.plPct,
                            }
                          : null
                      }
                    />
                  </div>
                  ) : loading ? (
                  <p className="text-sm text-[var(--muted)]">
                    Calcul de la simulation
                    {state.allocation.length > 0
                      ? ` (${state.allocation.length} actif${state.allocation.length > 1 ? "s" : ""})`
                      : ""}
                    …
                  </p>
                ) : (
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] px-5 py-8 text-center">
                    <p className="text-sm font-medium text-[var(--text)]">
                      Pas encore de résultats
                    </p>
                    <p className="mt-2 text-sm text-[var(--muted)]">
                      Lance la simulation pour voir le graphique, ou ajuste les réglages puis
                      appuie sur Recalculer.
                    </p>
                    <button
                      type="button"
                      disabled={loading || apiDown}
                      onClick={() => startSimulation()}
                      className="mt-4 rounded-xl bg-[var(--text)] px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                    >
                      {loading ? "Calcul…" : "Lancer la simulation"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <StrategyChat
              key={active.id}
              strategyName={active.name}
              messages={active.messages ?? []}
              onMessagesChange={setChatMessages}
              portfolioCurrency={portfolio?.portfolio.currency ?? state.currency}
              firstTransactionDate={portfolio?.firstTransactionDate ?? null}
              onOpenSettings={() => setSettingsOpen(true)}
              onValidateAndSimulate={(patch) => {
                const cleanPatch = scrubYearBudget(
                  Object.fromEntries(
                    Object.entries(patch).filter(([, v]) => v !== undefined && v !== null),
                  ) as Partial<EditorState>,
                );
                const chatAllocation =
                  Array.isArray(cleanPatch.allocation) &&
                  cleanPatch.allocation.some((a) => a.pct > 0)
                    ? cleanPatch.allocation.map((a) => ({
                        asset: a.asset,
                        pct: a.pct,
                      }))
                    : null;
                const assetsChoice =
                  cleanPatch.assetsChoice ?? active.state.assetsChoice;
                const portfolioAlloc = portfolio
                  ? allocationFromPortfolio(portfolio)
                  : null;
                const nextAllocation =
                  assetsChoice === "portfolio"
                    ? portfolioAlloc ??
                      (state.allocation.some((a) => a.pct > 0)
                        ? state.allocation
                        : chatAllocation ?? state.allocation)
                    : chatAllocation ??
                      (state.allocation.some((a) => a.pct > 0)
                        ? state.allocation
                        : portfolioAlloc ?? state.allocation);
                const customConfirmed =
                  assetsChoice === "custom" && Boolean(chatAllocation?.length);

                setStrategies((prev) => {
                  const next = prev.map((s) => {
                    if (s.id !== activeId) return s;
                    const merged: EditorState = {
                      ...s.state,
                      ...cleanPatch,
                      allocation: nextAllocation,
                      assetsChoice,
                      currency:
                        portfolio?.portfolio.currency ??
                        cleanPatch.currency ??
                        s.state.currency,
                    };
                    return {
                      ...s,
                      enabled: false,
                      assetsConfirmed: customConfirmed
                        ? true
                        : assetsChoice === "portfolio"
                          ? false
                          : s.assetsConfirmed,
                      state: merged,
                      updatedAt: new Date().toISOString(),
                    };
                  });
                  saveStrategyStore({ version: 3, activeId, strategies: next });
                  return next;
                });
                setChatOpen(false);

                // Oui portefeuille → toujours le quiz (pré-rempli) pour confirmer les %.
                if (assetsChoice === "portfolio") {
                  setState((s) => ({ ...s, ...cleanPatch, allocation: nextAllocation, assetsChoice }));
                  setShowResults(false);
                  setShowAllocQuiz(true);
                  return;
                }
                // Non + tickers (ou allocation chat) → skip quiz.
                if (customConfirmed || active.assetsConfirmed) {
                  void runBacktest({ ...cleanPatch, allocation: nextAllocation });
                  return;
                }
                // Legacy / pas de chat actifs → comportement actuel.
                if (!active.assetsConfirmed) {
                  setShowResults(false);
                  setShowAllocQuiz(true);
                  return;
                }
                void runBacktest({ ...cleanPatch, allocation: nextAllocation });
              }}
            />
          )}
        </div>
      </div>

      {/* Drawer Réglages */}
      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/25"
          role="dialog"
          aria-modal="true"
          aria-label="Réglages stratégie"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSettingsOpen(false);
          }}
        >
          <div className="flex h-full w-full max-w-lg flex-col border-l border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--border)] px-4">
              <div>
                <p className="text-sm font-medium text-[var(--text)]">Réglages</p>
                <p className="text-[11px] text-[var(--muted)]">
                  Enregistrés tout de suite — le graphique ne change qu’au clic Recalculer
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)] hover:text-[var(--text)]"
                >
                  Fermer
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {portfolio && (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--accent-soft)] px-3 py-2 text-xs text-[var(--accent)]">
                  Actifs de la simulation (choix manuel) :{" "}
                  {state.allocation
                    .filter((a) => a.pct > 0)
                    .map((a) => `${assetLabel(a.asset, assetNames)} ${a.pct.toFixed(0)}%`)
                    .join(" · ") || "non choisis"}
                  <button
                    type="button"
                    onClick={() => {
                      setSettingsOpen(false);
                      resyncAllocation();
                    }}
                    className="ml-2 underline"
                  >
                    Modifier
                  </button>
                </div>
              )}
              {!hidePortfolioPanel && (
                <PortfolioPanel
                  currency={state.currency}
                  onPortfolioChange={onPortfolioImported}
                  onUseAllocation={(rows) => {
                    if (rows.length === 0) return;
                    const total = rows.reduce((s, r) => s + r.pct, 0);
                    const allocation = rows.map((r, i) => ({
                      asset: r.asset,
                      pct:
                        i === rows.length - 1
                          ? 100 -
                            rows
                              .slice(0, -1)
                              .reduce((s, x) => s + Math.round((x.pct / total) * 100), 0)
                          : Math.round((r.pct / total) * 100),
                    }));
                    setState((s) => ({ ...s, allocation }));
                    seededRef.current = true;
                    void refreshAssets();
                  }}
                />
              )}
              <Editor
                state={state}
                onChange={setState}
                onPatch={patchState}
                assetNames={assetNames}
                firstTransactionDate={portfolio?.firstTransactionDate ?? null}
              />
              {strategies.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Supprimer « ${active.name} » ?`)) {
                      deleteStrategy(active.id);
                      setSettingsOpen(false);
                    }
                  }}
                  className="w-full rounded-lg border border-red-200 px-3 py-2 text-xs text-red-700 hover:bg-red-50"
                >
                  Supprimer cette stratégie
                </button>
              )}
            </div>
            <div className="shrink-0 border-t border-[var(--border)] px-4 py-3">
              <button
                type="button"
                disabled={loading || apiDown}
                onClick={() => {
                  setSettingsOpen(false);
                  if (active?.assetsConfirmed) void runBacktest();
                  else startSimulation();
                }}
                className="w-full rounded-xl bg-[var(--text)] px-3 py-2.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {loading
                  ? "Calcul en cours…"
                  : showResults && payload
                    ? "Recalculer la simulation"
                    : "Lancer la simulation"}
              </button>
            </div>
          </div>
        </div>
      )}

      {positionsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-900/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !positionsBusy) setPositionsOpen(false);
          }}
        >
          <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-[var(--border)] bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[var(--text)]">Gérer les positions</h2>
                <p className="mt-0.5 text-sm text-[var(--muted)]">
                  La répartition de la stratégie suit ces poids.
                </p>
              </div>
              <button
                type="button"
                disabled={positionsBusy}
                onClick={() => setPositionsOpen(false)}
                className="text-sm text-[var(--muted)]"
              >
                Fermer
              </button>
            </div>
            {!portfolio && (
              <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Aucun portefeuille —{" "}
                <Link href="/positions" className="underline">
                  importer autrement
                </Link>
                .
              </p>
            )}
            <HoldingsEditor
              holdings={draftHoldings}
              currency={portfolio?.portfolio.currency ?? state.currency}
              editable
              onChange={setDraftHoldings}
              maxHeightClass="max-h-[50vh]"
            />
            {positionsError && <p className="mt-3 text-sm text-red-600">{positionsError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={positionsBusy}
                onClick={() => setPositionsOpen(false)}
                className="ord-btn ord-btn-ghost !px-3 !py-1.5 text-xs"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={positionsBusy}
                onClick={() => void savePositions()}
                className="ord-btn ord-btn-primary !px-3 !py-1.5 text-xs"
              >
                {positionsBusy ? "…" : "Enregistrer"}
              </button>
            </div>
          </div>
        </div>
      )}
      {needSimulationOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="need-sim-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setNeedSimulationOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 shadow-xl">
            <p id="need-sim-title" className="text-sm font-semibold text-[var(--text)]">
              Analyse d’abord la stratégie
            </p>
            <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
              Tu ne peux activer une stratégie qu’après l’avoir simulée. Lance la simulation, regarde
              les résultats, puis clique sur « Activer la stratégie ».
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setNeedSimulationOpen(false)}
                className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)] hover:text-[var(--text)]"
              >
                Fermer
              </button>
              <button
                type="button"
                onClick={() => {
                  setNeedSimulationOpen(false);
                  setChatOpen(false);
                  startSimulation();
                }}
                className="rounded-xl bg-[var(--text)] px-3 py-2 text-xs font-medium text-white hover:bg-[#2a2a2a]"
              >
                Lancer la simulation
              </button>
            </div>
          </div>
        </div>
      )}
      {brokerRequiredOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="broker-required-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setBrokerRequiredOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 shadow-xl">
            <p id="broker-required-title" className="text-sm font-semibold text-[var(--text)]">
              Binance Testnet requis
            </p>
            <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
              Pour activer une stratégie, Ordium a besoin d’une connexion d’exécution{" "}
              <span className="font-medium text-[var(--text)]">paper</span> (Binance Testnet) :
              les ordres se passeront tout seuls selon tes règles, avec de l’argent fictif.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
              Connecte tes clés API Testnet sur la page Exécution, puis reviens ici pour activer.
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setBrokerRequiredOpen(false)}
                className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)] hover:text-[var(--text)]"
              >
                Plus tard
              </button>
              <Link
                href="/execution"
                onClick={() => setBrokerRequiredOpen(false)}
                className="rounded-xl bg-[var(--text)] px-3 py-2 text-xs font-medium text-white hover:bg-[#2a2a2a]"
              >
                Connecter Binance Testnet
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

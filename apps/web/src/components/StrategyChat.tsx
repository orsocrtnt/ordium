"use client";

import { useEffect, useRef, useState } from "react";
import { readyPresets } from "@/lib/strategyCatalog";
import { apiFetch } from "@/lib/api";
import type { EditorState } from "@/lib/strategy";
import { horizonLabel } from "@/lib/strategy";
import {
  hasExplicitStartDate,
  missingFromDraft,
  nextMissingQuestion,
  parseAllRequiredFromText,
  questionFor,
  scrubYearBudget,
} from "@/lib/strategyRequired";
import type { StoredChatMessage } from "@/lib/strategyStore";
import type { ChatAction, InterpretResponse } from "./StrategyPromptTypes";

export type { InterpretResponse } from "./StrategyPromptTypes";

type ChatMessage = StoredChatMessage;

interface StrategyChatProps {
  strategyName: string;
  messages: ChatMessage[];
  onMessagesChange: (messages: ChatMessage[]) => void;
  portfolioCurrency?: string;
  /** Pour résoudre « depuis mon premier achat ». */
  firstTransactionDate?: string | null;
  onValidateAndActivate: (patch: Partial<EditorState>, meta: InterpretResponse) => void;
}

const chips = readyPresets().slice(0, 6);

const WARN_COPY =
  "Tu es sur le point d’activer cette stratégie.\n\n" +
  "Une seule stratégie peut être active à la fois : si une autre est déjà activée, elle sera automatiquement désactivée.\n\n" +
  "Ordium appliquera uniquement les règles listées — ce n’est pas un conseil en investissement. " +
  "Les performances passées ne préjugent pas des performances futures.\n\n" +
  "Confirmer l’activation ?";

const ACTION_LABEL: Record<ChatAction, string> = {
  restart: "Reprendre à zéro",
  alternatives: "Proposer autre chose",
  revise: "Corriger un détail",
};

function lastAwaiting(msgs: ChatMessage[]): ChatMessage | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]!;
    if (m.role !== "assistant") continue;
    return m.awaitingField ? m : null;
  }
  return null;
}

function lastDraft(msgs: ChatMessage[]): Partial<EditorState> {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]!;
    if (m.draftPatch && Object.keys(m.draftPatch).length > 0) {
      return m.draftPatch as Partial<EditorState>;
    }
    if (m.pending?.patch) return m.pending.patch as Partial<EditorState>;
  }
  return {};
}

function historyForApi(msgs: ChatMessage[]): { role: "user" | "assistant"; text: string }[] {
  return msgs
    .filter((m) => m.text.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, text: m.text }));
}

/** Ordre chronologique (timestamp dans l’id `u_/a_${Date.now()}`). */
function chronological(msgs: ChatMessage[]): ChatMessage[] {
  return [...msgs].sort((a, b) => {
    const ta = Number.parseInt(a.id.replace(/^[ua]_/, ""), 10) || 0;
    const tb = Number.parseInt(b.id.replace(/^[ua]_/, ""), 10) || 0;
    if (ta !== tb) return ta - tb;
    // À timestamp égal : user avant assistant
    if (a.role !== b.role) return a.role === "user" ? -1 : 1;
    return 0;
  });
}

/** Résumé en puces : uniquement ce qui sera activé / exécuté. */
function buildExecutionBullets(meta: InterpretResponse): string[] {
  const patch = meta.patch as Partial<EditorState>;
  const bullets: string[] = [];

  if (patch.budgetAmount != null) {
    bullets.push(`Budget périodique : ${patch.budgetAmount} ${patch.currency ?? "EUR"}`);
  }
  if (patch.period || patch.windowFrom != null || patch.windowTo != null) {
    const period =
      patch.period === "weekly" ? "hebdomadaire" : patch.period === "monthly" ? "mensuelle" : null;
    const window =
      patch.windowFrom != null && patch.windowTo != null
        ? `jours ${patch.windowFrom}–${patch.windowTo}`
        : null;
    bullets.push(["Fenêtre d’achat", period, window].filter(Boolean).join(" · "));
  }
  const hLabel = horizonLabel(patch.horizon);
  if (hasExplicitStartDate(patch) && patch.from) {
    bullets.push(
      patch.horizon === "since_first_buy"
        ? `Début backtest : 1er achat (${patch.from})`
        : `Début backtest : ${patch.from}`,
    );
  } else if (hLabel || patch.from) {
    // Ne devrait plus apparaître pour activer, mais utile en brouillon partiel
    bullets.push(`Période : ${hLabel ?? patch.from}`);
  }
  if (patch.tranches != null && !(patch.tranches === 1 && (patch.distribution ?? "equal") === "equal")) {
    bullets.push(
      `Fractionnement : ${patch.tranches} tranche${patch.tranches > 1 ? "s" : ""}` +
        (patch.distribution ? ` (${patch.distribution === "random" ? "aléatoire" : "égale"})` : ""),
    );
  }
  if (patch.dipEnabled === true) {
    bullets.push(`Acheter sur baisse ≥ ${patch.dipPct ?? "…"} %`);
  }
  if (patch.rsiEnabled === true) {
    bullets.push(`Acheter si RSI ≤ ${patch.rsiValue ?? "…"}`);
  }
  if (patch.fearGreedEnabled === true) {
    bullets.push(`Acheter si Fear & Greed ≤ ${patch.fearGreedValue ?? "…"}`);
  }
  if (patch.macdEnabled === true) {
    bullets.push("Acheter si histogramme MACD > 0");
  }
  if (patch.bollingerEnabled === true) {
    bullets.push(`Acheter si Bollinger %B ≤ ${patch.bollingerPctB ?? "…"}`);
  }
  if (patch.smaBuyEnabled === true) {
    bullets.push(`Acheter si prix sous SMA(${patch.smaBuyPeriod ?? "…"})`);
  }
  if (patch.athEnabled === true) {
    bullets.push(`Éviter les nouveaux sommets (${patch.athLookback ?? "…"} j)`);
  }
  if (patch.reserveEnabled === true) {
    bullets.push(`Réserver ≥ ${patch.reservePct ?? "…"} % de cash`);
  }
  if (patch.regimeEnabled === true) {
    const ref =
      patch.regimeReferenceAsset === ""
        ? "plus gros poids"
        : patch.regimeReferenceAsset === "CSPX.L"
          ? "S&P 500"
          : !patch.regimeReferenceAsset || patch.regimeReferenceAsset === "IWDA.AS"
            ? "MSCI World"
            : patch.regimeReferenceAsset;
    bullets.push(
      `Ajuster le budget selon le régime (réf. ${ref}, SMA ${patch.regimeSmaPeriod ?? 200}j ±${patch.regimeBandPct ?? 2}%, ×${patch.bullMult ?? "…"} / ×${patch.neutralMult ?? 1} / ×${patch.bearMult ?? "…"})`,
    );
  }
  if (patch.ddTiersEnabled === true) {
    const tiers = (patch.ddTiers ?? []).map((t) => `−${t.gtePct}% → ×${t.factor}`).join(", ");
    bullets.push(`Paliers de drawdown${tiers ? ` : ${tiers}` : ""}`);
  }
  if (patch.riseTiersEnabled === true) {
    const tiers = (patch.riseTiers ?? []).map((t) => `+${t.gtePct}% → ×${t.factor}`).join(", ");
    bullets.push(`Paliers de hausse${tiers ? ` : ${tiers}` : ""}`);
  }
  if (patch.volEnabled === true) {
    bullets.push(
      `Filtre volatilité : ${patch.volMode ?? "veto"} si ≥ ${patch.volMaxPct ?? "…"} %`,
    );
  }
  if (patch.extraBuysEnabled === true) {
    const n = patch.extraBuys?.length ?? 0;
    bullets.push(`Achats exceptionnels (${n} règle${n > 1 ? "s" : ""})`);
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const b of bullets) {
    const key = b.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(b);
  }
  return unique;
}

function toPendingMeta(
  base: InterpretResponse,
  draft: Partial<EditorState>,
): InterpretResponse {
  return {
    ...base,
    patch: { ...base.patch, ...draft } as InterpretResponse["patch"],
    unanswered: [],
  };
}

export function StrategyChat({
  strategyName,
  messages,
  onMessagesChange,
  portfolioCurrency = "EUR",
  firstTransactionDate = null,
  onValidateAndActivate,
}: StrategyChatProps) {
  const currency = (portfolioCurrency || "EUR").toUpperCase();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmMsgId, setConfirmMsgId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy, confirmMsgId]);

  const appendAssistantFromTurn = (
    withUser: ChatMessage[],
    interpreted: InterpretResponse,
    draftOverride?: Partial<EditorState>,
  ) => {
    const intent = interpreted.intent ?? "build";
    // clearDraft / restart = ne pas garder l’ancien lastDraft,
    // MAIS toujours appliquer interpreted.patch (les règles du preset).
    // Avant : `draftOverride ?? interpreted.patch` avec draftOverride={}
    // (truthy) jetait tout le patch → stratégie = DCA vide.
    const draft = scrubYearBudget(
      interpreted.clearDraft || intent === "restart"
        ? ({
            ...(interpreted.patch as Partial<EditorState>),
            ...(draftOverride ?? {}),
          } as Partial<EditorState>)
        : ({
            ...lastDraft(withUser),
            ...(interpreted.patch as Partial<EditorState>),
            ...(draftOverride ?? {}),
          } as Partial<EditorState>),
    );

    const actions = interpreted.actions ?? [];
    const replyBase =
      interpreted.reply?.trim() ||
      interpreted.unanswered[0] ||
      "Dis-moi ce que tu veux ajuster.";

    // Historique chrono intact : on archive les puces des anciens messages,
    // on retire seulement les contrôles (pending / awaiting / actions).
    const base = withUser.map((m) => {
      if (m.role !== "assistant") return m;
      if (!m.pending && !m.awaitingField && !m.actions?.length) return m;
      const archivedBullets =
        m.summaryBullets ??
        (m.pending ? buildExecutionBullets(m.pending) : undefined);
      return {
        ...m,
        pending: undefined,
        awaitingField: undefined,
        actions: undefined,
        summaryBullets:
          archivedBullets && archivedBullets.length > 0 ? archivedBullets : m.summaryBullets,
      };
    });

    if (intent === "reject" || intent === "restart" || intent === "clarify") {
      const showPending =
        intent !== "reject" &&
        intent !== "restart" &&
        missingFromDraft(draft).length === 0 &&
        Object.keys(draft).length > 0;
      const meta = showPending ? toPendingMeta(interpreted, draft) : undefined;
      const preview = buildExecutionBullets(toPendingMeta(interpreted, draft));
      onMessagesChange([
        ...base,
        {
          id: `a_${Date.now()}`,
          role: "assistant",
          text: replyBase,
          draftPatch:
            intent === "restart" || interpreted.clearDraft
              ? {}
              : (draft as Record<string, unknown>),
          actions: actions.length
            ? actions
            : intent === "reject"
              ? ["restart", "alternatives", "revise"]
              : actions,
          pending: meta,
          summaryBullets: meta || preview.length === 0 ? undefined : preview,
        },
      ]);
      return;
    }

    const missing = missingFromDraft(draft);
    const meta = toPendingMeta(interpreted, draft);
    const bullets = buildExecutionBullets(meta);

    if (missing.length > 0) {
      const next = nextMissingQuestion(missing, currency);
      const question = interpreted.unanswered[0] || next?.question || replyBase;
      const reply = interpreted.reply?.trim();
      const text =
        reply && reply !== question ? `${reply}\n\n${question}` : reply || question;
      onMessagesChange([
        ...base,
        {
          id: `a_${Date.now()}`,
          role: "assistant",
          text: text.trim(),
          draftPatch: draft as Record<string, unknown>,
          awaitingField: next?.id,
          actions: actions.length ? actions : undefined,
          // Toutes les règles déjà connues (y compris montant / fenêtre si renseignés)
          summaryBullets: bullets.length > 0 ? bullets : undefined,
        },
      ]);
      return;
    }

    onMessagesChange([
      ...base,
      {
        id: `a_${Date.now()}`,
        role: "assistant",
        text:
          interpreted.reply?.trim() ||
          (intent === "revise" || intent === "answer"
            ? "C’est noté. Voici la stratégie à jour :"
            : "Voici ce qui sera activé :"),
        pending: meta,
        draftPatch: draft as Record<string, unknown>,
        actions: actions.length ? actions : ["revise", "restart"],
      },
    ]);
  };

  const runInterpret = async (
    body: Record<string, unknown>,
    userText: string | null,
    baseMessages: ChatMessage[] = messages,
  ) => {
    setBusy(true);
    setError(null);
    setConfirmMsgId(null);

    const withUser: ChatMessage[] = userText
      ? [...baseMessages, { id: `u_${Date.now()}`, role: "user", text: userText }]
      : [...baseMessages];
    if (userText) onMessagesChange(withUser);

    const awaiting = lastAwaiting(baseMessages);
    const draft = lastDraft(baseMessages);

    try {
      const res = await apiFetch("/api/strategy/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          history: historyForApi(baseMessages),
          draft,
          awaitingField: awaiting?.awaitingField ?? null,
          portfolioCurrency: currency,
          firstTransactionDate,
          ...body,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Interprétation impossible");
        onMessagesChange([
          ...withUser,
          {
            id: `a_${Date.now()}`,
            role: "assistant",
            text: data.error ?? "Je n’ai pas pu interpréter ça. Reformule ?",
            actions: ["restart", "alternatives"],
          },
        ]);
        return;
      }
      const interpreted = data as InterpretResponse;
      const fromText = userText
        ? parseAllRequiredFromText(userText, {
            defaultCurrency: currency,
            firstTransactionDate,
            awaiting: awaiting?.awaitingField,
          })
        : {};
      const mergedPatch = {
        ...(interpreted.patch as Partial<EditorState>),
        ...fromText,
      };
      appendAssistantFromTurn(
        withUser,
        { ...interpreted, patch: mergedPatch as InterpretResponse["patch"] },
        fromText,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleAction = (action: ChatAction) => {
    if (busy) return;
    if (action === "restart") {
      const withUser: ChatMessage[] = [
        ...messages,
        { id: `u_${Date.now()}`, role: "user", text: "Reprendre à zéro" },
      ];
      onMessagesChange([
        ...withUser,
        {
          id: `a_${Date.now()}`,
          role: "assistant",
          text: "OK, brouillon effacé. Décris la stratégie que tu veux, comme si on repartait de zéro.",
          draftPatch: {},
          actions: ["alternatives"],
        },
      ]);
      return;
    }
    if (action === "revise") {
      onMessagesChange([
        ...messages,
        {
          id: `a_${Date.now()}`,
          role: "assistant",
          text: "Dis-moi ce qu’il faut changer — ex. « passe en hebdo », « enlève le RSI », « budget 300 ».",
          draftPatch: lastDraft(messages) as Record<string, unknown>,
          actions: ["restart", "alternatives"],
        },
      ]);
      return;
    }
    void runInterpret({ action: "alternatives" }, "Propose autre chose");
  };

  const askConfirm = (msgId: string) => setConfirmMsgId(msgId);
  const cancelConfirm = () => setConfirmMsgId(null);

  const confirmActivate = () => {
    if (!confirmMsgId) return;
    const msg = messages.find((m) => m.id === confirmMsgId);
    if (!msg?.pending) {
      setConfirmMsgId(null);
      return;
    }
    const draft = scrubYearBudget({
      ...(lastDraft(messages) as Partial<EditorState>),
      ...(msg.pending.patch as Partial<EditorState>),
    });
    if (!hasExplicitStartDate(draft)) {
      setConfirmMsgId(null);
      onMessagesChange([
        ...messages,
        {
          id: `a_${Date.now()}`,
          role: "assistant",
          text: questionFor("startDate"),
          draftPatch: draft as Record<string, unknown>,
          awaitingField: "startDate",
        },
      ]);
      return;
    }
    const bullets = buildExecutionBullets({ ...msg.pending, patch: draft as InterpretResponse["patch"] });
    onValidateAndActivate(draft, {
      ...msg.pending,
      patch: draft as InterpretResponse["patch"],
    });
    onMessagesChange(
      messages.map((x) =>
        x.id === confirmMsgId
          ? {
              ...x,
              applied: true,
              summaryBullets: bullets,
              pending: undefined,
              awaitingField: undefined,
              suggestions: undefined,
              actions: undefined,
              text: "Stratégie validée et activée. Voici ce qui est en place :",
            }
          : x,
      ),
    );
    setConfirmMsgId(null);
  };

  const submitText = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setPrompt("");
    void runInterpret({ prompt: trimmed }, trimmed);
  };

  const submit = () => submitText(prompt);

  const pendingConfirm = confirmMsgId
    ? messages.find((m) => m.id === confirmMsgId)
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-6 sm:px-8">
        {messages.length === 0 && (
          <div className="mx-auto flex max-w-xl flex-col items-center justify-center pt-16 text-center">
            <p className="text-2xl font-semibold tracking-tight text-[var(--text)]">
              {strategyName}
            </p>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-[var(--muted)]">
              Décris ta stratégie comme tu parlerais à quelqu’un. On te demandera le montant, la
              fréquence, la fenêtre, puis la période de simulation — puis tu pourras voir les
              résultats.
            </p>
            <p className="mt-4 max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2.5 text-left text-[11px] leading-relaxed text-[var(--muted)]">
              La tendance haussier / baissier se lit sur le{" "}
              <span className="font-medium text-[var(--text)]">MSCI World</span>
              {" — "}le marché actions mondial pour ton portefeuille. Autre indice de
              référence ? Dis-le dès le départ.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-2">
              {chips.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={busy}
                  title={p.summary}
                  onClick={() => void runInterpret({ presetId: p.id }, p.name)}
                  className="rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1.5 text-xs text-[var(--muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:opacity-40"
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {chronological(messages).map((msg) => (
          <div
            key={msg.id}
            className={`mx-auto flex max-w-2xl ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-[var(--text)] text-white whitespace-pre-wrap"
                  : "border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text)]"
              }`}
            >
              {msg.role === "user" ? (
                msg.text
              ) : (
                <>
                  {msg.text && (
                    <p className="whitespace-pre-wrap text-[var(--text)]">{msg.text}</p>
                  )}
                  {(msg.pending || msg.summaryBullets) && (
                    <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-[var(--text)]">
                      {(
                        msg.summaryBullets ??
                        (msg.pending ? buildExecutionBullets(msg.pending) : [])
                      ).map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  )}
                  {msg.pending && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => askConfirm(msg.id)}
                        className="rounded-xl bg-[var(--text)] px-3 py-2 text-xs font-medium text-white hover:bg-[#2a2a2a]"
                      >
                        Valider et activer
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAction("revise")}
                        className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)] hover:text-[var(--text)]"
                      >
                        Corriger
                      </button>
                    </div>
                  )}
                  {msg.actions && msg.actions.length > 0 && !msg.applied && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {msg.actions.map((a) => (
                        <button
                          key={a}
                          type="button"
                          disabled={busy}
                          onClick={() => handleAction(a)}
                          className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40"
                        >
                          {ACTION_LABEL[a]}
                        </button>
                      ))}
                    </div>
                  )}
                  {msg.awaitingField === "startDate" && (
                    <div className="mt-3 space-y-2">
                      <p className="text-[11px] text-[var(--muted)]">
                        Tape une date de début (ex. 15/03/2023) — obligatoire pour lancer le
                        backtest.
                      </p>
                      {firstTransactionDate && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            submitText("depuis mon premier achat")
                          }
                          className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40"
                        >
                          Depuis mon 1er achat ({firstTransactionDate.slice(0, 10)})
                        </button>
                      )}
                    </div>
                  )}
                  {msg.applied && (
                    <p className="mt-3 text-xs font-medium text-[var(--accent)]">
                      Active · visible dans la barre latérale (point vert)
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="mx-auto max-w-2xl">
            <p className="text-sm text-[var(--muted)]">Analyse…</p>
          </div>
        )}
        {error && <p className="mx-auto max-w-2xl text-sm text-red-600">{error}</p>}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-[var(--border)] bg-[var(--bg)] px-4 py-4 sm:px-8">
        <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-card)] px-3 py-2 shadow-sm">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={1}
            placeholder="Écris comme tu parles…"
            className="max-h-32 min-h-[44px] flex-1 resize-none bg-transparent py-2.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted)]"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button
            type="button"
            disabled={busy || !prompt.trim()}
            onClick={submit}
            className="mb-1 shrink-0 rounded-xl bg-[var(--text)] px-3 py-2 text-xs font-medium text-white disabled:opacity-30"
          >
            Envoyer
          </button>
        </div>
        <p className="mx-auto mt-2 max-w-2xl text-center text-[10px] text-[var(--muted)]">
          Après validation, les résultats utilisent ton budget déclaré (pas ton historique)
        </p>
      </div>

      {pendingConfirm?.pending && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="warn-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) cancelConfirm();
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 shadow-xl">
            <p id="warn-title" className="text-sm font-semibold text-[var(--text)]">
              Activer cette stratégie ?
            </p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-[var(--muted)]">
              {WARN_COPY}
            </p>
            <ul className="mt-4 max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-xs text-[var(--text)]">
              {buildExecutionBullets(pendingConfirm.pending)
                .slice(0, 8)
                .map((b) => (
                  <li key={b}>{b}</li>
                ))}
            </ul>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={cancelConfirm}
                className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)] hover:text-[var(--text)]"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={confirmActivate}
                className="rounded-xl bg-[var(--text)] px-3 py-2 text-xs font-medium text-white hover:bg-[#2a2a2a]"
              >
                Oui, activer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

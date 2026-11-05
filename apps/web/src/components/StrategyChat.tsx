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
  startDateFailureMessage,
  stripReplyQuestionsForAnswered,
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
  /** Enregistre le patch et enchaîne vers la simulation — sans activer. */
  onValidateAndSimulate: (patch: Partial<EditorState>, meta: InterpretResponse) => void;
  /** Ouvre le panneau Réglages. */
  onOpenSettings?: () => void;
}

const chips = readyPresets().slice(0, 6);

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
    .slice(-10)
    .map((m) => ({ role: m.role, text: m.text }));
}

function stripStackedMissingLines(reply: string): string {
  return reply
    .replace(/\n{0,2}Il me manque encore [^\n]+/gi, "")
    .replace(/\n{0,2}Il me manque[^\n]*/gi, "")
    .replace(/\n{0,2}Quel budget périodique[^\n]*/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Même règle que l’API : retire toute question sur un champ déjà dans le brouillon,
 * plus le doublon de la prochaine question canonique.
 */
function stripRedundantFieldQuestions(
  reply: string,
  _field:
    | "budget"
    | "frequency"
    | "window"
    | "assets"
    | "budgetSplit"
    | "assetClassMix"
    | "startDate"
    | null
    | undefined,
  canonicalQuestion: string,
  draft?: Partial<EditorState>,
): string {
  let ack = stripStackedMissingLines(reply);
  if (!ack) return "";
  if (canonicalQuestion && ack === canonicalQuestion) return "";
  if (canonicalQuestion && ack.endsWith(canonicalQuestion)) {
    ack = ack.slice(0, -canonicalQuestion.length).replace(/\n+$/g, "").trim();
  } else if (canonicalQuestion && ack.includes(`\n\n${canonicalQuestion}`)) {
    ack = ack.replace(`\n\n${canonicalQuestion}`, "").trim();
  }
  if (draft) ack = stripReplyQuestionsForAnswered(ack, draft);
  // Retire aussi une reformulation de la question suivante si encore présente.
  if (canonicalQuestion && ack.includes("?")) {
    const parts = ack.split(/(?<=[.!?…])\s+/).filter(Boolean);
    ack = parts
      .filter((p) => {
        if (!p.includes("?")) return true;
        const a = p.toLowerCase().replace(/\s+/g, " ");
        const b = canonicalQuestion.toLowerCase().replace(/\s+/g, " ");
        return !(a.includes(b.slice(0, 24)) || b.includes(a.slice(0, 24)));
      })
      .join(" ")
      .trim();
  }
  return ack;
}

/** Accusés de « tout est bon / à jour » alors qu’il manque encore des champs. */
function stripFalseCompleteAck(reply: string): string {
  return reply
    .replace(
      /\b(tout est (bon|complet)|c[’']?est (bon|complet|tout|a jour|à jour)|on valide|strategie complete|stratégie complète)\b[^.?!]*[.?!]?\s*/gi,
      "",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  if (Array.isArray(patch.allocation) && patch.allocation.length > 0) {
    const parts = (patch.allocation as { asset?: string; pct?: number }[])
      .filter((a) => a && Number(a.pct) > 0 && a.asset)
      .map((a) => `${a.asset} ${Number(a.pct).toFixed(0)}%`);
    if (parts.length) bullets.push(`Actifs : ${parts.join(" · ")}`);
  } else if (patch.assetsChoice === "portfolio") {
    bullets.push("Actifs : ceux du portefeuille (à confirmer)");
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
  if (patch.fearGreedScaleEnabled === true) {
    bullets.push(
      `Fear & Greed module le budget : ≤${patch.fearGreedLowLte ?? 35} → ×${patch.fearGreedLowFactor ?? 2} · ≥${patch.fearGreedHighGte ?? 80} → ×${patch.fearGreedHighFactor ?? 0.5} · sinon ×1`,
    );
  } else if (patch.fearGreedEnabled === true) {
    bullets.push(`Acheter si Fear & Greed ≤ ${patch.fearGreedValue ?? "…"}`);
  }
  if (patch.requireSignal === true) {
    bullets.push("Uniquement si signal (pas de rattrapage fin de fenêtre)");
  }
  if (patch.rsiScaleEnabled === true) {
    bullets.push(
      `RSI module le budget : ≤${patch.rsiLowLte ?? 30} → ×${patch.rsiLowFactor ?? 2} · ≥${patch.rsiHighGte ?? 70} → ×${patch.rsiHighFactor ?? 0.5}`,
    );
  } else if (patch.rsiEnabled === true) {
    bullets.push(`Acheter si RSI ≤ ${patch.rsiValue ?? "…"}`);
  }
  if (patch.dipScaleEnabled === true) {
    bullets.push(
      `Dip module le budget : ≥${patch.dipDeepGte ?? 3}% → ×${patch.dipDeepFactor ?? 2} · <${patch.dipCalmLt ?? 1}% → ×${patch.dipCalmFactor ?? 0.5}`,
    );
  } else if (patch.dipEnabled === true) {
    bullets.push(`Acheter sur baisse ≥ ${patch.dipPct ?? "…"} %`);
  }
  if (patch.macdScaleEnabled === true) {
    bullets.push(
      `MACD module le budget : >0 → ×${patch.macdPosFactor ?? 1.2} · <0 → ×${patch.macdNegFactor ?? 0.8}`,
    );
  } else if (patch.macdEnabled === true) {
    bullets.push("Acheter si histogramme MACD > 0");
  }
  if (patch.bollingerScaleEnabled === true) {
    bullets.push(
      `Bollinger module le budget : %B≤${patch.bollingerLowLte ?? 0.05} → ×${patch.bollingerLowFactor ?? 2} · ≥${patch.bollingerHighGte ?? 0.95} → ×${patch.bollingerHighFactor ?? 0.5}`,
    );
  } else if (patch.bollingerEnabled === true) {
    bullets.push(`Acheter si Bollinger %B ≤ ${patch.bollingerPctB ?? "…"}`);
  }
  if (patch.smaScaleEnabled === true) {
    bullets.push(
      `SMA module le budget : sous → ×${patch.smaBelowFactor ?? 1.5} · dessus → ×${patch.smaAboveFactor ?? 0.7}`,
    );
  } else if (patch.smaBuyEnabled === true) {
    bullets.push(`Acheter si prix sous SMA(${patch.smaBuyPeriod ?? "…"})`);
  }
  if (patch.athEnabled === true) {
    bullets.push(`Éviter les nouveaux sommets (${patch.athLookback ?? "…"} j)`);
  }
  if (patch.reserveEnabled === true) {
    bullets.push(`Réserver ≥ ${patch.reservePct ?? "…"} % de cash`);
  }
  if (patch.regimeEnabled === true) {
    const scope = patch.regimeScope === "reference" ? "reference" : "per_asset";
    const ref =
      scope === "per_asset"
        ? "chaque actif"
        : patch.regimeReferenceAsset === ""
          ? "plus gros poids"
          : patch.regimeReferenceAsset === "CSPX.L"
            ? "S&P 500"
            : !patch.regimeReferenceAsset || patch.regimeReferenceAsset === "IWDA.AS"
              ? "MSCI World"
              : patch.regimeReferenceAsset;
    bullets.push(
      `Ajuster le budget selon le régime (${ref}, SMA ${patch.regimeSmaPeriod ?? 200}j ±${patch.regimeBandPct ?? 2}%, ×${patch.bullMult ?? "…"} / ×${patch.neutralMult ?? 1} / ×${patch.bearMult ?? "…"})`,
    );
  }
  if (patch.fallbackNeutral === true) {
    bullets.push("Fin de fenêtre sans signal → verser le budget neutre (×1)");
  }
  if (patch.fallbackNeutral === false) {
    bullets.push("Fin de fenêtre → garder le multiplicateur de régime");
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
  onValidateAndSimulate,
  onOpenSettings,
}: StrategyChatProps) {
  const currency = (portfolioCurrency || "EUR").toUpperCase();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

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
        question: undefined,
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
          // Récap bullets uniquement quand le draft est complet (pending).
          summaryBullets: undefined,
        },
      ]);
      return;
    }

    const missing = missingFromDraft(draft);
    const meta = toPendingMeta(interpreted, draft);
    const bullets = buildExecutionBullets(meta);

    if (missing.length > 0) {
      const next = nextMissingQuestion(missing, currency, draft);
      const question = next?.question || interpreted.unanswered[0] || "";
      const reply = stripFalseCompleteAck(interpreted.reply?.trim() ?? "");
      // Un seul bloc de texte (plus de bulle coupée en deux).
      let ack = stripFalseCompleteAck(
        stripRedundantFieldQuestions(reply, next?.id ?? null, question, draft),
      );
      // Si la reply pose déjà la question naturellement, on la garde telle quelle.
      const replyAlreadyAsks = Boolean(
        reply &&
          reply.includes("?") &&
          next?.id &&
          ((next.id === "budget" &&
            /\b(budget|montant|allouer|euros?|€|combien)\b/i.test(reply)) ||
            (next.id === "frequency" &&
              /\b(frequence|fréquence|hebdo|mensuel|semaine|mois)\b/i.test(reply)) ||
            (next.id === "window" && /\b(fenetre|fenêtre|jours?)\b/i.test(reply)) ||
            (next.id === "assets" &&
              /\b(actif|actifs|portefeuille|allocation)\b/i.test(reply)) ||
            (next.id === "startDate" && /\b(date|debut|début|backtest|futur|passée|passe)\b/i.test(reply))),
      );
      const text = replyAlreadyAsks
        ? stripStackedMissingLines(reply)
        : [ack, question].filter(Boolean).join(ack && question ? " " : "").trim() ||
          replyBase;

      onMessagesChange([
        ...base,
        {
          id: `a_${Date.now()}`,
          role: "assistant",
          text,
          draftPatch: draft as Record<string, unknown>,
          awaitingField: next?.id,
          actions: ["restart"],
          // Pas de récap tant que des questions restent.
          summaryBullets: undefined,
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
        actions: ["restart"],
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
            actions: ["restart"],
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
      // fromText ne doit jamais écraser un budget valide avec un seuil F&G (35, 80…).
      const safeFromText = { ...fromText } as Partial<EditorState>;
      const prevDraft = lastDraft(baseMessages);
      const fgThresholds = [
        safeFromText.fearGreedValue,
        safeFromText.fearGreedLowLte,
        safeFromText.fearGreedHighGte,
        (interpreted.patch as Partial<EditorState>).fearGreedValue,
        (interpreted.patch as Partial<EditorState>).fearGreedLowLte,
        (interpreted.patch as Partial<EditorState>).fearGreedHighGte,
      ].filter((n): n is number => typeof n === "number");
      if (
        safeFromText.budgetAmount != null &&
        fgThresholds.includes(safeFromText.budgetAmount) &&
        (safeFromText.fearGreedScaleEnabled ||
          safeFromText.fearGreedEnabled ||
          (interpreted.patch as Partial<EditorState>).fearGreedScaleEnabled ||
          (interpreted.patch as Partial<EditorState>).fearGreedEnabled)
      ) {
        delete safeFromText.budgetAmount;
      }

      // Si on attend la fenêtre (ou le texte la donne), forcer le parse local.
      if (
        (awaiting?.awaitingField === "window" ||
          prevDraft.windowFrom == null ||
          prevDraft.windowTo == null) &&
        (safeFromText.windowFrom == null || safeFromText.windowTo == null)
      ) {
        const winOnly = parseAllRequiredFromText(userText ?? "", {
          defaultCurrency: currency,
          awaiting: "window",
        });
        if (winOnly.windowFrom != null && winOnly.windowTo != null) {
          safeFromText.windowFrom = winOnly.windowFrom;
          safeFromText.windowTo = winOnly.windowTo;
        }
      }

      let mergedPatch = {
        ...prevDraft,
        ...(interpreted.patch as Partial<EditorState>),
        ...safeFromText,
      } as Partial<EditorState>;

      // Sticky : ne pas laisser Gemini/preset ramener Fear 35 si le brouillon avait 40
      // et que le message courant ne parle pas de fear.
      const mentionsFear = /\bfear\b|\bgreed\b|\bpeur\b/i.test(userText ?? "");
      if (!mentionsFear) {
        if (prevDraft.fearGreedValue != null) {
          mergedPatch.fearGreedValue = prevDraft.fearGreedValue;
        }
        if (prevDraft.fearGreedEnabled != null) {
          mergedPatch.fearGreedEnabled = prevDraft.fearGreedEnabled;
        }
        if (prevDraft.fearGreedScaleEnabled != null) {
          mergedPatch.fearGreedScaleEnabled = prevDraft.fearGreedScaleEnabled;
        }
        if (prevDraft.requireSignal != null) {
          mergedPatch.requireSignal = prevDraft.requireSignal;
        }
      }
      // Sticky fenêtre : si le texte local a une fenêtre, elle gagne toujours.
      if (safeFromText.windowFrom != null && safeFromText.windowTo != null) {
        mergedPatch.windowFrom = safeFromText.windowFrom;
        mergedPatch.windowTo = safeFromText.windowTo;
      }
      // Sticky actifs : union / ne jamais écraser multi par 1 ticker (RSI pour Amazon).
      if (safeFromText.allocation && safeFromText.allocation.length > 0) {
        const prevN = prevDraft.allocation?.length ?? 0;
        const nextN = safeFromText.allocation.length;
        const mode = (safeFromText as { allocationMode?: string }).allocationMode;
        if (mode === "add" && prevN > 0) {
          const seen = new Set(prevDraft.allocation!.map((a) => a.asset.toUpperCase()));
          const merged = [...prevDraft.allocation!];
          for (const row of safeFromText.allocation) {
            if (!seen.has(row.asset.toUpperCase())) {
              seen.add(row.asset.toUpperCase());
              merged.push(row);
            }
          }
          const each = Math.round((100 / merged.length) * 10) / 10;
          mergedPatch.allocation = merged.map((a, i) => ({
            asset: a.asset,
            pct: i === merged.length - 1 ? Math.round((100 - each * (merged.length - 1)) * 10) / 10 : each,
          }));
          mergedPatch.assetsChoice = "custom";
        } else if (prevN > 1 && nextN === 1) {
          // Ignorer un extract 1 ticker (souvent une phrase signal).
          mergedPatch.allocation = prevDraft.allocation;
        } else {
          mergedPatch.allocation = safeFromText.allocation;
          mergedPatch.assetsChoice = "custom";
        }
      } else if (prevDraft.assetsChoice && !safeFromText.assetsChoice) {
        mergedPatch.assetsChoice = prevDraft.assetsChoice;
      }
      if (
        !(safeFromText.allocation && safeFromText.allocation.length > 0) &&
        (prevDraft.allocation?.length ?? 0) > 0 &&
        !(interpreted.patch as Partial<EditorState>).allocation?.length
      ) {
        mergedPatch.allocation = prevDraft.allocation;
      }

      if (mergedPatch.fearGreedScaleEnabled === true || mergedPatch.fearGreedEnabled === true) {
        const userWantsRsi = /\brsi\b/i.test(userText ?? "");
        mergedPatch = {
          ...mergedPatch,
          dipEnabled: false,
          rsiEnabled: userWantsRsi ? mergedPatch.rsiEnabled : false,
          rsiScaleEnabled: userWantsRsi ? mergedPatch.rsiScaleEnabled : false,
          athEnabled: false,
          reserveEnabled: false,
          regimeEnabled: false,
          ddTiersEnabled: false,
          riseTiersEnabled: false,
          volEnabled: false,
          extraBuysEnabled: false,
          tranches: 1,
        };
        if (mergedPatch.fearGreedScaleEnabled === true) {
          mergedPatch.fearGreedEnabled = false;
        }
      }

      // Date incohérente : message guidé, rester sur startDate (pas de faux « à jour »).
      let interpretedOut: InterpretResponse = {
        ...interpreted,
        patch: mergedPatch as InterpretResponse["patch"],
      };
      if (
        awaiting?.awaitingField === "startDate" &&
        userText &&
        !hasExplicitStartDate(mergedPatch)
      ) {
        const fail = startDateFailureMessage(userText);
        if (fail) {
          interpretedOut = {
            ...interpretedOut,
            reply: fail,
            intent: "answer",
          };
        }
      }

      appendAssistantFromTurn(withUser, interpretedOut, safeFromText);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleAction = (action: ChatAction) => {
    if (busy || action !== "restart") return;
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
        actions: ["restart"],
      },
    ]);
  };

  const runSimulate = (msgId: string) => {
    const msg = messages.find((m) => m.id === msgId);
    if (!msg?.pending) return;
    const draft = scrubYearBudget({
      ...(lastDraft(messages) as Partial<EditorState>),
      ...(msg.pending.patch as Partial<EditorState>),
    });
    if (!hasExplicitStartDate(draft)) {
      onMessagesChange([
        ...messages,
        {
          id: `a_${Date.now()}`,
          role: "assistant",
          text: questionFor("startDate"),
          draftPatch: draft as Record<string, unknown>,
          awaitingField: "startDate",
          actions: ["restart"],
        },
      ]);
      return;
    }
    const bullets = buildExecutionBullets({
      ...msg.pending,
      patch: draft as InterpretResponse["patch"],
    });
    onValidateAndSimulate(draft, {
      ...msg.pending,
      patch: draft as InterpretResponse["patch"],
    });
    onMessagesChange(
      messages.map((x) =>
        x.id === msgId
          ? {
              ...x,
              applied: true,
              summaryBullets: bullets,
              pending: undefined,
              awaitingField: undefined,
              suggestions: undefined,
              actions: ["restart"],
              text:
                "Stratégie enregistrée. Voici ce qui sera simulé — tu pourras l’activer après analyse :",
            }
          : x,
      ),
    );
  };

  const submitText = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setPrompt("");
    void runInterpret({ prompt: trimmed }, trimmed);
  };

  const submit = () => submitText(prompt);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-6 sm:px-8">
        {messages.length === 0 && (
          <div className="mx-auto flex max-w-xl flex-col items-center justify-center pt-16 text-center">
            <p className="text-2xl font-semibold tracking-tight text-[var(--text)]">
              {strategyName}
            </p>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-[var(--muted)]">
              Dis ce que <span className="font-medium text-[var(--text)]">toi</span> tu veux
              automatiser — on traduit en règles, et on te pose les questions manquantes (budget,
              fréquence, fenêtre…). Pas de conseil : on configure tes règles.
            </p>
            <p className="mt-4 max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2.5 text-left text-[11px] leading-relaxed text-[var(--muted)]">
              Les chips ci-dessous sont des <span className="font-medium text-[var(--text)]">modèles
              de départ</span> (pas des recommandations). Autre indice que le MSCI World pour le
              régime ? Dis-le dès le départ.
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
                        onClick={() => runSimulate(msg.id)}
                        className="rounded-xl bg-[var(--text)] px-3 py-2 text-xs font-medium text-white hover:bg-[#2a2a2a]"
                      >
                        Simuler
                      </button>
                      {onOpenSettings && (
                        <button
                          type="button"
                          onClick={onOpenSettings}
                          className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)] hover:text-[var(--text)]"
                        >
                          Accéder aux réglages
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleAction("restart")}
                        className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40"
                      >
                        Reprendre à zéro
                      </button>
                    </div>
                  )}
                  {!msg.pending && msg.actions?.includes("restart") && !msg.applied && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleAction("restart")}
                        className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40"
                      >
                        Reprendre à zéro
                      </button>
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
                      Enregistrée · analyse-la en simulation avant de l’activer
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
          Clique Simuler pour lancer l’analyse — l’activation se fait ensuite
        </p>
      </div>
    </div>
  );
}

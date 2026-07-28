import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  buildPatchFromPresetIds,
  catalogForPrompt,
  explainPatch,
  extractScheduleHints,
  lexicalMatchPresetIds,
  mergePatches,
  normalizeFrChat,
  readyPresets,
  sanitizeFormPatch,
  stripScheduleFields,
  STRATEGY_PRESETS,
  type StrategyFormPatch,
} from "@ordium/engine";

export type ChatIntent =
  | "build"
  | "answer"
  | "revise"
  | "reject"
  | "restart"
  | "clarify";

export type ChatAction = "restart" | "alternatives" | "revise";

export interface InterpretResult {
  matched: { id: string; name: string; status: string; confidence: number }[];
  patch: StrategyFormPatch;
  explanation: string[];
  unanswered: string[];
  unsupported: { id: string; reason: string }[];
  source: "gemini" | "lexical";
  /** Réponse naturelle à afficher dans le chat. */
  reply?: string;
  intent?: ChatIntent;
  /** Effacer le brouillon côté client. */
  clearDraft?: boolean;
  /** Boutons d’action proposés. */
  actions?: ChatAction[];
}

export type ChatHistoryItem = { role: "user" | "assistant"; text: string };

export type InterpretTurnInput = {
  prompt: string;
  history?: ChatHistoryItem[];
  draft?: StrategyFormPatch;
  awaitingField?: "budget" | "frequency" | "window" | "startDate" | null;
  portfolioCurrency?: string;
  firstTransactionDate?: string | null;
};

interface LlmTurnOut {
  intent?: string;
  reply?: string;
  presetIds?: string[];
  override?: Record<string, unknown>;
  unanswered?: string[];
  confidence?: Record<string, number>;
  clearDraft?: boolean;
  actions?: string[];
}

function geminiModelCandidates(): string[] {
  const preferred = process.env.GEMINI_MODEL?.trim();
  const defaults = [
    "gemini-3.5-flash-lite",
    "gemini-3.6-flash",
    "gemini-flash-lite-latest",
    "gemini-2.0-flash",
  ];
  return preferred ? [preferred, ...defaults.filter((m) => m !== preferred)] : defaults;
}

function parseJsonObject(text: string): LlmTurnOut {
  try {
    return JSON.parse(text) as LlmTurnOut;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Gemini n'a pas renvoyé de JSON exploitable.");
    return JSON.parse(match[0]) as LlmTurnOut;
  }
}

function buildSystemPrompt(): string {
  return `Tu es Ordium, assistant conversationnel qui construit une stratégie d'investissement automatisée.
Tu lis le français naturel, SMS, fautes, abréviations — comme un humain.

RÈGLE D’OR — NE JAMAIS INVENTER :
- Interdit de déduire / inventer budgetAmount, currency, period, windowFrom, windowTo s’ils ne sont PAS explicitement dans le message (ou l’historique confirmé).
- Une année (ex. 2024) ou une date (mars 2024, 15/03/2023) n’est JAMAIS un budgetAmount — c’est une date de début.
- Interdit d’inventer des seuils de paliers (ex. −5 %, +5 %) que l’utilisateur n’a pas dits.
- Si une info manque → mets une question dans "unanswered" ET dans "reply". Ne remplis PAS override avec des défauts.
- Les presets du catalogue apportent des règles ; le planning (montant / fréquence / fenêtre) vient UNIQUEMENT de l’utilisateur.

INDICE DE RÉFÉRENCE DU RÉGIME (haussier / baissier) :
- Par défaut c’est TOUJOURS le MSCI World (ticker IWDA.AS) — hors allocation, pas besoin de l’acheter.
- Ne mets PAS regimeReferenceAsset dans override sauf si l’utilisateur demande explicitement un autre indice.
- Exemples explicites → override.regimeReferenceAsset :
  · « référence S&P / SP500 » → "CSPX.L"
  · « référence MSCI World / IWDA » → "IWDA.AS"
  · « référence mon plus gros titre / l’allocation » → "" (chaîne vide)
  · un ticker cité clairement (« référence NVDA ») → ce ticker

Intentions ("intent") :
- "build" | "answer" | "revise" | "reject" | "restart" | "clarify"

Réponse JSON UNIQUEMENT :
{
  "intent": "build",
  "reply": "Phrase naturelle courte (tutoiement).",
  "presetIds": ["dca-classique", "dca-tendance"],
  "override": { "regimeEnabled": true, "bearMult": 1.15, "bullMult": 0.85 },
  "unanswered": ["Quel budget périodique ?", "Quelle fréquence (chaque semaine / chaque mois) ?", "Quelle fenêtre de jours ?"],
  "confidence": { "dca-classique": 0.9 },
  "clearDraft": false,
  "actions": []
}

Exemples de mapping SANS inventer le planning :
- « DCA classique avec +15% en baisse et -15% en hausse sur l'investissement »
  → presetIds: ["dca-classique","dca-tendance"], override: { regimeEnabled: true, bearMult: 1.15, bullMult: 0.85 }
  → PAS de ddTiers / riseTiers, PAS de budget / period / window
  → unanswered: budget, fréquence, fenêtre
- « tt les mois », « mensuel » → period: "monthly" (seulement si dit)
- « 200 euros » → budgetAmount: 200, currency: "EUR"
- « du 1 au 7 » → windowFrom: 1, windowTo: 7

Si intent = "reject" : actions ["restart","alternatives","revise"]
Si intent = "restart" : clearDraft true

Champs override autorisés (uniquement si explicites) :
budgetAmount, currency, period (weekly|monthly), windowFrom, windowTo, tranches, distribution (equal|random),
regimeEnabled, bullMult, bearMult, neutralMult, regimeBandPct, regimeSmaPeriod, regimeReferenceAsset,
dipEnabled, dipPct, rsiEnabled, rsiValue, athEnabled, athLookback,
reserveEnabled, reservePct, feePct,
ddTiersEnabled, ddTiers ([{gtePct, factor}]), riseTiersEnabled, riseTiers, tierLookback,
volEnabled, volPeriod, volMaxPct, volMode (veto|scale), volScaleFactor,
extraBuysEnabled, extraBuys ([{trigger: rsi_below|dip, value, pctOfBudget, cooldownDays}]),
fearGreedEnabled, fearGreedValue, macdEnabled, bollingerEnabled, bollingerPctB,
smaBuyEnabled, smaBuyPeriod.

Catalogue :
${catalogForPrompt()}`;
}

function detectIntentLocal(text: string): ChatIntent {
  const t = normalizeFrChat(text);
  if (
    /\b(recommence|recommencer|reprendre?\s+a\s+(0|zero)|a\s+zero|repartir(\s+de\s+zero)?|oublie(\s+tout)?|annule(\s+tout)?|reset|from\s+scratch)\b/.test(
      t,
    )
  ) {
    return "restart";
  }
  if (
    /\b(ca\s+ne\s+va\s+pas|cest\s+pas\s+(bon|ca|juste|clair)|pas\s+bon|pas\s+ca|mauvais|ratee?|nul|j\s*aime\s+pas|je\s+veux\s+pas\s+(ca|cette)|change\s+(tout|de\s+strat)|pas\s+ce\s+que\s+je|mauvaise\s+strat)\b/.test(
      t,
    )
  ) {
    return "reject";
  }
  if (/\b(plutot|change|passe\s+en|mets\s+plutot|corrige|modifie|ajoute|enleve|retire)\b/.test(t)) {
    return "revise";
  }
  return "build";
}

function normalizeIntent(raw: string | undefined, fallback: ChatIntent): ChatIntent {
  const v = (raw ?? "").toLowerCase().trim();
  if (v === "build" || v === "answer" || v === "revise" || v === "reject" || v === "restart" || v === "clarify") {
    return v;
  }
  return fallback;
}

function normalizeActions(raw: unknown, intent: ChatIntent): ChatAction[] {
  const allowed = new Set<ChatAction>(["restart", "alternatives", "revise"]);
  const fromLlm = Array.isArray(raw)
    ? raw.map(String).filter((a): a is ChatAction => allowed.has(a as ChatAction))
    : [];
  if (fromLlm.length > 0) return fromLlm;
  if (intent === "reject") return ["restart", "alternatives", "revise"];
  if (intent === "restart") return ["alternatives"];
  return [];
}

async function callGeminiTurn(userPayload: string): Promise<LlmTurnOut> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("NO_GEMINI");

  const genAI = new GoogleGenerativeAI(key);
  const errors: string[] = [];

  for (const modelId of geminiModelCandidates()) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelId,
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
      });
      const result = await model.generateContent([
        { text: buildSystemPrompt() },
        { text: userPayload },
      ]);
      return parseJsonObject(result.response.text());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${modelId}: ${msg}`);
      if (!/429|404|quota|no longer available|rate.?limit|high demand|503/i.test(msg)) {
        throw err;
      }
    }
  }
  throw new Error(errors[errors.length - 1] ?? "Gemini indisponible");
}

/**
 * classicOff() met toutes les règles à false. En merge sur un brouillon existant,
 * ça effaçait régime / dip / RSI déjà validés dès qu’un preset « DCA classique »
 * était rematché. On ne garde que les activations et les valeurs numériques.
 * Un override LLM explicite peut toujours désactiver (merge après).
 */
function stripDisablingPresetFlags(patch: StrategyFormPatch): StrategyFormPatch {
  const out: StrategyFormPatch = { ...patch };
  const boolKeys = [
    "regimeEnabled",
    "dipEnabled",
    "rsiEnabled",
    "athEnabled",
    "reserveEnabled",
    "ddTiersEnabled",
    "riseTiersEnabled",
    "volEnabled",
    "extraBuysEnabled",
  ] as const;
  for (const k of boolKeys) {
    if (out[k] === false) delete out[k];
  }
  return out;
}

/** Planning : uniquement hints texte + brouillon déjà confirmé (jamais presets / LLM inventés). */
function mergeExplicitScheduleOnly(
  prompt: string,
  patch: StrategyFormPatch,
  previousDraft: StrategyFormPatch,
  opts: { looseBudget?: boolean; defaultCurrency?: string },
): StrategyFormPatch {
  const hints = extractScheduleHints(prompt, {
    looseBudget: opts.looseBudget,
    defaultCurrency: opts.defaultCurrency,
  });
  const withoutSchedule = stripScheduleFields(patch as Record<string, unknown>) as StrategyFormPatch;
  const schedule: StrategyFormPatch = {};

  if (previousDraft.budgetAmount != null) schedule.budgetAmount = previousDraft.budgetAmount;
  if (previousDraft.currency) schedule.currency = previousDraft.currency;
  if (previousDraft.period) schedule.period = previousDraft.period;
  if (previousDraft.windowFrom != null) schedule.windowFrom = previousDraft.windowFrom;
  if (previousDraft.windowTo != null) schedule.windowTo = previousDraft.windowTo;

  if (hints.budgetAmount != null) schedule.budgetAmount = hints.budgetAmount;
  if (hints.currency) schedule.currency = hints.currency;
  if (hints.period) schedule.period = hints.period;
  if (hints.windowFrom != null) schedule.windowFrom = hints.windowFrom;
  if (hints.windowTo != null) schedule.windowTo = hints.windowTo;

  return mergePatches(withoutSchedule, schedule);
}

/** « +15% baisse / -15% hausse » → régime ; retire paliers inventés si pas de drawdown explicite. */
function applyRegimeFromHints(prompt: string, patch: StrategyFormPatch): StrategyFormPatch {
  const hints = extractScheduleHints(prompt);
  const t = normalizeFrChat(prompt);
  const out: StrategyFormPatch = { ...patch };

  if (hints.regimeEnabled) {
    out.regimeEnabled = true;
    if (hints.bearMult != null) out.bearMult = hints.bearMult;
    if (hints.bullMult != null) out.bullMult = hints.bullMult;
    if (hints.regimeReferenceAsset !== undefined) {
      out.regimeReferenceAsset = hints.regimeReferenceAsset;
    }
  }

  const mentionsDrawdownTiers =
    /\b(palier|drawdown|depuis\s+(l\s*)?ath|depuis\s+le\s+plus\s+haut)\b/.test(t);
  const investAdjust =
    hints.regimeEnabled === true ||
    (/\d+\s*%/.test(t) &&
      /\b(baisse|hausse)\b/.test(t) &&
      /\b(investissement|investir|budget|montant)\b/.test(t));

  if (investAdjust && !mentionsDrawdownTiers) {
    out.ddTiersEnabled = false;
    out.riseTiersEnabled = false;
    delete out.ddTiers;
    delete out.riseTiers;
  }

  return out;
}

function missingScheduleQuestions(patch: StrategyFormPatch, currency: string): string[] {
  const q: string[] = [];
  if (patch.budgetAmount == null || !(patch.budgetAmount > 0)) {
    q.push(`Quel budget périodique ? (ex. 200 ${currency})`);
  }
  if (patch.period !== "weekly" && patch.period !== "monthly") {
    q.push("Quelle fréquence ? (chaque semaine / chaque mois)");
  }
  if (patch.windowFrom == null || patch.windowTo == null) {
    q.push("Quelle fenêtre de jours pour acheter ? (ex. du 1 au 7)");
  }
  // Date de début : obligatoire côté client (EditorState.from) — rappel si le champ est attendu.
  return q;
}

function buildUserPayload(input: InterpretTurnInput): string {
  const history = (input.history ?? [])
    .slice(-12)
    .map((m) => `${m.role === "user" ? "User" : "Ordium"}: ${m.text}`)
    .join("\n");
  const draftJson = JSON.stringify(input.draft ?? {}, null, 0);
  return [
    history ? `Historique récent :\n${history}\n` : "",
    `Brouillon actuel (JSON) : ${draftJson}`,
    `Devise portefeuille : ${(input.portfolioCurrency ?? "EUR").toUpperCase()}`,
    input.awaitingField
      ? `Champ en attente de réponse : ${input.awaitingField}`
      : "Aucun champ en attente particulier.",
    "Rappel : n'invente pas budget / fréquence / fenêtre / date de début s'ils sont absents du message.",
    input.awaitingField === "startDate"
      ? "L'utilisateur doit fournir une date de début précise (JJ/MM/AAAA). Ne propose pas le backtest sans cette date."
      : "",
    `\nMessage utilisateur :\n${input.prompt}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function defaultReply(intent: ChatIntent, patch: StrategyFormPatch, unanswered: string[]): string {
  if (intent === "restart") {
    return "OK, on repart de zéro. Décris la stratégie que tu veux, simplement.";
  }
  if (intent === "reject") {
    return "Compris, ce n’est pas ça. Tu veux reprendre à zéro, que je propose autre chose, ou qu’on corrige un détail ?";
  }
  if (unanswered[0]) return unanswered[0]!;
  if (Object.keys(patch).length > 0) {
    return "J’ai mis à jour la proposition. Dis-moi si ça te va, ou ce qu’il faut changer.";
  }
  return "Je n’ai pas bien saisi — reformule en une phrase ce que tu veux faire.";
}

function finalizeTurn(opts: {
  presetIds: string[];
  override: StrategyFormPatch | undefined;
  previousDraft: StrategyFormPatch;
  unanswered: string[];
  confidence: Record<string, number>;
  source: "gemini" | "lexical";
  rawPrompt: string;
  intent: ChatIntent;
  reply?: string;
  clearDraft?: boolean;
  actions?: ChatAction[];
  looseBudget: boolean;
  defaultCurrency: string;
}): InterpretResult {
  // Serveur : ne vider le brouillon que sur restart.
  // Client : clearDraft reste un signal « ne pas merger lastDraft » (presets / chips).
  const wipePrevious = opts.intent === "restart";
  const previous = wipePrevious ? {} : opts.previousDraft;
  const hasPrevious = Object.keys(previous).length > 0;
  const clearDraftForClient = Boolean(opts.clearDraft) || wipePrevious;

  const safeOverride = opts.override
    ? (stripScheduleFields(opts.override as Record<string, unknown>) as StrategyFormPatch)
    : undefined;

  // dca-classique = classicOff() : si d’autres presets (ou un brouillon) existent,
  // il ne doit JAMAIS merger en dernier et tuer dip/régime/RSI.
  const presetIds = (() => {
    let ids = [...opts.presetIds];
    if (hasPrevious) ids = ids.filter((id) => id !== "dca-classique");
    if (ids.some((id) => id !== "dca-classique")) {
      ids = ids.filter((id) => id !== "dca-classique");
    }
    return ids;
  })();

  // Tour incrémental : on garde le brouillon, on ne réapplique pas des presets
  // qui écraseraient les règles déjà validées.
  const incremental =
    hasPrevious &&
    (opts.intent === "answer" ||
      opts.intent === "revise" ||
      presetIds.length === 0 ||
      (safeOverride != null &&
        Object.keys(safeOverride).length > 0 &&
        opts.intent !== "build"));

  let built: ReturnType<typeof buildPatchFromPresetIds>;
  let patch: StrategyFormPatch;

  if (incremental) {
    built = {
      patch: {},
      explanation: [],
      matched: [],
      unsupported: [],
    };
    patch = { ...previous };
    if (safeOverride) patch = mergePatches(patch, safeOverride);
  } else {
    built =
      presetIds.length > 0
        ? buildPatchFromPresetIds(presetIds, safeOverride)
        : {
            patch: safeOverride ?? {},
            explanation: [] as string[],
            matched: [] as ReturnType<typeof buildPatchFromPresetIds>["matched"],
            unsupported: [] as ReturnType<typeof buildPatchFromPresetIds>["unsupported"],
          };
    const incoming = stripDisablingPresetFlags(
      stripScheduleFields(built.patch as Record<string, unknown>) as StrategyFormPatch,
    );
    patch = mergePatches(previous, incoming);
    if (safeOverride) patch = mergePatches(patch, safeOverride);
  }

  patch = mergeExplicitScheduleOnly(opts.rawPrompt, patch, previous, {
    looseBudget: opts.looseBudget,
    defaultCurrency: opts.defaultCurrency,
  });

  // Régime : seulement si le message courant en parle (sinon on conserve le brouillon)
  const regimeInMessage = extractScheduleHints(opts.rawPrompt);
  if (regimeInMessage.regimeEnabled) {
    patch = applyRegimeFromHints(opts.rawPrompt, patch);
  }

  const forcedAsk = missingScheduleQuestions(patch, opts.defaultCurrency);
  const unanswered = [...opts.unanswered];
  for (const q of forcedAsk) {
    if (!unanswered.some((u) => u.toLowerCase().includes(q.slice(0, 12).toLowerCase()))) {
      unanswered.push(q);
    }
  }

  const detail = explainPatch(patch);
  const explanation = [...built.explanation, ...detail];
  const actions = normalizeActions(opts.actions, opts.intent);

  let reply = opts.reply?.trim() || defaultReply(opts.intent, patch, unanswered);
  if (
    forcedAsk.length > 0 &&
    opts.intent !== "reject" &&
    opts.intent !== "restart" &&
    !/\b(budget|frequence|fréquence|fenetre|fenêtre|montant)\b/i.test(reply)
  ) {
    reply = `${reply}\n\n${forcedAsk[0]}`.trim();
  } else if (forcedAsk.length === 0 && (opts.intent === "answer" || opts.intent === "revise")) {
    if (!/voici|à jour|a jour|noté|strategie|stratégie/i.test(reply)) {
      reply = `${reply}\n\nVoici la stratégie à jour :`.trim();
    }
  }

  return {
    matched: built.matched.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      confidence: opts.confidence[p.id] ?? (opts.source === "gemini" ? 0.75 : 0.55),
    })),
    patch,
    explanation,
    unanswered,
    unsupported: built.unsupported,
    source: opts.source,
    reply,
    intent: opts.intent,
    clearDraft: clearDraftForClient,
    actions,
  };
}

/** Tour de conversation : message + historique + brouillon → patch + reply + intent. */
export async function interpretStrategyTurn(
  input: InterpretTurnInput,
): Promise<InterpretResult> {
  const text = input.prompt.trim();
  const currency = (input.portfolioCurrency ?? "EUR").toUpperCase();
  const previousDraft = sanitizeFormPatch((input.draft ?? {}) as Record<string, unknown>);
  const looseBudget = input.awaitingField === "budget";
  const localIntent = detectIntentLocal(text);

  if (!text) {
    return {
      matched: [],
      patch: previousDraft,
      explanation: [],
      unanswered: ["Décris ta stratégie en quelques phrases."],
      unsupported: [],
      source: "lexical",
      reply: "Dis-moi ce que tu veux automatiser — budget, fréquence, règles…",
      intent: "clarify",
      actions: [],
    };
  }

  try {
    const llm = await callGeminiTurn(buildUserPayload(input));
    const intent = normalizeIntent(llm.intent, localIntent === "build" && input.awaitingField ? "answer" : localIntent);
    const ids = (llm.presetIds ?? []).filter((id) =>
      STRATEGY_PRESETS.some((p) => p.id === id),
    );
    const override = llm.override ? sanitizeFormPatch(llm.override) : undefined;
    const unanswered = Array.isArray(llm.unanswered)
      ? llm.unanswered.map(String).filter(Boolean)
      : [];
    const confidence =
      llm.confidence && typeof llm.confidence === "object"
        ? (llm.confidence as Record<string, number>)
        : {};

    // Si Gemini n'a rien matché et ce n'est pas reject/restart → lexical
    if (
      ids.length === 0 &&
      !override &&
      intent !== "reject" &&
      intent !== "restart" &&
      intent !== "clarify"
    ) {
      const lexicalIds = lexicalMatchPresetIds(text);
      return finalizeTurn({
        presetIds: lexicalIds,
        override: undefined,
        previousDraft,
        unanswered,
        confidence: {},
        source: "lexical",
        rawPrompt: text,
        intent,
        reply: llm.reply,
        clearDraft: llm.clearDraft,
        actions: llm.actions as ChatAction[] | undefined,
        looseBudget,
        defaultCurrency: currency,
      });
    }

    return finalizeTurn({
      presetIds: ids,
      override,
      previousDraft,
      unanswered,
      confidence,
      source: "gemini",
      rawPrompt: text,
      intent,
      reply: llm.reply,
      clearDraft: llm.clearDraft,
      actions: llm.actions as ChatAction[] | undefined,
      looseBudget,
      defaultCurrency: currency,
    });
  } catch {
    const intent = localIntent === "build" && input.awaitingField ? "answer" : localIntent;
    const ids =
      intent === "reject" || intent === "restart" ? [] : lexicalMatchPresetIds(text);
    const result = finalizeTurn({
      presetIds: ids,
      override: undefined,
      previousDraft,
      unanswered: [],
      confidence: {},
      source: "lexical",
      rawPrompt: text,
      intent,
      reply: undefined,
      clearDraft: intent === "restart",
      actions: undefined,
      looseBudget,
      defaultCurrency: currency,
    });
    if (intent === "build" && ids.length === 0 && Object.keys(result.patch).length === 0) {
      result.unanswered.push(
        "Aucune stratégie reconnue. Reformule ou choisis un preset (Smart DCA, RSI…).",
      );
      result.reply =
        result.reply ||
        "Je n’ai pas reconnu de stratégie claire. Reformule ou clique un preset.";
    } else if (!process.env.GEMINI_API_KEY?.trim()) {
      result.explanation.unshift(
        "Gemini non configuré : matching lexical (résultats approximatifs).",
      );
    } else if (intent === "build" || intent === "revise" || intent === "answer") {
      result.explanation.unshift(
        "Gemini indisponible : matching lexical de secours.",
      );
    }
    return result;
  }
}

/** @deprecated alias — premier message sans contexte. */
export async function interpretStrategyPrompt(prompt: string): Promise<InterpretResult> {
  return interpretStrategyTurn({ prompt });
}

export function listReadyPresets() {
  return readyPresets().map((p) => ({
    id: p.id,
    name: p.name,
    family: p.family,
    summary: p.summary,
    status: p.status,
  }));
}

export function applyPresetId(id: string): InterpretResult {
  return finalizeTurn({
    presetIds: [id],
    override: undefined,
    previousDraft: {},
    unanswered: [],
    confidence: { [id]: 1 },
    source: "lexical",
    rawPrompt: id,
    intent: "build",
    reply: `OK, on part sur « ${STRATEGY_PRESETS.find((p) => p.id === id)?.name ?? id} ».`,
    clearDraft: true,
    actions: [],
    looseBudget: false,
    defaultCurrency: "EUR",
  });
}

/** Propose 2–3 presets ready comme alternatives (sans LLM). */
export function proposeAlternatives(draft: StrategyFormPatch = {}): InterpretResult {
  const ready = readyPresets().slice(0, 3);
  const names = ready.map((p) => p.name).join(", ");
  return {
    matched: ready.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      confidence: 0.5,
    })),
    patch: draft,
    explanation: ready.map((p) => `${p.name} — ${p.summary}`),
    unanswered: [],
    unsupported: [],
    source: "lexical",
    reply: `Voici d’autres pistes : ${names}. Dis-moi laquelle te parle, ou décris autrement ce que tu veux.`,
    intent: "clarify",
    actions: ["restart", "revise"],
    clearDraft: false,
  };
}

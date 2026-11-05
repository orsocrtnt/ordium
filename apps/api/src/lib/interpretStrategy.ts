import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  buildPatchFromPresetIds,
  catalogForPrompt,
  diagnoseStartDateHint,
  explainPatch,
  extractFearGreedScaleHint,
  extractBudgetSplitHint,
  extractAssetClassPolicyHint,
  extractRequiredFromText,
  extractScheduleHints,
  fieldIdOfQuestion,
  INVESTMENT_ADVICE_REFUSAL,
  isInvestmentAdviceRequest,
  lexicalMatchPresetIds,
  mergePatches,
  mergeRequiredSchedule,
  messageForStartDateFailure,
  missingRequiredQuestions,
  normalizeFrChat,
  parseAssetsChoice,
  readyPresets,
  replyAsksRequiredField,
  sanitizeFormPatch,
  stripReplyQuestionsForAnswered,
  stripScheduleFields,
  stripSignalThresholdFields,
  STRATEGY_PRESETS,
  type RequiredFieldId,
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
  awaitingField?: RequiredFieldId | null;
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
  // Un modèle rapide en priorité — éviter la cascade lente de 4 modèles.
  const defaults = ["gemini-2.0-flash-lite", "gemini-flash-lite-latest", "gemini-2.0-flash"];
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
  return `Tu es Ordium, un assistant conversationnel qui aide l'utilisateur à ÉCRIRE les règles qu'il a lui-même choisies pour automatiser ses achats.
Tu lis le français naturel, SMS, fautes, abréviations — comme un humain. Tu parles naturellement (tutoiement), sans jargon inutile.

STYLE CONVERSATIONNEL :
- Accuse réception de ce qui est clair (« OK, 150 € / mois sur BTC… ») puis pose UNE seule question manquante à la fois.
- Ne redis jamais la même question déjà posée dans l'historique si le brouillon a déjà la réponse.
- Ne pose JAMAIS 2 formulations de la même question (ex. budget ×3). Une question = une phrase.
- Ne récite pas toute la stratégie à chaque message : confirme le delta, puis la prochaine info utile.
- Si l'utilisateur corrige un détail, reconnais la correction et mets à jour — sans tout recommencer.
- Cadences supportées aujourd’hui : weekly / monthly seulement. Si semestriel / trimestriel → dis que ce n’est pas dispo et demande hebdo ou mensuel (UNE question).
- reply = 1 à 3 phrases max + éventuellement la question manquante. Pas de pavé.

INTERDICTION ABSOLUE — PAS DE CONSEIL EN INVESTISSEMENT :
- Tu n'es PAS un conseiller. Tu ne recommandes JAMAIS une stratégie, un actif, un timing ou un montant.
- Interdit de dire qu'une approche est « excellente », « la meilleure », « recommandée », « idéale », etc.
- Si l'utilisateur demande un conseil, la meilleure stratégie, quoi acheter, ou ce qu'il « devrait » faire :
  intent: "clarify", presetIds: [], override: {}, unanswered: [],
  reply: refus clair (pas de Smart DCA inventé, pas d'allocation inventée).
- Tu configures UNIQUEMENT ce que l'utilisateur décrit explicitement. S'il ne décrit pas de règles → pose des questions factuelles (budget, fréquence, fenêtre), sans proposer un « bon » setup.

RÈGLE D’OR — NE JAMAIS INVENTER :
- Interdit de déduire / inventer budgetAmount, currency, period, windowFrom, windowTo s’ils ne sont PAS explicitement dans le message (ou l’historique confirmé).
- Une année (ex. 2024) ou une date (mars 2024, 15/03/2023) n’est JAMAIS un budgetAmount — c’est une date de début.
- Un jour du mois (« le 29 du mois », « acheter le 15 ») n’est JAMAIS un budgetAmount — c’est windowFrom/windowTo.
- Un seuil Fear & Greed (25, 35, 50, 75, 80…) n’est JAMAIS un budgetAmount. « si fear 35 on double » → modulation, budget inchangé.
- Si le brouillon a déjà fearGreedValue (ex. 40), NE PAS le ramener à 35 (défaut preset) sauf si l’utilisateur change explicitement le seuil.
- Si l’utilisateur module le budget selon Fear & Greed (double sous X, moitié au-dessus de Y) → fearGreedScaleEnabled: true + seuils/facteurs, et fearGreedEnabled: false (ce n’est PAS un veto d’achat).
- Pareil pour RSI / dip / MACD / Bollinger / SMA : scale*Enabled vs *Enabled (gate).
- « acheter 150 que si fear < 35 » → fearGreedEnabled + requireSignal: true (pas de rattrapage).
- Interdit d’inventer des seuils de paliers (ex. −5 %, +5 %) que l’utilisateur n’a pas dits.
- Si une info manque → mets une question dans "unanswered" ET dans "reply". Ne remplis PAS override avec des défauts.
- Les presets du catalogue apportent des règles SEULEMENT si l’utilisateur nomme ce preset / ces règles. Jamais « parce que c’est bien pour Google ».

INDICE / RÉGIME (haussier / baissier) :
- Par défaut : régime **par actif** (chaque actif juge sa propre SMA) → regimeScope: "per_asset".
- Ne mets PAS regimeReferenceAsset sauf si l’utilisateur demande un indice unique.
- Si indice unique demandé → regimeScope: "reference" + regimeReferenceAsset :
  · « référence S&P / SP500 » → "CSPX.L"
  · « référence MSCI World / IWDA » → "IWDA.AS"
  · « référence mon plus gros titre / l’allocation » → "" (chaîne vide)
  · un ticker cité clairement (« référence NVDA ») → ce ticker

- Si l’utilisateur dit que la fin de fenêtre / sans signal doit verser ×1 / budget de base / neutre → fallbackNeutral: true.
- Si l’utilisateur veut garder le multiplicateur de régime aussi en fin de fenêtre → fallbackNeutral: false.

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
- « 200 sur BTC ETH SOL » sans « total » ni « chacun » → NE décide PAS le split (unanswered posera la question)
- « 200 au total » / « 200 répartis » / « on répartit » → budgetSplit: "total"
- « 200 chacun » / « 200 par actif » → budgetSplit: "per_asset", budgetAmount = 200 × nb actifs
- Tant que budgetSplit n’est pas tranché : NE PAS parler de « répartis » comme un fait, et NE PAS demander la date de début.
- Mix crypto + actions avec Fear & Greed : le F&G est un indice crypto **global** (même valeur pour tout le panier) ; le RSI se calcule **sur le prix de chaque ticker** au moment d’acheter. On ne peut PAS encore scoper « F&G cryptos only / RSI Amazon only ». Demander crypto only / actions only / garder le mix — ne pas inventer un RSI Amazon-only.
- « ajoute Amazon » = ajouter à l’allocation existante, JAMAIS remplacer BTC/ETH/SOL par AMZN 100 %.
- « RSI pour Amazon » ≠ nouvelle allocation.
- « du 1 au 7 » → windowFrom: 1, windowTo: 7
- « le 1 du mois », « le 1er », « uniquement le 1 » → windowFrom: 1, windowTo: 1
- « les premiers jours » → windowFrom: 1, windowTo: 7
- « si fear ≤ 35 on double, si ≥ 80 moitié, sinon normal » → fearGreedScaleEnabled: true, …, fearGreedEnabled: false — NE PAS toucher budgetAmount
- « acheter seulement si fear < 35 » / « 150 que si fear < 35 » → fearGreedEnabled: true, fearGreedValue: 35, requireSignal: true
- « si rsi < 30 on double, si > 70 moitié » → rsiScaleEnabled: true
- « donne-moi la meilleure stratégie sur Google » / « un conseil en investissement »
  → intent: "clarify", presetIds: [], override: {}, unanswered: []
  → reply: refus conseil (pas de Smart DCA, pas d’allocation GOOGL inventée)

Si intent = "reject" : actions ["restart","alternatives","revise"]
Si intent = "restart" : clearDraft true

Champs override autorisés (uniquement si explicites) :
budgetAmount, currency, period (weekly|monthly), windowFrom, windowTo, tranches, distribution (equal|random),
regimeEnabled, bullMult, bearMult, neutralMult, regimeBandPct, regimeSmaPeriod, regimeScope, regimeReferenceAsset, fallbackNeutral,
requireSignal,
dipEnabled, dipPct, dipScaleEnabled, dipDeepGte, dipDeepFactor, dipCalmLt, dipCalmFactor,
rsiEnabled, rsiValue, rsiScaleEnabled, rsiLowLte, rsiLowFactor, rsiHighGte, rsiHighFactor,
athEnabled, athLookback,
reserveEnabled, reservePct, feePct,
ddTiersEnabled, ddTiers ([{gtePct, factor}]), riseTiersEnabled, riseTiers, tierLookback,
volEnabled, volPeriod, volMaxPct, volMode (veto|scale|gate), volScaleFactor,
extraBuysEnabled, extraBuys ([{trigger: rsi_below|dip|fear_greed|macd|bollinger, value, pctOfBudget, cooldownDays}]),
fearGreedEnabled, fearGreedValue, fearGreedScaleEnabled, fearGreedLowLte, fearGreedLowFactor, fearGreedHighGte, fearGreedHighFactor,
macdEnabled, macdScaleEnabled, macdPosFactor, macdNegFactor,
bollingerEnabled, bollingerPctB, bollingerScaleEnabled, bollingerLowLte, bollingerLowFactor, bollingerHighGte, bollingerHighFactor,
smaBuyEnabled, smaBuyPeriod, smaScaleEnabled, smaBelowFactor, smaAboveFactor.

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
  if (/\b(plutot|change|changer|passe\s+en|mets\s+plutot|corrige|modifie|ajoute|enleve|retire|reprend|remets)\b/.test(t)) {
    return "revise";
  }
  return "build";
}

/** Salut / small-talk sans intention de configurer une règle. */
function isGreetingOrChitchat(text: string): boolean {
  const t = normalizeFrChat(text).replace(/[!?.…]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (
    /^(salut|slt|hello|hi|hey|bonjour|bonsoir|coucou|yo|bjr|hello\s+ordium|salut\s+ordium)$/.test(
      t,
    )
  ) {
    return true;
  }
  // « salut ça va » / « bonjour ! » sans contenu stratégie
  if (
    /^(salut|bonjour|bonsoir|coucou|hey|hello)\b/.test(t) &&
    t.split(" ").length <= 5 &&
    !/\b(budget|investir|acheter|dca|strateg|mois|semaine|euro|btc|eth|fear|rsi|regle|fenetre)\b/.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

function normalizeIntent(raw: string | undefined, fallback: ChatIntent): ChatIntent {
  const v = (raw ?? "").toLowerCase().trim();
  if (v === "build" || v === "answer" || v === "revise" || v === "reject" || v === "restart" || v === "clarify") {
    return v;
  }
  return fallback;
}

function normalizeActions(_raw: unknown, _intent: ChatIntent): ChatAction[] {
  // UI chat : seul « Reprendre à zéro » est exposé (pas revise / alternatives).
  return ["restart"];
}

async function callGeminiTurn(userPayload: string): Promise<LlmTurnOut> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("NO_GEMINI");

  const genAI = new GoogleGenerativeAI(key);
  const errors: string[] = [];
  const system = buildSystemPrompt();

  for (const modelId of geminiModelCandidates()) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelId,
        systemInstruction: system,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 768,
          responseMimeType: "application/json",
        },
      });
      const result = await model.generateContent(userPayload);
      return parseJsonObject(result.response.text());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${modelId}: ${msg}`);
      if (!/429|404|quota|no longer available|rate.?limit|high demand|503|not found|not supported/i.test(msg)) {
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
    "requireSignal",
    "dipEnabled",
    "dipScaleEnabled",
    "rsiEnabled",
    "rsiScaleEnabled",
    "fearGreedEnabled",
    "fearGreedScaleEnabled",
    "macdEnabled",
    "macdScaleEnabled",
    "bollingerEnabled",
    "bollingerScaleEnabled",
    "smaBuyEnabled",
    "smaScaleEnabled",
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
  opts: {
    looseBudget?: boolean;
    defaultCurrency?: string;
    awaitingField?: RequiredFieldId | null;
    firstTransactionDate?: string | null;
  },
): StrategyFormPatch {
  const hints = extractScheduleHints(prompt, {
    looseBudget: opts.looseBudget,
    defaultCurrency: opts.defaultCurrency,
  });
  const withoutSchedule = stripScheduleFields(patch as Record<string, unknown>) as StrategyFormPatch;

  // 5 champs obligatoires : une seule logique (engine requiredSchedule).
  const required = mergeRequiredSchedule(
    previousDraft,
    extractRequiredFromText(prompt, {
      awaiting: opts.awaitingField ?? (opts.looseBudget ? "budget" : null),
      defaultCurrency: opts.defaultCurrency,
      firstTransactionDate: opts.firstTransactionDate,
    }),
  );
  // Override chat (ex. parseAssetsChoice sur le patch entrant) avant signaux.
  const incoming = patch as StrategyFormPatch;
  if (incoming.assetsChoice) {
    // Ne pas laisser « portfolio » écraser un add custom fraîchement mergé.
    if (
      !(
        required.allocationMode === "add" &&
        required.allocation?.length &&
        incoming.assetsChoice === "portfolio"
      )
    ) {
      required.assetsChoice = incoming.assetsChoice;
    }
    if (incoming.assetsChoice === "custom" && !(incoming.allocation?.length)) {
      if (!required.allocation?.length) delete required.allocation;
    }
  }
  // Allocation : le merge required (add / sticky) gagne. Ne jamais réécraser
  // avec l’ancien panier du patch (bug « ajoute Amazon » annulé).
  if (incoming.allocation?.length && !required.allocation?.length) {
    const prevN = previousDraft.allocation?.length ?? 0;
    if (!(prevN > 1 && incoming.allocation.length === 1)) {
      required.allocation = incoming.allocation;
      required.assetsChoice = incoming.assetsChoice ?? "custom";
    }
  }

  const schedule: StrategyFormPatch = { ...required };

  // Seuils déjà validés : Gemini / presets ne doivent pas les écraser.
  if (previousDraft.fearGreedEnabled === true) schedule.fearGreedEnabled = true;
  if (previousDraft.fearGreedValue != null) schedule.fearGreedValue = previousDraft.fearGreedValue;
  if (previousDraft.fearGreedScaleEnabled === true) {
    schedule.fearGreedScaleEnabled = true;
    schedule.fearGreedEnabled = false;
  }
  if (previousDraft.fearGreedLowLte != null) schedule.fearGreedLowLte = previousDraft.fearGreedLowLte;
  if (previousDraft.fearGreedLowFactor != null) {
    schedule.fearGreedLowFactor = previousDraft.fearGreedLowFactor;
  }
  if (previousDraft.fearGreedHighGte != null) {
    schedule.fearGreedHighGte = previousDraft.fearGreedHighGte;
  }
  if (previousDraft.fearGreedHighFactor != null) {
    schedule.fearGreedHighFactor = previousDraft.fearGreedHighFactor;
  }
  if (previousDraft.requireSignal === true) schedule.requireSignal = true;

  // Horizon non-date (1y / 3y) hors extractRequired.
  if (!hints.from && (hints.horizon === "since_first_buy" || hints.horizon === "1y" || hints.horizon === "3y")) {
    schedule.horizon = hints.horizon;
  }

  if (hints.fearGreedScaleEnabled) {
    schedule.fearGreedScaleEnabled = true;
    schedule.fearGreedEnabled = false;
    schedule.requireSignal = false;
    if (hints.fearGreedLowLte != null) schedule.fearGreedLowLte = hints.fearGreedLowLte;
    if (hints.fearGreedLowFactor != null) schedule.fearGreedLowFactor = hints.fearGreedLowFactor;
    if (hints.fearGreedHighGte != null) schedule.fearGreedHighGte = hints.fearGreedHighGte;
    if (hints.fearGreedHighFactor != null) {
      schedule.fearGreedHighFactor = hints.fearGreedHighFactor;
    }
  } else if (hints.fearGreedEnabled) {
    schedule.fearGreedEnabled = true;
    if (hints.fearGreedValue != null) schedule.fearGreedValue = hints.fearGreedValue;
  }
  // Politique « actions only » : pas de Fear & Greed (orienté crypto).
  if (schedule.assetClassPolicy === "equity_only") {
    schedule.fearGreedEnabled = false;
    schedule.fearGreedScaleEnabled = false;
  }
  if (hints.requireSignal && !hints.fearGreedScaleEnabled) {
    schedule.requireSignal = true;
  }

  if (hints.rsiScaleEnabled) {
    schedule.rsiScaleEnabled = true;
    schedule.rsiEnabled = false;
    if (hints.rsiLowLte != null) schedule.rsiLowLte = hints.rsiLowLte;
    if (hints.rsiLowFactor != null) schedule.rsiLowFactor = hints.rsiLowFactor;
    if (hints.rsiHighGte != null) schedule.rsiHighGte = hints.rsiHighGte;
    if (hints.rsiHighFactor != null) schedule.rsiHighFactor = hints.rsiHighFactor;
  } else if (hints.rsiEnabled) {
    schedule.rsiEnabled = true;
    if (hints.rsiValue != null) schedule.rsiValue = hints.rsiValue;
  }

  if (hints.dipScaleEnabled) {
    schedule.dipScaleEnabled = true;
    schedule.dipEnabled = false;
    if (hints.dipDeepGte != null) schedule.dipDeepGte = hints.dipDeepGte;
    if (hints.dipDeepFactor != null) schedule.dipDeepFactor = hints.dipDeepFactor;
    if (hints.dipCalmLt != null) schedule.dipCalmLt = hints.dipCalmLt;
    if (hints.dipCalmFactor != null) schedule.dipCalmFactor = hints.dipCalmFactor;
  } else if (hints.dipEnabled) {
    schedule.dipEnabled = true;
    if (hints.dipPct != null) schedule.dipPct = hints.dipPct;
  }

  if (hints.macdScaleEnabled) {
    schedule.macdScaleEnabled = true;
    schedule.macdEnabled = false;
    if (hints.macdPosFactor != null) schedule.macdPosFactor = hints.macdPosFactor;
    if (hints.macdNegFactor != null) schedule.macdNegFactor = hints.macdNegFactor;
  } else if (hints.macdEnabled) {
    schedule.macdEnabled = true;
  }

  if (hints.bollingerScaleEnabled) {
    schedule.bollingerScaleEnabled = true;
    schedule.bollingerEnabled = false;
    if (hints.bollingerLowLte != null) schedule.bollingerLowLte = hints.bollingerLowLte;
    if (hints.bollingerLowFactor != null) schedule.bollingerLowFactor = hints.bollingerLowFactor;
    if (hints.bollingerHighGte != null) schedule.bollingerHighGte = hints.bollingerHighGte;
    if (hints.bollingerHighFactor != null) {
      schedule.bollingerHighFactor = hints.bollingerHighFactor;
    }
  } else if (hints.bollingerEnabled) {
    schedule.bollingerEnabled = true;
    if (hints.bollingerPctB != null) schedule.bollingerPctB = hints.bollingerPctB;
  }

  if (hints.smaScaleEnabled) {
    schedule.smaScaleEnabled = true;
    schedule.smaBuyEnabled = false;
    if (hints.smaBelowFactor != null) schedule.smaBelowFactor = hints.smaBelowFactor;
    if (hints.smaAboveFactor != null) schedule.smaAboveFactor = hints.smaAboveFactor;
  } else if (hints.smaBuyEnabled) {
    schedule.smaBuyEnabled = true;
  }

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
      out.regimeScope = "reference";
      out.regimeReferenceAsset = hints.regimeReferenceAsset;
    } else {
      out.regimeScope = "per_asset";
    }
    if (hints.fallbackNeutral !== undefined) {
      out.fallbackNeutral = hints.fallbackNeutral;
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

function buildUserPayload(input: InterpretTurnInput): string {
  const historyItems = input.history ?? [];
  const history = historyItems
    .slice(-10)
    .map((m) => `${m.role === "user" ? "User" : "Ordium"}: ${m.text}`)
    .join("\n");
  const lastAssistantQs = historyItems
    .filter((m) => m.role === "assistant")
    .slice(-2)
    .map((m) => m.text.replace(/\s+/g, " ").slice(0, 180));
  const draftJson = JSON.stringify(input.draft ?? {}, null, 0);
  return [
    history ? `Historique récent :\n${history}\n` : "",
    lastAssistantQs.length
      ? `Dernières questions Ordium (ne les répète pas si déjà répondues) :\n- ${lastAssistantQs.join("\n- ")}\n`
      : "",
    `Brouillon actuel (JSON) : ${draftJson}`,
    `Devise portefeuille : ${(input.portfolioCurrency ?? "EUR").toUpperCase()}`,
    input.awaitingField
      ? `Champ en attente de réponse : ${input.awaitingField} — priorise cette info si le message y répond.`
      : "Aucun champ en attente particulier.",
    "Rappel : n'invente pas budget / fréquence / fenêtre / date de début s'ils sont absents du message. Réponds JSON court.",
    "reply : conversationnel, accuse réception du delta, UNE question manquante max. Pas de conseil.",
    input.awaitingField === "startDate"
      ? "L'utilisateur doit fournir une date de début précise passée (JJ/MM/AAAA). Pas de date future. Ne propose pas le backtest sans cette date."
      : input.awaitingField === "assets"
        ? "L'utilisateur répond aux actifs : oui = même portefeuille ; non + tickers = allocation custom. Si non sans tickers, demande les actifs."
        : "",
    `\nMessage utilisateur :\n${input.prompt}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function defaultReply(intent: ChatIntent, patch: StrategyFormPatch, unanswered: string[]): string {
  if (intent === "restart") {
    return "OK, on repart de zéro. Dis-moi simplement ce que tu veux automatiser.";
  }
  if (intent === "reject") {
    return "Compris, on met ça de côté. Tu préfères reprendre à zéro, ou corriger juste un détail ?";
  }
  if (unanswered[0]) {
    if (Object.keys(patch).length > 0) {
      return `C’est noté. ${unanswered[0]}`;
    }
    return unanswered[0]!;
  }
  if (Object.keys(patch).length > 0) {
    return "C’est à jour. Tu veux ajuster un détail, ou on valide pour simuler ?";
  }
  return "Je n’ai pas bien saisi — reformule en une phrase ce que tu veux automatiser (budget, fréquence, règles…).";
}

/** Une seule question manquante max — jamais un champ déjà dans le brouillon. */
function mergeReplyWithForcedAsk(
  reply: string,
  question: string,
  history?: ChatHistoryItem[],
): string {
  const q = question.trim();
  if (!q) return reply.trim();
  let out = reply.trim();
  if (out === q) return q;

  if (out.endsWith(q)) out = out.slice(0, -q.length).replace(/\n+$/g, "").trim();
  else if (out.includes(`\n\n${q}`)) out = out.replace(`\n\n${q}`, "").trim();
  out = out
    .replace(/\n{0,2}Il me manque encore [^\n]+/gi, "")
    .replace(/\n{0,2}Quel budget périodique[^\n]*/gi, "")
    .trim();

  const field = fieldIdOfQuestion(q);
  if (field && replyAsksRequiredField(out || reply, field)) {
    return (out || reply).trim();
  }

  const alreadyAsked = (history ?? []).some((m) => {
    if (m.role !== "assistant") return false;
    if (field && replyAsksRequiredField(m.text, field)) return true;
    return m.text.includes(q.slice(0, 24)) || m.text.includes(q);
  });
  if (alreadyAsked) {
    return out || "C’est noté — dès que tu as l’info, envoie-la dans le chat.";
  }

  if (!out) return q;
  if (out.includes(q.slice(0, 18))) return out;
  return `${out}\n\n${q}`.trim();
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
  history?: ChatHistoryItem[];
  awaitingField?: RequiredFieldId | null;
  firstTransactionDate?: string | null;
}): InterpretResult {
  // Serveur : ne vider le brouillon que sur restart.
  // Client : clearDraft reste un signal « ne pas merger lastDraft » (presets / chips).
  const wipePrevious = opts.intent === "restart";
  const previous = wipePrevious ? {} : opts.previousDraft;
  const hasPrevious = Object.keys(previous).length > 0;
  const clearDraftForClient = Boolean(opts.clearDraft) || wipePrevious;

  const safeOverride = opts.override
    ? (stripSignalThresholdFields(
        stripScheduleFields(opts.override as Record<string, unknown>),
      ) as StrategyFormPatch)
    : undefined;

  // dca-classique = classicOff() : si d’autres presets (ou un brouillon) existent,
  // il ne doit JAMAIS merger en dernier et tuer dip/régime/RSI.
  const presetIds = (() => {
    let ids = [...opts.presetIds];
    const t = normalizeFrChat(opts.rawPrompt);
    if (/\bfear\b/.test(t) && /\bgreed\b/.test(t)) {
      ids = ids.filter((id) => id !== "smart-dca");
      // Modulation budget (×2 / ×0.5) ≠ gate d’achat dca-fear-greed.
      const scale = extractFearGreedScaleHint(opts.rawPrompt);
      if (scale) {
        ids = ids.filter((id) => id !== "dca-fear-greed");
        if (!ids.includes("dca-classique")) ids = ["dca-classique", ...ids];
      } else if (!ids.includes("dca-fear-greed")) {
        ids = ["dca-fear-greed", ...ids];
      }
    }
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
      stripSignalThresholdFields(
        stripScheduleFields(built.patch as Record<string, unknown>),
      ) as StrategyFormPatch,
    );
    patch = mergePatches(previous, incoming);
    if (safeOverride) patch = mergePatches(patch, safeOverride);
  }

  patch = mergeExplicitScheduleOnly(opts.rawPrompt, patch, previous, {
    looseBudget: opts.looseBudget,
    defaultCurrency: opts.defaultCurrency,
    awaitingField: opts.awaitingField,
    firstTransactionDate: opts.firstTransactionDate,
  });

  // Fear & Greed scale ou gate : pas de Smart DCA parasitant — mais on conserve
  // RSI / dip si le brouillon ou le message courant les active.
  if (patch.fearGreedScaleEnabled === true || patch.fearGreedEnabled === true) {
    const keepRsi =
      patch.rsiScaleEnabled === true ||
      patch.rsiEnabled === true ||
      /\brsi\b/i.test(opts.rawPrompt);
    const keepDip =
      patch.dipScaleEnabled === true ||
      patch.dipEnabled === true ||
      /\b(dip|baisse\s+\d)/i.test(opts.rawPrompt);
    patch = {
      ...patch,
      dipEnabled: keepDip ? patch.dipEnabled : false,
      dipScaleEnabled: keepDip ? patch.dipScaleEnabled : false,
      rsiEnabled: keepRsi ? patch.rsiEnabled : false,
      rsiScaleEnabled: keepRsi ? patch.rsiScaleEnabled : false,
      athEnabled: false,
      reserveEnabled: false,
      regimeEnabled: false,
      ddTiersEnabled: false,
      riseTiersEnabled: false,
      volEnabled: false,
      extraBuysEnabled: false,
      tranches: patch.tranches && patch.tranches > 1 ? 1 : patch.tranches,
    };
    if (patch.fearGreedScaleEnabled === true) {
      patch.fearGreedEnabled = false;
    }
  }

  // Régime : seulement si le message courant en parle (sinon on conserve le brouillon)
  const regimeInMessage = extractScheduleHints(opts.rawPrompt);
  if (regimeInMessage.regimeEnabled) {
    patch = applyRegimeFromHints(opts.rawPrompt, patch);
  }

  const forcedAsk = missingRequiredQuestions(patch, opts.defaultCurrency);
  // Source de vérité = brouillon réel. On ignore unanswered Gemini périmé
  // (ex. encore « quelle fenêtre ? » alors que windowFrom/To sont déjà posés).
  const unanswered = forcedAsk;

  const detail = explainPatch(patch);
  const explanation = [...built.explanation, ...detail];
  const actions = normalizeActions(opts.actions, opts.intent);

  let reply = opts.reply?.trim() || defaultReply(opts.intent, patch, unanswered);
  // Ne jamais reposer une question déjà satisfaite — même règle pour les 5 champs.
  reply = stripReplyQuestionsForAnswered(reply, patch);
  // Ne pas coller « quel budget ? » sur un salut / clarify / reject.
  const skipForcedAsk =
    opts.intent === "clarify" ||
    opts.intent === "reject" ||
    opts.intent === "restart" ||
    isGreetingOrChitchat(opts.rawPrompt);

  if (forcedAsk.length > 0 && !skipForcedAsk) {
    const claimsComplete =
      /\b(tout est (bon|complet)|c.?est (bon|complet|tout|a jour|à jour)|on valide|strategie complete|stratégie complète)\b/i.test(
        reply,
      );
    if (claimsComplete) {
      reply = forcedAsk[0]!;
    } else {
      reply = mergeReplyWithForcedAsk(reply, forcedAsk[0]!, opts.history);
    }
  } else if (
    !skipForcedAsk &&
    forcedAsk.length === 0 &&
    (opts.intent === "answer" || opts.intent === "revise")
  ) {
    if (!/voici|à jour|a jour|noté|strategie|stratégie|valide|simuler/i.test(reply)) {
      reply = `${reply}\n\nDis-moi si on valide pour simuler, ou ce qu’il faut encore changer.`.trim();
    }
  }

  // Sur clarify / greeting : pas de liste unanswered budget fantôme.
  const unansweredOut = skipForcedAsk ? [] : unanswered;

  return {
    matched: built.matched.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      confidence: opts.confidence[p.id] ?? (opts.source === "gemini" ? 0.75 : 0.55),
    })),
    patch,
    explanation,
    unanswered: unansweredOut,
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
      unanswered: [],
      unsupported: [],
      source: "lexical",
      reply:
        "Salut ! Dis-moi ce que tu veux automatiser — budget, fréquence, fenêtres, règles… comme tu parlerais à quelqu’un.",
      intent: "clarify",
      actions: [],
    };
  }

  // Simple salut / small-talk : pas de question budget collée derrière.
  if (isGreetingOrChitchat(text)) {
    return {
      matched: [],
      patch: previousDraft,
      explanation: [],
      unanswered: [],
      unsupported: [],
      source: "lexical",
      reply:
        "Salut ! Qu’est-ce qu’on met en place comme règles d’achat automatiques ? Décris-le comme tu veux — je te poserai les détails manquants ensuite.",
      intent: "clarify",
      actions: ["restart"],
    };
  }

  // Racine produit : jamais de conseil / « meilleure stratégie » / recommandation.
  if (isInvestmentAdviceRequest(text)) {
    return {
      matched: [],
      patch: previousDraft,
      explanation: [],
      unanswered: [],
      unsupported: [],
      source: "lexical",
      reply: INVESTMENT_ADVICE_REFUSAL,
      intent: "clarify",
      actions: ["restart"],
    };
  }

  // Cadences pas encore supportées (évite Gemini qui enchaîne 3 questions budget).
  // On conserve quand même budget / actifs / signaux extraits du message.
  {
    const t = normalizeFrChat(text);
    const unsupportedCadence = /\b(semestriel+e?|bi[- ]?annuel+e?|tous\s+les\s+6\s+mois|chaque\s+semestre)\b/.test(
      t,
    )
      ? ("semestriel" as const)
      : /\b(trimestriel+e?|tous\s+les\s+3\s+mois|chaque\s+trimestre)\b/.test(t)
        ? ("trimestriel" as const)
        : null;
    if (unsupportedCadence) {
      const partial = mergeRequiredSchedule(
        previousDraft,
        extractRequiredFromText(text, {
          defaultCurrency: currency,
          firstTransactionDate: input.firstTransactionDate,
        }),
      );
      // Ne pas figer une période inventée — on demande hebdo/mensuel.
      delete (partial as { period?: unknown }).period;
      const label =
        unsupportedCadence === "semestriel"
          ? "Semestriel (tous les 6 mois) n’est pas encore dispo. Pour l’instant on automatise en hebdo ou en mensuel — tu préfères laquelle ?"
          : "Trimestriel n’est pas encore dispo. On peut faire hebdomadaire ou mensuel pour le moment — tu veux laquelle ?";
      return {
        matched: [],
        patch: partial as StrategyFormPatch,
        explanation: [],
        unanswered: ["Quelle fréquence ? (chaque semaine / chaque mois)"],
        unsupported: [],
        source: "lexical",
        reply: label,
        intent: "clarify",
        actions: ["restart"],
      };
    }
  }

  // Chemin rapide (~ms) : réponses planning → pas d’appel Gemini.
  // Racine : extractScheduleHints = source de vérité pour budget/période/fenêtre.
  // Gemini ne peut pas inventer ces champs (stripScheduleFields) ; mergeExplicitScheduleOnly
  // réapplique toujours les hints texte + brouillon précédent.
  {
    const hints = extractScheduleHints(text, {
      looseBudget: looseBudget,
      defaultCurrency: currency,
    });
    const draftMissingWindow =
      previousDraft.windowFrom == null || previousDraft.windowTo == null;
    const windowAnswer = hints.windowFrom != null && hints.windowTo != null;
    // Fenêtre manquante, OU révision courte de fenêtre (ex. « passe au 10 du mois »).
    const windowOnlyRevise =
      windowAnswer &&
      text.length < 100 &&
      hints.budgetAmount == null &&
      hints.period == null &&
      previousDraft.budgetAmount != null &&
      (draftMissingWindow ||
        hints.windowFrom !== previousDraft.windowFrom ||
        hints.windowTo !== previousDraft.windowTo);
    const treatAsWindow =
      input.awaitingField === "window" ||
      (draftMissingWindow && windowAnswer && text.length < 80) ||
      windowOnlyRevise;

    const assetsAnswer =
      input.awaitingField === "assets"
        ? parseAssetsChoice(text, input.awaitingField)
        : null;
    const assetsOk =
      assetsAnswer != null &&
      (assetsAnswer.assetsChoice === "portfolio" ||
        (assetsAnswer.allocation?.length ?? 0) > 0);

    const startDateParsed = Boolean(hints.from);
    const startDateLooksLike =
      /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|depuis\s+(mon\s+)?premier|20\d{2}/i.test(text);
    const startDateFail =
      input.awaitingField === "startDate" &&
      !startDateParsed &&
      startDateLooksLike
        ? diagnoseStartDateHint(text, { bareYear: true })
        : null;

    const splitAnswer =
      input.awaitingField === "budgetSplit" ? extractBudgetSplitHint(text) : null;
    const classAnswer =
      input.awaitingField === "assetClassMix" ? extractAssetClassPolicyHint(text) : null;

    const answered =
      (input.awaitingField === "budget" && hints.budgetAmount != null) ||
      (input.awaitingField === "frequency" && hints.period != null) ||
      (treatAsWindow && windowAnswer) ||
      (input.awaitingField === "assets" && assetsOk) ||
      (input.awaitingField === "budgetSplit" && splitAnswer != null) ||
      (input.awaitingField === "assetClassMix" && classAnswer != null) ||
      (input.awaitingField === "startDate" && startDateParsed);

    // Date future / invalide : expliquer, ne pas dire « c’est à jour ».
    if (
      input.awaitingField === "startDate" &&
      startDateFail &&
      !startDateFail.ok &&
      text.length < 120
    ) {
      return finalizeTurn({
        presetIds: [],
        override: undefined,
        previousDraft,
        unanswered: [],
        confidence: {},
        source: "lexical",
        rawPrompt: text,
        intent: "answer",
        reply: messageForStartDateFailure(startDateFail.reason),
        clearDraft: false,
        actions: ["restart"],
        looseBudget,
        defaultCurrency: currency,
        history: input.history,
        awaitingField: input.awaitingField,
        firstTransactionDate: input.firstTransactionDate,
      });
    }

    if (
      text.length < 120 &&
      (answered || localIntent === "restart") &&
      (input.awaitingField || treatAsWindow || localIntent === "restart")
    ) {
      const hintsReply =
        treatAsWindow && windowAnswer
          ? hints.windowFrom === hints.windowTo
            ? `C’est noté — le ${hints.windowFrom} de chaque mois.`
            : `C’est noté — fenêtre jours ${hints.windowFrom}–${hints.windowTo}.`
          : input.awaitingField === "budget" && hints.budgetAmount != null
            ? `C’est noté — budget ${hints.budgetAmount} ${currency}.`
            : input.awaitingField === "frequency" && hints.period
              ? `C’est noté — ${hints.period === "weekly" ? "hebdomadaire" : "mensuel"}.`
              : input.awaitingField === "assets" && assetsOk
                ? assetsAnswer?.assetsChoice === "portfolio"
                  ? "C’est noté — on garde les actifs du portefeuille (tu confirmeras les % à la simulation)."
                  : `C’est noté — actifs : ${(assetsAnswer?.allocation ?? []).map((a) => a.asset).join(", ")}.`
                : input.awaitingField === "budgetSplit" && splitAnswer
                  ? splitAnswer === "per_asset"
                    ? "C’est noté — montant par actif."
                    : "C’est noté — montant au total, réparti entre les actifs."
                : input.awaitingField === "assetClassMix" && classAnswer
                  ? classAnswer === "crypto_only"
                    ? "C’est noté — on garde les cryptos (Fear & Greed), sans les actions."
                    : classAnswer === "equity_only"
                      ? "C’est noté — on garde les actions ; Fear & Greed est retiré (plutôt RSI/SMA ensuite)."
                      : "C’est noté — on garde le mix ; RSI par ticker, Fear & Greed global sur tout le panier."
                : input.awaitingField === "startDate" && hints.from
                  ? `C’est noté — début ${hints.from}.`
                  : undefined;
      return finalizeTurn({
        presetIds: [],
        override: assetsOk ? assetsAnswer : undefined,
        previousDraft,
        unanswered: [],
        confidence: {},
        source: "lexical",
        rawPrompt: text,
        intent: localIntent === "restart" ? "restart" : "answer",
        reply: hintsReply,
        clearDraft: localIntent === "restart",
        actions: ["restart"],
        looseBudget,
        defaultCurrency: currency,
        history: input.history,
        awaitingField: input.awaitingField,
        firstTransactionDate: input.firstTransactionDate,
      });
    }
  }

  // Révision Fear & Greed (×2 / ×0.5) : lexical, sans Gemini qui confond seuil et budget.
  const fgScale = extractFearGreedScaleHint(text);
  if (fgScale && previousDraft.budgetAmount != null && localIntent !== "restart") {
    const hints = extractScheduleHints(text, {
      looseBudget: false,
      defaultCurrency: currency,
    });
    const budget = hints.budgetAmount ?? previousDraft.budgetAmount;
    return finalizeTurn({
      presetIds: [],
      override: undefined,
      previousDraft,
      unanswered: [],
      confidence: {},
      source: "lexical",
      rawPrompt: text,
      intent: localIntent === "build" ? "revise" : localIntent,
      reply: `C’est noté — budget ${budget} ${currency}, Fear & Greed module le montant (≤${fgScale.low_lte} → ×${fgScale.low_factor}, ≥${fgScale.high_gte} → ×${fgScale.high_factor}, sinon ×1).`,
      clearDraft: false,
      actions: ["restart"],
      looseBudget: false,
      defaultCurrency: currency,
      history: input.history,
      awaitingField: input.awaitingField,
      firstTransactionDate: input.firstTransactionDate,
    });
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
        history: input.history,
        awaitingField: input.awaitingField,
        firstTransactionDate: input.firstTransactionDate,
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
      history: input.history,
      awaitingField: input.awaitingField,
      firstTransactionDate: input.firstTransactionDate,
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
      history: input.history,
      awaitingField: input.awaitingField,
      firstTransactionDate: input.firstTransactionDate,
    });
    if (intent === "build" && ids.length === 0 && Object.keys(result.patch).length === 0) {
      result.unanswered.push(
        "Décris tes règles (budget, fréquence, fenêtres…) ou choisis un modèle dans les chips — je ne recommande rien à ta place.",
      );
      result.reply =
        result.reply ||
        "Je n’ai pas encore assez pour configurer. Dis-moi ce que TU veux automatiser, ou clique un modèle pour partir d’une base.";
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

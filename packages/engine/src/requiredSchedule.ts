/**
 * Source de vérité unique pour les champs obligatoires du chat stratégie.
 *
 * Contrat :
 * 1. extractRequiredFromText — une passe texte → patch (même logique pour tous les champs)
 * 2. mergeRequiredSchedule — brouillon précédent ← extrait (jamais le LLM)
 * 3. missingRequired / questionForRequired — seules questions autorisées
 * 4. stripReplyQuestionsForAnswered — jamais reposer un champ déjà dans le brouillon
 */

import {
  extractBudgetSplitHint,
  extractScheduleHints,
  extractStartDateHint,
  isLikelyCalendarYear,
  normalizeFrChat,
  partitionAllocationByClass,
  unionEqualAllocation,
  type ScheduleHints,
} from "./scheduleHints.js";
import type { StrategyFormPatch } from "./presets.js";

export type RequiredFieldId =
  | "budget"
  | "frequency"
  | "window"
  | "assets"
  | "budgetSplit"
  | "assetClassMix"
  | "startDate";

export const REQUIRED_FIELD_IDS: RequiredFieldId[] = [
  "budget",
  "frequency",
  "window",
  "assets",
  "budgetSplit",
  "assetClassMix",
  "startDate",
];

/** Sous-ensemble planning du brouillon (compatible StrategyFormPatch / EditorState). */
export type RequiredScheduleDraft = Pick<
  StrategyFormPatch,
  | "budgetAmount"
  | "currency"
  | "period"
  | "windowFrom"
  | "windowTo"
  | "allocation"
  | "assetsChoice"
  | "budgetSplit"
  | "budgetQuotedAmount"
  | "allocationMode"
  | "assetClassPolicy"
  | "from"
  | "to"
  | "horizon"
> & {
  /** Signaux globaux — pour détecter conflit F&G + actions. */
  fearGreedEnabled?: boolean;
  fearGreedScaleEnabled?: boolean;
  rsiEnabled?: boolean;
  rsiScaleEnabled?: boolean;
};

export type ExtractRequiredOpts = {
  awaiting?: RequiredFieldId | null;
  defaultCurrency?: string;
  firstTransactionDate?: string | null;
};

export function hasAssetsAnswer(draft: RequiredScheduleDraft): boolean {
  if (draft.assetsChoice === "portfolio") return true;
  if (draft.assetsChoice === "custom" && (draft.allocation?.length ?? 0) > 0) return true;
  if (!draft.assetsChoice && (draft.allocation?.length ?? 0) > 0) return true;
  return false;
}

export function hasExplicitStartDate(draft: RequiredScheduleDraft): boolean {
  if (!draft.from || !/^\d{4}-\d{2}-\d{2}$/.test(draft.from)) return false;
  return draft.horizon === "custom" || draft.horizon === "since_first_buy";
}

/** Montant unique + ≥2 actifs custom sans « total » / « chacun » → clarification. */
export function needsBudgetSplitClarification(draft: RequiredScheduleDraft): boolean {
  if (draft.budgetSplit === "total" || draft.budgetSplit === "per_asset") return false;
  if (draft.budgetAmount == null || !(draft.budgetAmount > 0)) return false;
  if (draft.assetsChoice === "portfolio") return false;
  const n = draft.allocation?.length ?? 0;
  return n >= 2;
}

/**
 * Mix crypto + actions alors qu’un signal « crypto » (F&G) ou une demande RSI actions
 * est active — les signaux Ordium sont globaux (pas par actif).
 */
export function needsAssetClassClarification(draft: RequiredScheduleDraft): boolean {
  if (draft.assetClassPolicy) return false;
  const { crypto, equity } = partitionAllocationByClass(draft.allocation);
  if (crypto.length === 0 || equity.length === 0) return false;
  const fg = draft.fearGreedScaleEnabled === true || draft.fearGreedEnabled === true;
  const rsi = draft.rsiScaleEnabled === true || draft.rsiEnabled === true;
  return fg || rsi;
}

export function extractAssetClassPolicyHint(
  text: string,
): "mixed_ok" | "crypto_only" | "equity_only" | null {
  const t = normalizeFrChat(text);
  if (
    /\b(crypto\s+only|que\s+les\s+cryptos?|sans\s+actions?|retire?\s+les\s+actions?|pas\s+(?:d['']|de\s+)?actions?|uniquement\s+crypto)\b/.test(
      t,
    )
  ) {
    return "crypto_only";
  }
  if (
    /\b(actions?\s+only|que\s+les\s+actions?|sans\s+cryptos?|retire?\s+les\s+cryptos?|pas\s+(?:de\s+)?crypto|uniquement\s+actions?)\b/.test(
      t,
    )
  ) {
    return "equity_only";
  }
  if (
    /\b(mix|melange|garder\s+(?:les\s+)?deux|tout\s+garder|mixed|ok\s+mix|on\s+garde\s+tout|global|les\s+deux)\b/.test(
      t,
    ) ||
    /^(mix|melange|garder|ok|oui)[\s!.]*$/.test(t)
  ) {
    return "mixed_ok";
  }
  return null;
}

/** Applique crypto_only / equity_only sur l’allocation (+ coupe F&G si equity_only). */
export function applyAssetClassPolicy(
  draft: RequiredScheduleDraft,
  policy: "mixed_ok" | "crypto_only" | "equity_only",
): RequiredScheduleDraft {
  const { crypto, equity, unknown } = partitionAllocationByClass(draft.allocation);
  if (policy === "mixed_ok") {
    return { ...draft, assetClassPolicy: "mixed_ok" };
  }
  if (policy === "crypto_only") {
    const keep = [...crypto, ...unknown.filter((a) => !equity.includes(a))];
    return {
      ...draft,
      assetClassPolicy: "crypto_only",
      allocation: keep.length
        ? unionEqualAllocation(
            keep.map((asset) => ({ asset, pct: 0 })),
            undefined,
          )
        : draft.allocation,
      assetsChoice: "custom",
    };
  }
  // equity_only : retirer F&G (orienté crypto)
  const keep = [...equity, ...unknown.filter((a) => !crypto.includes(a))];
  return {
    ...draft,
    assetClassPolicy: "equity_only",
    allocation: keep.length
      ? unionEqualAllocation(
          keep.map((asset) => ({ asset, pct: 0 })),
          undefined,
        )
      : draft.allocation,
    assetsChoice: "custom",
    fearGreedEnabled: false,
    fearGreedScaleEnabled: false,
  };
}

export function isRequiredFieldAnswered(
  draft: RequiredScheduleDraft,
  id: RequiredFieldId,
): boolean {
  if (id === "budget") return draft.budgetAmount != null && draft.budgetAmount > 0;
  if (id === "frequency") return draft.period === "weekly" || draft.period === "monthly";
  if (id === "window") return draft.windowFrom != null && draft.windowTo != null;
  if (id === "assets") return hasAssetsAnswer(draft);
  if (id === "budgetSplit") return !needsBudgetSplitClarification(draft);
  if (id === "assetClassMix") return !needsAssetClassClarification(draft);
  return hasExplicitStartDate(draft);
}

export function missingRequired(draft: RequiredScheduleDraft): RequiredFieldId[] {
  return REQUIRED_FIELD_IDS.filter((id) => !isRequiredFieldAnswered(draft, id));
}

export function questionForRequired(id: RequiredFieldId, currency = "EUR"): string {
  const code = (currency || "EUR").toUpperCase();
  const unit = code === "USD" ? "USD" : "EUR";
  if (id === "budget") return `Quel montant par période ? (ex. 200 ${unit})`;
  if (id === "frequency") return "Quelle fréquence — chaque semaine ou chaque mois ?";
  if (id === "window") return "Quelle fenêtre d’achat ? (ex. du 1 au 7, ou le 1 du mois)";
  if (id === "assets") {
    return "Tu veux garder les mêmes actifs que ton portefeuille ? (oui / non — si non, dis sur quels actifs porte la stratégie)";
  }
  if (id === "budgetSplit") {
    return `Ce montant, c’est au total (répartis entre les actifs) ou par actif ?`;
  }
  if (id === "assetClassMix") {
    return assetClassMixQuestion({ allocation: undefined, fearGreedScaleEnabled: true });
  }
  return "Quelle date de début pour le backtest ? (ex. 15/03/2023)";
}

function assetClassMixQuestion(draft: RequiredScheduleDraft): string {
  const { crypto, equity } = partitionAllocationByClass(draft.allocation);
  const c = crypto.join(", ") || "cryptos";
  const e = equity.join(", ") || "actions";
  const fg = draft.fearGreedScaleEnabled || draft.fearGreedEnabled;
  const head = fg
    ? `Fear & Greed convient surtout aux cryptos (${c}), pas vraiment aux actions (${e}). ` +
      `Le RSI se calcule sur le prix de chaque ticker ; le F&G est un indice crypto unique pour tout le panier. ` +
      `On ne peut pas encore scoper « F&G cryptos only / RSI Amazon only » dans la même stratégie.`
    : `Tu mixes cryptos (${c}) et actions (${e}). ` +
      `Le RSI se calcule par ticker ; on ne peut pas encore attacher des règles différentes à des actifs différents.`;
  return `${head} Tu préfères : garder le mix, retirer les actions (crypto only), ou retirer les cryptos (actions only — F&G retiré) ?`;
}

function budgetSplitQuestion(draft: RequiredScheduleDraft, currency: string): string {
  const code = (currency || "EUR").toUpperCase();
  const unit = code === "USD" ? "$" : "€";
  const quoted =
    draft.budgetQuotedAmount ??
    (draft.budgetSplit === "per_asset" && (draft.allocation?.length ?? 0) > 0
      ? Math.round((draft.budgetAmount! / draft.allocation!.length) * 100) / 100
      : draft.budgetAmount);
  const n = draft.allocation?.length ?? 0;
  const names = (draft.allocation ?? []).map((a) => a.asset).join(", ");
  const totalIfEach =
    quoted != null && n > 0 ? Math.round(quoted * n * 100) / 100 : null;
  if (quoted != null && n >= 2 && totalIfEach != null) {
    return `Les ${quoted} ${unit}, c’est au total (répartis sur ${names}) ou ${quoted} ${unit} par actif (donc ${totalIfEach} ${unit}) ?`;
  }
  return questionForRequired("budgetSplit", currency);
}

/** Questions manquantes (formulation adaptée si custom sans tickers / split). */
export function missingRequiredQuestions(
  draft: RequiredScheduleDraft,
  currency = "EUR",
): string[] {
  return missingRequired(draft).map((id) => {
    if (id === "assets" && draft.assetsChoice === "custom" && !(draft.allocation?.length)) {
      return "Sur quels actifs ? (ex. BTC, ETH, GOOGL)";
    }
    if (id === "budgetSplit") return budgetSplitQuestion(draft, currency);
    if (id === "assetClassMix") return assetClassMixQuestion(draft);
    return questionForRequired(id, currency);
  });
}

export function nextRequiredQuestion(
  draft: RequiredScheduleDraft,
  currency = "EUR",
): { id: RequiredFieldId; question: string } | null {
  const id = missingRequired(draft)[0];
  if (!id) return null;
  const questions = missingRequiredQuestions(draft, currency);
  return { id, question: questions[0]! };
}

/** Réponse oui/non / tickers pour les actifs. */
export function parseAssetsChoice(
  text: string,
  awaiting?: RequiredFieldId | null,
): Pick<RequiredScheduleDraft, "assetsChoice" | "allocation"> | null {
  const t = normalizeFrChat(text);
  const hints = extractScheduleHints(text);
  const hasAlloc = Boolean(hints.allocation?.length);
  const yesAlone =
    /^(oui|ouais|ouai|ok|okay|yes|yep|daccord|dac|pareil|same)[\s!.]*$/.test(t);
  const yesKeep =
    (/\b(oui|ouais)\b/.test(t) &&
      /\b(portefeuille|meme|memes|same|garder|tous|toutes)\b/.test(t)) ||
    /\bgarder\b.+\bportefeuille\b/.test(t) ||
    /\bmeme[s]?\s+actifs?\b/.test(t);

  if (hasAlloc) {
    return { assetsChoice: "custom", allocation: hints.allocation };
  }
  if (yesKeep) return { assetsChoice: "portfolio" };
  if (yesAlone && awaiting === "assets") return { assetsChoice: "portfolio" };
  if (/^(non|no|nan|nop)[\s!.]*$/.test(t)) {
    return { assetsChoice: "custom", allocation: [] };
  }
  return null;
}

/**
 * Applique total vs par actif sur un brouillon (réponse à budgetSplit).
 * `quoted` = montant unitaire cité ; si per_asset → budget = quoted × n.
 */
export function applyBudgetSplit(
  draft: RequiredScheduleDraft,
  split: "total" | "per_asset",
): RequiredScheduleDraft {
  const n = draft.allocation?.length ?? 0;
  const quoted = draft.budgetQuotedAmount ?? draft.budgetAmount;
  if (quoted == null || !(quoted > 0)) {
    return { ...draft, budgetSplit: split };
  }
  if (split === "per_asset" && n >= 2) {
    return {
      ...draft,
      budgetSplit: "per_asset",
      budgetQuotedAmount: quoted,
      budgetAmount: Math.round(quoted * n * 100) / 100,
    };
  }
  return {
    ...draft,
    budgetSplit: "total",
    budgetQuotedAmount: quoted,
    budgetAmount: quoted,
  };
}

function applyStartDate(iso: string): Pick<RequiredScheduleDraft, "from" | "horizon"> {
  return { from: iso, horizon: "custom" };
}

function applySinceFirstBuy(
  firstTx: string,
): Pick<RequiredScheduleDraft, "from" | "horizon"> {
  return { from: firstTx, horizon: "since_first_buy" };
}

function looksLikeDateOnlyAnswer(text: string): boolean {
  const t = normalizeFrChat(text);
  if (t.length > 100) return false;
  const hasScheduleNoise =
    /\b(budget|investir|mettre|mets|euros?|eur|usd|btc|eth|sol|fear|greed|semaine|mensuel|total|chacun)\b/.test(
      t,
    ) || /\d+\s*(eur|euros|usd)/.test(t);
  if (hasScheduleNoise) return false;
  return (
    /\d{1,2}[./\-]\d{1,2}([./\-]\d{2,4})?/.test(t) ||
    /^(20\d{2})$/.test(t.trim()) ||
    /\b(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\b/.test(
      t,
    ) ||
    /\bdepuis\s+(mon\s+)?(premier|1er)\s+achat\b/.test(t)
  );
}

function looksLikeAssetsOnlyAnswer(text: string, awaiting?: RequiredFieldId | null): boolean {
  if (awaiting !== "assets") return false;
  const t = normalizeFrChat(text);
  if (t.length > 80) return false;
  if (
    /^(oui|ouais|ouai|ok|okay|yes|yep|daccord|dac|non|no|nan|nop)[\s!.]*$/.test(t)
  ) {
    return true;
  }
  const hints = extractScheduleHints(text);
  return (
    Boolean(hints.allocation?.length) &&
    hints.budgetAmount == null &&
    hints.period == null &&
    hints.windowFrom == null
  );
}

function looksLikeBudgetSplitOnlyAnswer(
  text: string,
  awaiting?: RequiredFieldId | null,
): boolean {
  if (awaiting !== "budgetSplit") return false;
  return extractBudgetSplitHint(text) != null && normalizeFrChat(text).length < 80;
}

/** Mappe les hints planning (+ actifs / date / split) vers un patch requis. */
function hintsToRequired(
  hints: ScheduleHints,
  text: string,
  opts: ExtractRequiredOpts,
): RequiredScheduleDraft {
  const out: RequiredScheduleDraft = {};
  if (hints.budgetAmount != null) out.budgetAmount = hints.budgetAmount;
  if (hints.currency) out.currency = hints.currency;
  if (hints.period) out.period = hints.period;
  if (hints.windowFrom != null) out.windowFrom = hints.windowFrom;
  if (hints.windowTo != null) out.windowTo = hints.windowTo;
  if (hints.budgetSplit) out.budgetSplit = hints.budgetSplit;
  if (hints.budgetQuotedAmount != null) out.budgetQuotedAmount = hints.budgetQuotedAmount;
  if (hints.allocationMode) out.allocationMode = hints.allocationMode;
  if (hints.fearGreedScaleEnabled) out.fearGreedScaleEnabled = true;
  if (hints.fearGreedEnabled) out.fearGreedEnabled = true;
  if (hints.rsiScaleEnabled) out.rsiScaleEnabled = true;
  if (hints.rsiEnabled) out.rsiEnabled = true;

  const policyHint = extractAssetClassPolicyHint(text);
  if (policyHint) out.assetClassPolicy = policyHint;

  if (hints.from) {
    Object.assign(out, applyStartDate(hints.from));
  } else if (opts.awaiting === "startDate" || opts.firstTransactionDate) {
    const bare = opts.awaiting === "startDate";
    const start = extractStartDateHint(text, { bareYear: bare });
    if (start) Object.assign(out, applyStartDate(start));
    else if (opts.firstTransactionDate) {
      const t = normalizeFrChat(text);
      if (/\b(depuis\s+(mon\s+)?(premier|1er)\s+achat|depuis\s+le\s+debut|first\s+buy)\b/.test(t)) {
        Object.assign(out, applySinceFirstBuy(opts.firstTransactionDate));
      }
    }
  }

  const assets = parseAssetsChoice(text, opts.awaiting);
  if (assets) Object.assign(out, assets);
  else if (hints.allocation?.length) {
    out.allocation = hints.allocation;
    out.assetsChoice = "custom";
  }

  if (
    out.budgetAmount != null &&
    out.from &&
    isLikelyCalendarYear(out.budgetAmount) &&
    out.from.startsWith(String(Math.trunc(out.budgetAmount)))
  ) {
    delete out.budgetAmount;
  }

  return out;
}

/**
 * Extraction unique — même filets pour tous les champs.
 * `awaiting` assouplit UNIQUEMENT le champ attendu.
 */
export function extractRequiredFromText(
  text: string,
  opts: ExtractRequiredOpts = {},
): RequiredScheduleDraft {
  const awaiting = opts.awaiting ?? null;
  const currency = (opts.defaultCurrency ?? "EUR").toUpperCase();

  if (awaiting === "startDate" && looksLikeDateOnlyAnswer(text)) {
    const start = extractStartDateHint(text, { bareYear: true });
    if (start) return applyStartDate(start);
    if (opts.firstTransactionDate) {
      const t = normalizeFrChat(text);
      if (/\b(depuis\s+(mon\s+)?(premier|1er)\s+achat|depuis\s+le\s+debut|first\s+buy)\b/.test(t)) {
        return applySinceFirstBuy(opts.firstTransactionDate);
      }
    }
    return {};
  }
  if (looksLikeAssetsOnlyAnswer(text, awaiting)) {
    return parseAssetsChoice(text, awaiting) ?? {};
  }
  if (looksLikeBudgetSplitOnlyAnswer(text, awaiting)) {
    const split = extractBudgetSplitHint(text);
    return split ? { budgetSplit: split } : {};
  }
  if (awaiting === "assetClassMix") {
    const policy = extractAssetClassPolicyHint(text);
    if (policy) return { assetClassPolicy: policy };
  }

  const hints = extractScheduleHints(text, {
    defaultCurrency: currency,
    looseBudget: awaiting === "budget",
  });
  let out = hintsToRequired(hints, text, opts);

  if (out.budgetAmount == null) {
    const loose = extractScheduleHints(text, {
      defaultCurrency: currency,
      looseBudget: true,
    });
    if (loose.budgetAmount != null) {
      out.budgetAmount = loose.budgetAmount;
      if (loose.currency) out.currency = loose.currency;
      if (loose.budgetQuotedAmount != null) out.budgetQuotedAmount = loose.budgetQuotedAmount;
      if (loose.budgetSplit) out.budgetSplit = loose.budgetSplit;
      if (
        out.from &&
        isLikelyCalendarYear(out.budgetAmount) &&
        out.from.startsWith(String(Math.trunc(out.budgetAmount)))
      ) {
        delete out.budgetAmount;
      }
    }
  }

  if (!hasAssetsAnswer(out) && hints.allocation?.length) {
    out.allocation = hints.allocation;
    out.assetsChoice = "custom";
  }

  // Si on attend budgetSplit et le hint est là, ne renvoyer que le split
  // (le merge appliquera ×n avec le brouillon précédent).
  if (awaiting === "budgetSplit" && out.budgetSplit && !out.allocation) {
    return { budgetSplit: out.budgetSplit };
  }

  return out;
}

/** Fusion : précédent ← extrait ; applique ×n si split per_asset vient d’être posé. */
export function mergeRequiredSchedule(
  previous: RequiredScheduleDraft,
  extracted: RequiredScheduleDraft,
): RequiredScheduleDraft {
  let out: RequiredScheduleDraft = { ...previous };

  const prevQuoted = previous.budgetQuotedAmount ?? previous.budgetAmount;
  if (extracted.budgetAmount != null) {
    out.budgetAmount = extracted.budgetAmount;
    if (
      extracted.budgetQuotedAmount != null &&
      prevQuoted != null &&
      extracted.budgetQuotedAmount !== prevQuoted &&
      !extracted.budgetSplit
    ) {
      // Nouveau montant ambigu → re-clarifier
      delete out.budgetSplit;
    }
  }
  if (extracted.currency) out.currency = extracted.currency;
  if (extracted.budgetQuotedAmount != null) out.budgetQuotedAmount = extracted.budgetQuotedAmount;
  if (extracted.period) out.period = extracted.period;
  if (extracted.windowFrom != null) out.windowFrom = extracted.windowFrom;
  if (extracted.windowTo != null) out.windowTo = extracted.windowTo;

  if (extracted.assetsChoice) out.assetsChoice = extracted.assetsChoice;
  if (
    extracted.assetsChoice === "custom" &&
    !(extracted.allocation?.length) &&
    !previous.allocation?.length
  ) {
    delete out.allocation;
  } else if (extracted.allocation?.length) {
    const mode = extracted.allocationMode ?? "replace";
    const prevAlloc = previous.allocation ?? out.allocation;
    const prevN = prevAlloc?.length ?? 0;
    const extN = extracted.allocation.length;

    if (mode === "add" && prevN > 0) {
      out.allocation = unionEqualAllocation(prevAlloc, extracted.allocation);
      out.assetsChoice = "custom";
      // Nouvel actif dans un mix sensible → re-clarifier la classe
      if (out.assetClassPolicy && needsAssetClassClarification({ ...out, assetClassPolicy: undefined })) {
        delete out.assetClassPolicy;
      }
    } else if (
      // Ne jamais écraser un multi-actifs par un seul ticker (ex. « RSI pour Amazon »)
      prevN > 1 &&
      extN === 1 &&
      mode === "replace"
    ) {
      const only = extracted.allocation[0]!.asset.toUpperCase();
      const already = prevAlloc!.some((a) => a.asset.toUpperCase() === only);
      if (already) {
        // mention signal — garder prev
        out.allocation = prevAlloc;
      } else {
        // ticker nouveau sans « ajoute » → traiter comme add
        out.allocation = unionEqualAllocation(prevAlloc, extracted.allocation);
        out.assetsChoice = "custom";
        if (out.assetClassPolicy) delete out.assetClassPolicy;
      }
    } else {
      out.allocation = extracted.allocation;
      out.assetsChoice = extracted.assetsChoice ?? "custom";
    }
  }
  if (extracted.allocationMode) out.allocationMode = extracted.allocationMode;

  if (extracted.fearGreedScaleEnabled) out.fearGreedScaleEnabled = true;
  if (extracted.fearGreedEnabled) out.fearGreedEnabled = true;
  if (extracted.rsiScaleEnabled) out.rsiScaleEnabled = true;
  if (extracted.rsiEnabled) out.rsiEnabled = true;

  if (extracted.assetClassPolicy) {
    out = applyAssetClassPolicy(out, extracted.assetClassPolicy);
  }

  if (extracted.from) {
    out.from = extracted.from;
    out.horizon = extracted.horizon ?? "custom";
  } else if (extracted.horizon != null) {
    out.horizon = extracted.horizon;
  }
  if (extracted.to) out.to = extracted.to;

  // Split : si le message clarifie total / par actif, appliquer sur le brouillon.
  if (extracted.budgetSplit) {
    if (
      extracted.budgetAmount != null &&
      extracted.budgetQuotedAmount != null &&
      (extracted.allocation?.length || out.allocation?.length)
    ) {
      // Déjà résolu dans extractScheduleHints (même message).
      out.budgetSplit = extracted.budgetSplit;
      out.budgetAmount = extracted.budgetAmount;
      out.budgetQuotedAmount = extracted.budgetQuotedAmount;
    } else {
      const n = out.allocation?.length ?? 0;
      const quoted =
        extracted.budgetQuotedAmount ??
        out.budgetQuotedAmount ??
        (out.budgetSplit === "per_asset" && n > 0 && out.budgetAmount != null
          ? Math.round((out.budgetAmount / n) * 100) / 100
          : out.budgetAmount);
      out = applyBudgetSplit(
        {
          ...out,
          budgetAmount: quoted ?? out.budgetAmount,
          budgetQuotedAmount: quoted ?? out.budgetQuotedAmount,
        },
        extracted.budgetSplit,
      );
    }
  } else if (extracted.budgetQuotedAmount != null) {
    out.budgetQuotedAmount = extracted.budgetQuotedAmount;
  }

  return out;
}

export function replyAsksRequiredField(reply: string, field: RequiredFieldId): boolean {
  const r = reply.toLowerCase();
  if (!r.includes("?")) return false;
  if (field === "budget") {
    return /\b(budget|montant|allouer|euros?|€|dollars?|combien)\b/.test(r);
  }
  if (field === "frequency") {
    return /\b(frequence|fréquence|hebdo|mensuel|semaine|mois|cadence|p[ée]riode)\b/.test(r);
  }
  if (field === "window") {
    return /\b(fenetre|fenêtre|jours?|du\s+\d|le\s+\d)/.test(r);
  }
  if (field === "assets") {
    return /\b(actif|actifs|portefeuille|allocation|ticker)\b/.test(r);
  }
  if (field === "budgetSplit") {
    return /\b(total|par\s+actif|chacun|reparti|réparti|donc\s+\d)\b/.test(r);
  }
  if (field === "assetClassMix") {
    return /\b(crypto|actions?|mix|melange|signaux|fear|rsi|retirer)\b/.test(r);
  }
  return /\b(date|debut|début|depuis|backtest)\b/.test(r);
}

/**
 * Retire les questions sur champs déjà satisfaits ET les questions prématurées
 * (ex. date de début alors que budgetSplit n’est pas encore tranché).
 * Une seule question autorisée : missing[0].
 */
export function stripReplyQuestionsForAnswered(
  reply: string,
  draft: RequiredScheduleDraft,
): string {
  const next = missingRequired(draft)[0] ?? null;
  const block = REQUIRED_FIELD_IDS.filter((id) => id !== next);

  const parts = reply
    .trim()
    .split(/(?<=[.!?…])\s+/)
    .filter(Boolean);
  const keep = parts.filter((p) => {
    if (!p.includes("?")) return true;
    return !block.some((f) => replyAsksRequiredField(p, f));
  });
  return keep.join(" ").trim();
}

export function fieldIdOfQuestion(question: string): RequiredFieldId | null {
  const q = question.toLowerCase();
  if (/crypto only|actions only|pas actif par actif|fear & greed convient|mixes cryptos/.test(q)) {
    return "assetClassMix";
  }
  if (/par actif|au total|répartis sur|repartis sur|donc \d/.test(q)) return "budgetSplit";
  if (/budget|montant/.test(q)) return "budget";
  if (/fr[ée]quence|chaque semaine ou chaque mois/.test(q)) return "frequency";
  if (/fen[êe]tre/.test(q)) return "window";
  if (/actif|actifs|portefeuille|allocation/.test(q)) return "assets";
  if (/date|d[ée]but|backtest/.test(q)) return "startDate";
  return null;
}

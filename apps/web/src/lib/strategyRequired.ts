/**
 * Infos obligatoires chat — thin wrapper autour de @ordium/engine requiredSchedule
 * (même logique API + web).
 */

import {
  diagnoseStartDateHint,
  extractRequiredFromText,
  hasAssetsAnswer as engineHasAssetsAnswer,
  hasExplicitStartDate as engineHasExplicitStartDate,
  isLikelyCalendarYear,
  messageForStartDateFailure,
  missingRequired,
  nextRequiredQuestion,
  parseAssetsChoice,
  questionForRequired,
  stripReplyQuestionsForAnswered,
  type RequiredFieldId,
  type RequiredScheduleDraft,
} from "@ordium/engine";
import {
  applyStartDate,
  applyHorizon,
  type EditorState,
} from "./strategy";

export type { RequiredFieldId };
export { messageForStartDateFailure, stripReplyQuestionsForAnswered };

/** Feedback si l’utilisateur répond une mauvaise date alors qu’on attend startDate. */
export function startDateFailureMessage(text: string): string | null {
  const d = diagnoseStartDateHint(text, { bareYear: true });
  if (d.ok) return null;
  if (d.reason === "unparsed") {
    const looksLikeDate =
      /\d{1,4}[./\-]\d{1,2}([./\-]\d{2,4})?/.test(text) ||
      /\b(20\d{2})\b/.test(text) ||
      /\b(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\b/i.test(
        text,
      );
    if (!looksLikeDate) return null;
  }
  return messageForStartDateFailure(d.reason);
}

export function isSuspiciousYearBudget(n: number | null | undefined): boolean {
  return n != null && isLikelyCalendarYear(n);
}

export function scrubYearBudget<T extends { budgetAmount?: number }>(patch: T): T {
  if (!isSuspiciousYearBudget(patch.budgetAmount)) return patch;
  const next = { ...patch };
  delete next.budgetAmount;
  return next;
}

export type RequiredField = {
  id: RequiredFieldId;
  question: (currency: string) => string;
};

export const REQUIRED_FIELDS: RequiredField[] = (
  [
    "budget",
    "frequency",
    "window",
    "assets",
    "budgetSplit",
    "assetClassMix",
    "startDate",
  ] as RequiredFieldId[]
).map((id) => ({
  id,
  question: (currency: string) => questionForRequired(id, currency),
}));

export function questionFor(id: RequiredFieldId, currency = "EUR"): string {
  return questionForRequired(id, currency);
}

export type ParseOpts = {
  defaultCurrency?: string;
  awaiting?: RequiredFieldId;
  firstTransactionDate?: string | null;
};

export function hasExplicitStartDate(draft: Partial<EditorState>): boolean {
  return engineHasExplicitStartDate(draft as RequiredScheduleDraft);
}

export function hasAssetsAnswer(draft: Partial<EditorState>): boolean {
  return engineHasAssetsAnswer(draft as RequiredScheduleDraft);
}

export function detectsField(id: RequiredFieldId, text: string): boolean {
  const extracted = extractRequiredFromText(text, { awaiting: id });
  if (id === "budget") return extracted.budgetAmount != null;
  if (id === "frequency") return extracted.period != null;
  if (id === "window") return extracted.windowFrom != null && extracted.windowTo != null;
  if (id === "assets") return hasAssetsAnswer(extracted);
  if (id === "budgetSplit") return extracted.budgetSplit != null;
  if (id === "assetClassMix") return extracted.assetClassPolicy != null;
  return hasExplicitStartDate(extracted);
}

export function missingRequiredFields(userTexts: string[]): RequiredFieldId[] {
  return REQUIRED_FIELDS.map((f) => f.id).filter((id) => {
    return !userTexts.some((t) => detectsField(id, t));
  });
}

export function parseAssetsAnswer(
  text: string,
  opts: ParseOpts = {},
): Partial<EditorState> | null {
  return parseAssetsChoice(text, opts.awaiting) as Partial<EditorState> | null;
}

/** Champs manquants d’après le brouillon — même prédicat que l’API. */
export function missingFromDraft(draft: Partial<EditorState>): RequiredFieldId[] {
  return missingRequired(draft as RequiredScheduleDraft);
}

export function parseRequiredAnswer(
  field: RequiredFieldId,
  text: string,
  opts: ParseOpts = {},
): Partial<EditorState> | null {
  const extracted = extractRequiredFromText(text, {
    awaiting: field,
    defaultCurrency: opts.defaultCurrency,
    firstTransactionDate: opts.firstTransactionDate,
  });
  if (field === "budget") {
    return extracted.budgetAmount != null
      ? {
          budgetAmount: extracted.budgetAmount,
          currency: extracted.currency ?? opts.defaultCurrency ?? "EUR",
        }
      : null;
  }
  if (field === "frequency") return extracted.period ? { period: extracted.period } : null;
  if (field === "window") {
    return extracted.windowFrom != null && extracted.windowTo != null
      ? { windowFrom: extracted.windowFrom, windowTo: extracted.windowTo }
      : null;
  }
  if (field === "assets") return parseAssetsAnswer(text, opts);
  if (field === "budgetSplit") {
    const split = extractRequiredFromText(text, { awaiting: "budgetSplit" }).budgetSplit;
    return split ? { budgetSplit: split } : null;
  }
  if (field === "assetClassMix") {
    const policy = extractRequiredFromText(text, { awaiting: "assetClassMix" }).assetClassPolicy;
    return policy ? { assetClassPolicy: policy } : null;
  }
  if (field === "startDate") {
    if (extracted.from) {
      return extracted.horizon === "since_first_buy" && opts.firstTransactionDate
        ? applyHorizon("since_first_buy", opts.firstTransactionDate)
        : applyStartDate(extracted.from);
    }
    return null;
  }
  return null;
}

export function parseAllRequiredFromText(
  text: string,
  opts: ParseOpts = {},
): Partial<EditorState> {
  return extractRequiredFromText(text, {
    awaiting: opts.awaiting,
    defaultCurrency: opts.defaultCurrency,
    firstTransactionDate: opts.firstTransactionDate,
  }) as Partial<EditorState>;
}

export function extractExplicitPatch(
  userTexts: string[],
  opts: ParseOpts = {},
): Partial<EditorState> {
  const out: Partial<EditorState> = {};
  for (const t of userTexts) {
    Object.assign(out, parseAllRequiredFromText(t, opts));
  }
  return out;
}

export function nextMissingQuestion(
  missing: RequiredFieldId[],
  currency = "EUR",
  draft?: Partial<EditorState>,
): { id: RequiredFieldId; question: string } | null {
  if (draft) {
    return nextRequiredQuestion(draft as RequiredScheduleDraft, currency);
  }
  const id = missing[0];
  if (!id) return null;
  return { id, question: questionFor(id, currency) };
}

export function ackUnderstood(patch: Partial<EditorState>): string | null {
  const bits: string[] = [];
  if (patch.budgetAmount != null) {
    bits.push(`${patch.budgetAmount} ${patch.currency ?? "EUR"}`);
  }
  if (patch.period === "weekly") bits.push("chaque semaine");
  if (patch.period === "monthly") bits.push("chaque mois");
  if (patch.windowFrom != null && patch.windowTo != null) {
    bits.push(`jours ${patch.windowFrom}–${patch.windowTo}`);
  }
  if (hasExplicitStartDate(patch) && patch.from) {
    bits.push(
      patch.horizon === "since_first_buy"
        ? `depuis le 1er achat (${patch.from})`
        : `début ${patch.from}`,
    );
  }
  if (bits.length === 0) return null;
  return `C’est noté : ${bits.join(" · ")}.`;
}

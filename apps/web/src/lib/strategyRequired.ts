/**
 * Infos obligatoires chat — s’appuie sur extractScheduleHints (@ordium/engine)
 * pour le français naturel / SMS (« tt les mois », « je mets 200 », …).
 */

import {
  extractScheduleHints,
  extractStartDateHint,
} from "@ordium/engine";
import {
  applyStartDate,
  applyHorizon,
  type EditorState,
} from "./strategy";

export type RequiredFieldId = "budget" | "frequency" | "window" | "startDate";

/** Budget qui ressemble à une année (ex. 2024) — confusion date / montant. */
export function isSuspiciousYearBudget(n: number | null | undefined): boolean {
  return n != null && Number.isInteger(n) && n >= 2010 && n <= 2039;
}

/** Retire un budget « année » d’un patch / brouillon. */
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

function currencyLabel(currency: string): { example: string; unit: string } {
  const code = (currency || "EUR").toUpperCase();
  if (code === "USD") return { example: "500 $", unit: "dollars" };
  return { example: "500 €", unit: "euros" };
}

export const REQUIRED_FIELDS: RequiredField[] = [
  {
    id: "budget",
    question: (currency) => {
      const { example, unit } = currencyLabel(currency);
      return `Il me manque le montant de base par période. Réponds dans le chat — « 200 » suffit (ce sera des ${unit}), ou « ${example} », « je mets 300 »…`;
    },
  },
  {
    id: "frequency",
    question: () =>
      "Il me manque la fréquence. Réponds dans le chat comme tu veux : « tt les mois », « chaque semaine », « mensuel »…",
  },
  {
    id: "window",
    question: () =>
      "Il me manque la fenêtre d’achat. Ex. « du 1 au 7 », « 1-7 », « les premiers jours »…",
  },
  {
    id: "startDate",
    question: () =>
      "Il me manque la date de début du backtest — obligatoire. Réponds une date précise : « 15/03/2023 », « 2023-03-15 », « mars 2024 »…",
  },
];

const FIELD_BY_ID = Object.fromEntries(REQUIRED_FIELDS.map((f) => [f.id, f])) as Record<
  RequiredFieldId,
  RequiredField
>;

export function questionFor(id: RequiredFieldId, currency = "EUR"): string {
  return FIELD_BY_ID[id].question(currency);
}

export type ParseOpts = {
  defaultCurrency?: string;
  awaiting?: RequiredFieldId;
  firstTransactionDate?: string | null;
};

/** Date de début saisie / confirmée (pas un simple preset « 1 an »). */
export function hasExplicitStartDate(draft: Partial<EditorState>): boolean {
  if (!draft.from || !/^\d{4}-\d{2}-\d{2}$/.test(draft.from)) return false;
  // custom = date tapée ; since_first_buy = date concrète du portefeuille
  return draft.horizon === "custom" || draft.horizon === "since_first_buy";
}

function hintsToPatch(
  hints: ReturnType<typeof extractScheduleHints>,
  opts: ParseOpts = {},
): Partial<EditorState> {
  const out: Partial<EditorState> = {};
  if (hints.budgetAmount != null) out.budgetAmount = hints.budgetAmount;
  if (hints.currency) out.currency = hints.currency;
  if (hints.period) out.period = hints.period;
  if (hints.windowFrom != null) out.windowFrom = hints.windowFrom;
  if (hints.windowTo != null) out.windowTo = hints.windowTo;
  // Date de début : uniquement une date explicite (pas 1y/3y).
  if (hints.from) {
    Object.assign(out, applyStartDate(hints.from));
  }
  // Régime explicite dans le message (« +15% baisse / -15% hausse »)
  if (hints.regimeEnabled) {
    out.regimeEnabled = true;
    if (hints.bearMult != null) out.bearMult = hints.bearMult;
    if (hints.bullMult != null) out.bullMult = hints.bullMult;
    if (hints.regimeReferenceAsset !== undefined) {
      out.regimeReferenceAsset = hints.regimeReferenceAsset;
    }
  }
  return out;
}

export function detectsField(id: RequiredFieldId, text: string): boolean {
  const h = extractScheduleHints(text, { looseBudget: id === "budget" });
  if (id === "budget") return h.budgetAmount != null;
  if (id === "frequency") return h.period != null;
  if (id === "window") return h.windowFrom != null && h.windowTo != null;
  if (id === "startDate") return extractStartDateHint(text) != null || h.from != null;
  return false;
}

export function missingRequiredFields(userTexts: string[]): RequiredFieldId[] {
  return REQUIRED_FIELDS.map((f) => f.id).filter((id) => {
    return !userTexts.some((t) => detectsField(id, t));
  });
}

/** Champs manquants d’après le brouillon (plus fiable que le seul texte utilisateur). */
export function missingFromDraft(draft: Partial<EditorState>): RequiredFieldId[] {
  const missing: RequiredFieldId[] = [];
  if (draft.budgetAmount == null || !(draft.budgetAmount > 0)) missing.push("budget");
  if (draft.period !== "weekly" && draft.period !== "monthly") missing.push("frequency");
  if (draft.windowFrom == null || draft.windowTo == null) missing.push("window");
  if (!hasExplicitStartDate(draft)) missing.push("startDate");
  return missing;
}

export function parseRequiredAnswer(
  field: RequiredFieldId,
  text: string,
  opts: ParseOpts = {},
): Partial<EditorState> | null {
  const h = extractScheduleHints(text, {
    defaultCurrency: opts.defaultCurrency,
    looseBudget: opts.awaiting === "budget" || field === "budget",
  });
  if (field === "budget") {
    return h.budgetAmount != null
      ? { budgetAmount: h.budgetAmount, currency: h.currency ?? opts.defaultCurrency ?? "EUR" }
      : null;
  }
  if (field === "frequency") return h.period ? { period: h.period } : null;
  if (field === "window") {
    return h.windowFrom != null && h.windowTo != null
      ? { windowFrom: h.windowFrom, windowTo: h.windowTo }
      : null;
  }
  if (field === "startDate") {
    const start = h.from ?? extractStartDateHint(text, { bareYear: true });
    if (start) return applyStartDate(start);
    // « depuis mon premier achat » uniquement si on a la date réelle
    const t = text.toLowerCase();
    if (
      opts.firstTransactionDate &&
      /\b(depuis\s+(mon\s+)?(premier|1er)\s+achat|depuis\s+le\s+debut|first\s+buy)\b/.test(
        t.normalize("NFD").replace(/\p{M}/gu, ""),
      )
    ) {
      return applyHorizon("since_first_buy", opts.firstTransactionDate);
    }
    return null;
  }
  return null;
}

export function parseAllRequiredFromText(
  text: string,
  opts: ParseOpts = {},
): Partial<EditorState> {
  // En attente de la date de début : ne touche JAMAIS au budget.
  if (opts.awaiting === "startDate") {
    return parseRequiredAnswer("startDate", text, opts) ?? {};
  }

  const base = hintsToPatch(
    extractScheduleHints(text, {
      defaultCurrency: opts.defaultCurrency,
      // Loose uniquement quand on attend explicitement le montant.
      looseBudget: opts.awaiting === "budget",
    }),
    opts,
  );

  const startPatch = parseRequiredAnswer("startDate", text, opts);
  if (startPatch) Object.assign(base, startPatch);

  // Filet : budget == année de la date de début → confusion, on ignore le budget.
  if (
    base.budgetAmount != null &&
    base.from &&
    base.budgetAmount >= 2010 &&
    base.budgetAmount <= 2039 &&
    String(base.from).startsWith(String(Math.trunc(base.budgetAmount)))
  ) {
    delete base.budgetAmount;
  }

  return base;
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
): { id: RequiredFieldId; question: string } | null {
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

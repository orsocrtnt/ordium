/**
 * Extraction « planning » (montant / fréquence / fenêtre) depuis du français naturel.
 * Partagé chat client + interprétation stratégie (Gemini/lexical).
 * Ne déduit JAMAIS un montant / une période absents du texte.
 */

export type ScheduleHints = {
  budgetAmount?: number;
  currency?: string;
  period?: "weekly" | "monthly";
  windowFrom?: number;
  windowTo?: number;
  /** Ajustement du montant investi selon le régime (explicite dans le texte). */
  regimeEnabled?: boolean;
  bullMult?: number;
  bearMult?: number;
  /**
   * Indice / actif pour juger haussier-baissier.
   * Absent = laisser le défaut produit (MSCI World).
   * "" = plus gros poids de l'allocation (choix explicite).
   */
  regimeReferenceAsset?: string;
  /** Horizon de backtest (ou date de début libre → custom). */
  horizon?: "1y" | "3y" | "since_first_buy" | "custom";
  /** Date de début YYYY-MM-DD si fournie explicitement. */
  from?: string;
};

/** Champs planning : uniquement texte utilisateur ou brouillon déjà confirmé. */
export const SCHEDULE_PATCH_KEYS = [
  "budgetAmount",
  "currency",
  "period",
  "windowFrom",
  "windowTo",
] as const;

export function stripScheduleFields<T extends Record<string, unknown>>(patch: T): T {
  const out = { ...patch };
  for (const k of SCHEDULE_PATCH_KEYS) delete out[k];
  return out;
}

/** Normalise FR SMS / abréviations courantes avant parsing. */
export function normalizeFrChat(text: string): string {
  let t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’]/g, " ")
    .replace(/€/g, " eur ")
    .replace(/\$/g, " usd ");

  const replacements: [RegExp, string][] = [
    [/\btt\b/g, "toutes"],
    [/\bttes\b/g, "toutes"],
    [/\btjs\b/g, "toujours"],
    [/\btd\b/g, "tout"],
    [/\bds\b/g, "dans"],
    [/\bpr\b/g, "pour"],
    [/\bpq\b/g, "pourquoi"],
    [/\bpcq\b|\bpce\s*que\b|\bparce\s*que\b/g, "parce que"],
    [/\bcad\b|\bc[- ]?a[- ]?d\b/g, "cest a dire"],
    [/\bmnt\b/g, "maintenant"],
    [/\bbcp\b/g, "beaucoup"],
    [/\bstp\b|\bsvp\b/g, ""],
    [/\bjr\b/g, "jour"],
    [/\bjrs\b/g, "jours"],
    [/\bms\b/g, "mais"],
    [/\bvs\b/g, "vous"],
    [/\bca\b/g, "ca"],
    [/\bchaq\b/g, "chaque"],
    [/\bmensuelle?s?\b/g, "mensuel"],
    [/\bhebdomadaires?\b/g, "hebdomadaire"],
  ];
  for (const [re, to] of replacements) t = t.replace(re, to);

  return t.replace(/\s+/g, " ").trim();
}

function clampWindow(from: number, to: number): { windowFrom: number; windowTo: number } | null {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  if (from > to) [from, to] = [to, from];
  return {
    windowFrom: Math.max(1, Math.min(28, Math.round(from))),
    windowTo: Math.max(1, Math.min(28, Math.round(to))),
  };
}

function extractPeriod(t: string): "weekly" | "monthly" | null {
  if (
    /\b(toutes?\s+les\s+semaines?|chaque\s+semaines?|par\s+semaines?|\/\s*semaines?)\b/.test(t) ||
    /\b(hebdo|hebdomadaire|weekly|semainier)\b/.test(t) ||
    /\b(une?\s+fois\s+par\s+semaine|1\s*x?\s*par\s+semaine)\b/.test(t) ||
    /\b(ca|que\s+ca|que\s+ce)\s+(soit|soit)\s+.{0,20}\bsemaine/.test(t) ||
    /\b(je\s+veux|je\s+prefere|plutot|fais|faire|en)\s+.{0,25}\bsemaine/.test(t) ||
    /^(semaine|hebdo)$/.test(t)
  ) {
    return "weekly";
  }

  if (
    /\b(toutes?\s+les\s+mois|tous\s+les\s+mois|chaque\s+mois|par\s+mois|\/\s*mois)\b/.test(t) ||
    /\b(mensuel|monthly|mensualite)\b/.test(t) ||
    /\b(une?\s+fois\s+par\s+mois|1\s*x?\s*par\s+mois)\b/.test(t) ||
    /\b(ca|que\s+ca|que\s+ce)\s+soit\s+.{0,30}\bmois\b/.test(t) ||
    /\b(je\s+veux|je\s+prefere|plutot|fais|faire|en)\s+.{0,30}\bmois\b/.test(t) ||
    /\bau\s+mois\b/.test(t) ||
    /\ben\s+mensuel\b/.test(t) ||
    /^(mois|mensuel)$/.test(t) ||
    /\bsoit\s+tous\s+les\s+mois\b/.test(t) ||
    /\bsoit\s+toutes\s+les\s+mois\b/.test(t)
  ) {
    return "monthly";
  }

  return null;
}

/** True si le nombre à l’index est un % (ex. +15%, -15 %). */
function isPercentNumber(t: string, index: number, len: number): boolean {
  const after = t.slice(index + len, index + len + 8);
  return /^\s*%/.test(after);
}

/**
 * Années calendaires « typiques » de date de début (2010–2039).
 * Pas 1990–2100 : un budget nu « 2000 » doit rester valide.
 */
export function isLikelyCalendarYear(n: number): boolean {
  return Number.isInteger(n) && n >= 2010 && n <= 2039;
}

/**
 * True si le match numérique fait partie d’une date
 * (2024-03-15, 15/03/2024, 15.03.2024, mars 2024).
 */
function isInsideDateToken(t: string, index: number, len: number): boolean {
  const before = t.slice(Math.max(0, index - 16), index);
  const after = t.slice(index + len, index + len + 16);
  const token = t.slice(index, index + len);

  // ISO 2024-03-15 ou fragment
  if (/^\d{4}$/.test(token) && /^[-/.]\d{1,2}/.test(after)) return true;
  if (/^\d{1,2}$/.test(token) && (/^[-/.]\d{1,2}[-/.]\d{2,4}/.test(after) || /[-/.]\d{1,2}[-/.]\d{2,4}$/.test(before + token))) {
    return true;
  }
  // 15/03/2024 — le 2024
  if (/^\d{4}$/.test(token) && /\d{1,2}[-/.]\d{1,2}[-/.]$/.test(before)) return true;
  // mois nommé + année
  if (
    /^\d{4}$/.test(token) &&
    /(janvier|janv|fevrier|fev|mars|avril|avr|mai|juin|juillet|juil|aout|septembre|sept|octobre|oct|novembre|nov|decembre|dec)\s*$/.test(
      before,
    )
  ) {
    return true;
  }
  // « depuis 2024 », « en 2024 », « a partir de 2024 »
  if (
    /^\d{4}$/.test(token) &&
    /\b(depuis|debut|a partir(?:\s+de)?|en|annee|année|year)\s*$/.test(before)
  ) {
    return true;
  }
  return false;
}

function canBeBudgetAmount(n: number, opts?: { allowYearLike?: boolean }): boolean {
  if (!Number.isFinite(n) || n <= 0 || n >= 1_000_000) return false;
  // « 2024 » seul = année, pas un montant (sauf devise explicite).
  if (!opts?.allowYearLike && isLikelyCalendarYear(n)) return false;
  return true;
}

function extractBudget(
  t: string,
  raw: string,
  defaultCurrency: string,
  loose: boolean,
): { budgetAmount: number; currency: string } | null {
  const withCur = t.match(/(\d+(?:[.,]\d+)?)\s*(eur|euros|usd|dollars?)/);
  if (withCur && withCur.index != null && !isPercentNumber(t, withCur.index, withCur[1]!.length)) {
    const amount = Number(withCur[1]!.replace(",", "."));
    // Devise explicite : on accepte même 2024 € (cas limite), mais pas une année seule.
    if (canBeBudgetAmount(amount, { allowYearLike: true }) && amount < 500_000) {
      return {
        budgetAmount: amount,
        currency: /usd|dollar/.test(withCur[2]!) ? "USD" : "EUR",
      };
    }
  }

  // Pas de « de » seul — trop gourmand (« de hausse », etc.)
  const withVerb = t.match(
    /\b(?:budget|investirai|investir|mets?|mettre|alloue|allouer|place|placer|verse|verser|veux|veut|voudrais|souhaite|environ|genre|style|disons|mettons)\b\D{0,28}(\d+(?:[.,]\d+)?)/,
  );
  if (withVerb && withVerb.index != null) {
    const num = withVerb[1]!;
    const numIdx = t.indexOf(num, withVerb.index);
    if (
      numIdx >= 0 &&
      !isPercentNumber(t, numIdx, num.length) &&
      !isInsideDateToken(t, numIdx, num.length)
    ) {
      const amount = Number(num.replace(",", "."));
      if (canBeBudgetAmount(amount)) {
        return { budgetAmount: amount, currency: defaultCurrency };
      }
    }
  }

  const withPeriod = t.match(/(\d+(?:[.,]\d+)?)\s*(?:par|\/|chaque)\s*(?:mois|semaine)/);
  if (
    withPeriod &&
    withPeriod.index != null &&
    !isPercentNumber(t, withPeriod.index, withPeriod[1]!.length) &&
    !isInsideDateToken(t, withPeriod.index, withPeriod[1]!.length)
  ) {
    const amount = Number(withPeriod[1]!.replace(",", "."));
    if (canBeBudgetAmount(amount)) {
      return { budgetAmount: amount, currency: defaultCurrency };
    }
  }

  // Réponse nue « 200 » — mais pas « 2024 » (année).
  if (/^\s*\d+(?:[.,]\d+)?\s*$/.test(raw.trim())) {
    const amount = Number(raw.trim().replace(",", "."));
    if (canBeBudgetAmount(amount)) {
      return { budgetAmount: amount, currency: defaultCurrency };
    }
  }

  if (loose) {
    const nums = [...t.matchAll(/\d+(?:[.,]\d+)?/g)]
      .filter(
        (m) =>
          m.index != null &&
          !isPercentNumber(t, m.index, m[0]!.length) &&
          !isInsideDateToken(t, m.index, m[0]!.length),
      )
      .map((m) => Number(m[0]!.replace(",", ".")))
      .filter((n) => canBeBudgetAmount(n) && n >= 10 && n < 100_000);
    if (nums.length > 0) {
      // Préfère un montant « typique » DCA (< 10k) plutôt que le max absolu.
      const typical = nums.filter((n) => n <= 10_000);
      const pool = typical.length > 0 ? typical : nums;
      return { budgetAmount: Math.max(...pool), currency: defaultCurrency };
    }
  }

  return null;
}

function extractWindow(t: string): { windowFrom: number; windowTo: number } | null {
  if (/\b(debut\s+(de\s+)?mois|premiere?\s+semaine|premiers?\s+jours?|en\s+debut)\b/.test(t)) {
    return { windowFrom: 1, windowTo: 7 };
  }
  if (/\b(milieu\s+(de\s+)?mois|mi[- ]?mois)\b/.test(t)) {
    return { windowFrom: 10, windowTo: 20 };
  }
  if (/\b(fin\s+(de\s+)?mois|derniers?\s+jours?)\b/.test(t)) {
    return { windowFrom: 22, windowTo: 28 };
  }

  const ordinals: Record<string, number> = {
    premier: 1,
    premiere: 1,
    deuxieme: 2,
    second: 2,
    seconde: 2,
    troisieme: 3,
    quatrieme: 4,
    cinquieme: 5,
    sixieme: 6,
    septieme: 7,
    huitieme: 8,
    neuvieme: 9,
    dixieme: 10,
  };
  const ordMatch = t.match(
    /(?:du|de|entre)\s+(?:le\s+)?(premier|premiere|deuxieme|second|seconde|troisieme|quatrieme|cinquieme|sixieme|septieme)\s+(?:au|a|et)\s+(?:le\s+)?(premier|premiere|deuxieme|second|seconde|troisieme|quatrieme|cinquieme|sixieme|septieme|\d{1,2})/,
  );
  if (ordMatch) {
    const from = ordinals[ordMatch[1]!] ?? Number(ordMatch[1]);
    const to = ordinals[ordMatch[2]!] ?? Number(ordMatch[2]);
    return clampWindow(from, to);
  }

  const patterns = [
    /(?:du|de|entre)\s*(?:le\s*)?(\d{1,2})(?:er|e|eme)?\s*(?:au|a|et|jusqu.?a|-|–)\s*(?:le\s*)?(\d{1,2})/,
    /jours?\s*(\d{1,2})\s*(?:-|–|a|au|et)\s*(\d{1,2})/,
    /\b(\d{1,2})\s*(?:-|–|\/)\s*(\d{1,2})\b/,
    /\b(\d{1,2})\s+a\s+(\d{1,2})\b/,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) return clampWindow(Number(m[1]), Number(m[2]));
  }

  const firstN = t.match(/(?:les?\s+)?(\d{1,2})\s+premiers?\s+jours?/);
  if (firstN) {
    const n = Number(firstN[1]);
    if (n >= 1 && n <= 28) return { windowFrom: 1, windowTo: n };
  }

  return null;
}

/**
 * « +15% en baisse » → bearMult 1.15 ; « -15% en hausse » → bullMult 0.85
 * Ajustement du montant investi — pas des paliers de drawdown inventés.
 */
export function extractRegimeHints(text: string): Pick<
  ScheduleHints,
  "regimeEnabled" | "bullMult" | "bearMult" | "regimeReferenceAsset"
> | null {
  const t = normalizeFrChat(text);
  let bearMult: number | undefined;
  let bullMult: number | undefined;
  let regimeReferenceAsset: string | undefined;

  // Indice de référence explicite (sinon défaut produit = MSCI World / IWDA.AS).
  if (
    /\b(reference|indice\s+de\s+ref|benchmark)\b.{0,40}\b(plus\s+gros|allocation|portefeuille|holding)\b/.test(
      t,
    ) ||
    /\b(plus\s+gros\s+(titre|actif|poids)|selon\s+(mon\s+)?allocation)\b/.test(t)
  ) {
    regimeReferenceAsset = "";
  } else if (
    /\b(msci\s*world|iwda(\.as)?)\b/.test(t) &&
    /\b(reference|indice|benchmark|vs|contre)\b/.test(t)
  ) {
    regimeReferenceAsset = "IWDA.AS";
  } else if (
    /\b(s\s*&\s*p\s*500|sp\s*500|s\s*p\s*500|cspx|spy)\b/.test(t) &&
    /\b(reference|indice|benchmark|vs|contre)\b/.test(t)
  ) {
    regimeReferenceAsset = "CSPX.L";
  } else {
    const m = t.match(
      /\b(?:reference|indice\s+de\s+ref|benchmark)\s*[:=]?\s*([a-z0-9][a-z0-9._-]{0,11})\b/,
    );
    const raw = m?.[1]?.toUpperCase();
    if (raw && !["S", "P", "LE", "LA", "UN", "UNE", "SUR", "MON"].includes(raw)) {
      if (raw === "IWDA" || raw === "IWDA.AS") regimeReferenceAsset = "IWDA.AS";
      else if (raw === "CSPX" || raw === "CSPX.L" || raw === "SPY") regimeReferenceAsset = "CSPX.L";
      else regimeReferenceAsset = raw;
    }
  }

  const comboDown = t.match(/\+\s*(\d+(?:[.,]\d+)?)\s*%[^%]{0,40}\bbaisse/);
  const comboUp = t.match(/-\s*(\d+(?:[.,]\d+)?)\s*%[^%]{0,40}\bhausse/);
  if (comboDown) {
    const pct = Number(comboDown[1]!.replace(",", "."));
    if (Number.isFinite(pct)) bearMult = 1 + pct / 100;
  }
  if (comboUp) {
    const pct = Number(comboUp[1]!.replace(",", "."));
    if (Number.isFinite(pct)) bullMult = Math.max(0, 1 - pct / 100);
  }

  if (bearMult == null) {
    const downPlus = t.match(/(?:\+|plus\s+)(\d+(?:[.,]\d+)?)\s*%\s*(?:en\s+|a\s+la\s+)?baisse/);
    const downMoins = t.match(/(?:-|moins\s+)(\d+(?:[.,]\d+)?)\s*%\s*(?:en\s+|a\s+la\s+)?baisse/);
    if (downPlus) {
      const pct = Number(downPlus[1]!.replace(",", "."));
      if (Number.isFinite(pct)) bearMult = 1 + pct / 100;
    } else if (downMoins) {
      const pct = Number(downMoins[1]!.replace(",", "."));
      if (Number.isFinite(pct)) bearMult = Math.max(0, 1 - pct / 100);
    }
  }

  if (bullMult == null) {
    const upMoins = t.match(/(?:-|moins\s+)(\d+(?:[.,]\d+)?)\s*%\s*(?:en\s+|a\s+la\s+)?hausse/);
    if (upMoins) {
      const pct = Number(upMoins[1]!.replace(",", "."));
      if (Number.isFinite(pct)) bullMult = Math.max(0, 1 - pct / 100);
    }
  }

  if (bearMult == null && bullMult == null && regimeReferenceAsset === undefined) return null;
  return {
    regimeEnabled: true,
    ...(bearMult != null ? { bearMult: Math.round(bearMult * 1000) / 1000 } : {}),
    ...(bullMult != null ? { bullMult: Math.round(bullMult * 1000) / 1000 } : {}),
    ...(regimeReferenceAsset !== undefined ? { regimeReferenceAsset } : {}),
  };
}

/** « 1 an », « 3 ans », « depuis mon premier achat ». */
export function extractHorizonHint(
  text: string,
): "1y" | "3y" | "since_first_buy" | null {
  const t = normalizeFrChat(text);
  if (
    /\b(depuis\s+(mon\s+)?(premier|1er)\s+achat|depuis\s+le\s+debut|depuis\s+mes\s+achats|first\s+buy|depuis\s+que\s+j)\b/.test(
      t,
    )
  ) {
    return "since_first_buy";
  }
  if (/\b(3\s*ans?|trois\s+ans|36\s*mois)\b/.test(t)) return "3y";
  if (/\b(1\s*an|un\s+an|12\s*mois|une\s+annee)\b/.test(t)) return "1y";
  if (/^(1y|3y|since_first_buy)$/.test(t)) return t as "1y" | "3y" | "since_first_buy";
  return null;
}

const FR_MONTHS: Record<string, number> = {
  janvier: 1,
  janv: 1,
  fevrier: 2,
  fev: 2,
  mars: 3,
  avril: 4,
  avr: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  juil: 7,
  aout: 8,
  septembre: 9,
  sept: 9,
  octobre: 10,
  oct: 10,
  novembre: 11,
  nov: 11,
  decembre: 12,
  dec: 12,
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function validIsoDate(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${pad2(m)}-${pad2(d)}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return null;
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== m || dt.getUTCDate() !== d) {
    return null;
  }
  const yesterday = yesterdayIso();
  if (iso > yesterday) return null;
  return iso;
}

/**
 * Date de début explicite : 2023-03-15, 15/03/2023, « 15 mars 2023 », « mars 2023 ».
 * Une année nue (« 2024 ») n’est acceptée que si `opts.bareYear` (réponse au champ date).
 */
export function extractStartDateHint(
  text: string,
  opts: { bareYear?: boolean } = {},
): string | null {
  const raw = text.trim();
  const t = normalizeFrChat(text);

  const iso = raw.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const d = validIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (d) return d;
  }

  const slash = t.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2})\b/);
  if (slash) {
    const d = validIsoDate(Number(slash[3]), Number(slash[2]), Number(slash[1]));
    if (d) return d;
  }

  const named = t.match(
    /\b(?:depuis|a partir(?:\s+de)?|debut|du|le)?\s*(\d{1,2})?\s*(janvier|janv|fevrier|fev|mars|avril|avr|mai|juin|juillet|juil|aout|septembre|sept|octobre|oct|novembre|nov|decembre|dec)\s+(20\d{2})\b/,
  );
  if (named) {
    const day = named[1] ? Number(named[1]) : 1;
    const month = FR_MONTHS[named[2]!];
    const year = Number(named[3]);
    if (month) {
      const d = validIsoDate(year, month, day);
      if (d) return d;
    }
  }

  // « depuis 2024 », « en 2024 » — jamais une année nue hors contexte date.
  const yearPrefixed = t.match(/^(?:depuis|a partir(?:\s+de)?|debut|en)\s+(20\d{2})$/);
  if (yearPrefixed) {
    const d = validIsoDate(Number(yearPrefixed[1]), 1, 1);
    if (d) return d;
  }

  if (opts.bareYear) {
    const yearOnly = t.match(/^(20\d{2})$/);
    if (yearOnly) {
      const d = validIsoDate(Number(yearOnly[1]), 1, 1);
      if (d) return d;
    }
  }

  return null;
}

function monthsAgoIso(months: number): string {
  const d = new Date(Date.now() - 86_400_000);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

function yesterdayIso(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

/** Horizon → bornes de backtest. */
export function horizonToDates(
  horizon: "1y" | "3y" | "since_first_buy" | "custom",
  firstTransactionDate?: string | null,
  customFrom?: string | null,
): { from: string; to: string } {
  const to = yesterdayIso();
  if (horizon === "custom" && customFrom) {
    return { from: customFrom.slice(0, 10), to };
  }
  if (horizon === "1y") return { from: monthsAgoIso(12), to };
  if (horizon === "3y") return { from: monthsAgoIso(36), to };
  return { from: firstTransactionDate?.slice(0, 10) || monthsAgoIso(12), to };
}

/**
 * Extrait planning depuis une phrase FR (éventuellement SMS).
 * `looseBudget` : en réponse à « quel montant ? », plus permissif.
 * Les années / dates ne sont JAMAIS confondues avec un budget.
 */
export function extractScheduleHints(
  text: string,
  opts: { defaultCurrency?: string; looseBudget?: boolean } = {},
): ScheduleHints {
  const defaultCurrency = (opts.defaultCurrency ?? "EUR").toUpperCase();
  const t = normalizeFrChat(text);
  const out: ScheduleHints = {};

  // 1) Date / horizon d’abord — pour exclure ces chiffres du budget.
  const horizon = extractHorizonHint(text);
  if (horizon) out.horizon = horizon;

  const from = extractStartDateHint(text);
  if (from) {
    out.from = from;
    if (!out.horizon) out.horizon = "custom";
  }

  const period = extractPeriod(t);
  if (period) out.period = period;

  const window = extractWindow(t);
  if (window) Object.assign(out, window);

  const regime = extractRegimeHints(text);
  if (regime) Object.assign(out, regime);

  // 2) Budget ensuite — ignore si le message est surtout une date.
  const dateOnly =
    Boolean(from) &&
    !/\b(budget|investir|mets?|mettre|euros?|eur|usd|dollars?|par\s+mois|par\s+semaine)\b/.test(t) &&
    !/\d+(?:[.,]\d+)?\s*(eur|euros|usd)/.test(t);
  if (!dateOnly) {
    const budget = extractBudget(t, text, defaultCurrency, Boolean(opts.looseBudget));
    if (budget) {
      // Garde-fou : budget == année de la date de début → confusion date/montant.
      if (
        from &&
        isLikelyCalendarYear(budget.budgetAmount) &&
        from.startsWith(String(Math.trunc(budget.budgetAmount)))
      ) {
        // ignore — confusion date de début / montant
      } else {
        Object.assign(out, budget);
      }
    }
  }

  return out;
}

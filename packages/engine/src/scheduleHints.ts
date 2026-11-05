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
  /**
   * Montant unique + plusieurs actifs : « au total » vs « par actif ».
   * Absent = pas encore clarifié (ou non applicable).
   */
  budgetSplit?: "total" | "per_asset";
  /** Montant cité avant ×n actifs (pour la question de clarification). */
  budgetQuotedAmount?: number;
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
  /** Fin de fenêtre → budget neutre (×1). */
  fallbackNeutral?: boolean;
  /** Horizon de backtest (ou date de début libre → custom). */
  horizon?: "1y" | "3y" | "since_first_buy" | "custom";
  /** Date de début YYYY-MM-DD si fournie explicitement. */
  from?: string;
  /** Allocation extraite du texte (ex. 50 BTC / 50 ETH / 50 SOL). */
  allocation?: { asset: string; pct: number }[];
  /** replace = nouvelle liste ; add = union avec le brouillon (« ajoute Amazon »). */
  allocationMode?: "replace" | "add";
  /**
   * Politique crypto / actions quand les signaux (F&G…) ne collent pas au mix.
   * mixed_ok = garder le mix (signaux globaux) ; crypto_only / equity_only = filtrer.
   */
  assetClassPolicy?: "mixed_ok" | "crypto_only" | "equity_only";
  /** Fear & Greed ≤ valeur, si mentionné (gate d’achat). */
  fearGreedEnabled?: boolean;
  fearGreedValue?: number;
  /** Modulation budget selon F&G (×low / ×1 / ×high). */
  fearGreedScaleEnabled?: boolean;
  fearGreedLowLte?: number;
  fearGreedLowFactor?: number;
  fearGreedHighGte?: number;
  fearGreedHighFactor?: number;
  /** Pas de rattrapage sans signal. */
  requireSignal?: boolean;
  rsiEnabled?: boolean;
  rsiValue?: number;
  rsiScaleEnabled?: boolean;
  rsiLowLte?: number;
  rsiLowFactor?: number;
  rsiHighGte?: number;
  rsiHighFactor?: number;
  dipEnabled?: boolean;
  dipPct?: number;
  dipScaleEnabled?: boolean;
  dipDeepGte?: number;
  dipDeepFactor?: number;
  dipCalmLt?: number;
  dipCalmFactor?: number;
  macdEnabled?: boolean;
  macdScaleEnabled?: boolean;
  macdPosFactor?: number;
  macdNegFactor?: number;
  bollingerEnabled?: boolean;
  bollingerPctB?: number;
  bollingerScaleEnabled?: boolean;
  bollingerLowLte?: number;
  bollingerLowFactor?: number;
  bollingerHighGte?: number;
  bollingerHighFactor?: number;
  smaBuyEnabled?: boolean;
  smaScaleEnabled?: boolean;
  smaBelowFactor?: number;
  smaAboveFactor?: number;
};

/** Champs planning : uniquement texte utilisateur ou brouillon déjà confirmé. */
export const SCHEDULE_PATCH_KEYS = [
  "budgetAmount",
  "currency",
  "period",
  "windowFrom",
  "windowTo",
  "budgetSplit",
  "budgetQuotedAmount",
] as const;

/**
 * Seuils d’indicateurs : Gemini / presets ne doivent pas les inventer ni les
 * ramener au défaut (ex. fear 35) quand le brouillon a déjà 40.
 */
export const SIGNAL_THRESHOLD_PATCH_KEYS = [
  "fearGreedEnabled",
  "fearGreedValue",
  "fearGreedScaleEnabled",
  "fearGreedLowLte",
  "fearGreedLowFactor",
  "fearGreedHighGte",
  "fearGreedHighFactor",
  "requireSignal",
  "rsiEnabled",
  "rsiValue",
  "rsiScaleEnabled",
  "rsiLowLte",
  "rsiLowFactor",
  "rsiHighGte",
  "rsiHighFactor",
] as const;

export function stripScheduleFields<T extends Record<string, unknown>>(patch: T): T {
  const out = { ...patch };
  for (const k of SCHEDULE_PATCH_KEYS) delete out[k];
  return out;
}

export function stripSignalThresholdFields<T extends Record<string, unknown>>(patch: T): T {
  const out = { ...patch };
  for (const k of SIGNAL_THRESHOLD_PATCH_KEYS) delete out[k];
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
    // Typos fenêtre : « 1 u 7 », « 1 a 7 » → « 1 au 7 »
    [/\b(\d{1,2})\s+u\s+(\d{1,2})\b/g, "$1 au $2"],
    // « tout les mois » (très fréquent) → « tous les mois »
    [/\btout\s+les\s+mois\b/g, "tous les mois"],
    [/\btoute\s+les\s+semaines?\b/g, "toutes les semaines"],
    [/\btout\s+les\s+semaines?\b/g, "toutes les semaines"],
  ];
  for (const [re, to] of replacements) t = t.replace(re, to);

  return t.replace(/\s+/g, " ").trim();
}

/** Fenêtre mensuelle : 1–31 (le calendrier clampera au dernier jour du mois). */
const MONTH_DAY_MAX = 31;

function clampWindow(from: number, to: number): { windowFrom: number; windowTo: number } | null {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  if (from > to) [from, to] = [to, from];
  return {
    windowFrom: Math.max(1, Math.min(MONTH_DAY_MAX, Math.round(from))),
    windowTo: Math.max(1, Math.min(MONTH_DAY_MAX, Math.round(to))),
  };
}

/** « le 29 du mois » / « jour 29 » — ce chiffre n’est pas un budget. */
function isDayOfMonthContext(t: string, index: number, len: number): boolean {
  const n = Number(t.slice(index, index + len).replace(",", "."));
  // Un budget typique (50, 200, 500…) n’est jamais un jour du mois.
  if (!Number.isInteger(n) || n < 1 || n > MONTH_DAY_MAX) return false;

  const before = t.slice(Math.max(0, index - 28), index);
  const after = t.slice(index + len, index + len + 20);

  // « 5 du mois », « 5e du mois », « 1er du mois » — adjacent, pas « 200 … 5 du mois ».
  if (/^(?:er|e)?(?:\s+jour)?\s+du\s+mois\b/.test(after)) return true;

  // « le 5 », « jour 15 », « chaque 1er », « tous/toutes les 5 »
  if (
    /\b(?:le|jour|chaque|tous\s+les|toutes\s+les)\s*$/.test(before) &&
    /^(?:er|e)?(?:\s+du\s+mois)?\b/.test(after)
  ) {
    return true;
  }

  // « du 1 au 7 », « 1 au 7 », « au 7 sur BTC » — borne de fenêtre ≠ budget
  if (/\b(?:du|de|entre|au|a)\s*(?:le\s*)?$/.test(before) && n <= MONTH_DAY_MAX) {
    if (
      /^(?:er|e)?\s*(?:au|a|et|-|–|\/)\s*(?:le\s*)?\d{1,2}\b/.test(after) ||
      /\b(?:du|de|entre)\s*(?:le\s*)?\d{1,2}\b/.test(before) ||
      /^(?:er|e)?\s+sur\b/.test(after)
    ) {
      return true;
    }
  }

  // « acheter le 29 » … avec « mois » tout près
  if (
    /\b(?:acheter|achete|investir|investirai|mets?|mettre|place)\s+(?:le\s+)?$/.test(before) &&
    /^(?:er|e)?\b/.test(after) &&
    /\bmois\b/.test(after)
  ) {
    return true;
  }
  return false;
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

  // Jour du mois = cadence mensuelle (« tt les 5 du mois », « le 15 du mois », « chaque 1er »).
  if (
    /\b(?:tous|toutes)\s+les\s+(?:le\s+)?(?:\d{1,2}|1er|premier)(?:er|e)?(?:\s+du\s+mois)?\b/.test(
      t,
    ) ||
    /\b(?:le\s+|jour\s+)?(?:\d{1,2}|1er|premier)(?:er|e)?(?:\s+jour)?\s+du\s+mois\b/.test(t) ||
    /\bchaque\s+(?:le\s+)?(?:\d{1,2}|1er|premier)(?:er|e)?\b/.test(t)
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

const CRYPTO_TICKERS =
  "btc|eth|sol|bnb|xrp|ada|doge|avax|dot|link|matic|pol|uni|ltc|atom|near|apt|arb|op|sui|pepe|shib|trx|ton|bch|xlm";

/** Tickers actions / ETF courants (chat FR). */
const EQUITY_TICKERS =
  "amzn|tsla|aapl|googl|goog|msft|meta|nvda|nflx|amd|intc|spy|qqq|iwm|dia|voo|vti|arkk|coin|pltr|uber|abnb|shop|sq|crm|orcl|ibm|dis|ba|jpm|v|ma|ko|pep|wmt|cost|nke|mcd";

/**
 * Noms / alias → ticker (après normalizeFrChat : sans accents, lower).
 * Les alias multi-mots doivent être testés avant les mono-mots.
 */
const ASSET_ALIASES: [string, string][] = [
  ["amazon", "AMZN"],
  ["tesla", "TSLA"],
  ["apple", "AAPL"],
  ["google", "GOOGL"],
  ["alphabet", "GOOGL"],
  ["microsoft", "MSFT"],
  ["facebook", "META"],
  ["nvidia", "NVDA"],
  ["netflix", "NFLX"],
  ["bitcoin", "BTC"],
  ["ethereum", "ETH"],
  ["solana", "SOL"],
];

const ASSET_TOKEN_RE = new RegExp(
  `\\b(?:${CRYPTO_TICKERS}|${EQUITY_TICKERS}|${ASSET_ALIASES.map(([a]) => a).join("|")})\\b`,
  "gi",
);

function resolveAssetToken(raw: string): string {
  const k = raw.toLowerCase();
  for (const [alias, ticker] of ASSET_ALIASES) {
    if (alias === k) return ticker;
  }
  return raw.toUpperCase();
}

const CRYPTO_SET = new Set(
  CRYPTO_TICKERS.split("|").map((s) => s.toUpperCase()),
);
const EQUITY_SET = new Set(
  EQUITY_TICKERS.split("|").map((s) => s.toUpperCase()),
);

export type AssetClass = "crypto" | "equity" | "unknown";

export function classifyAsset(ticker: string): AssetClass {
  const u = ticker.trim().toUpperCase();
  if (!u) return "unknown";
  if (CRYPTO_SET.has(u)) return "crypto";
  if (EQUITY_SET.has(u)) return "equity";
  // Suffixes crypto courants
  if (/-(USD|USDT|USDC|EUR)$/.test(u) || /USDT$|USDC$/.test(u)) return "crypto";
  return "unknown";
}

export function partitionAllocationByClass(
  allocation: { asset: string; pct?: number }[] | undefined | null,
): { crypto: string[]; equity: string[]; unknown: string[] } {
  const crypto: string[] = [];
  const equity: string[] = [];
  const unknown: string[] = [];
  for (const row of allocation ?? []) {
    const a = row.asset?.toUpperCase();
    if (!a) continue;
    const c = classifyAsset(a);
    if (c === "crypto") crypto.push(a);
    else if (c === "equity") equity.push(a);
    else unknown.push(a);
  }
  return { crypto, equity, unknown };
}

function equalAllocation(assets: string[]): { asset: string; pct: number }[] {
  if (assets.length === 0) return [];
  const each = Math.round((100 / assets.length) * 10) / 10;
  return assets.map((asset, i) => ({
    asset,
    pct: i === assets.length - 1 ? Math.round((100 - each * (assets.length - 1)) * 10) / 10 : each,
  }));
}

/** Union d’allocations (tickers uniques) puis parts égales. */
export function unionEqualAllocation(
  previous: { asset: string; pct: number }[] | undefined,
  added: { asset: string; pct: number }[] | undefined,
): { asset: string; pct: number }[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const row of [...(previous ?? []), ...(added ?? [])]) {
    const a = row.asset?.toUpperCase();
    if (!a || seen.has(a)) continue;
    seen.add(a);
    ordered.push(a);
  }
  return equalAllocation(ordered);
}

/**
 * Mention d’un actif dans une phrase de signal (RSI/SMA…) — pas une nouvelle allocation.
 * Ex. « je veux le RSI pour Amazon » ne doit PAS → AMZN 100 %.
 * Ne pas déclencher sur Fear & Greed + multi cryptos (« 200 sur BTC ETH SOL + fear »).
 */
export function isSignalScopedAssetMention(text: string): boolean {
  const t = normalizeFrChat(text);
  if (/\b(ajoute|ajouter|rajoute|rajouter|inclus)\b/.test(t)) return false;
  if (/\b(mets?\s+aussi|mettre\s+aussi|et\s+aussi)\b/.test(t)) return false;
  if (/^\s*et\s+[a-z0-9.]{2,}\s*$/.test(t)) return false;
  // Signaux « par actif » demandés explicitement — pas F&G seul (souvent global + allocation).
  if (!/\b(rsi|sma|macd|bollinger)\b/.test(t)) return false;

  const assets = collectAssetsFromText(text);
  if (assets.length === 0) return false;
  // Liste multi-actifs avec budget/calendrier = allocation, même si RSI est cité.
  if (
    assets.length >= 2 &&
    /\b(\d+|sur|mettre|mets|investir|tt|tous|toutes|mois|semaine)\b/.test(t)
  ) {
    return false;
  }
  return true;
}

/** Collecte les actifs cités (crypto + actions + noms). */
export function collectAssetsFromText(text: string): string[] {
  const t = normalizeFrChat(text);
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const m of t.matchAll(ASSET_TOKEN_RE)) {
    const sym = resolveAssetToken(m[0]!);
    if (seen.has(sym)) continue;
    seen.add(sym);
    ordered.push(sym);
  }
  return ordered;
}

/** « 01/01 » dans « 01/01/2025 » ou « 2025/01/01 » ne doit pas devenir une fenêtre. */
function isPartOfCalendarDate(t: string, index: number, length: number): boolean {
  const before = t.slice(Math.max(0, index - 6), index);
  const after = t.slice(index + length, index + length + 8);
  if (/20\d{2}\s*[/.−-]$/.test(before.trimEnd()) || /20\d{2}$/.test(before.replace(/\s+$/, ""))) {
    return true;
  }
  if (/^[/.−-]\s*20\d{2}\b/.test(after) || /^[/.−-]20\d{2}\b/.test(after)) {
    return true;
  }
  return false;
}

function extractPerAssetAmounts(
  t: string,
): { asset: string; amount: number }[] | null {
  const tokenAlt = `${CRYPTO_TICKERS}|${EQUITY_TICKERS}|${ASSET_ALIASES.map(([a]) => a).join("|")}`;
  const re = new RegExp(
    `(\\d+(?:[.,]\\d+)?)\\s*(?:€|eur|euros|usd|\\$)?\\s*(?:sur|en|de|pour)?\\s*(?:le\\s+|l[''])?(${tokenAlt})\\b`,
    "gi",
  );
  const found: { asset: string; amount: number }[] = [];
  const seen = new Set<string>();
  for (const m of t.matchAll(re)) {
    if (m.index != null && isInsideDateToken(t, m.index, m[1]!.length)) continue;
    const amount = Number(m[1]!.replace(",", "."));
    const asset = resolveAssetToken(m[2]!);
    if (!canBeBudgetAmount(amount) || amount < 1) continue;
    if (seen.has(asset)) continue;
    seen.add(asset);
    found.push({ asset, amount });
  }
  return found.length >= 1 ? found : null;
}

/** « au total » / « par actif » / « on répartit » — clarifie un montant unique multi-actifs. */
export function extractBudgetSplitHint(text: string): "total" | "per_asset" | null {
  const t = normalizeFrChat(text);

  // Négation : « pas chacun », « répartis pas chacun », « non par actif » → total.
  if (
    /\bpas\s+(?:de\s+)?(?:chacun|chacune|par\s+actif|par\s+crypto)\b/.test(t) ||
    /\b(?:non|pas)\s+(?:du\s+)?(?:chacun|chacune)\b/.test(t) ||
    /\breparti\w*\s+(?:\w+\s+){0,3}pas\s+chacun/.test(t)
  ) {
    return "total";
  }

  // Par actif d’abord (plus spécifique) — après les négations.
  if (
    /\b(par\s+actif|par\s+crypto|par\s+titre|chacun|chacune|sur\s+chaque|pour\s+chaque|individuel(?:lement)?)\b/.test(
      t,
    ) ||
    /\b(\d+(?:[.,]\d+)?)\s*(?:€|eur|euros|usd)?\s*(chacun|chacune)\b/.test(t) ||
    /^(chacun|chacune|par\s+actif|par\s+crypto)[\s!.]*$/.test(t)
  ) {
    return "per_asset";
  }

  // Total / répartition (toutes conjugaisons : répartit, répartis, répartir, répartition…).
  if (
    /\b(au\s+total|en\s+tout|en\s+total|global(?:ement)?|ensemble|parts?\s+egales?)\b/.test(t) ||
    /\breparti(?:r|t|s|e|es|on|ons|ez|ent|tion)?\b/.test(t) ||
    /\b(pour\s+les\s+(?:trois|2|3|deux|quatre)|\d+\s+en\s+(?:tt|tout|total))\b/.test(t) ||
    /^(total|au\s+total|en\s+tout|ensemble)[\s!.]*$/.test(t) ||
    /\bon\s+(?:les\s+)?reparti/.test(t)
  ) {
    return "total";
  }

  return null;
}

/** Nombre dans un contexte Fear & Greed / multiplicateur — jamais un budget. */
function isFearGreedOrMultiplierContext(
  t: string,
  index: number,
  numLen: number,
): boolean {
  const before = t.slice(Math.max(0, index - 48), index);
  const after = t.slice(index + numLen, index + numLen + 24);
  if (/\bfear\b|\bgreed\b|\bsentiment\b|\bpeur\b|\bavidite\b/.test(before)) return true;
  if (/^\s*(fois|x|×)/i.test(after)) return true;
  if (/\b(double|moitie|moitié|divis)/.test(before + " " + after)) {
    if (/\bfear\b|\bgreed\b|\bpeur\b|\bsentiment\b/.test(t)) return true;
  }
  return false;
}

/** Seuil RSI / MACD / Bollinger / SMA — jamais un budget. */
function isIndicatorThresholdContext(t: string, index: number, numLen: number): boolean {
  const before = t.slice(Math.max(0, index - 40), index);
  const after = t.slice(index + numLen, index + numLen + 28);
  if (/\b(rsi|macd|bollinger|sma|ema|stoch)\b/.test(before)) return true;
  if (
    /\b(rsi|macd|bollinger)\b/.test(t) &&
    /\b(sous|en\s+dessous|au[- ]dessus|<|>|<=|>=)\s*$/.test(before)
  ) {
    return true;
  }
  // « sous 30 on double » alors que RSI est cité dans la phrase
  if (
    /\brsi\b/.test(t) &&
    /\b(sous|en\s+dessous|<|<=)\s*$/.test(before) &&
    /^\s*(on\s+)?(double|moitie|moitié|fois|x|×)/.test(after)
  ) {
    return true;
  }
  return false;
}

/** Fear & Greed < 35 / en dessous de 35 (gate d’achat simple). */
export function extractFearGreedHint(text: string): number | null {
  const t = normalizeFrChat(text);
  // Scale explicite → pas un simple seuil d’achat.
  if (extractFearGreedScaleHint(text)) return null;
  const m = t.match(
    /(?:fear\s*(?:&|et)?\s*greed|indice\s+de\s+(?:peur|sentiment)|fear\s+and\s+greed)\s*(?:est\s+)?(?:<|<=|inf[eé]rieur(?:e)?|en\s+dessous|sous|below|quand\s+.*?sous)\s*(?:de\s*|a\s*)?(\d{1,3})/,
  );
  if (m) {
    const v = Number(m[1]);
    if (v >= 1 && v <= 100) return v;
  }
  const m2 = t.match(
    /(?:quand\s+)?(?:le\s+)?fear\b.{0,40}?(?:en\s+dessous|sous)\s*(?:de\s*)?(\d{1,3})/,
  );
  if (m2) {
    const v = Number(m2[1]);
    if (v >= 1 && v <= 100) return v;
  }
  return null;
}

/**
 * « si fear < 35 on double, si > 80 on divise par 2 »
 * → modulation du budget (pas un veto).
 */
export function extractFearGreedScaleHint(text: string): {
  low_lte: number;
  low_factor: number;
  high_gte: number;
  high_factor: number;
} | null {
  const t = normalizeFrChat(text);
  if (!/\bfear\b/.test(t) && !/\bgreed\b/.test(t) && !/\bpeur\b/.test(t)) return null;

  const hasScaleIntent =
    /\b(double|doubl|2\s*fois|x\s*2|×\s*2|fois\s+plus|moitie|moitié|0\s*[,.]?\s*5|divis|x\s*0|×\s*0|normalement|entre\s+les\s+deux)\b/.test(
      t,
    );
  if (!hasScaleIntent) return null;

  let low_lte = 35;
  let low_factor = 2;
  let high_gte: number | null = null;
  let high_factor: number | null = null;

  const lowMatch = t.match(
    /(?:fear|greed|peur|indice)[^\d]{0,40}?(?:<|<=|en\s+dessous|sous|inf[eé]rieur(?:e)?(?:\s+a)?)\s*(?:de\s*)?(\d{1,3})/,
  );
  const lowMatch2 = t.match(
    /(?:si|quand)\s+(?:fear|greed|peur)[^\d]{0,20}?(\d{1,3})[^\d]{0,30}?(?:double|doubl|2\s*fois|x\s*2|×\s*2|fois\s+plus)/,
  );
  if (lowMatch) low_lte = Number(lowMatch[1]);
  else if (lowMatch2) low_lte = Number(lowMatch2[1]);

  const lowFactorMatch = t.match(
    /(?:double|doubl|2\s*fois|x\s*2|×\s*2|fois\s+plus)|(?:x|×)\s*(2(?:[.,]0+)?)\b/,
  );
  if (lowFactorMatch) {
    if (lowFactorMatch[1]) low_factor = Number(lowFactorMatch[1].replace(",", "."));
    else low_factor = 2;
  }

  const highMatch = t.match(
    /(?:fear|greed|peur|indice)[^\d]{0,80}?(?:>|>=|au[- ]dessus|superieur(?:e)?(?:\s+a)?)\s*(?:de\s*)?(\d{1,3})/,
  );
  const highMatch2 = t.match(
    /(?:si|quand)\s+(?:fear|greed|peur)[^\d]{0,20}?(\d{1,3})[^\d]{0,40}?(?:moitie|moitié|divis|0\s*[,.]?\s*5|x\s*0|×\s*0)/,
  );
  // « si au dessus de 80 on divise » (fear déjà cité ailleurs dans la phrase)
  const highMatch3 = t.match(
    /\b(?:au[- ]dessus|superieur(?:e)?(?:\s+a)?|>|>=)\s*(?:de\s*)?(\d{1,3})\b/,
  );
  const halfMatch = t.match(
    /(?:moitie|moitié|divis(?:e|er)?\s+par\s+2|0\s*[,.]?\s*5|x\s*0\s*[,.]?\s*5|×\s*0\s*[,.]?\s*5)/,
  );
  const highExplicit = Boolean(highMatch || highMatch2 || (highMatch3 && halfMatch));
  if (highMatch) high_gte = Number(highMatch[1]);
  else if (highMatch2) high_gte = Number(highMatch2[1]);
  else if (highMatch3 && halfMatch) high_gte = Number(highMatch3[1]);

  if (halfMatch && highExplicit) high_factor = 0.5;

  // Haut non dit → neutre (pas d’invention 80 / ×0.5).
  if (high_gte == null || high_factor == null) {
    high_gte = 100;
    high_factor = 1;
  }

  if (!(low_lte >= 1 && low_lte <= 100 && high_gte >= 1 && high_gte <= 100)) return null;
  if (low_lte >= high_gte) {
    // Seuils inversés dans la phrase → garder un bas sensé, haut neutre.
    low_lte = Math.min(low_lte, 35);
    high_gte = 100;
    high_factor = 1;
  }

  return { low_lte, low_factor, high_gte, high_factor };
}

/** « que si », « uniquement si », « seulement si » → require_signal. */
export function extractRequireSignalHint(text: string): boolean {
  const t = normalizeFrChat(text);
  return /\b(que\s+si|uniquement\s+si|seulement\s+si|acheter\s+(?:.*?)\s+si|n.?acheter\s+que\s+si)\b/.test(
    t,
  );
}

/** RSI scale : « si rsi < 30 double, si > 70 moitié ». */
export function extractRsiScaleHint(text: string): {
  low_lte: number;
  low_factor: number;
  high_gte: number;
  high_factor: number;
} | null {
  const t = normalizeFrChat(text);
  if (!/\brsi\b/.test(t)) return null;
  const hasScale =
    /\b(double|doubl|2\s*fois|x\s*2|×\s*2|moitie|moitié|0\s*[,.]?\s*5|divis|normalement)\b/.test(t);
  if (!hasScale) return null;
  let low_lte = 30;
  let low_factor = 2;
  let high_gte: number | null = null;
  let high_factor: number | null = null;
  const low = t.match(/rsi[^\d]{0,20}?(?:<|<=|en\s+dessous|sous)\s*(?:de\s*)?(\d{1,3})/);
  const high = t.match(/rsi[^\d]{0,40}?(?:>|>=|au[- ]dessus|superieur)\s*(?:de\s*)?(\d{1,3})/);
  const high2 = t.match(/\b(?:au[- ]dessus|>|>=)\s*(?:de\s*)?(\d{1,3})\b/);
  if (low) low_lte = Number(low[1]);
  if (high) high_gte = Number(high[1]);
  else if (high2 && /\b(moitie|moitié|divis|haut)\b/.test(t)) high_gte = Number(high2[1]);
  if (/\b(double|2\s*fois|x\s*2)/.test(t)) low_factor = 2;
  if (high_gte != null && /\b(moitie|moitié|divis|0\s*[,.]?\s*5)/.test(t)) high_factor = 0.5;
  // Haut non dit → neutre (pas d’invention 70 / ×0.5).
  if (high_gte == null || high_factor == null) {
    high_gte = 100;
    high_factor = 1;
  }
  if (!(low_lte < high_gte)) return { low_lte: 30, low_factor: 2, high_gte: 100, high_factor: 1 };
  return { low_lte, low_factor, high_gte, high_factor };
}

/** Dip scale : « si baisse 5% on double sinon moitié ». */
export function extractDipScaleHint(text: string): {
  deep_gte: number;
  deep_factor: number;
  calm_lt: number;
  calm_factor: number;
} | null {
  const t = normalizeFrChat(text);
  if (!/\b(dip|baisse|drawdown|chute)\b/.test(t)) return null;
  const hasScale =
    /\b(double|doubl|2\s*fois|x\s*2|moitie|moitié|0\s*[,.]?\s*5|divis|fois\s+plus)\b/.test(t);
  if (!hasScale) return null;
  let deep_gte = 3;
  let deep_factor = 2;
  let calm_lt = 1;
  let calm_factor = 0.5;
  const deep = t.match(
    /(?:baisse|dip|chute|drawdown)[^\d]{0,20}?(?:>=|>|de\s+)?(\d+(?:[.,]\d+)?)\s*%/,
  );
  if (deep) deep_gte = Number(deep[1]!.replace(",", "."));
  if (/\b(double|2\s*fois|x\s*2)/.test(t)) deep_factor = 2;
  if (/\b(moitie|moitié|divis|0\s*[,.]?\s*5)/.test(t)) calm_factor = 0.5;
  return { deep_gte, deep_factor, calm_lt, calm_factor };
}

/** Actifs cités dans le chat → allocation %. */
export function extractAllocationHints(
  text: string,
): { asset: string; pct: number }[] | null {
  const t = normalizeFrChat(text);

  // Signal sur un actif (« RSI pour Amazon ») ≠ nouvelle allocation.
  if (isSignalScopedAssetMention(text)) return null;

  const perAsset = extractPerAssetAmounts(t);
  // Montants explicites sur ≥2 actifs → poids proportionnels.
  if (perAsset && perAsset.length >= 2) {
    const sum = perAsset.reduce((s, a) => s + a.amount, 0);
    if (sum > 0) {
      return perAsset.map((a) => ({
        asset: a.asset,
        pct: Math.round((a.amount / sum) * 1000) / 10,
      }));
    }
  }

  const list = collectAssetsFromText(text);
  if (list.length === 0) {
    if (perAsset && perAsset.length === 1) {
      return [{ asset: perAsset[0]!.asset, pct: 100 }];
    }
    return null;
  }

  // « ajoute Amazon » / « mets aussi Google » / « et apple » → nouveaux (merge add).
  if (
    /\b(ajoute|ajouter|rajoute|rajouter|inclus|ajouterai)\b/.test(t) ||
    /\b(mets?\s+aussi|mettre\s+aussi|et\s+aussi)\b/.test(t) ||
    /^\s*et\s+[a-z0-9.]{2,}\s*$/.test(t)
  ) {
    return equalAllocation(list);
  }

  // Exige un contexte d’achat / allocation pour ne pas matcher un ticker isolé hors sujet.
  if (
    !/\b(sur|acheter|investir|allouer|repartir|crypto|btc|eth|sol|envoyer|mettre|mets|place|repartie|repartir|veux|veut|actif|actifs|portefeuille|seulement|uniquement|au\s+lieu|au\s+place|ajoute|ajouter|rajoute)\b/.test(
      t,
    ) &&
    list.length < 2
  ) {
    return null;
  }
  // ≥2 actifs cités = intention d’allocation (même sans verbe).
  return equalAllocation(list);
}

/** Mode d’allocation : add si « ajoute … » / « mets aussi … » / « et Apple ». */
export function extractAllocationMode(text: string): "replace" | "add" {
  const t = normalizeFrChat(text);
  if (
    /\b(ajoute|ajouter|rajoute|rajouter|inclus)\b/.test(t) ||
    /\b(mets?\s+aussi|mettre\s+aussi|et\s+aussi)\b/.test(t) ||
    /^\s*et\s+[a-z0-9.]{2,}\s*$/.test(t)
  ) {
    return "add";
  }
  return "replace";
}

function isUsableBudgetAt(t: string, index: number, len: number): boolean {
  return (
    !isPercentNumber(t, index, len) &&
    !isInsideDateToken(t, index, len) &&
    !isDayOfMonthContext(t, index, len) &&
    !isFearGreedOrMultiplierContext(t, index, len) &&
    !isIndicatorThresholdContext(t, index, len)
  );
}

/** Premier montant valide dans une fenêtre après `fromIndex` (saute jour du mois / fear / dates). */
function firstBudgetInWindow(
  t: string,
  fromIndex: number,
  windowChars: number,
  defaultCurrency: string,
): { budgetAmount: number; currency: string } | null {
  const end = Math.min(t.length, fromIndex + windowChars);
  const slice = t.slice(fromIndex, end);
  for (const m of slice.matchAll(/\d+(?:[.,]\d+)?/g)) {
    if (m.index == null) continue;
    const numIdx = fromIndex + m.index;
    const token = m[0]!;
    if (!isUsableBudgetAt(t, numIdx, token.length)) continue;
    const amount = Number(token.replace(",", "."));
    if (canBeBudgetAmount(amount)) {
      return { budgetAmount: amount, currency: defaultCurrency };
    }
  }
  return null;
}

function extractBudget(
  t: string,
  raw: string,
  defaultCurrency: string,
  loose: boolean,
): { budgetAmount: number; currency: string } | null {
  // « 50 sur BTC, 50 ETH et 50 SOL » → somme des montants par actif
  const perAsset = extractPerAssetAmounts(t);
  if (perAsset && perAsset.length >= 2) {
    const sum = perAsset.reduce((s, a) => s + a.amount, 0);
    if (canBeBudgetAmount(sum)) {
      return { budgetAmount: sum, currency: defaultCurrency };
    }
  }

  const withCur = t.match(/(\d+(?:[.,]\d+)?)\s*(eur|euros|usd|dollars?)/);
  if (withCur && withCur.index != null && isUsableBudgetAt(t, withCur.index, withCur[1]!.length)) {
    const amount = Number(withCur[1]!.replace(",", "."));
    // Devise explicite : on accepte même 2024 € (cas limite), mais pas une année seule.
    if (canBeBudgetAmount(amount, { allowYearLike: true }) && amount < 500_000) {
      return {
        budgetAmount: amount,
        currency: /usd|dollar/.test(withCur[2]!) ? "USD" : "EUR",
      };
    }
  }

  // Verbe d’investissement → premier montant utilisable après (même si un jour 5 s’intercale).
  // « mettre tt les 5 du mois 200 » / « je veux mettre 200 »
  const budgetVerbs =
    /\b(?:budget|investirai|investir|investi[st]?|acheter|achete|mets?|mettre|alloue|allouer|place|placer|verse|verser|veux|veut|voudrais|souhaite|environ|genre|style|disons|mettons)\b/g;
  for (const vm of t.matchAll(budgetVerbs)) {
    if (vm.index == null) continue;
    const found = firstBudgetInWindow(t, vm.index + vm[0].length, 72, defaultCurrency);
    if (found) return found;
  }

  // « du mois 200 », « toutes les 5 du mois 200 sur BTC » (montant après la fenêtre)
  const afterDom = t.match(
    /\b(?:(?:tous|toutes)\s+les\s+\d{1,2}(?:\s+du\s+mois)?|(?:le\s+|jour\s+)?\d{1,2}(?:er|e)?(?:\s+jour)?\s+du\s+mois)\s+(\d+(?:[.,]\d+)?)\b/,
  );
  if (afterDom && afterDom.index != null) {
    const num = afterDom[1]!;
    const numIdx = afterDom.index + afterDom[0].length - num.length;
    if (isUsableBudgetAt(t, numIdx, num.length)) {
      const amount = Number(num.replace(",", "."));
      if (canBeBudgetAmount(amount)) {
        return { budgetAmount: amount, currency: defaultCurrency };
      }
    }
  }

  // « 200 par mois », « 150/semaine », « 150 chaque semaine » — AVANT « N sur TICKER »
  // sinon « du 1 au 7 sur BTC » vole le budget (7).
  const withPeriod = t.match(/(\d+(?:[.,]\d+)?)\s*(?:par|\/|chaque)\s*(?:mois|semaine)/);
  if (
    withPeriod &&
    withPeriod.index != null &&
    isUsableBudgetAt(t, withPeriod.index, withPeriod[1]!.length)
  ) {
    const amount = Number(withPeriod[1]!.replace(",", "."));
    if (canBeBudgetAmount(amount)) {
      return { budgetAmount: amount, currency: defaultCurrency };
    }
  }

  // « 200 sur BTC », « 200 sur du eth et sol »
  const amountSur = t.match(
    /(\d+(?:[.,]\d+)?)\s+sur\s+(?:du\s+|de\s+|la\s+|le\s+|l['’]\s*)?[a-z0-9.]{2,}/,
  );
  if (amountSur && amountSur.index != null && isUsableBudgetAt(t, amountSur.index, amountSur[1]!.length)) {
    const amount = Number(amountSur[1]!.replace(",", "."));
    if (canBeBudgetAmount(amount)) {
      return { budgetAmount: amount, currency: defaultCurrency };
    }
  }

  // « 150 en tt », « 150 au total » (tt → toutes via normalizeFrChat)
  const withTotal = t.match(
    /(\d+(?:[.,]\d+)?)\s*(?:€|eur|euros)?\s*(?:en\s+)?(?:tt|total|tout|toutes)\b/,
  );
  if (
    withTotal &&
    withTotal.index != null &&
    isUsableBudgetAt(t, withTotal.index, withTotal[1]!.length)
  ) {
    const amount = Number(withTotal[1]!.replace(",", "."));
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
      .filter((m) => m.index != null && isUsableBudgetAt(t, m.index, m[0]!.length))
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

  // Jour unique : « le 1 du mois », « 1er du mois », « le premier du mois »
  if (/\b(?:le\s+)?(?:1er|1|premier)(?:\s+jour)?\s+du\s+mois\b/.test(t)) {
    return { windowFrom: 1, windowTo: 1 };
  }
  // « le 29 du mois », « jour 15 du mois », « acheter le 29 »
  const dayOfMonth = t.match(
    /\b(?:le\s+|jour\s+)?(\d{1,2}|1er|premier)(?:er|e)?(?:\s+jour)?\s+du\s+mois\b/,
  );
  if (dayOfMonth) {
    const raw = dayOfMonth[1]!;
    const n = raw === "1er" || raw === "premier" ? 1 : Number(raw);
    if (n >= 1 && n <= MONTH_DAY_MAX) return { windowFrom: n, windowTo: n };
  }
  // « chaque 1er », « tous/toutes les 1 », « tous les 29 » (tt → toutes)
  if (/\b(?:chaque|tous\s+les|toutes\s+les)\s+(?:le\s+)?(?:1er|1|premier)\b/.test(t)) {
    return { windowFrom: 1, windowTo: 1 };
  }
  const everyDay = t.match(/\b(?:chaque|tous\s+les|toutes\s+les)\s+(?:le\s+)?(\d{1,2})\b/);
  if (everyDay) {
    const n = Number(everyDay[1]);
    if (n >= 1 && n <= MONTH_DAY_MAX) return { windowFrom: n, windowTo: n };
  }
  // « uniquement/seulement le 5 »
  const onlyDay = t.match(
    /\b(?:uniquement|seulement|juste|que)\s+(?:le\s+)?(\d{1,2}|1er|premier)(?:er|e)?\b/,
  );
  if (onlyDay) {
    const raw = onlyDay[1]!;
    const n = raw === "1er" || raw === "premier" ? 1 : Number(raw);
    if (n >= 1 && n <= MONTH_DAY_MAX) return { windowFrom: n, windowTo: n };
  }
  // « tous les mois le 5 », « mensuel le 15 » — jour isolé après cadence mensuelle
  if (
    /\b(?:tous\s+les\s+mois|toutes\s+les\s+mois|chaque\s+mois|mensuel|par\s+mois)\b/.test(t)
  ) {
    const monthlyDay = t.match(
      /\b(?:le|jour)\s+(\d{1,2}|1er|premier)(?:er|e)?(?:\s+du\s+mois)?\b/,
    );
    if (monthlyDay) {
      const raw = monthlyDay[1]!;
      const n = raw === "1er" || raw === "premier" ? 1 : Number(raw);
      if (n >= 1 && n <= MONTH_DAY_MAX) return { windowFrom: n, windowTo: n };
    }
  }
  // Réponse courte à la question fenêtre : « le 1 », « 1er », « jour 1 »
  const shortSingle = t
    .trim()
    .match(/^(?:le\s+)?(?:jour\s+)?(\d{1,2}|1er|premier)(?:er|e)?(?:\s+du\s+mois)?$/);
  if (shortSingle) {
    const raw = shortSingle[1]!;
    const n = raw === "1er" || raw === "premier" ? 1 : Number(raw);
    if (n >= 1 && n <= MONTH_DAY_MAX) return { windowFrom: n, windowTo: n };
  }

  // « 1 au 7 », « 1 a 7 », « 1-7 », « 1 et 7 » (réponse SMS)
  const shortRange = t
    .trim()
    .match(/^(\d{1,2})\s*(?:au|a|et|-|–|\/)\s*(\d{1,2})$/);
  if (shortRange) {
    return clampWindow(Number(shortRange[1]), Number(shortRange[2]));
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
    /(?:du|de|entre)\s*(?:le\s*)?(\d{1,2})(?:er|e|eme)?\s*(?:au|a|et|u|jusqu.?a|-|–)\s*(?:le\s*)?(\d{1,2})/,
    /jours?\s*(\d{1,2})\s*(?:-|–|a|au|et|u)\s*(\d{1,2})/,
    // Ne pas matcher les dates JJ/MM/AAAA ou AAAA/MM/JJ → géré via isPartOfCalendarDate
    /\b(\d{1,2})\s*(?:-|–|\/)\s*(\d{1,2})\b/,
    /\b(\d{1,2})\s+(?:a|au|et|u)\s+(\d{1,2})\b/,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (!m || m.index == null) continue;
    if (isPartOfCalendarDate(t, m.index, m[0]!.length)) continue;
    return clampWindow(Number(m[1]), Number(m[2]));
  }

  const firstN = t.match(/(?:les?\s+)?(\d{1,2})\s+premiers?\s+jours?/);
  if (firstN) {
    const n = Number(firstN[1]);
    if (n >= 1 && n <= MONTH_DAY_MAX) return { windowFrom: 1, windowTo: n };
  }

  return null;
}

/**
 * « +15% en baisse » → bearMult 1.15 ; « -15% en hausse » → bullMult 0.85
 * Ajustement du montant investi — pas des paliers de drawdown inventés.
 */
export function extractRegimeHints(text: string): Pick<
  ScheduleHints,
  "regimeEnabled" | "bullMult" | "bearMult" | "regimeReferenceAsset" | "fallbackNeutral"
> | null {
  const t = normalizeFrChat(text);
  let bearMult: number | undefined;
  let bullMult: number | undefined;
  let regimeReferenceAsset: string | undefined;
  let fallbackNeutral: boolean | undefined;

  // Fin de fenêtre → ×1 / neutre (pas le régime).
  if (
    /\b(fin\s+de\s+fenetre|fallback|sans\s+signal|si\s+(pas|aucun)\s+signal)\b/.test(t) &&
    /\b(x\s*1|×\s*1|neutre|budget\s+de\s+base|verser?\s+(le\s+)?(base|normal|classique)|200\s*€?)\b/.test(
      t,
    )
  ) {
    fallbackNeutral = true;
  } else if (
    /\b(fin\s+de\s+fenetre|fallback)\b/.test(t) &&
    /\b(garder|garde|meme|toujours)\b.{0,30}\b(regime|multiplicateur|haussier|baissier)\b/.test(t)
  ) {
    fallbackNeutral = false;
  }

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

  if (
    bearMult == null &&
    bullMult == null &&
    regimeReferenceAsset === undefined &&
    fallbackNeutral === undefined
  ) {
    return null;
  }
  return {
    regimeEnabled: true,
    ...(bearMult != null ? { bearMult: Math.round(bearMult * 1000) / 1000 } : {}),
    ...(bullMult != null ? { bullMult: Math.round(bullMult * 1000) / 1000 } : {}),
    ...(regimeReferenceAsset !== undefined ? { regimeReferenceAsset } : {}),
    ...(fallbackNeutral !== undefined ? { fallbackNeutral } : {}),
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

export type StartDateDiagnosis =
  | { ok: true; date: string }
  | { ok: false; reason: "future" | "invalid" | "unparsed" };

function classifyIsoDate(y: number, m: number, d: number): StartDateDiagnosis {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) {
    return { ok: false, reason: "invalid" };
  }
  const iso = `${y}-${pad2(m)}-${pad2(d)}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return { ok: false, reason: "invalid" };
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== m || dt.getUTCDate() !== d) {
    return { ok: false, reason: "invalid" };
  }
  const yesterday = yesterdayIso();
  if (iso > yesterday) return { ok: false, reason: "future" };
  return { ok: true, date: iso };
}

function validIsoDate(y: number, m: number, d: number): string | null {
  const r = classifyIsoDate(y, m, d);
  return r.ok ? r.date : null;
}

/**
 * Analyse une réponse « date de début » : OK, futur, invalide, ou non reconnue.
 * Préférer ceci à extractStartDateHint quand on doit expliquer un rejet.
 */
export function diagnoseStartDateHint(
  text: string,
  opts: { bareYear?: boolean } = {},
): StartDateDiagnosis {
  const raw = text.trim();
  const t = normalizeFrChat(text);
  let sawCandidate = false;
  let lastFail: StartDateDiagnosis = { ok: false, reason: "unparsed" };

  const tryYmd = (y: number, m: number, d: number): StartDateDiagnosis | null => {
    sawCandidate = true;
    const r = classifyIsoDate(y, m, d);
    if (r.ok) return r;
    lastFail = r;
    return null;
  };

  const iso = raw.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const r = tryYmd(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (r) return r;
  }

  const isoSlash = raw.match(/\b(20\d{2})[\/.](\d{1,2})[\/.](\d{1,2})\b/);
  if (isoSlash) {
    const r = tryYmd(Number(isoSlash[1]), Number(isoSlash[2]), Number(isoSlash[3]));
    if (r) return r;
  }

  const slash = t.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2})\b/);
  if (slash) {
    const r = tryYmd(Number(slash[3]), Number(slash[2]), Number(slash[1]));
    if (r) return r;
  }

  const named = t.match(
    /\b(?:depuis|a partir(?:\s+de)?|debut|du|le)?\s*(\d{1,2})?\s*(janvier|janv|fevrier|fev|mars|avril|avr|mai|juin|juillet|juil|aout|septembre|sept|octobre|oct|novembre|nov|decembre|dec)\s+(20\d{2})\b/,
  );
  if (named) {
    const day = named[1] ? Number(named[1]) : 1;
    const month = FR_MONTHS[named[2]!];
    const year = Number(named[3]);
    if (month) {
      const r = tryYmd(year, month, day);
      if (r) return r;
    }
  }

  const yearPrefixed = t.match(/^(?:depuis|a partir(?:\s+de)?|debut|en)\s+(20\d{2})$/);
  if (yearPrefixed) {
    const r = tryYmd(Number(yearPrefixed[1]), 1, 1);
    if (r) return r;
  }

  if (opts.bareYear) {
    const yearOnly = t.match(/^(20\d{2})$/);
    if (yearOnly) {
      const r = tryYmd(Number(yearOnly[1]), 1, 1);
      if (r) return r;
    }
  }

  return sawCandidate ? lastFail : { ok: false, reason: "unparsed" };
}

/**
 * Date de début explicite : 2023-03-15, 15/03/2023, « 15 mars 2023 », « mars 2023 ».
 * Une année nue (« 2024 ») n’est acceptée que si `opts.bareYear` (réponse au champ date).
 */
export function extractStartDateHint(
  text: string,
  opts: { bareYear?: boolean } = {},
): string | null {
  const d = diagnoseStartDateHint(text, opts);
  return d.ok ? d.date : null;
}

export function messageForStartDateFailure(reason: "future" | "invalid" | "unparsed"): string {
  if (reason === "future") {
    return "Cette date est dans le futur — le backtest a besoin d’une date passée (ex. 01/01/2024 ou 15/03/2023).";
  }
  if (reason === "invalid") {
    return "Cette date n’existe pas. Réessaie au format JJ/MM/AAAA (ex. 15/03/2023).";
  }
  return "Je n’ai pas compris la date. Ex. 15/03/2023.";
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

  // Fenêtre : ignorer si le message est surtout une date (évite 01/01/2025 → jours 1–1).
  const window = extractWindow(t);
  if (
    window &&
    !(
      from &&
      !/(fenetre|jours?|du\s+\d|du\s+mois|le\s+\d{1,2}|entre\s+(le\s+)?\d|premiers?\s+jours)/.test(
        t,
      )
    )
  ) {
    Object.assign(out, window);
  }

  const regime = extractRegimeHints(text);
  if (regime) Object.assign(out, regime);

  const fgScale = extractFearGreedScaleHint(text);
  if (fgScale) {
    out.fearGreedScaleEnabled = true;
    out.fearGreedLowLte = fgScale.low_lte;
    out.fearGreedLowFactor = fgScale.low_factor;
    out.fearGreedHighGte = fgScale.high_gte;
    out.fearGreedHighFactor = fgScale.high_factor;
    out.fearGreedEnabled = false;
  } else {
    const fg = extractFearGreedHint(text);
    if (fg != null) {
      out.fearGreedEnabled = true;
      out.fearGreedValue = fg;
    }
  }

  const rsiScale = extractRsiScaleHint(text);
  if (rsiScale) {
    out.rsiScaleEnabled = true;
    out.rsiEnabled = false;
    out.rsiLowLte = rsiScale.low_lte;
    out.rsiLowFactor = rsiScale.low_factor;
    out.rsiHighGte = rsiScale.high_gte;
    out.rsiHighFactor = rsiScale.high_factor;
  } else if (/\brsi\b/.test(t) && !rsiScale) {
    const rsiGate = t.match(/rsi[^\d]{0,20}?(?:<|<=|sous|en\s+dessous)\s*(?:de\s*)?(\d{1,3})/);
    if (rsiGate) {
      out.rsiEnabled = true;
      out.rsiValue = Number(rsiGate[1]);
    }
  }

  const dipScale = extractDipScaleHint(text);
  if (dipScale) {
    out.dipScaleEnabled = true;
    out.dipEnabled = false;
    out.dipDeepGte = dipScale.deep_gte;
    out.dipDeepFactor = dipScale.deep_factor;
    out.dipCalmLt = dipScale.calm_lt;
    out.dipCalmFactor = dipScale.calm_factor;
  }

  if (/\bmacd\b/.test(t)) {
    if (/\b(double|moitie|moitié|fois|x\s*\d|×)/.test(t)) {
      out.macdScaleEnabled = true;
      out.macdEnabled = false;
      out.macdPosFactor = 1.2;
      out.macdNegFactor = 0.8;
    } else if (/\b(acheter|que\s+si|uniquement|positif)\b/.test(t)) {
      out.macdEnabled = true;
    }
  }

  if (/\bbollinger\b|\b%b\b|\bpctb\b/.test(t)) {
    if (/\b(double|moitie|moitié|fois|x\s*\d|×)/.test(t)) {
      out.bollingerScaleEnabled = true;
      out.bollingerEnabled = false;
      out.bollingerLowLte = 0.05;
      out.bollingerLowFactor = 2;
      out.bollingerHighGte = 0.95;
      out.bollingerHighFactor = 0.5;
    } else if (/\b(acheter|que\s+si|bande\s+basse)\b/.test(t)) {
      out.bollingerEnabled = true;
    }
  }

  if (/\bsma\b|\bmoyenne\s+mobile\b/.test(t)) {
    if (/\b(double|moitie|moitié|fois|x\s*\d|×|ajuster|module)\b/.test(t)) {
      out.smaScaleEnabled = true;
      out.smaBuyEnabled = false;
      out.smaBelowFactor = 1.5;
      out.smaAboveFactor = 0.7;
    } else if (/\b(acheter|sous|que\s+si)\b/.test(t)) {
      out.smaBuyEnabled = true;
    }
  }

  if (extractRequireSignalHint(text)) {
    out.requireSignal = true;
  }

  const allocation = extractAllocationHints(text);
  if (allocation?.length) {
    out.allocation = allocation;
    out.allocationMode = extractAllocationMode(text);
  }

  // 2) Budget ensuite — ignore si le message est surtout une date.
  const dateOnly =
    Boolean(from) &&
    !/\b(budget|investir|mets?|mettre|euros?|eur|usd|dollars?|par\s+mois|par\s+semaine)\b/.test(t) &&
    !/\d+(?:[.,]\d+)?\s*(eur|euros|usd)/.test(t) &&
    !(allocation && allocation.length >= 2);
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
      } else if (
        (out.fearGreedValue != null && budget.budgetAmount === out.fearGreedValue) ||
        (out.fearGreedLowLte != null && budget.budgetAmount === out.fearGreedLowLte) ||
        (out.fearGreedHighGte != null &&
          out.fearGreedHighGte < 100 &&
          budget.budgetAmount === out.fearGreedHighGte)
      ) {
        // ignore — seuil Fear & Greed ≠ budget
      } else if (
        (out.rsiValue != null && budget.budgetAmount === out.rsiValue) ||
        (out.rsiLowLte != null && budget.budgetAmount === out.rsiLowLte) ||
        (out.rsiHighGte != null &&
          out.rsiHighGte < 100 &&
          budget.budgetAmount === out.rsiHighGte)
      ) {
        // ignore — seuil RSI ≠ budget
      } else if (
        out.windowFrom != null &&
        out.windowTo != null &&
        (budget.budgetAmount === out.windowFrom || budget.budgetAmount === out.windowTo)
      ) {
        // ignore — jour de fenêtre (« le 5 », « du 1 au 7 ») ≠ budget
      } else {
        Object.assign(out, budget);
      }
    }
  }

  // Montant unique + ≥2 actifs : total vs par actif.
  const perAssetLines = extractPerAssetAmounts(t);
  const splitHint = extractBudgetSplitHint(text);
  if (perAssetLines && perAssetLines.length >= 2) {
    // « 50 BTC + 50 ETH » = total explicite (somme), pas d’ambiguïté.
    out.budgetSplit = "total";
    out.budgetQuotedAmount = perAssetLines.reduce((s, a) => s + a.amount, 0);
  } else if (out.budgetAmount != null && (out.allocation?.length ?? 0) >= 2) {
    out.budgetQuotedAmount = out.budgetAmount;
    if (splitHint === "per_asset") {
      out.budgetSplit = "per_asset";
      out.budgetAmount = out.budgetAmount * out.allocation!.length;
    } else if (splitHint === "total") {
      out.budgetSplit = "total";
    }
    // sinon : ambigu — budgetSplit absent → question obligatoire
  } else if (splitHint) {
    out.budgetSplit = splitHint;
  }

  return out;
}

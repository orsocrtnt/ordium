/** Utilitaires de normalisation pour les imports (CSV, Excel, connecteurs). */

export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Nettoie un en-tête de colonne : minuscules, sans accents ni ponctuation. */
export function normalizeHeader(raw: string): string {
  return stripAccents(String(raw).toLowerCase()).replace(/[^a-z]/g, "");
}

/**
 * Nombre depuis un texte de tableur, quel que soit le format :
 * "1 234,56", "1,234.56", "0.0012BTC", "€500". Null si illisible.
 */
export function parseNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (raw == null) return null;
  const text = String(raw).replace(/[\s\u00a0\u202f]/g, "");
  const match = text.match(/-?[\d.,]+/);
  if (!match) return null;
  let num = match[0];
  const lastComma = num.lastIndexOf(",");
  const lastDot = num.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Les deux présents : le dernier est le séparateur décimal.
    num =
      lastComma > lastDot
        ? num.replace(/\./g, "").replace(",", ".")
        : num.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // Virgule seule : séparateur de milliers si groupes de 3 ("1,234,000"), décimal sinon.
    num = /^\d{1,3}(,\d{3})+$/.test(num) ? num.replace(/,/g, "") : num.replace(/,/g, ".");
  }
  const value = Number(num);
  return Number.isFinite(value) ? value : null;
}

/** Date vers YYYY-MM-DD. Accepte ISO, DD/MM/YYYY (fr), epoch s/ms, Date Excel. */
export function parseDate(raw: unknown): string | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  if (typeof raw === "number") {
    // Numéro de série Excel (jours depuis 1900) ou epoch.
    if (raw > 20000 && raw < 80000) {
      return new Date(Math.round((raw - 25569) * 86_400_000)).toISOString().slice(0, 10);
    }
    if (raw > 1e12) return new Date(raw).toISOString().slice(0, 10);
    if (raw > 1e9) return new Date(raw * 1000).toISOString().slice(0, 10);
    return null;
  }
  if (raw == null) return null;
  const text = String(raw).trim();

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];

  const dmy = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (dmy) {
    let day = Number(dmy[1]);
    let month = Number(dmy[2]);
    // Heuristique : format américain si le "mois" est impossible.
    if (month > 12 && day <= 12) [day, month] = [month, day];
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${dmy[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    return null;
  }

  if (/^\d{13}$/.test(text)) return new Date(Number(text)).toISOString().slice(0, 10);
  if (/^\d{10}$/.test(text)) return new Date(Number(text) * 1000).toISOString().slice(0, 10);
  return null;
}

const BUY_WORDS = new Set(["buy", "achat", "acheter", "bought", "purchase", "b", "bid", "long"]);
const SELL_WORDS = new Set(["sell", "vente", "vendre", "sold", "s", "ask", "short"]);
const IGNORE_WORDS = new Set([
  "deposit",
  "depot",
  "withdrawal",
  "withdraw",
  "retrait",
  "transfer",
  "transfert",
  "staking",
  "stakingreward",
  "reward",
  "dividend",
  "dividende",
  "interest",
  "interet",
  "fee",
  "airdrop",
  "conversion",
]);

/** buy / sell / "ignore" (dépôt, retrait, staking…) / null si inconnu. */
export function normalizeSide(raw: unknown): "buy" | "sell" | "ignore" | null {
  const text = normalizeHeader(String(raw ?? ""));
  if (BUY_WORDS.has(text)) return "buy";
  if (SELL_WORDS.has(text)) return "sell";
  if (IGNORE_WORDS.has(text)) return "ignore";
  return null;
}

/** Vocabulaire Kraken et variantes vers les symboles canoniques. */
const ASSET_ALIASES: Record<string, string> = {
  XXBT: "BTC",
  XBT: "BTC",
  XETH: "ETH",
  XXRP: "XRP",
  XLTC: "LTC",
  XXLM: "XLM",
  XXMR: "XMR",
  XZEC: "ZEC",
  XXDG: "DOGE",
  XDG: "DOGE",
  ZEUR: "EUR",
  ZUSD: "USD",
  ZGBP: "GBP",
  ZJPY: "JPY",
  ZCAD: "CAD",
  ZAUD: "AUD",
  /** Tickers inventés / tronqués → symboles cotés. */
  TAKE: "TTWO",
  TAKETWO: "TTWO",
  URANIUM: "URNM",
};

/**
 * Noms d'instruments (captures broker) → tickers Yahoo/canoniques.
 * Clés normalisées : majuscules, sans accents, ponctuation → espaces.
 */
const NAME_TO_TICKER: Record<string, string> = {
  BROADCOM: "AVGO",
  NVIDIA: "NVDA",
  APPLE: "AAPL",
  MICROSOFT: "MSFT",
  AMAZON: "AMZN",
  "AMAZON COM": "AMZN",
  TESLA: "TSLA",
  VISA: "V",
  META: "META",
  "META PLATFORMS": "META",
  "META PLATFORMS A": "META",
  ALPHABET: "GOOGL",
  "ALPHABET A": "GOOGL",
  GOOGLE: "GOOGL",
  MASTERCARD: "MA",
  "COCA COLA": "KO",
  COCA: "KO",
  COCACOLA: "KO",
  "JOHNSON JOHNSON": "JNJ",
  "PROCTER GAMBLE": "PG",
  "TRACTOR SUPPLY": "TSCO",
  TRACTOR: "TSCO",
  "TAKE TWO": "TTWO",
  "TAKE TWO INTERACTIVE": "TTWO",
  /** Gemini / OCR tronquent souvent « Take-Two » → TAKE. */
  TAKE: "TTWO",
  TAKETWO: "TTWO",
  "TAKE 2": "TTWO",
  TOTALENERGIES: "TTE",
  "TOTAL ENERGIES": "TTE",
  CHEVRON: "CVX",
  "CONSTELLATION ENERGY": "CEG",
  "DOMINION ENERGY": "D",
  ASML: "ASML",
  LVMH: "MC.PA",
  "LVMH MOET HENNESSY": "MC.PA",
  "PHYSICAL GOLD": "SGLD.L",
  "PHYSICAL GOLD USD": "SGLD.L",
  "PHYSICAL GOLD USD ACC": "SGLD.L",
  "MSCI WORLD": "IWDA.AS",
  "MSCI WORLD USD": "IWDA.AS",
  "MSCI WORLD USD ACC": "IWDA.AS",
  "S P 500": "CSPX.L",
  "S P 500 EUR": "CSPX.L",
  "S P 500 EUR ACC": "CSPX.L",
  "MSCI EMERGING MARKETS": "EIMI.L",
  "MSCI EMERGING MARKETS E": "EIMI.L",
  "MSCI EUROPE HEALTH CARE": "HEAL.L",
  "STOXX 600 ENERGY": "ENRG.L",
  "STOXX 600 ENERGY ESG": "ENRG.L",
  "STOXX 600 ENERGY ESG E": "ENRG.L",
  "AI BIG DATA": "AIAG.L",
  "AI BIG DATA USD": "AIAG.L",
  "AI BIG DATA USD ACC": "AIAG.L",
  AINF: "AIAG.L",
  "AINF PA": "AIAG.L",
  "AINF.PA": "AIAG.L",
  "CRYPTO BLOCKCHAIN": "BLCN",
  "CRYPTO BLOCKCHAIN INNO": "BLCN",
  "URANIUM AND NUCLEAR TECH": "URNM",
  "URANIUM AND NUCLEAR TEC": "URNM",
  URANIUM: "URNM",
  SPACEX: "SPACEX",
  "SPACE X": "SPACEX",
};

function normalizeInstrumentKey(raw: string): string {
  return stripAccents(raw)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeAsset(raw: string): string {
  const code = raw.trim().toUpperCase();
  if (ASSET_ALIASES[code]) return ASSET_ALIASES[code]!;
  const key = normalizeInstrumentKey(raw);
  if (NAME_TO_TICKER[key]) return NAME_TO_TICKER[key]!;
  // Essai sans suffixes Acc / USD / EUR courants sur les ETF.
  const stripped = key
    .replace(/\b(USD|EUR|ACC|DIST|HEDGED)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped !== key && NAME_TO_TICKER[stripped]) return NAME_TO_TICKER[stripped]!;
  return code.includes(" ") ? key : code;
}

/** Noms d'affichage préférés pour les tickers connus (NVDA → NVIDIA). */
const TICKER_DISPLAY_NAME: Record<string, string> = (() => {
  const out: Record<string, string> = {
    BTC: "Bitcoin",
    ETH: "Ethereum",
    SOL: "Solana",
    XRP: "XRP",
    ADA: "Cardano",
    DOT: "Polkadot",
    AVAX: "Avalanche",
    LINK: "Chainlink",
    AVGO: "Broadcom",
    NVDA: "NVIDIA",
    AAPL: "Apple",
    MSFT: "Microsoft",
    AMZN: "Amazon.com",
    TSLA: "Tesla",
    V: "Visa",
    META: "Meta Platforms",
    GOOGL: "Alphabet",
    MA: "Mastercard",
    KO: "Coca-Cola",
    JNJ: "Johnson & Johnson",
    PG: "Procter & Gamble",
    TSCO: "Tractor Supply",
    TTWO: "Take-Two Interactive",
    TTE: "TotalEnergies",
    CVX: "Chevron",
    CEG: "Constellation Energy",
    D: "Dominion Energy",
    ASML: "ASML",
    "MC.PA": "LVMH",
    SGLD: "Physical Gold",
    "SGLD.L": "Physical Gold",
    IWDA: "MSCI World",
    "IWDA.AS": "MSCI World",
    CSPX: "S&P 500",
    "CSPX.L": "S&P 500",
    EIMI: "MSCI Emerging Markets",
    "EIMI.L": "MSCI Emerging Markets",
    "HEAL.L": "MSCI Europe Health Care",
    "ENRG.L": "STOXX 600 Energy ESG",
    "AINF.PA": "AI & Big Data",
    "AIAG.L": "AI & Big Data",
    BLCN: "Crypto & Blockchain",
    URNM: "Uranium And Nuclear Tech",
    SPACEX: "SpaceX",
  };
  return out;
})();

/** Nom lisible pour un ticker ; `fallback` si fourni (ex. texte OCR). */
export function displayNameForAsset(asset: string, fallback?: string): string {
  const cleaned = fallback?.trim();
  if (cleaned && cleaned.toUpperCase() !== asset.toUpperCase()) return cleaned;
  return (
    TICKER_DISPLAY_NAME[asset.toUpperCase()] ??
    TICKER_DISPLAY_NAME[asset] ??
    asset
  );
}

function isKrakenCode(code: string): boolean {
  return code in ASSET_ALIASES;
}

/** Devises de cotation reconnues en suffixe de paire, du plus long au plus court. */
const QUOTES = [
  "FDUSD",
  "USDT",
  "USDC",
  "BUSD",
  "TUSD",
  "EUR",
  "USD",
  "GBP",
  "JPY",
  "CHF",
  "DAI",
  "BTC",
  "ETH",
  "BNB",
];

/** Décompose une paire ("BTC/EUR", "BTCEUR", "XXBTZEUR") en base + cotation. */
export function splitPair(raw: string): { base: string; quote: string } | null {
  const text = raw.trim().toUpperCase();
  const sep = text.match(/^([A-Z0-9]+)[/\-_]([A-Z0-9]+)$/);
  if (sep) return { base: normalizeAsset(sep[1]!), quote: normalizeAsset(sep[2]!) };
  for (const q of QUOTES) {
    // Forme Kraken (XXBTZEUR) : suffixe Z + devise, seulement si le préfixe
    // est un code Kraken connu — sinon XTZEUR se découperait en XT + ZEUR.
    if (text.endsWith(`Z${q}`) && isKrakenCode(text.slice(0, -q.length - 1))) {
      return { base: normalizeAsset(text.slice(0, -q.length - 1)), quote: q };
    }
    if (text.endsWith(q) && text.length > q.length) {
      return { base: normalizeAsset(text.slice(0, -q.length)), quote: normalizeAsset(q) };
    }
  }
  return null;
}

/**
 * Valeur d'une colonne "actif" : accepte un symbole simple (BTC) ou une
 * paire (BTCEUR, BTC/EUR) dont on extrait la base.
 */
export function resolveAsset(raw: string): { asset: string; quote?: string } {
  const pair = splitPair(raw);
  if (pair) return { asset: pair.base, quote: pair.quote };
  return { asset: normalizeAsset(raw) };
}

import {
  normalizeHeader,
  normalizeSide,
  parseDate,
  parseNumber,
  resolveAsset,
} from "./normalize.js";
import {
  CASH_ASSETS,
  holdingsFromTransactions,
  type Holding,
  type Portfolio,
  type PortfolioSource,
  type Transaction,
} from "../types.js";

/** Résultat brut d'un parsing de fichier, avant assemblage en Portfolio. */
export interface ParsedRows {
  kind: "transactions" | "holdings";
  transactions: Transaction[];
  holdings: Holding[];
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Lecture CSV : séparateur détecté, champs entre guillemets gérés     */
/* ------------------------------------------------------------------ */

function sniffDelimiter(line: string): string {
  let best = ",";
  let bestCount = 0;
  for (const d of [",", ";", "\t"]) {
    const count = line.split(d).length;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

function parseLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

/* ------------------------------------------------------------------ */
/* Détection des colonnes (fr/en, exports Binance/Kraken/Coinbase…)    */
/* ------------------------------------------------------------------ */

type Role =
  | "date"
  | "asset"
  | "side"
  | "quantity"
  | "price"
  | "amount"
  | "fee"
  | "currency"
  | "name"
  | "avgPrice"
  | "invested"
  | "value"
  | "pnl"
  | "pnlPct";

const HEADER_ROLES: [Role, string[]][] = [
  ["date", ["date", "datetime", "dateutc", "time", "timestamp", "createdat", "tradedate", "utctime"]],
  [
    "asset",
    [
      "pair",
      "market",
      "symbol",
      "symbole",
      "asset",
      "actif",
      "instrument",
      "produit",
      "product",
      "coin",
      "ticker",
      "isin",
    ],
  ],
  ["name", ["name", "nom", "label", "libelle", "displayname", "description", "designation"]],
  ["side", ["side", "type", "sens", "operation", "direction", "transactiontype", "action"]],
  [
    "quantity",
    [
      "quantity",
      "quantite",
      "qty",
      "vol",
      "volume",
      "executed",
      "units",
      "nombre",
      "shares",
      "size",
      "filled",
      "amountasset",
      "quantitytransacted",
    ],
  ],
  [
    "avgPrice",
    [
      "avgprice",
      "pru",
      "prixderevient",
      "averageprice",
      "costbasis",
      "coutmoyen",
      "prixdachat",
      "prixachat",
      "prixmoyen",
      "coutunitaire",
    ],
  ],
  [
    "price",
    [
      "price",
      "prix",
      "cours",
      "rate",
      "unitprice",
      "prixunitaire",
      "spotpriceatransaction",
      "lastprice",
      "coursactuel",
      "prixactuel",
      "derniercours",
    ],
  ],
  [
    "invested",
    [
      "invested",
      "investi",
      "acquisition",
      "coutachat",
      "totalcost",
      "bookvalue",
      "montantinvesti",
      "capitalinvesti",
    ],
  ],
  [
    "value",
    [
      "value",
      "valeur",
      "marketvalue",
      "valeurmarche",
      "valorisation",
      "positionvalue",
      "valeuractuelle",
    ],
  ],
  [
    "pnl",
    [
      "pnl",
      "pl",
      "plusvalue",
      "gain",
      "unrealizedpnl",
      "plusoumoinsvalue",
      "plusvalueeur",
      "plusvaluemonetaire",
    ],
  ],
  [
    "pnlPct",
    [
      "pnlpct",
      "plpct",
      "plusvaluepct",
      "gainpct",
      "returnpct",
      "plusvaluepourcent",
    ],
  ],
  ["amount", ["total", "montant", "cost", "cout", "subtotal", "cashvalue", "totaleur", "totalusd", "montanttotal"]],
  ["fee", ["fee", "fees", "frais", "commission"]],
  ["currency", ["currency", "devise", "quotecurrency", "cashcurrency", "spotpricecurrency", "feecoin"]],
];

/** "amount" chez Binance/Coinbase = quantité d'actif, pas montant en devise. */
const QUANTITY_AMBIGUOUS = new Set(["amount"]);

function detectColumns(headers: string[]): Map<Role, number> {
  const normalized = headers.map(normalizeHeader);
  const roles = new Map<Role, number>();
  for (const [role, names] of HEADER_ROLES) {
    for (const name of names) {
      const idx = normalized.indexOf(name);
      if (idx >= 0 && ![...roles.values()].includes(idx)) {
        roles.set(role, idx);
        break;
      }
    }
  }
  // Fallback : "name" / "nom" peut servir d'actif si aucune colonne ticker.
  if (!roles.has("asset")) {
    const idx = normalized.findIndex(
      (h, i) => (h === "name" || h === "nom") && ![...roles.values()].includes(i),
    );
    if (idx >= 0) roles.set("asset", idx);
  }
  // "Amount" seul (sans colonne quantité) désigne la quantité d'actif.
  if (!roles.has("quantity")) {
    const idx = normalized.findIndex(
      (h, i) => QUANTITY_AMBIGUOUS.has(h) && ![...roles.values()].includes(i),
    );
    if (idx >= 0) roles.set("quantity", idx);
  }
  return roles;
}

/* ------------------------------------------------------------------ */
/* Parsing principal                                                   */
/* ------------------------------------------------------------------ */

export function parseCsv(text: string): ParsedRows {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error("Fichier vide ou sans données (en-tête + au moins une ligne attendus).");
  }

  const delimiter = sniffDelimiter(lines[0]!);
  const headers = parseLine(lines[0]!, delimiter);
  const rows = lines.slice(1).map((l) => parseLine(l, delimiter));
  return parseTable(headers, rows);
}

/** Coeur commun CSV/Excel : des en-têtes + des lignes de cellules. */
export function parseTable(headers: unknown[], rows: unknown[][]): ParsedRows {
  const roles = detectColumns(headers.map((h) => String(h ?? "")));
  const warnings: string[] = [];

  if (!roles.has("asset")) {
    throw new Error(
      `Impossible d'identifier la colonne des actifs. Colonnes trouvées : ${headers.join(", ")}. ` +
        `Attendu : une colonne "actif", "symbol", "pair" ou "produit".`,
    );
  }

  const cell = (row: unknown[], role: Role): unknown =>
    roles.has(role) ? row[roles.get(role)!] : undefined;

  const isTransactionFile = roles.has("date") && (roles.has("side") || roles.has("price"));

  if (!isTransactionFile) {
    // Photo de positions : actif + quantité.
    if (!roles.has("quantity")) {
      throw new Error(
        "Fichier de positions sans colonne quantité, ou fichier de transactions sans colonne date. " +
          "Attendu : (actif, quantité) ou (date, actif, type, quantité, prix).",
      );
    }
    const holdings: Holding[] = [];
    for (const [i, row] of rows.entries()) {
      const rawAsset = String(cell(row, "asset") ?? "").trim();
      const quantity = parseNumber(cell(row, "quantity"));
      const rowBlank = row.every((c) => String(c ?? "").trim() === "");
      if (rowBlank) continue;
      if (!rawAsset || quantity == null || quantity <= 0) {
        warnings.push(`Ligne ${i + 2} ignorée (actif ou quantité illisible).`);
        continue;
      }
      const { asset } = resolveAsset(rawAsset);
      if (CASH_ASSETS.has(asset)) continue; // trésorerie, pas une position

      const nameRaw = String(cell(row, "name") ?? "").trim();
      const price = parseNumber(cell(row, "price"));
      const avgPrice = parseNumber(cell(row, "avgPrice"));
      const invested = parseNumber(cell(row, "invested"));
      const value = parseNumber(cell(row, "value"));
      const pnl = parseNumber(cell(row, "pnl"));
      const pnlPct = parseNumber(cell(row, "pnlPct"));

      const holding: Holding = {
        asset,
        quantity,
        ...(nameRaw ? { name: nameRaw } : {}),
        ...(price != null ? { price } : {}),
        ...(avgPrice != null ? { avgPrice } : {}),
        ...(invested != null ? { invested } : {}),
        ...(value != null ? { value } : {}),
        ...(pnl != null ? { pnl } : {}),
        ...(pnlPct != null ? { pnlPct } : {}),
      };
      // Compléter invest/valeur si possible
      if (holding.invested == null && holding.avgPrice != null) {
        holding.invested = holding.avgPrice * quantity;
      }
      if (holding.avgPrice == null && holding.invested != null && quantity > 0) {
        holding.avgPrice = holding.invested / quantity;
      }
      if (holding.value == null && holding.price != null) {
        holding.value = holding.price * quantity;
      }
      if (holding.pnl == null && holding.value != null && holding.invested != null) {
        holding.pnl = holding.value - holding.invested;
      }
      if (
        holding.pnlPct == null &&
        holding.pnl != null &&
        holding.invested != null &&
        holding.invested > 0
      ) {
        holding.pnlPct = (holding.pnl / holding.invested) * 100;
      }

      const existing = holdings.find((h) => h.asset === asset);
      if (existing) {
        existing.quantity += quantity;
        if (holding.invested != null) {
          existing.invested = (existing.invested ?? 0) + holding.invested;
        }
        if (holding.value != null) {
          existing.value = (existing.value ?? 0) + holding.value;
        }
        if (existing.invested != null && existing.quantity > 0) {
          existing.avgPrice = existing.invested / existing.quantity;
        }
        if (existing.value != null && existing.invested != null) {
          existing.pnl = existing.value - existing.invested;
          existing.pnlPct =
            existing.invested > 0 ? (existing.pnl / existing.invested) * 100 : undefined;
        }
      } else {
        holdings.push(holding);
      }
    }
    if (holdings.length === 0) throw new Error("Aucune position exploitable dans le fichier.");
    return { kind: "holdings", transactions: [], holdings, warnings };
  }

  const transactions: Transaction[] = [];
  let ignored = 0;
  for (const [i, row] of rows.entries()) {
    const date = parseDate(cell(row, "date"));
    const rawAsset = String(cell(row, "asset") ?? "").trim();
    const quantity = parseNumber(cell(row, "quantity"));
    const price = parseNumber(cell(row, "price"));
    const amount = parseNumber(cell(row, "amount"));
    const fee = parseNumber(cell(row, "fee"));
    const side = roles.has("side") ? normalizeSide(cell(row, "side")) : "buy";

    if (side === "ignore") {
      ignored++;
      continue;
    }
    if (!date || !rawAsset || quantity == null || quantity <= 0 || side == null) {
      warnings.push(`Ligne ${i + 2} ignorée (date, actif, quantité ou type illisible).`);
      continue;
    }
    const { asset, quote } = resolveAsset(rawAsset);
    if (CASH_ASSETS.has(asset)) continue;
    const currencyCell = cell(row, "currency");
    transactions.push({
      date,
      side,
      asset,
      quantity,
      price: price ?? undefined,
      amount: amount ?? (price != null ? quantity * price : undefined),
      fee: fee ?? undefined,
      currency: currencyCell ? String(currencyCell).trim().toUpperCase() : quote,
    });
  }
  if (ignored > 0) {
    warnings.push(`${ignored} opérations hors achat/vente ignorées (dépôts, retraits, staking…).`);
  }
  if (transactions.length === 0) {
    throw new Error("Aucune transaction d'achat/vente exploitable dans le fichier.");
  }
  transactions.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { kind: "transactions", transactions, holdings: [], warnings };
}

/* ------------------------------------------------------------------ */
/* Assemblage                                                          */
/* ------------------------------------------------------------------ */

export function buildPortfolio(
  name: string,
  currency: string,
  source: PortfolioSource,
  parsed: ParsedRows,
): Portfolio {
  const holdings =
    parsed.kind === "transactions"
      ? holdingsFromTransactions(parsed.transactions)
      : parsed.holdings;
  const warnings = [...parsed.warnings];
  return {
    name,
    currency: currency.toUpperCase(),
    source,
    importedAt: new Date().toISOString(),
    transactions: parsed.transactions,
    holdings,
    warnings,
  };
}

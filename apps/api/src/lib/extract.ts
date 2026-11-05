import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  buildPortfolio,
  displayNameForAsset,
  holdingsFromTransactions,
  parseCsv,
  parseDate,
  parseNumber,
  parseXlsx,
  resolveAsset,
  CASH_ASSETS,
  type Holding,
  type ParsedRows,
  type Portfolio,
  type Transaction,
  type TransactionSide,
} from "@ordium/portfolio";

export interface ExtractionDraft {
  /** true si Gemini a été utilisé ; false si parseur déterministe (CSV/Excel). */
  usedLlm: boolean;
  kind: "transactions" | "holdings";
  currency: string;
  name: string;
  transactions: Transaction[];
  holdings: Holding[];
  warnings: string[];
  /** Résumé court pour l'UI (ce que le modèle a compris). */
  summary: string;
}

const EXTRACTION_PROMPT = `Tu extrais un portefeuille d'investissement depuis un document (PDF, capture d'écran de broker/exchange, ou tableur).

Réponds UNIQUEMENT avec un JSON valide (pas de markdown, pas de \`\`\`) de cette forme exacte :
{
  "kind": "transactions" | "holdings",
  "currency": "EUR" | "USD" | ...,
  "summary": "une phrase en français résumant ce que tu as trouvé",
  "warnings": ["avertissements éventuels"],
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "side": "buy" | "sell",
      "asset": "BTC" | "ETH" | "AAPL" | ...,
      "name": "Bitcoin" | "Apple" | ...,
      "quantity": 0.5,
      "price": 42000,
      "amount": 21000,
      "fee": 1.5,
      "currency": "EUR"
    }
  ],
  "holdings": [
    {
      "asset": "NVDA",
      "name": "NVIDIA",
      "quantity": 3.059,
      "price": 180.34,
      "avgPrice": 99.71,
      "invested": 304.99,
      "value": 551.66,
      "pnl": 246.66,
      "pnlPct": 80.87
    }
  ]
}

Règles STRICTES (exactitude > exhaustivité) :
- kind = "transactions" s'il y a un historique d'achats/ventes avec dates ; sinon "holdings" (photo de positions actuelles).
- Pour holdings : une entrée = UNE ligne du tableau broker. Ne fusionne pas deux instruments.
- Lis les colonnes dans l'ordre typique Trade Republic / brokers FR :
  Instrument | Position(qté) | Dernier(cours) | Valeur | … | Prix d'achat(PRU) | Plus-value € | Plus-value %.
- quantity = UNIQUEMENT la colonne Position (souvent < 100 pour actions, parfois milliers pour ETF). Ne prends JAMAIS un levier (1,84x), un rang (#14), ni une plus-value comme quantité.
- price = colonne "Dernier" (cours unitaire).
- value = colonne "Valeur" (montant total de la ligne en €). C'est souvent le chiffre le plus fiable.
- avgPrice = "Prix d'achat" / PRU unitaire.
- invested = coût total de la ligne si visible ; sinon quantity × avgPrice.
- pnl / pnlPct = colonnes plus-value € / % (signe inclus : rouge = négatif).
- COHÉRENCE OBLIGATOIRE (tolérance ~2 %) :
  • quantity × price ≈ value
  • quantity × avgPrice ≈ invested
  • value − invested ≈ pnl
  • pnl / invested × 100 ≈ pnlPct
  Si un chiffre casse la cohérence, RE-LIS la ligne ; si toujours flou, omets ce champ (null) plutôt que d'inventer. Ne multiplie jamais des colonnes au hasard.
- asset = ticker (NVDA, AAPL, IWDA…). name = libellé visible ("NVIDIA", "MSCI World USD (Acc)").
- Nombres FR : "2,0947" → 2.0947 ; "704,87 €" → 704.87 ; "+41,53 %" → 41.53.
- Ignore cash (EUR, USD, USDT…) et lignes hors positions.
- Si plusieurs captures du MÊME portefeuille : une seule liste sans doublons (même instrument une seule fois).
- Devise : celle du document, sinon celle demandée.`;

interface LlmExtraction {
  kind?: string;
  currency?: string;
  summary?: string;
  warnings?: string[];
  transactions?: unknown[];
  holdings?: unknown[];
}

function requireGeminiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "GEMINI_API_KEY manquante. Créez apps/api/.env à partir de apps/api/env.example " +
        "et collez votre clé (https://aistudio.google.com/apikey).",
    );
  }
  return key;
}

function mimeFor(filename: string, provided?: string): string {
  if (provided && provided !== "application/octet-stream") return provided;
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  const map: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    heic: "image/heic",
    csv: "text/csv",
    tsv: "text/tab-separated-values",
    txt: "text/plain",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
  };
  return map[ext] ?? "application/octet-stream";
}

function isTabular(ext: string): boolean {
  return ["csv", "tsv", "txt", "xlsx", "xls"].includes(ext);
}

function isVisionDoc(ext: string): boolean {
  return ["pdf", "png", "jpg", "jpeg", "webp", "gif", "heic"].includes(ext);
}

function normalizeSide(raw: unknown): TransactionSide | null {
  const s = String(raw ?? "")
    .toLowerCase()
    .trim();
  if (s === "buy" || s === "achat") return "buy";
  if (s === "sell" || s === "vente") return "sell";
  return null;
}

function sanitizeTransactions(rows: unknown[]): Transaction[] {
  const out: Transaction[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const date = parseDate(r.date) ?? (typeof r.date === "string" ? r.date.slice(0, 10) : null);
    const side = normalizeSide(r.side);
    const quantity = parseNumber(r.quantity);
    const rawAsset = String(r.asset ?? "").trim();
    if (!date || !side || quantity == null || quantity <= 0 || !rawAsset) continue;
    const { asset, quote } = resolveAsset(rawAsset);
    if (CASH_ASSETS.has(asset)) continue;
    const price = parseNumber(r.price) ?? undefined;
    const amount = parseNumber(r.amount) ?? (price != null ? quantity * price : undefined);
    const fee = parseNumber(r.fee) ?? undefined;
    const currency = r.currency ? String(r.currency).trim().toUpperCase() : quote;
    out.push({ date, side, asset, quantity, price, amount, fee, currency });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

const REL_TOL = 0.03; // 3 % — au-delà, on corrige / on signale

function relDiff(a: number, b: number): number {
  const den = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / den;
}

/**
 * Recale quantité / cours / valeur / investi / P&L pour qu'ils soient cohérents.
 * Priorité : value + price (colonnes broker les plus lisibles) > quantity brute OCR.
 */
function reconcileHolding(h: Holding, warnings: string[]): Holding {
  let { quantity, price, avgPrice, invested, value, pnl, pnlPct, name, asset } = h;
  const label = name || asset;

  if (quantity > 0 && price != null && price > 0 && value != null && value > 0) {
    const impliedQty = value / price;
    const product = quantity * price;
    if (relDiff(product, value) > REL_TOL) {
      warnings.push(
        `${label} : quantité×cours (${product.toFixed(2)}) ≠ valeur (${value.toFixed(2)}) — quantité corrigée ${quantity.toFixed(4)} → ${impliedQty.toFixed(4)}.`,
      );
      quantity = impliedQty;
    }
  } else if (price != null && price > 0 && value != null && quantity <= 0) {
    quantity = value / price;
  } else if (value == null && price != null && quantity > 0) {
    value = quantity * price;
  }

  if (quantity > 0 && avgPrice != null && avgPrice > 0) {
    const impliedInvested = quantity * avgPrice;
    if (invested == null) {
      invested = impliedInvested;
    } else if (relDiff(invested, impliedInvested) > REL_TOL) {
      const impliedAvg = invested / quantity;
      if (relDiff(avgPrice, impliedAvg) > REL_TOL) {
        warnings.push(
          `${label} : PRU recalé ${avgPrice.toFixed(2)} → ${impliedAvg.toFixed(2)} pour coller à l'investi.`,
        );
        avgPrice = impliedAvg;
      }
    }
  } else if (invested == null && avgPrice != null && quantity > 0) {
    invested = quantity * avgPrice;
  } else if (avgPrice == null && invested != null && quantity > 0) {
    avgPrice = invested / quantity;
  }

  if (value != null && invested != null) {
    const impliedPnl = value - invested;
    if (pnl == null || relDiff(pnl, impliedPnl) > REL_TOL) {
      if (pnl != null && relDiff(pnl, impliedPnl) > REL_TOL) {
        warnings.push(
          `${label} : P&L lu (${pnl.toFixed(2)}) ≠ valeur−investi (${impliedPnl.toFixed(2)}) — P&L recalculé.`,
        );
      }
      pnl = impliedPnl;
    }
    if (invested > 0) {
      const impliedPct = (pnl / invested) * 100;
      if (pnlPct == null || Math.abs((pnlPct ?? 0) - impliedPct) > 0.5) {
        pnlPct = impliedPct;
      }
    }
  } else if (pnl != null && invested != null && invested > 0 && pnlPct == null) {
    pnlPct = (pnl / invested) * 100;
  }

  if (value != null && quantity > 0 && price != null && price > 0) {
    const ratio = value / (quantity * price);
    if (ratio > 50 || ratio < 0.02) {
      warnings.push(
        `${label} : écart extrême valeur/qté×cours — vérifiez cette ligne manuellement.`,
      );
    }
  }

  return { asset, quantity, name, price, avgPrice, invested, value, pnl, pnlPct };
}

function sanitizeHoldings(rows: unknown[]): { holdings: Holding[]; warnings: string[] } {
  const map = new Map<string, Holding>();
  const warnings: string[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const rawAsset = String(r.asset ?? r.name ?? "").trim();
    let quantity = parseNumber(r.quantity);
    if (!rawAsset) continue;
    const { asset } = resolveAsset(rawAsset);
    if (CASH_ASSETS.has(asset)) continue;

    const price = parseNumber(r.price) ?? undefined;
    const avgPrice = parseNumber(r.avgPrice ?? r.avg_price ?? r.pru) ?? undefined;
    const invested = parseNumber(r.invested ?? r.cost ?? r.costBasis) ?? undefined;
    const value = parseNumber(r.value ?? r.marketValue) ?? undefined;
    const pnl = parseNumber(r.pnl ?? r.pl ?? r.gain) ?? undefined;
    const pnlPct = parseNumber(r.pnlPct ?? r.plPct ?? r.pnl_pct ?? r.gainPct) ?? undefined;

    if ((quantity == null || quantity <= 0) && value != null && price != null && price > 0) {
      quantity = value / price;
    }
    if (quantity == null || quantity <= 0) continue;

    const name =
      displayNameForAsset(asset, String(r.name ?? r.label ?? r.instrument ?? "").trim() || undefined) ??
      undefined;

    const reconciled = reconcileHolding(
      { asset, quantity, name, price, avgPrice, invested, value, pnl, pnlPct },
      warnings,
    );

    const prev = map.get(asset);
    if (!prev) {
      map.set(asset, reconciled);
      continue;
    }

    // Doublon (pages qui se chevauchent) : garder la plus riche, ne PAS additionner.
    const score = (h: Holding) =>
      [h.value, h.invested, h.price, h.avgPrice, h.name].filter((x) => x != null && x !== "").length;
    warnings.push(`${name || asset} : doublon ignoré (même ticker sur plusieurs pages).`);
    if (score(reconciled) >= score(prev)) map.set(asset, reconciled);
  }

  const holdings = [...map.values()]
    .map((h) => reconcileHolding(h, warnings))
    .sort((a, b) => a.asset.localeCompare(b.asset));
  return { holdings, warnings };
}

/** Fusionne des positions (même ticker) en conservant les métriques d'import. */
function mergeHoldingsList(items: Holding[]): Holding[] {
  return sanitizeHoldings(items).holdings;
}

function draftFromParsed(
  name: string,
  currency: string,
  parsed: ParsedRows,
  usedLlm: boolean,
  summary: string,
): ExtractionDraft {
  const holdings =
    parsed.kind === "transactions"
      ? holdingsFromTransactions(parsed.transactions)
      : parsed.holdings;
  return {
    usedLlm,
    kind: parsed.kind,
    currency: currency.toUpperCase(),
    name,
    transactions: parsed.transactions,
    holdings,
    warnings: parsed.warnings,
    summary,
  };
}

/** Modèles essayés dans l'ordre — 2.0-flash est souvent à quota 0 sur les nouvelles clés. */
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

function humanizeGeminiError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/429|quota|rate.?limit/i.test(msg)) {
    return (
      "Quota Gemini dépassé (ou modèle sans accès free tier). " +
      "Dans apps/api/.env, essayez GEMINI_MODEL=gemini-3.5-flash-lite " +
      "ou créez une nouvelle clé sur https://aistudio.google.com/apikey — puis redémarrez l'API."
    );
  }
  if (/404|no longer available/i.test(msg)) {
    return (
      "Modèle Gemini indisponible. Définissez GEMINI_MODEL=gemini-3.5-flash-lite dans apps/api/.env."
    );
  }
  return msg;
}

function parseLlmJson(text: string): LlmExtraction {
  try {
    return JSON.parse(text) as LlmExtraction;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Gemini n'a pas renvoyé de JSON exploitable.");
    return JSON.parse(match[0]) as LlmExtraction;
  }
}

function draftFromLlm(
  raw: LlmExtraction,
  preferredCurrency: string,
  name: string,
  fileCount: number,
): ExtractionDraft {
  const kind = raw.kind === "holdings" ? "holdings" : "transactions";
  const currency = (raw.currency || preferredCurrency).toUpperCase();
  const transactions = sanitizeTransactions(raw.transactions ?? []);
  const sanitized =
    kind === "holdings"
      ? sanitizeHoldings(raw.holdings ?? [])
      : { holdings: holdingsFromTransactions(transactions), warnings: [] as string[] };
  const holdings = sanitized.holdings;

  if (kind === "transactions" && transactions.length === 0) {
    throw new Error(
      "Aucune transaction reconnue. Essayez des captures plus nettes, ou un export CSV/Excel.",
    );
  }
  if (kind === "holdings" && holdings.length === 0) {
    throw new Error("Aucune position reconnue dans le document.");
  }

  return {
    usedLlm: true,
    kind,
    currency,
    name,
    transactions: kind === "transactions" ? transactions : [],
    holdings,
    warnings: [...(raw.warnings ?? []), ...sanitized.warnings],
    summary:
      raw.summary?.trim() ||
      (fileCount > 1
        ? `${fileCount} fichiers analysés par Gemini.`
        : "Document analysé par Gemini."),
  };
}

/**
 * Un seul appel Gemini avec 1..N pièces jointes (screenshots/PDF).
 * Essaie plusieurs modèles si quota / 404.
 */
async function extractWithGeminiParts(opts: {
  parts: { buffer: Buffer; mimeType: string; filename: string }[];
  preferredCurrency: string;
}): Promise<ExtractionDraft> {
  const key = requireGeminiKey();
  const genAI = new GoogleGenerativeAI(key);
  const names = opts.parts.map((p) => p.filename);
  const name =
    names.length === 1
      ? names[0]!.replace(/\.[^.]+$/, "") || "Mon portefeuille"
      : names.length <= 2
        ? names.map((n) => n.replace(/\.[^.]+$/, "")).join(" + ")
        : `${names[0]!.replace(/\.[^.]+$/, "")} + ${names.length - 1} autres`;

  const contentParts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> =
    opts.parts.map((p) => ({
      inlineData: {
        mimeType: p.mimeType === "application/octet-stream" ? "application/pdf" : p.mimeType,
        data: p.buffer.toString("base64"),
      },
    }));
  contentParts.push({
    text:
      EXTRACTION_PROMPT +
      `\nDevise préférée de l'utilisateur (si absente du document) : ${opts.preferredCurrency}.` +
      `\nFichiers (${opts.parts.length}) : ${names.join(", ")}.` +
      (opts.parts.length > 1
        ? "\nCe sont des captures/pages du MÊME portefeuille : fusionne toutes les lignes en un seul JSON."
        : ""),
  });

  const errors: string[] = [];
  for (const modelId of geminiModelCandidates()) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelId,
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
      });
      const result = await model.generateContent(contentParts);
      const raw = parseLlmJson(result.response.text());
      const draft = draftFromLlm(raw, opts.preferredCurrency, name, opts.parts.length);
      if (modelId !== geminiModelCandidates()[0]) {
        draft.warnings = [`Modèle utilisé : ${modelId}`, ...draft.warnings];
      }
      return draft;
    } catch (err) {
      errors.push(`${modelId} : ${humanizeGeminiError(err)}`);
      // 429 / 404 → essayer le suivant ; autre erreur fatale si un seul modèle
      const msg = err instanceof Error ? err.message : String(err);
      if (!/429|404|quota|no longer available|rate.?limit|high demand|503/i.test(msg)) {
        throw new Error(humanizeGeminiError(err));
      }
    }
  }
  throw new Error(errors[errors.length - 1] ?? "Aucun modèle Gemini disponible.");
}

/**
 * Extraction d'un portefeuille depuis un fichier.
 * CSV/Excel propres → parseur déterministe (gratuit).
 * PDF / screenshot / Excel illisible → Gemini vision.
 */
export async function extractPortfolioFile(opts: {
  buffer: Buffer;
  filename: string;
  mimeType?: string;
  preferredCurrency: string;
}): Promise<ExtractionDraft> {
  const filename = opts.filename || "document";
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  const mime = mimeFor(filename, opts.mimeType);
  const currency = opts.preferredCurrency.toUpperCase();
  const name = filename.replace(/\.[^.]+$/, "") || "Mon portefeuille";

  if (isTabular(ext)) {
    try {
      let parsed: ParsedRows;
      if (ext === "xlsx" || ext === "xls") {
        parsed = parseXlsx(new Uint8Array(opts.buffer));
      } else {
        parsed = parseCsv(opts.buffer.toString("utf8"));
      }
      return draftFromParsed(
        name,
        currency,
        parsed,
        false,
        "Fichier tableur lu sans IA (parseur Ordium).",
      );
    } catch (err) {
      try {
        return await extractWithGeminiParts({
          parts: [
            {
              buffer: opts.buffer,
              mimeType: mime.startsWith("text/") ? "text/plain" : mime,
              filename,
            },
          ],
          preferredCurrency: currency,
        });
      } catch (llmErr) {
        throw new Error(
          `Parseur : ${(err as Error).message}. Gemini : ${humanizeGeminiError(llmErr)}`,
        );
      }
    }
  }

  if (isVisionDoc(ext) || mime.startsWith("image/") || mime === "application/pdf") {
    return extractWithGeminiParts({
      parts: [{ buffer: opts.buffer, mimeType: mime, filename }],
      preferredCurrency: currency,
    });
  }

  throw new Error(
    `Format .${ext || "?"} non géré. Envoyez un CSV, Excel, PDF ou une image (PNG/JPG/WebP).`,
  );
}

/** Assemble un Portfolio à partir d'un brouillon (éventuellement édité par l'utilisateur). */
export function portfolioFromDraft(
  draft: Pick<
    ExtractionDraft,
    "name" | "currency" | "kind" | "transactions" | "holdings" | "warnings"
  >,
  source: Portfolio["source"] = "manual",
): Portfolio {
  return buildPortfolio(
    draft.name,
    draft.currency,
    source,
    {
      kind: draft.kind,
      transactions: draft.kind === "transactions" ? draft.transactions : [],
      holdings: draft.kind === "holdings" ? draft.holdings : [],
      warnings: draft.warnings,
    },
  );
}

function txKey(t: Transaction): string {
  return `${t.date}|${t.side}|${t.asset}|${t.quantity}|${t.price ?? ""}|${t.amount ?? ""}`;
}

/** Fusionne plusieurs brouillons (plusieurs screenshots / PDF). */
export function mergeDrafts(drafts: ExtractionDraft[], preferredCurrency: string): ExtractionDraft {
  if (drafts.length === 0) {
    throw new Error("Aucun fichier à fusionner.");
  }
  if (drafts.length === 1) return drafts[0]!;

  const seen = new Set<string>();
  const transactions: Transaction[] = [];
  for (const d of drafts) {
    for (const t of d.transactions) {
      const key = txKey(t);
      if (seen.has(key)) continue;
      seen.add(key);
      transactions.push(t);
    }
  }
  transactions.sort((a, b) => (a.date < b.date ? -1 : 1));

  // Positions : si on a des transactions, on les reconstruit ; sinon on fusionne.
  let holdings: Holding[];
  if (transactions.length > 0) {
    holdings = holdingsFromTransactions(transactions);
  } else {
    holdings = mergeHoldingsList(drafts.flatMap((d) => d.holdings));
  }

  const warnings = drafts.flatMap((d, i) =>
    d.warnings.map((w) => `[fichier ${i + 1}] ${w}`),
  );
  const names = drafts.map((d) => d.name).filter(Boolean);
  const usedLlm = drafts.some((d) => d.usedLlm);
  const kind = transactions.length > 0 ? "transactions" : "holdings";

  return {
    usedLlm,
    kind,
    currency: drafts[0]?.currency || preferredCurrency,
    name: names.length <= 2 ? names.join(" + ") : `${names[0]} + ${names.length - 1} autres`,
    transactions,
    holdings,
    warnings,
    summary: `${drafts.length} fichiers fusionnés — ${drafts.map((d) => d.summary).join(" · ")}`,
  };
}

/** Extrait puis fusionne plusieurs fichiers (screenshots successifs, etc.). */
export async function extractPortfolioFiles(
  files: { buffer: Buffer; filename: string; mimeType?: string }[],
  preferredCurrency: string,
): Promise<ExtractionDraft> {
  if (files.length === 0) throw new Error("Aucun fichier reçu.");

  const tabular: { buffer: Buffer; filename: string; mimeType?: string }[] = [];
  const vision: { buffer: Buffer; filename: string; mimeType: string }[] = [];

  for (const f of files) {
    const ext = (f.filename.split(".").pop() ?? "").toLowerCase();
    const mime = mimeFor(f.filename, f.mimeType);
    if (isTabular(ext)) tabular.push(f);
    else if (isVisionDoc(ext) || mime.startsWith("image/") || mime === "application/pdf") {
      vision.push({ buffer: f.buffer, filename: f.filename, mimeType: mime });
    } else {
      throw new Error(
        `Format non géré pour ${f.filename}. Envoyez CSV, Excel, PDF ou image.`,
      );
    }
  }

  const drafts: ExtractionDraft[] = [];
  const errors: string[] = [];

  for (const f of tabular) {
    try {
      drafts.push(
        await extractPortfolioFile({
          buffer: f.buffer,
          filename: f.filename,
          mimeType: f.mimeType,
          preferredCurrency,
        }),
      );
    } catch (err) {
      errors.push(`${f.filename} : ${humanizeGeminiError(err)}`);
    }
  }

  // Tous les screenshots/PDF en UN seul appel Gemini (économie de quota).
  if (vision.length > 0) {
    try {
      drafts.push(
        await extractWithGeminiParts({
          parts: vision,
          preferredCurrency,
        }),
      );
    } catch (err) {
      errors.push(humanizeGeminiError(err));
    }
  }

  if (drafts.length === 0) {
    throw new Error(errors.join("\n") || "Aucun fichier exploitable.");
  }
  const merged = mergeDrafts(drafts, preferredCurrency);
  if (errors.length > 0) {
    merged.warnings = [...errors.map((e) => `Partiel — ${e}`), ...merged.warnings];
  }
  return merged;
}

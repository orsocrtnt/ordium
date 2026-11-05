import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  buildPortfolio,
  fetchAlpacaPortfolio,
  fetchBinancePortfolio,
  fetchCoinbasePortfolio,
  fetchIbkrPortfolio,
  fetchKrakenPortfolio,
  fetchTrading212Portfolio,
  holdingsFromTransactions,
  parseCsv,
  parseXlsx,
  type BrokerEnvironment,
  type ConnectorResult,
  type Holding,
  type ParsedRows,
  type Portfolio,
  type PortfolioSource,
  type Transaction,
} from "@ordium/portfolio";
import {
  extractPortfolioFiles,
  portfolioFromDraft,
  type ExtractionDraft,
} from "../lib/extract.js";
import {
  deletePortfolio,
  loadPortfolio,
  portfolioPayload,
  savePortfolio,
} from "../lib/portfolio.js";
import { userKeyFromRequest } from "../lib/userKey.js";

const CONNECTABLE = new Set([
  "binance",
  "kraken",
  "coinbase",
  "alpaca",
  "trading212",
  "ibkr",
]);

const DISPLAY_NAMES: Record<string, string> = {
  binance: "Binance",
  kraken: "Kraken",
  coinbase: "Coinbase",
  alpaca: "Alpaca",
  trading212: "Trading 212",
  ibkr: "Interactive Brokers",
};
function fieldValue(fields: Record<string, unknown>, key: string): string | undefined {
  const raw = fields[key];
  if (!raw) return undefined;
  const part = Array.isArray(raw) ? raw[0] : raw;
  if (part && typeof part === "object" && "value" in part) {
    return String((part as { value: unknown }).value);
  }
  return undefined;
}

async function readMultipartFiles(req: FastifyRequest): Promise<{
  files: { buffer: Buffer; filename: string; mimeType: string }[];
  currency: string;
}> {
  const files: { buffer: Buffer; filename: string; mimeType: string }[] = [];
  let currency = "EUR";
  for await (const part of req.files()) {
    const fromField = fieldValue(part.fields as Record<string, unknown>, "currency");
    if (fromField) currency = fromField;
    files.push({
      buffer: await part.toBuffer(),
      filename: part.filename || `fichier-${files.length + 1}`,
      mimeType: part.mimetype,
    });
  }
  return { files, currency };
}
export async function portfolioRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { market?: string } }>("/api/portfolio", async (req, reply) => {
    try {
      const userKey = userKeyFromRequest(req);
      const portfolio = await loadPortfolio(userKey);
      if (!portfolio) return null;
      const preferMarket = req.query.market === "1" || req.query.market === "true";
      return await portfolioPayload(portfolio, { preferMarket });
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  app.delete("/api/portfolio", async (req) => {
    await deletePortfolio(userKeyFromRequest(req));
    return { ok: true };
  });

  /**
   * Extraction intelligente (1 ou N fichiers).
   * CSV/Excel → parseur ; PDF/screenshot → Gemini. Ne sauvegarde pas.
   * Champ multipart : `file` (répétable) + `currency`.
   */
  app.post("/api/portfolio/extract", async (req, reply) => {
    try {
      const { files, currency } = await readMultipartFiles(req);
      if (files.length === 0) {
        return reply.code(400).send({ error: "Aucun fichier reçu." });
      }
      const draft = await extractPortfolioFiles(files, currency);
      return draft;
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  /** Confirme un brouillon (éventuellement édité) et sauvegarde. */
  app.post<{ Body: ExtractionDraft & { source?: PortfolioSource } }>(
    "/api/portfolio/confirm",
    async (req, reply) => {
    try {
      const userKey = userKeyFromRequest(req);
      const body = req.body;
      if (!body?.name || !body.currency || !body.kind) {
        return reply.code(400).send({ error: "Brouillon incomplet." });
      }
      const source: Portfolio["source"] =
        body.source ?? (body.usedLlm ? "manual" : "csv");
      const portfolio = portfolioFromDraft(
        {
          name: body.name,
          currency: body.currency,
          kind: body.kind,
          transactions: (body.transactions ?? []) as Transaction[],
          holdings: (body.holdings ?? []) as Holding[],
          warnings: body.warnings ?? [],
        },
        source,
      );
      // Ne reconstruire les holdings depuis les txs que s'il y a un historique.
      // Sinon on conserve name / invested / value / pnl issus de l'extraction.
      if (portfolio.transactions.length > 0 && body.kind === "transactions") {
        const enriched = new Map(portfolio.holdings.map((h) => [h.asset, h]));
        portfolio.holdings = holdingsFromTransactions(portfolio.transactions).map((h) => ({
          ...h,
          ...enriched.get(h.asset),
          asset: h.asset,
          quantity: h.quantity,
        }));
      }
      if (portfolio.holdings.length === 0) {
        return reply.code(400).send({ error: "Aucune position à enregistrer." });
      }
      await savePortfolio(portfolio, userKey);
      return await portfolioPayload(portfolio);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  },
  );

  /** Import direct CSV/Excel (sans revue) — rétrocompatibilité. */
  app.post("/api/portfolio/import", async (req, reply) => {
    try {
      const userKey = userKeyFromRequest(req);
      const file = await req.file();
      if (!file) {
        return reply.code(400).send({ error: "Aucun fichier reçu." });
      }
      const fields = file.fields as Record<string, { value?: string } | undefined>;
      const currency = String(fields.currency?.value ?? "EUR");
      const filename = file.filename || "Mon portefeuille";
      const name = filename.replace(/\.[^.]+$/, "") || "Mon portefeuille";
      const extension = (filename.split(".").pop() ?? "").toLowerCase();
      const buffer = await file.toBuffer();

      if (["pdf", "png", "jpg", "jpeg", "webp", "gif", "heic"].includes(extension)) {
        const draft = await extractPortfolioFiles(
          [{ buffer, filename, mimeType: file.mimetype }],
          currency,
        );
        return reply.code(202).send({ needsReview: true, draft });
      }

      let parsed: ParsedRows;
      if (extension === "xlsx" || extension === "xls") {
        parsed = parseXlsx(new Uint8Array(buffer));
      } else if (extension === "csv" || extension === "txt" || extension === "tsv") {
        parsed = parseCsv(buffer.toString("utf8"));
      } else {
        return reply.code(400).send({
          error: `Format .${extension} non géré : CSV, Excel, PDF ou image.`,
        });
      }

      const portfolio = buildPortfolio(
        name,
        currency,
        extension.startsWith("x") ? "xlsx" : "csv",
        parsed,
      );
      await savePortfolio(portfolio, userKey);
      return await portfolioPayload(portfolio);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{
    Body: {
      exchange?: string;
      apiKey?: string;
      apiSecret?: string;
      currency?: string;
      /** paper (défaut) | live — Alpaca & Trading 212 */
      environment?: string;
    };
  }>("/api/portfolio/connect", async (req, reply) => {
    try {
      const userKey = userKeyFromRequest(req);
      const body = req.body;
      const exchange = (body.exchange ?? "").toLowerCase();
      if (!body.apiKey?.trim() || !body.apiSecret?.trim()) {
        return reply.code(400).send({ error: "Clé API et secret requis." });
      }
      if (!CONNECTABLE.has(exchange)) {
        return reply.code(400).send({
          error: `Broker inconnu : ${body.exchange}. Attendu : ${[...CONNECTABLE].join(", ")}.`,
        });
      }
      const creds = { apiKey: body.apiKey.trim(), apiSecret: body.apiSecret.trim() };
      const currency = (body.currency ?? "EUR").toUpperCase();
      const environment: BrokerEnvironment =
        body.environment === "live" ? "live" : "paper";

      let result: ConnectorResult;
      if (exchange === "binance") result = await fetchBinancePortfolio(creds, currency);
      else if (exchange === "kraken") result = await fetchKrakenPortfolio(creds);
      else if (exchange === "coinbase") result = await fetchCoinbasePortfolio(creds);
      else if (exchange === "alpaca") result = await fetchAlpacaPortfolio(creds, environment);
      else if (exchange === "trading212")
        result = await fetchTrading212Portfolio(creds, environment);
      else if (exchange === "ibkr") result = await fetchIbkrPortfolio(creds);
      else {
        return reply.code(400).send({ error: `Broker non géré : ${exchange}` });
      }

      const holdings =
        result.holdings.length > 0
          ? result.holdings
          : holdingsFromTransactions(result.transactions);
      if (holdings.length === 0 && result.transactions.length === 0) {
        return reply.code(400).send({
          error: "Aucune position ni transaction trouvée sur ce compte.",
        });
      }

      const portfolio: Portfolio = {
        name: `Portefeuille ${DISPLAY_NAMES[exchange] ?? exchange}`,
        currency,
        source: exchange as PortfolioSource,
        importedAt: new Date().toISOString(),
        transactions: result.transactions,
        holdings,
        warnings: result.warnings,
      };
      await savePortfolio(portfolio, userKey);
      return await portfolioPayload(portfolio);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}

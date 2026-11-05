import type { FastifyPluginAsync } from "fastify";
import { analyzeLiveSymbols, fetchChartSeries } from "../lib/markets.js";

export const marketsRoutes: FastifyPluginAsync = async (app) => {
  /** Analyse live : indicateurs (RSI, MACD, Bollinger, SMA, vol) + Fear & Greed. */
  app.post<{
    Body: {
      symbols?: Array<{ symbol: string; assetType?: string; quote?: string }>;
    };
  }>("/api/markets/live", async (req, reply) => {
    const symbols = req.body?.symbols?.length
      ? req.body.symbols
      : [
          { symbol: "BTC", assetType: "crypto", quote: "USDT" },
          { symbol: "ETH", assetType: "crypto", quote: "USDT" },
          { symbol: "SPY", assetType: "etf", quote: "USD" },
          { symbol: "AAPL", assetType: "stock", quote: "USD" },
        ];
    try {
      return await analyzeLiveSymbols(symbols.slice(0, 12));
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  /**
   * Chart OHLC + séries d’indicateurs (@ordium/engine — mêmes formules que les règles).
   * TF : 1d | 1h.
   */
  app.post<{
    Body: {
      symbol?: string;
      timeframe?: "1d" | "1h";
      assetType?: string;
      quote?: string;
    };
  }>("/api/markets/chart", async (req, reply) => {
    const symbol = req.body?.symbol?.trim();
    if (!symbol) {
      return reply.code(400).send({ error: "symbol requis" });
    }
    try {
      return await fetchChartSeries({
        symbol,
        timeframe: req.body?.timeframe === "1h" ? "1h" : "1d",
        assetType: req.body?.assetType,
        quote: req.body?.quote,
      });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.get("/api/markets/fear-greed", async (_req, reply) => {
    try {
      const { fetchFearGreedIndex } = await import("@ordium/data");
      return await fetchFearGreedIndex();
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });
};

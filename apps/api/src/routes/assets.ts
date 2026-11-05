import type { FastifyInstance } from "fastify";
import { fetchAsset, listAssets } from "../lib/data.js";

export async function assetsRoutes(app: FastifyInstance) {
  app.get("/api/assets", async () => listAssets());

  app.post<{
    Body: { symbol?: string; assetType?: string; quote?: string };
  }>("/api/assets", async (req, reply) => {
    try {
      if (!req.body?.symbol?.trim()) {
        return reply.code(400).send({ error: "Symbole manquant." });
      }
      return await fetchAsset(req.body.symbol, req.body.assetType, req.body.quote ?? "EUR");
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}

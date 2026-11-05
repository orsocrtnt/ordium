import type { FastifyInstance } from "fastify";
import {
  applyPresetId,
  interpretStrategyTurn,
  listReadyPresets,
  proposeAlternatives,
  type ChatHistoryItem,
} from "../lib/interpretStrategy.js";
import { sanitizeFormPatch, STRATEGY_PRESETS, type StrategyFormPatch } from "@ordium/engine";

export async function strategyRoutes(app: FastifyInstance) {
  app.get("/api/strategy/presets", async () => ({
    ready: listReadyPresets(),
    all: STRATEGY_PRESETS.map((p) => ({
      id: p.id,
      name: p.name,
      family: p.family,
      status: p.status,
      summary: p.summary,
    })),
  }));

  app.post<{
    Body: {
      prompt?: string;
      presetId?: string;
      history?: ChatHistoryItem[];
      draft?: Record<string, unknown>;
      awaitingField?:
        | "budget"
        | "frequency"
        | "window"
        | "assets"
        | "budgetSplit"
        | "assetClassMix"
        | "startDate"
        | null;
      portfolioCurrency?: string;
      firstTransactionDate?: string | null;
      action?: "alternatives";
    };
  }>("/api/strategy/interpret", async (req, reply) => {
    try {
      if (req.body?.action === "alternatives") {
        const draft = req.body.draft
          ? sanitizeFormPatch(req.body.draft)
          : ({} as StrategyFormPatch);
        return proposeAlternatives(draft);
      }

      const presetId = req.body?.presetId?.trim();
      if (presetId) {
        return applyPresetId(presetId);
      }

      const prompt = req.body?.prompt?.trim() ?? "";
      if (!prompt) {
        return reply.code(400).send({ error: "Indiquez un prompt ou un presetId." });
      }

      return await interpretStrategyTurn({
        prompt,
        history: Array.isArray(req.body?.history) ? req.body.history : [],
        draft: req.body?.draft
          ? sanitizeFormPatch(req.body.draft)
          : undefined,
        awaitingField: req.body?.awaitingField ?? null,
        portfolioCurrency: req.body?.portfolioCurrency,
        firstTransactionDate: req.body?.firstTransactionDate ?? null,
      });
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}

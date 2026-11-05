import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { startScheduler } from "@ordium/execution";
import { assetsRoutes } from "./routes/assets.js";
import { backtestRoutes } from "./routes/backtest.js";
import { executionRoutes } from "./routes/execution.js";
import { learnRoutes } from "./routes/learn.js";
import { marketsRoutes } from "./routes/markets.js";
import { portfolioRoutes } from "./routes/portfolio.js";
import { strategyRoutes } from "./routes/strategy.js";

// Charge apps/api/.env (clé Gemini, etc.) — jamais exposée au front.
const apiDir = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(apiDir, "../.env");
if (existsSync(envPath)) loadEnv({ path: envPath, override: true });
else loadEnv({ override: true });

const PORT = Number(process.env.API_PORT ?? process.env.PORT ?? 4000);
const HOST = process.env.API_HOST ?? "0.0.0.0";

const CORS_ORIGIN = (process.env.CORS_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

async function main() {
  const app = Fastify({
    logger: true,
    bodyLimit: 25 * 1024 * 1024,
  });

  await app.register(cors, {
    origin: CORS_ORIGIN,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Ordium-User"],
  });
  await app.register(multipart, {
    limits: { fileSize: 20 * 1024 * 1024 },
  });

  app.get("/health", async () => ({
    ok: true,
    service: "ordium-api",
    time: new Date().toISOString(),
    gemini: Boolean(process.env.GEMINI_API_KEY?.trim()),
    alpaca: Boolean(
      process.env.ALPACA_API_KEY?.trim() && process.env.ALPACA_API_SECRET?.trim(),
    ),
    polygon: Boolean(process.env.POLYGON_API_KEY?.trim()),
  }));

  await app.register(assetsRoutes);
  await app.register(backtestRoutes);
  await app.register(portfolioRoutes);
  await app.register(strategyRoutes);
  await app.register(executionRoutes);
  await app.register(marketsRoutes);
  await app.register(learnRoutes);

  await app.listen({ port: PORT, host: HOST });
  startScheduler(60_000);
  app.log.info(`Ordium API prête sur http://localhost:${PORT} (scheduler exécution actif)`);
  if (!process.env.GEMINI_API_KEY?.trim()) {
    app.log.warn(
      "GEMINI_API_KEY absente — PDF/screenshots et prompt stratégie en mode lexical. Voir apps/api/env.example",
    );
  }
  if (!process.env.ALPACA_API_KEY?.trim() || !process.env.ALPACA_API_SECRET?.trim()) {
    app.log.warn(
      "ALPACA_API_KEY/SECRET absents — actions US via Yahoo (secours). Compte gratuit : https://app.alpaca.markets/signup",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

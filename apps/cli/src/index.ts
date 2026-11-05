import { readFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { parseStrategy, runBacktest, toClassicDca } from "@ordium/engine";
import {
  ASSET_TYPES,
  defaultDataDir,
  getHistoricalPrices,
  listAssets,
  type AssetType,
} from "@ordium/data";
import { printReport } from "./report.js";

/** Résout un chemin utilisateur depuis son cwd d'origine (pnpm change le cwd). */
function resolveUserPath(p: string): string {
  if (path.isAbsolute(p)) return p;
  return path.resolve(process.env.INIT_CWD ?? process.cwd(), p);
}

function yesterday(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

/** Marge d'historique avant le début du backtest, requise par SMA200/RSI. */
function warmupFrom(from: string): string {
  return new Date(Date.parse(`${from}T00:00:00Z`) - 600 * 86_400_000).toISOString().slice(0, 10);
}

const program = new Command();
program
  .name("ordium")
  .description(
    "Ordium — votre stratégie, exécutée automatiquement. Données de marché + backtest.",
  )
  .version("0.2.0");

program
  .command("fetch")
  .description(
    "Télécharge l'historique journalier d'un actif ; le fournisseur gratuit est choisi automatiquement",
  )
  .argument("<symbol>", "symbole de l'actif : BTC, SPY, MC.PA, ^GSPC, EUR/USD…")
  .option("--type <type>", `classe d'actif : ${ASSET_TYPES.join(" | ")}`, "crypto")
  .option("--quote <currency>", "devise de cotation souhaitée (crypto)", "EUR")
  .option("--from <date>", "date de début YYYY-MM-DD", "2017-01-01")
  .option("--data-dir <dir>", "répertoire de cache", defaultDataDir())
  .action(async (symbol: string, opts) => {
    const type = String(opts.type).toLowerCase() as AssetType;
    if (!ASSET_TYPES.includes(type)) {
      throw new Error(`Classe d'actif inconnue : ${type} (attendu : ${ASSET_TYPES.join(", ")})`);
    }
    const series = await getHistoricalPrices(symbol, type, "1d", opts.from, yesterday(), {
      dataDir: opts.dataDir,
      quote: opts.quote,
      strictQuote: type === "crypto",
    });
    const first = series.candles[0]!.date;
    const last = series.candles[series.candles.length - 1]!.date;
    console.log(
      `${series.symbol} (${series.quote}, ${series.assetType ?? type}) : ` +
        `${series.candles.length} bougies [${first} → ${last}] via ${series.source}`,
    );
  });

program
  .command("backtest")
  .description(
    "Rejoue une stratégie sur l'historique (téléchargé au besoin) et la compare à un DCA classique",
  )
  .requiredOption("-s, --strategy <path>", "chemin du fichier JSON de stratégie")
  .option("--from <date>", "début du backtest", "2021-01-01")
  .option("--to <date>", "fin du backtest", yesterday())
  .option("--fee <pct>", "frais de transaction en %", "0.1")
  .option("--json", "sortie JSON complète (pour scripts/outils)")
  .option("--data-dir <dir>", "répertoire de cache", defaultDataDir())
  .action(async (opts) => {
    const raw = JSON.parse(await readFile(resolveUserPath(opts.strategy), "utf8"));
    const strategy = parseStrategy(raw);

    const series = await Promise.all(
      strategy.allocation.map((a) =>
        getHistoricalPrices(a.asset, undefined, "1d", warmupFrom(opts.from), opts.to, {
          dataDir: opts.dataDir,
          quote: strategy.budget.currency,
        }),
      ),
    );

    const options = { from: opts.from, to: opts.to, feePct: Number(opts.fee) };
    const result = runBacktest(strategy, series, options);
    const baseline = runBacktest(toClassicDca(strategy), series, options);

    if (opts.json) {
      console.log(JSON.stringify({ result, baseline }, null, 2));
      return;
    }
    printReport(result, baseline, strategy.budget.currency);
  });

program
  .command("data")
  .description("Liste les séries de prix en cache")
  .option("--data-dir <dir>", "répertoire de cache", defaultDataDir())
  .action(async (opts) => {
    const assets = await listAssets(opts.dataDir);
    if (assets.length === 0) {
      console.log("Aucune donnée en cache. Exemple : pnpm ordium fetch BTC --quote EUR");
      return;
    }
    for (const a of assets) {
      console.log(
        `  ${a.symbol} (${a.quote}) : ${a.candleCount} bougies [${a.firstDate} → ${a.lastDate}]` +
          `${a.source ? ` via ${a.source}` : ""}`,
      );
    }
  });

program.parseAsync().catch((err: Error) => {
  console.error(`Erreur : ${err.message}`);
  process.exit(1);
});

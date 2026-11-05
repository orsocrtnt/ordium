import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AssetSeries } from "@ordium/engine";
import type { AssetInfo, Timeframe } from "./types.js";

export type { AssetInfo };

/**
 * Store local de bougies : un fichier JSON par (actif, devise, TF),
 * au format SYMBOL-QUOTE.1d.json / SYMBOL-QUOTE.1h.json.
 */

/** Remonte depuis cwd jusqu’à la racine du monorepo (pnpm-workspace.yaml). */
function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

export function defaultDataDir(): string {
  if (process.env.ORDIUM_DATA_DIR) return process.env.ORDIUM_DATA_DIR;
  return path.join(findRepoRoot(process.cwd()), "data", "candles");
}

/** Rend un symbole utilisable dans un nom de fichier (EUR/USD → EUR_USD). */
function safeSymbol(symbol: string): string {
  return symbol.toUpperCase().replace(/[/\\:]/g, "_");
}

function fileFor(dir: string, symbol: string, quote: string, interval: Timeframe = "1d"): string {
  return path.join(dir, `${safeSymbol(symbol)}-${quote.toUpperCase()}.${interval}.json`);
}

export async function saveSeries(dir: string, series: AssetSeries): Promise<string> {
  await mkdir(dir, { recursive: true });
  const interval = (series.interval ?? "1d") as Timeframe;
  const file = fileFor(dir, series.symbol, series.quote, interval);
  await writeFile(file, JSON.stringify(series));
  return file;
}

export async function listSeriesFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir))
      .filter((f) => f.endsWith(".1d.json") || f.endsWith(".1h.json"))
      .sort();
  } catch {
    return [];
  }
}

async function readSeriesFile(dir: string, file: string): Promise<AssetSeries> {
  return JSON.parse(await readFile(path.join(dir, file), "utf8")) as AssetSeries;
}

/**
 * Charge la série d’un actif depuis le store, ou null si absente.
 * Si plusieurs devises de cotation sont en cache, privilégie `preferredQuote`.
 */
export async function loadSeries(
  dir: string,
  symbol: string,
  preferredQuote?: string,
  timeframe: Timeframe = "1d",
): Promise<AssetSeries | null> {
  const files = await listSeriesFiles(dir);
  const suffix = `.${timeframe}.json`;
  const candidates = files.filter(
    (f) => f.startsWith(`${safeSymbol(symbol)}-`) && f.endsWith(suffix),
  );
  if (candidates.length === 0) return null;
  const preferred = preferredQuote
    ? candidates.find((f) =>
        f.startsWith(`${safeSymbol(symbol)}-${preferredQuote.toUpperCase()}.`),
      )
    : undefined;
  return readSeriesFile(dir, preferred ?? candidates[0]!);
}

/** Inventaire des séries en cache (pour l’éditeur de stratégie et la CLI) — TF daily. */
export async function listAssets(dir: string): Promise<AssetInfo[]> {
  const infos: AssetInfo[] = [];
  for (const f of await listSeriesFiles(dir)) {
    if (!f.endsWith(".1d.json")) continue;
    const s = await readSeriesFile(dir, f);
    if (s.candles.length === 0) continue;
    infos.push({
      symbol: s.symbol,
      quote: s.quote,
      source: s.source,
      assetType: s.assetType,
      firstDate: s.candles[0]!.date.slice(0, 10),
      lastDate: s.candles[s.candles.length - 1]!.date.slice(0, 10),
      candleCount: s.candles.length,
    });
  }
  return infos;
}

"use client";

import type { AssetInfo } from "@ordium/data/types";
import { assetLabel } from "@/lib/assets";

export const TYPE_LABELS: Record<string, string> = {
  crypto: "crypto",
  stock: "action",
  etf: "ETF",
  index: "indice",
  forex: "forex",
  commodity: "mat. première",
};

const SOURCE_LABELS: Record<string, string> = {
  binance: "Binance",
  coinbase: "Coinbase",
  kraken: "Kraken",
  alpaca: "Alpaca",
  trading212: "Trading 212",
  ibkr: "Interactive Brokers",
  polygon: "Polygon",
  yahoo: "Yahoo Finance",
};

/**
 * Provenance des données de marché : pour chaque actif de la stratégie,
 * la source choisie par le routeur, la classe d'actif et la couverture.
 */
export function DataPanel({
  assets,
  used,
  assetNames,
}: {
  assets: AssetInfo[];
  used: string[];
  assetNames?: Map<string, string>;
}) {
  const rows = used
    .map((symbol) => assets.find((a) => a.symbol === symbol))
    .filter((a): a is AssetInfo => a !== undefined);
  if (rows.length === 0) return null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-zinc-900">Données de marché</h3>
      <p className="mt-0.5 text-xs text-zinc-500">
        Fournisseur gratuit choisi automatiquement, données en cache local
      </p>
      <ul className="mt-3 space-y-2">
        {rows.map((a) => (
          <li key={`${a.symbol}-${a.quote}`} className="text-xs">
            <div className="flex items-center gap-2">
              <span className="min-w-0 truncate font-medium text-zinc-800">
                {assetLabel(a.symbol, assetNames)}
              </span>
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">
                {TYPE_LABELS[a.assetType ?? ""] ?? a.assetType ?? "?"}
              </span>
              <span className="ml-auto shrink-0 text-zinc-500">
                via {SOURCE_LABELS[a.source ?? ""] ?? a.source ?? "?"}
              </span>
            </div>
            <div className="mt-0.5 text-zinc-600">
              {a.candleCount.toLocaleString("fr-FR")} bougies · {a.firstDate} → {a.lastDate} ·{" "}
              {a.quote}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

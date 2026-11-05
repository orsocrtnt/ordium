import * as XLSX from "xlsx";
import { parseTable, type ParsedRows } from "./csv.js";
import { normalizeHeader } from "./normalize.js";

const PREFERRED_SHEETS = new Set(["positions", "portefeuille", "holdings", "assets"]);

function looksLikeHeaderRow(row: unknown[]): boolean {
  const headers = row.map((c) => normalizeHeader(String(c ?? "")));
  const hasAsset = headers.some((h) =>
    ["asset", "ticker", "symbol", "symbole", "actif", "coin", "pair", "instrument", "produit"].includes(
      h,
    ),
  );
  const hasQty = headers.some((h) =>
    ["quantity", "quantite", "qty", "amount", "shares", "units"].includes(h),
  );
  return hasAsset && hasQty;
}

/**
 * Fichier Excel (.xlsx/.xls) : on lit la première feuille contenant un
 * tableau exploitable, avec la même normalisation que le CSV.
 * Préfère l’onglet « Positions » ; ignore les en-têtes décoratifs (Accueil…).
 */
export function parseXlsx(buffer: ArrayBuffer | Uint8Array): ParsedRows {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  let lastError: Error | null = null;

  const ordered = [...workbook.SheetNames].sort((a, b) => {
    const pa = PREFERRED_SHEETS.has(a.trim().toLowerCase()) ? 0 : 1;
    const pb = PREFERRED_SHEETS.has(b.trim().toLowerCase()) ? 0 : 1;
    return pa - pb;
  });

  for (const sheetName of ordered) {
    const sheet = workbook.Sheets[sheetName]!;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: "",
    });
    const nonEmpty = rows.filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
    if (nonEmpty.length < 1) continue;

    const headerIdx = nonEmpty.findIndex(looksLikeHeaderRow);
    if (headerIdx < 0) {
      // Ancien format : 1re ligne = en-têtes
      if (nonEmpty.length < 2) continue;
      try {
        return parseTable(nonEmpty[0]!, nonEmpty.slice(1));
      } catch (err) {
        lastError = err as Error;
        continue;
      }
    }

    try {
      return parseTable(nonEmpty[headerIdx]!, nonEmpty.slice(headerIdx + 1));
    } catch (err) {
      lastError = err as Error;
    }
  }
  throw lastError ?? new Error("Aucune feuille exploitable dans le fichier Excel.");
}

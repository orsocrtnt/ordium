/**
 * Génère le modèle Excel Ordium (vide, soigné, avec logo + consignes).
 * Usage : pnpm --filter @ordium/web exec node scripts/generate-portfolio-template.mjs
 */
import ExcelJS from "exceljs";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, "public", "templates");
const logoPath = join(root, "public", "brand", "ordium-logo.png");

mkdirSync(outDir, { recursive: true });

/** Colonnes FR — alignées avec le parseur Ordium (normalizeHeader). */
const COLUMNS = [
  { header: "Actif", width: 12, required: true, hint: "Ticker (AAPL, IWDA, BTC…)" },
  { header: "Nom", width: 28, required: false, hint: "Libellé complet (Apple Inc.…)" },
  { header: "ISIN", width: 14, required: false, hint: "Code ISIN si connu (informatif)" },
  { header: "Quantité", width: 12, required: true, hint: "Nombre d’unités détenues" },
  {
    header: "Prix d'achat",
    width: 14,
    required: false,
    hint: "PRU / prix de revient unitaire",
  },
  {
    header: "Montant investi",
    width: 15,
    required: false,
    hint: "Total investi (sinon Quantité × Prix d'achat)",
  },
  {
    header: "Cours actuel",
    width: 13,
    required: false,
    hint: "Dernier cours unitaire connu",
  },
  {
    header: "Valeur actuelle",
    width: 15,
    required: false,
    hint: "Valorisation marché (sinon Quantité × Cours)",
  },
  {
    header: "Plus-value EUR",
    width: 14,
    required: false,
    hint: "P&L absolu en devise (optionnel)",
  },
  {
    header: "Plus-value pct",
    width: 14,
    required: false,
    hint: "P&L en pourcentage (optionnel)",
  },
  { header: "Devise", width: 10, required: false, hint: "EUR, USD…" },
  {
    header: "Date d'achat",
    width: 13,
    required: false,
    hint: "AAAA-MM-JJ ou JJ/MM/AAAA (indicatif)",
  },
  { header: "Broker", width: 14, required: false, hint: "Où est détenu l’actif" },
  { header: "Notes", width: 28, required: false, hint: "Libre — ignoré à l’import" },
];

async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Ordium";
  wb.created = new Date();
  wb.title = "Modèle portefeuille Ordium";
  wb.description = "Turn conviction into execution";

  /* ========== Feuille Accueil ========== */
  const home = wb.addWorksheet("Accueil", {
    views: [{ showGridLines: false }],
  });

  home.mergeCells("A1:H1");
  home.getRow(1).height = 110;

  try {
    const logoId = wb.addImage({
      filename: logoPath,
      extension: "png",
    });
    home.addImage(logoId, {
      tl: { col: 0.15, row: 0.15 },
      ext: { width: 200, height: 133 },
    });
  } catch (err) {
    console.warn("Logo non embarqué :", err instanceof Error ? err.message : err);
    home.getCell("A1").value = "ORDIUM";
    home.getCell("A1").font = {
      name: "Calibri",
      size: 22,
      bold: true,
      color: { argb: "FF111111" },
    };
  }

  home.mergeCells("A3:H3");
  home.getCell("A3").value = "Turn conviction into execution";
  home.getCell("A3").font = {
    name: "Calibri",
    size: 10,
    italic: true,
    color: { argb: "FF6B6B67" },
  };
  home.getRow(3).height = 18;

  home.mergeCells("A5:H5");
  home.getCell("A5").value = "Modèle d’import de portefeuille";
  home.getCell("A5").font = {
    name: "Calibri",
    size: 18,
    bold: true,
    color: { argb: "FF111111" },
  };
  home.getRow(5).height = 28;

  home.mergeCells("A6:H6");
  home.getCell("A6").value =
    "Ce classeur Excel sert à décrire votre situation actuelle dans Ordium : les actifs que vous détenez aujourd’hui. " +
    "Allez dans l’onglet « Positions », remplissez le tableau (vide), enregistrez le fichier, puis uploadez-le depuis Ordium (Importer ou Créer).";
  home.getCell("A6").font = { name: "Calibri", size: 11, color: { argb: "FF3D3D3A" } };
  home.getCell("A6").alignment = { wrapText: true, vertical: "top" };
  home.getRow(6).height = 52;

  home.mergeCells("A8:H8");
  home.getCell("A8").value =
    "Toutes les colonnes ne sont pas destinées à être remplies. Seuls « Actif » (ticker) et « Quantité » sont indispensables. " +
    "Plus vous ajoutez de détails (prix d’achat, montant investi, cours, valeur…), plus la revue et le suivi du P&L seront précis. " +
    "Laissez vides les cases que vous ne connaissez pas.";
  home.getCell("A8").font = { name: "Calibri", size: 10, color: { argb: "FF0B6E4F" } };
  home.getCell("A8").alignment = { wrapText: true, vertical: "top" };
  home.getCell("A8").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE8F3EE" },
  };
  home.getRow(8).height = 56;

  home.mergeCells("A10:H10");
  home.getCell("A10").value = "Légende des colonnes (onglet Positions)";
  home.getCell("A10").font = {
    name: "Calibri",
    size: 12,
    bold: true,
    color: { argb: "FF111111" },
  };

  let r = 11;
  for (const col of COLUMNS) {
    home.mergeCells(`A${r}:H${r}`);
    const tag = col.required ? "obligatoire" : "optionnel";
    home.getCell(`A${r}`).value = `• ${col.header} (${tag}) — ${col.hint}`;
    home.getCell(`A${r}`).font = {
      name: "Calibri",
      size: 10,
      color: { argb: col.required ? "FF111111" : "FF6B6B67" },
    };
    r++;
  }

  r += 1;
  home.mergeCells(`A${r}:H${r}`);
  home.getCell(`A${r}`).value =
    "Ordium n’est pas un conseiller en investissement. Ce fichier ne sert qu’à importer vos positions pour backtester vos propres règles.";
  home.getCell(`A${r}`).font = {
    name: "Calibri",
    size: 8,
    color: { argb: "FF8C8C8C" },
  };

  home.getColumn(1).width = 16;
  for (let c = 2; c <= 8; c++) home.getColumn(c).width = 14;

  /* ========== Feuille Positions (vide, parsable) ========== */
  const pos = wb.addWorksheet("Positions", {
    views: [{ showGridLines: false, state: "frozen", ySplit: 1 }],
  });

  const headerRow = pos.getRow(1);
  headerRow.height = 24;
  COLUMNS.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.header;
    cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF111111" },
    };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      bottom: { style: "medium", color: { argb: "FF0B6E4F" } },
    };
    pos.getColumn(i + 1).width = col.width;
  });

  for (let row = 2; row <= 31; row++) {
    const excelRow = pos.getRow(row);
    excelRow.height = 18;
    for (let c = 1; c <= COLUMNS.length; c++) {
      const cell = excelRow.getCell(c);
      cell.border = {
        top: { style: "hair", color: { argb: "FFE0E0DC" } },
        bottom: { style: "hair", color: { argb: "FFE0E0DC" } },
        left: { style: "hair", color: { argb: "FFE0E0DC" } },
        right: { style: "hair", color: { argb: "FFE0E0DC" } },
      };
      if (row % 2 === 0) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFAFAF8" },
        };
      }
    }
  }

  const xlsxName = "Ordium-état portefeuille actuel.xlsx";
  const csvName = "Ordium-état portefeuille actuel.csv";
  const outXlsx = join(outDir, xlsxName);
  await wb.xlsx.writeFile(outXlsx);

  const csv =
    COLUMNS.map((c) => `"${c.header.replace(/"/g, '""')}"`).join(",") +
    "\n" +
    Array.from({ length: 8 }, () => COLUMNS.map(() => "").join(",")).join("\n") +
    "\n";
  writeFileSync(join(outDir, csvName), csv, "utf8");

  console.log("OK →", outXlsx);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

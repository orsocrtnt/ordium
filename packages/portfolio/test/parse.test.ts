import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildPortfolio, parseCsv, parseXlsx } from "../src/index.js";

describe("parseCsv — export type Binance (paires, Amount = quantité)", () => {
  const csv = [
    "Date(UTC),Pair,Side,Price,Executed,Amount,Fee",
    "2023-01-05 10:00:00,BTCEUR,BUY,16000,0.05,800,0.8",
    "2023-02-05 10:00:00,ETHEUR,BUY,1500,1.2,1800,1.8",
    "2023-03-01 09:00:00,BTCEUR,SELL,21000,0.01,210,0.21",
  ].join("\n");

  it("détecte transactions, extrait la base des paires et la devise", () => {
    const parsed = parseCsv(csv);
    expect(parsed.kind).toBe("transactions");
    expect(parsed.transactions).toHaveLength(3);
    const [t1] = parsed.transactions;
    expect(t1).toMatchObject({
      date: "2023-01-05",
      side: "buy",
      asset: "BTC",
      quantity: 0.05,
      price: 16000,
      currency: "EUR",
    });
  });

  it("reconstruit les positions nettes", () => {
    const p = buildPortfolio("Test", "EUR", "csv", parseCsv(csv));
    expect(p.holdings).toEqual([
      { asset: "BTC", quantity: expect.closeTo(0.04, 10) },
      { asset: "ETH", quantity: 1.2 },
    ]);
  });
});

describe("parseCsv — export type Kraken (codes XXBT/ZEUR, colonnes cost/vol)", () => {
  const csv = [
    '"txid","pair","time","type","price","cost","fee","vol"',
    '"T1","XXBTZEUR","2022-06-01 08:00:00","buy","28000.0","1400.00","2.24","0.05"',
    '"T2","XETHZEUR","2022-07-01 08:00:00","buy","1000.0","500.00","0.80","0.5"',
  ].join("\n");

  it("traduit le vocabulaire Kraken", () => {
    const parsed = parseCsv(csv);
    expect(parsed.transactions.map((t) => t.asset)).toEqual(["BTC", "ETH"]);
    expect(parsed.transactions[0]!.amount).toBe(1400);
    expect(parsed.transactions[0]!.currency).toBe("EUR");
  });

  it("ne casse pas les symboles ordinaires finissant par Z (XTZEUR)", () => {
    const parsed = parseCsv(
      '"txid","pair","time","type","price","cost","fee","vol"\n' +
        '"T3","XTZEUR","2022-08-01 08:00:00","buy","1.5","150.00","0.24","100"',
    );
    expect(parsed.transactions[0]!.asset).toBe("XTZ");
  });
});

describe("parseCsv — format français (séparateur ;, virgule décimale, dates JJ/MM)", () => {
  const csv = [
    "Date;Actif;Sens;Quantité;Prix;Montant",
    "05/01/2023;BTC;Achat;0,05;16 000,00;800,00",
    "05/02/2023;ETH;Achat;1,2;1 500,50;1 800,60",
  ].join("\n");

  it("gère le point-virgule, les virgules décimales et les dates françaises", () => {
    const parsed = parseCsv(csv);
    expect(parsed.transactions).toHaveLength(2);
    expect(parsed.transactions[0]).toMatchObject({
      date: "2023-01-05",
      asset: "BTC",
      quantity: 0.05,
      price: 16000,
      amount: 800,
    });
    expect(parsed.transactions[1]!.price).toBe(1500.5);
  });
});

describe("parseCsv — photo de positions (pas de dates)", () => {
  const csv = ["Asset,Quantity", "BTC,0.5", "ETH,4", "USDT,1200", "AAPL,10"].join("\n");

  it("détecte le mode positions et exclut la trésorerie", () => {
    const parsed = parseCsv(csv);
    expect(parsed.kind).toBe("holdings");
    expect(parsed.holdings).toEqual([
      { asset: "BTC", quantity: 0.5 },
      { asset: "ETH", quantity: 4 },
      { asset: "AAPL", quantity: 10 },
    ]);
  });

  it("conserve nom, PRU, investi et valeur si fournis", () => {
    const rich = [
      "Asset,Name,Quantity,AvgPrice,Invested,Price,Value",
      "AAPL,Apple Inc.,10,150,1500,190,1900",
    ].join("\n");
    const parsed = parseCsv(rich);
    expect(parsed.kind).toBe("holdings");
    expect(parsed.holdings[0]).toMatchObject({
      asset: "AAPL",
      name: "Apple Inc.",
      quantity: 10,
      avgPrice: 150,
      invested: 1500,
      price: 190,
      value: 1900,
      pnl: 400,
    });
  });
});

describe("parseCsv — lignes hors achat/vente", () => {
  const csv = [
    "Date,Asset,Type,Quantity,Price",
    "2023-01-01,BTC,Deposit,0.1,",
    "2023-01-02,BTC,Buy,0.05,16000",
    "2023-01-03,BTC,Staking Reward,0.001,",
  ].join("\n");

  it("ignore dépôts et récompenses avec un avertissement", () => {
    const parsed = parseCsv(csv);
    expect(parsed.transactions).toHaveLength(1);
    expect(parsed.warnings.some((w) => w.includes("hors achat/vente"))).toBe(true);
  });
});

describe("parseCsv — erreurs claires", () => {
  it("fichier sans colonne actif", () => {
    expect(() => parseCsv("a,b\n1,2")).toThrow(/colonne des actifs/);
  });
  it("fichier vide", () => {
    expect(() => parseCsv("")).toThrow(/vide/);
  });
});

describe("parseXlsx", () => {
  it("lit une feuille Excel de transactions", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Date", "Asset", "Side", "Quantity", "Price"],
      ["2023-01-05", "BTC", "buy", 0.05, 16000],
      ["2023-02-05", "ETH", "buy", 1.2, 1500],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transactions");
    const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const parsed = parseXlsx(buffer);
    expect(parsed.kind).toBe("transactions");
    expect(parsed.transactions).toHaveLength(2);
    expect(parsed.transactions[0]!.asset).toBe("BTC");
  });

  it("préfère Positions et lit les en-têtes FR du modèle Ordium", () => {
    const home = XLSX.utils.aoa_to_sheet([
      ["Modèle d’import de portefeuille"],
      ["Toutes les colonnes ne sont pas destinées à être remplies."],
    ]);
    const positions = XLSX.utils.aoa_to_sheet([
      [
        "Actif",
        "Nom",
        "ISIN",
        "Quantité",
        "Prix d'achat",
        "Montant investi",
        "Cours actuel",
        "Valeur actuelle",
        "Plus-value EUR",
        "Plus-value pct",
        "Devise",
      ],
      ["AAPL", "Apple", "", 10, 150, 1500, 200, 2000, 500, 33.3, "EUR"],
      ["", "", "", "", "", "", "", "", "", "", ""],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, home, "Accueil");
    XLSX.utils.book_append_sheet(wb, positions, "Positions");
    const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const parsed = parseXlsx(buffer);
    expect(parsed.kind).toBe("holdings");
    expect(parsed.holdings).toHaveLength(1);
    expect(parsed.holdings[0]).toMatchObject({
      asset: "AAPL",
      name: "Apple",
      quantity: 10,
      avgPrice: 150,
      invested: 1500,
      price: 200,
      value: 2000,
      pnl: 500,
      pnlPct: 33.3,
    });
  });
});

import type { Holding } from "../types.js";
import type { ConnectorCredentials, ConnectorResult } from "./types.js";

const SEND =
  "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest";
const GET =
  "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement";

function xmlTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i");
  const m = xml.match(re);
  return m?.[1]?.trim() ?? null;
}

function xmlAttr(fragment: string, attr: string): string | null {
  const re = new RegExp(`${attr}\\s*=\\s*"([^"]*)"`, "i");
  const m = fragment.match(re);
  return m?.[1]?.trim() ?? null;
}

function childOrAttr(block: string, name: string): string | null {
  return xmlTag(block, name) ?? xmlAttr(block, name);
}

function num(raw: string | null | undefined): number | undefined {
  if (raw == null || raw === "") return undefined;
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Interactive Brokers via Flex Web Service (positions).
 * Prérequis côté IBKR Client Portal :
 *  1. Créer une Flex Query « Open Positions » (Activity Flex Query)
 *  2. Activer Flex Web Service → token
 * apiKey = token Flex, apiSecret = Query ID (numérique).
 */
export async function fetchIbkrPortfolio(
  creds: ConnectorCredentials,
): Promise<ConnectorResult> {
  const token = creds.apiKey;
  const queryId = creds.apiSecret;

  const sendRes = await fetch(
    `${SEND}?t=${encodeURIComponent(token)}&q=${encodeURIComponent(queryId)}&v=3`,
  );
  const sendXml = await sendRes.text();
  const sendStatus = xmlTag(sendXml, "Status");
  if (sendStatus && sendStatus.toUpperCase() !== "Success".toUpperCase()) {
    const err = xmlTag(sendXml, "ErrorMessage") ?? sendXml.slice(0, 200);
    throw new Error(`IBKR Flex (SendRequest) : ${err}`);
  }
  const referenceCode = xmlTag(sendXml, "ReferenceCode");
  if (!referenceCode) {
    throw new Error(
      "IBKR Flex : pas de ReferenceCode. Vérifiez le token et le Query ID (Flex Query avec Open Positions).",
    );
  }

  let statement = "";
  let lastErr = "rapport non prêt";
  for (let attempt = 0; attempt < 8; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
    const getRes = await fetch(
      `${GET}?t=${encodeURIComponent(token)}&q=${encodeURIComponent(referenceCode)}&v=3`,
    );
    statement = await getRes.text();
    const st = xmlTag(statement, "Status");
    if (st && /Fail|Warn/i.test(st) && /not ready|try again/i.test(statement)) {
      lastErr = xmlTag(statement, "ErrorMessage") ?? st;
      continue;
    }
    if (st && /Fail/i.test(st) && !/OpenPosition/i.test(statement)) {
      throw new Error(`IBKR Flex (GetStatement) : ${xmlTag(statement, "ErrorMessage") ?? st}`);
    }
    if (/OpenPosition/i.test(statement) || /FlexQueryResponse/i.test(statement)) {
      break;
    }
    lastErr = xmlTag(statement, "ErrorMessage") ?? "en attente du rapport";
  }

  if (!/OpenPosition/i.test(statement)) {
    throw new Error(
      `IBKR Flex : impossible de récupérer les positions (${lastErr}). ` +
        `Assurez-vous que la Flex Query inclut la section « Open Positions ».`,
    );
  }

  const blocks = statement.match(/<OpenPosition\b[^>]*>[\s\S]*?<\/OpenPosition>|<OpenPosition\b[^>]*\/>/gi) ?? [];
  const warnings: string[] = [
    "Import IBKR via Flex Query (snapshot). Créez une query « Open Positions » dans Client Portal.",
  ];

  const holdings: Holding[] = [];
  for (const block of blocks) {
    const symbol =
      childOrAttr(block, "symbol") ??
      childOrAttr(block, "Symbol") ??
      childOrAttr(block, "ticker") ??
      childOrAttr(block, "description");
    const quantity = num(
      childOrAttr(block, "position") ??
        childOrAttr(block, "Position") ??
        childOrAttr(block, "quantity"),
    );
    if (!symbol || quantity == null || Math.abs(quantity) < 1e-9) continue;

    const avgPrice = num(
      childOrAttr(block, "costBasisPrice") ??
        childOrAttr(block, "CostBasisPrice") ??
        childOrAttr(block, "averageCost"),
    );
    const price = num(
      childOrAttr(block, "markPrice") ??
        childOrAttr(block, "MarkPrice") ??
        childOrAttr(block, "closePrice"),
    );
    const invested = num(
      childOrAttr(block, "costBasisMoney") ?? childOrAttr(block, "CostBasisMoney"),
    );
    const value = num(
      childOrAttr(block, "positionValue") ??
        childOrAttr(block, "PositionValue") ??
        childOrAttr(block, "marketValue"),
    );
    const pnl = num(
      childOrAttr(block, "fifoPnlUnrealized") ??
        childOrAttr(block, "FifoPnlUnrealized") ??
        childOrAttr(block, "unrealizedPnl"),
    );
    const name = childOrAttr(block, "description") ?? childOrAttr(block, "Description");

    const holding: Holding = {
      asset: symbol.toUpperCase(),
      quantity: Math.abs(quantity),
      ...(name && name.toUpperCase() !== symbol.toUpperCase() ? { name } : {}),
      ...(avgPrice != null ? { avgPrice } : {}),
      ...(price != null ? { price } : {}),
      ...(invested != null ? { invested: Math.abs(invested) } : {}),
      ...(value != null ? { value: Math.abs(value) } : {}),
      ...(pnl != null ? { pnl } : {}),
    };
    if (
      holding.pnlPct == null &&
      holding.pnl != null &&
      holding.invested != null &&
      holding.invested !== 0
    ) {
      holding.pnlPct = (holding.pnl / holding.invested) * 100;
    }
    holdings.push(holding);
  }

  if (holdings.length === 0) {
    warnings.push("Flex Query OK mais aucune ligne OpenPosition parsée.");
  }

  return { holdings, transactions: [], warnings };
}

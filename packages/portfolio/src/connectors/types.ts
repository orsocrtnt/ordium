import type { Holding, Transaction } from "../types.js";

/**
 * Résultat d'un connecteur d'exchange. Les clés API servent le temps de
 * l'appel puis sont oubliées : rien d'autre que ces données n'en sort.
 */
export interface ConnectorResult {
  transactions: Transaction[];
  holdings: Holding[];
  warnings: string[];
}

export interface ConnectorCredentials {
  /** Clé API (ou nom de clé CDP pour Coinbase ; token Flex pour IBKR). */
  apiKey: string;
  /** Secret API (ou clé privée PEM pour Coinbase ; Query ID pour IBKR). */
  apiSecret: string;
}

/** Paper/demo vs live pour Alpaca et Trading 212. */
export type BrokerEnvironment = "paper" | "live";

/** Brokers avec connecteur API implémenté dans Ordium. */
export type ConnectableExchange =
  | "binance"
  | "kraken"
  | "coinbase"
  | "alpaca"
  | "trading212"
  | "ibkr";

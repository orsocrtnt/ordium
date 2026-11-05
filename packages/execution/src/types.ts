/** Types partagés pour l’exécution broker (Alpaca + Binance). */

export type ExecutionBroker = "alpaca" | "binance";
export type ExecutionEnvironment = "paper" | "live";
export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit";

export type BrokerScope = "read" | "trade" | "withdraw";

export interface BrokerCredentials {
  apiKey: string;
  apiSecret: string;
}

export interface BrokerConnection {
  id: string;
  broker: ExecutionBroker;
  environment: ExecutionEnvironment;
  /** Scopes déclarés / vérifiés. */
  scopes: BrokerScope[];
  /** Métadonnées non secrètes (ex. account id). */
  label?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlaceOrderRequest {
  broker: ExecutionBroker;
  environment: ExecutionEnvironment;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  /** Quantité d’actif (actions / coins). */
  quantity?: number;
  /** Notional en devise quote (ex. USD) — market buy preferé côté Alpaca. */
  notional?: number;
  /** Prix limite si type = limit. */
  limitPrice?: number;
  /** Confirmation live obligatoire. */
  confirmLive?: boolean;
  clientOrderId?: string;
}

export interface PlaceOrderResult {
  broker: ExecutionBroker;
  environment: ExecutionEnvironment;
  orderId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  status: string;
  quantity?: number;
  notional?: number;
  filledQty?: number;
  raw?: unknown;
}

export interface WithdrawRequest {
  broker: ExecutionBroker;
  environment: ExecutionEnvironment;
  /** Binance coin, ou USD pour Alpaca ACH. */
  asset: string;
  amount: number;
  /** Adresse crypto (Binance) ou info banking. */
  address?: string;
  network?: string;
  addressTag?: string;
  confirmLive: boolean;
  confirmPhrase: string;
}

export interface WithdrawResult {
  broker: ExecutionBroker;
  status: string;
  id?: string;
  message?: string;
  /** Si true : ouvrir le dashboard broker (pas d’API withdraw). */
  dashboardUrl?: string;
  raw?: unknown;
}

export type ScheduleKind = "dca_fixed" | "strategy_live";

export interface ExecutionSchedule {
  id: string;
  kind: ScheduleKind;
  enabled: boolean;
  broker: ExecutionBroker;
  environment: ExecutionEnvironment;
  /** Symbole cible (DCA fixe) ou laissé vide pour strategy_live multi-actifs. */
  symbol?: string;
  /** Montant notional par run (DCA). */
  amount?: number;
  /** Intervalle en minutes. */
  intervalMinutes: number;
  /** Document stratégie JSON (strategy_live). */
  strategyJson?: unknown;
  /** Id stratégie Ordium (store local) — pour upsert / pause. */
  strategyId?: string;
  nextRunAt: string;
  lastRunAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface KillSwitchState {
  engaged: boolean;
  reason?: string;
  updatedAt: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  action: string;
  broker?: ExecutionBroker;
  detail: Record<string, unknown>;
}

export interface StoredConnectionSecrets {
  connectionId: string;
  /** Ciphertext base64 (AES-GCM). */
  ciphertext: string;
  iv: string;
  tag: string;
}

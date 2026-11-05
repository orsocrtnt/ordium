"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";

type Broker = "alpaca" | "binance";

export type OrderHistoryItem = {
  id: string;
  at: string;
  broker: Broker;
  action: "place_order" | "cancel_order";
  orderId?: string;
  symbol?: string;
  side?: "buy" | "sell";
  status?: string;
  environment?: "paper" | "live";
  quantity?: number;
  notional?: number;
};

const BROKER_LABEL: Record<Broker, string> = {
  binance: "Binance",
  alpaca: "Alpaca",
};

function monthKey(iso: string): string {
  return iso.slice(0, 7); // YYYY-MM
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  const d = new Date(Date.UTC(y, m - 1, 1));
  const label = d.toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function fmtMoney(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

function fmtQty(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 8 });
}

type BrokerGroup = {
  broker: Broker;
  months: Array<{ key: string; label: string; orders: OrderHistoryItem[] }>;
  total: number;
};

function groupOrders(orders: OrderHistoryItem[]): BrokerGroup[] {
  const byBroker = new Map<Broker, OrderHistoryItem[]>();
  for (const o of orders) {
    const list = byBroker.get(o.broker) ?? [];
    list.push(o);
    byBroker.set(o.broker, list);
  }

  const brokers: Broker[] = ["binance", "alpaca"].filter((b) =>
    byBroker.has(b as Broker),
  ) as Broker[];
  // Include any other broker keys just in case
  for (const b of byBroker.keys()) {
    if (!brokers.includes(b)) brokers.push(b);
  }

  return brokers.map((broker) => {
    const list = byBroker.get(broker) ?? [];
    const byMonth = new Map<string, OrderHistoryItem[]>();
    for (const o of list) {
      const k = monthKey(o.at);
      const m = byMonth.get(k) ?? [];
      m.push(o);
      byMonth.set(k, m);
    }
    const months = [...byMonth.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, monthOrders]) => ({
        key,
        label: monthLabel(key),
        orders: monthOrders.sort((a, b) => b.at.localeCompare(a.at)),
      }));
    return { broker, months, total: list.length };
  });
}

export function OrderHistoryPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [orders, setOrders] = useState<OrderHistoryItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openBroker, setOpenBroker] = useState<Broker | null>(null);
  const [openMonth, setOpenMonth] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/execution/orders/history");
      const data = (await res.json()) as { orders?: OrderHistoryItem[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Chargement historique impossible");
      setOrders(data.orders ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const groups = useMemo(() => groupOrders(orders), [orders]);

  useEffect(() => {
    if (groups.length === 0) return;
    if (!openBroker || !groups.some((g) => g.broker === openBroker)) {
      const first = groups[0]!;
      setOpenBroker(first.broker);
      setOpenMonth(first.months[0] ? `${first.broker}:${first.months[0].key}` : null);
    }
  }, [groups, openBroker]);

  return (
    <section className="rounded-3xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text)]">Historique des ordres</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Ordres passés via Ordium, rangés par broker puis par mois.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void load()}
          className="rounded-xl border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--bg)] disabled:opacity-50"
        >
          {busy ? "Chargement…" : "Actualiser"}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      {!error && orders.length === 0 && !busy && (
        <p className="mt-4 rounded-xl border border-dashed border-[var(--border)] bg-white px-4 py-6 text-center text-xs text-[var(--muted)]">
          Aucun ordre pour l’instant. Lance un run ou place un ordre paper.
        </p>
      )}

      <div className="mt-4 space-y-3">
        {groups.map((g) => {
          const brokerOpen = openBroker === g.broker;
          return (
            <div
              key={g.broker}
              className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white"
            >
              <button
                type="button"
                onClick={() => {
                  setOpenBroker(brokerOpen ? null : g.broker);
                  if (!brokerOpen) {
                    setOpenMonth(g.months[0] ? `${g.broker}:${g.months[0].key}` : null);
                  }
                }}
                className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-[var(--bg)]"
              >
                <span className="text-sm font-semibold text-[var(--text)]">
                  {BROKER_LABEL[g.broker]}
                </span>
                <span className="text-xs text-[var(--muted)]">
                  {g.total} ordre{g.total > 1 ? "s" : ""} · {brokerOpen ? "▾" : "▸"}
                </span>
              </button>

              {brokerOpen && (
                <div className="border-t border-[var(--border)] px-3 pb-3 pt-1">
                  {g.months.map((m) => {
                    const monthOpen = openMonth === `${g.broker}:${m.key}`;
                    const monthId = `${g.broker}:${m.key}`;
                    return (
                      <div key={m.key} className="mt-2">
                        <button
                          type="button"
                          onClick={() => setOpenMonth(monthOpen ? null : monthId)}
                          className="flex w-full items-center justify-between rounded-xl px-2 py-2 text-left hover:bg-[var(--bg-elevated)]"
                        >
                          <span className="text-xs font-medium text-[var(--text)]">{m.label}</span>
                          <span className="text-[11px] text-[var(--muted)]">
                            {m.orders.length} · {monthOpen ? "▾" : "▸"}
                          </span>
                        </button>
                        {monthOpen && (
                          <div className="mt-1 overflow-x-auto rounded-xl border border-[var(--border)]">
                            <table className="w-full min-w-[32rem] text-left text-xs">
                              <thead className="bg-[var(--bg-elevated)] text-[var(--muted)]">
                                <tr>
                                  <th className="px-2 py-2 font-normal">Date</th>
                                  <th className="px-2 py-2 font-normal">Actif</th>
                                  <th className="px-2 py-2 font-normal">Sens</th>
                                  <th className="px-2 py-2 font-normal">Montant</th>
                                  <th className="px-2 py-2 font-normal">Statut</th>
                                  <th className="px-2 py-2 font-normal">Id</th>
                                </tr>
                              </thead>
                              <tbody>
                                {m.orders.map((o) => (
                                  <tr key={o.id} className="border-t border-[var(--border)]">
                                    <td className="px-2 py-2 tabular-nums text-[var(--muted)]">
                                      {new Date(o.at).toLocaleString("fr-FR")}
                                    </td>
                                    <td className="px-2 py-2 font-medium text-[var(--text)]">
                                      {o.symbol ?? "—"}
                                      {o.environment === "live" ? (
                                        <span className="ml-1 text-[10px] text-amber-800">live</span>
                                      ) : o.environment === "paper" ? (
                                        <span className="ml-1 text-[10px] text-[var(--muted)]">
                                          paper
                                        </span>
                                      ) : null}
                                    </td>
                                    <td className="px-2 py-2">
                                      {o.action === "cancel_order"
                                        ? "annulé"
                                        : o.side === "sell"
                                          ? "vente"
                                          : "achat"}
                                    </td>
                                    <td className="px-2 py-2 tabular-nums">
                                      {o.notional != null
                                        ? `${fmtMoney(o.notional)}`
                                        : fmtQty(o.quantity)}
                                    </td>
                                    <td className="px-2 py-2 text-[var(--muted)]">
                                      {o.status ?? (o.action === "cancel_order" ? "cancel" : "—")}
                                    </td>
                                    <td
                                      className="max-w-[7rem] truncate px-2 py-2 font-mono text-[10px] text-[var(--muted)]"
                                      title={o.orderId}
                                    >
                                      {o.orderId ?? "—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

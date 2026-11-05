"use client";

import { Builder } from "@/components/Builder";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";

/** Builder style ChatGPT : prompt + sidebar strats + réglages. */
export default function StrategyPage() {
  return (
    <RequireAuth>
      <AppShell flush>
        <Builder hidePortfolioPanel />
      </AppShell>
    </RequireAuth>
  );
}

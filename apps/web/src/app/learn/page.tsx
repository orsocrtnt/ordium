"use client";

import { AppShell } from "@/components/AppShell";
import { LearningChat } from "@/components/LearningChat";
import { RequireAuth } from "@/components/RequireAuth";

export default function LearnPage() {
  return (
    <RequireAuth>
      <AppShell flush>
        <LearningChat />
      </AppShell>
    </RequireAuth>
  );
}

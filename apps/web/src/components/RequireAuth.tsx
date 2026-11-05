"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";

/** Redirige vers la landing si non connecté. Remonte l’UI à chaque compte. */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && !session) router.replace("/login");
  }, [ready, session, router]);

  if (!ready || !session) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-sm text-[var(--muted)]">Chargement…</p>
      </div>
    );
  }

  // key = remonte Builder / start / etc. quand on change de compte (démo ↔ réel).
  return <div key={session.user.email}>{children}</div>;
}

"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import {
  LandingCinema,
  LandingClose,
  LandingHero,
} from "@/components/landing/LandingCinema";
import "@/components/landing/landing.css";

/** Page de présentation — avant connexion. Scroll cinéma. */
export default function PresentationPage() {
  const router = useRouter();
  const { session, ready } = useAuth();

  useEffect(() => {
    if (ready && session) router.replace("/start");
  }, [ready, session, router]);

  if (!ready || session) {
    return (
      <AppShell bare>
        <div className="flex min-h-[70vh] items-center justify-center">
          <p className="text-sm text-[var(--muted)]">Chargement…</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      bare
      flush
      right={
        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="rounded-md px-3 py-1.5 text-xs font-medium text-[var(--muted)] hover:text-[var(--text)]"
          >
            Sign in
          </Link>
          <Link
            href="/login?mode=signup"
            className="rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[#efefec]"
          >
            Create account
          </Link>
        </div>
      }
    >
      <LandingHero />
      <LandingCinema />
      <LandingClose />

      <footer className="border-t border-[var(--border)] py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 text-xs text-[var(--muted)] sm:px-6">
          <span>Ordium — Turn conviction into execution</span>
          <Link href="/login" className="hover:text-[var(--text)]">
            Sign in →
          </Link>
        </div>
      </footer>
    </AppShell>
  );
}

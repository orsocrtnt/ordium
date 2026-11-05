"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/components/AuthProvider";

const NAV = [
  { href: "/start", label: "Parcours" },
  { href: "/markets", label: "Marchés" },
  { href: "/strategy", label: "Stratégie" },
  { href: "/execution", label: "Exécution" },
];

export function AppShell({
  children,
  right,
  bare = false,
  flush = false,
}: {
  children: ReactNode;
  right?: ReactNode;
  /** Landing sans nav app. */
  bare?: boolean;
  /** Contenu pleine largeur sans padding (ex. builder ChatGPT). */
  flush?: boolean;
}) {
  const { session, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const onLogout = () => {
    void logout().then(() => router.replace("/"));
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-elevated)_92%,transparent)] backdrop-blur-md">
        <div
          className={`mx-auto flex items-center justify-between gap-4 px-4 py-3.5 sm:px-6 ${
            flush ? "max-w-none" : "max-w-6xl"
          }`}
        >
          <div className="flex min-w-0 items-center gap-6">
            <Link href={session ? "/start" : "/"} className="group shrink-0">
              <span className="text-[1.05rem] font-semibold tracking-tight text-[var(--text)]">
                Ordium
              </span>
              <span className="ml-2 hidden text-[11px] text-[var(--muted)] sm:inline group-hover:text-[var(--text)]">
                Turn conviction into execution
              </span>
            </Link>
            {!bare && session && (
              <nav className="hidden items-center gap-1 sm:flex">
                {NAV.map((item) => {
                  const active =
                    pathname === item.href ||
                    (item.href === "/start" &&
                      (pathname.startsWith("/portfolio") ||
                        pathname.startsWith("/positions") ||
                        pathname.startsWith("/import") ||
                        pathname.startsWith("/create") ||
                        pathname.startsWith("/dashboard")));
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`rounded-md px-3 py-1.5 text-xs transition ${
                        active
                          ? "bg-[#efefec] text-[var(--text)]"
                          : "text-[var(--muted)] hover:text-[var(--text)]"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
            {right}
            {!bare && session && (
              <>
                <span className="hidden md:inline">
                  {session.user.isDemo ? "Démo" : session.user.email}
                </span>
                <button
                  type="button"
                  onClick={onLogout}
                  className="rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-xs text-[var(--muted)] hover:border-[var(--text)] hover:text-[var(--text)]"
                >
                  Déconnexion
                </button>
              </>
            )}
          </div>
        </div>
      </header>
      <main className={bare || flush ? "" : "mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10"}>
        {children}
      </main>
    </div>
  );
}

"use client";

import Link from "next/link";
import {
  Archivo,
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  Newsreader,
  Public_Sans,
  Space_Grotesk,
} from "next/font/google";
import { AppShell } from "@/components/AppShell";
import { DesignLab } from "@/components/design-lab/DesignLab";
import "@/components/design-lab/design-lab.css";

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-lab-archivo",
  display: "swap",
});

const space = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-lab-space",
  display: "swap",
});

const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-lab-plex",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-lab-plex-mono",
  display: "swap",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-lab-newsreader",
  display: "swap",
});

const publicSans = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-lab-public",
  display: "swap",
});

/** Lab isolé — multi-écrans, aucune auth. Current = défaut. */
export default function DesignLabPage() {
  const fontVars = [
    archivo.variable,
    space.variable,
    plex.variable,
    plexMono.variable,
    newsreader.variable,
    publicSans.variable,
  ].join(" ");

  return (
    <AppShell
      bare
      flush
      right={
        <Link href="/start" className="text-xs text-[var(--muted)] hover:text-[var(--text)]">
          App prod →
        </Link>
      }
    >
      <div className={fontVars}>
        <DesignLab />
      </div>
    </AppShell>
  );
}

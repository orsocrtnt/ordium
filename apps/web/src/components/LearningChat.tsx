"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getActiveUserScope, scopedStorageKey } from "@/lib/userScope";

type LearnMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type LearnConversation = {
  id: string;
  name: string;
  messages: LearnMessage[];
  createdAt: string;
  updatedAt: string;
};

type LearnStore = {
  activeId: string;
  conversations: LearnConversation[];
};

const KEY_BASE = "ordium_learn_chat_v2";

function storageKey(): string {
  return scopedStorageKey(KEY_BASE);
}

function uid(prefix: "c" | "u" | "a"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeConversationName(index: number): string {
  return index <= 1 ? "Explication" : `Explication ${index}`;
}

function emptyStore(): LearnStore {
  const now = new Date().toISOString();
  const first: LearnConversation = {
    id: uid("c"),
    name: "Explication",
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  return { activeId: first.id, conversations: [first] };
}

function chronological(msgs: LearnMessage[]): LearnMessage[] {
  return [...msgs].sort((a, b) => {
    const ta = Number.parseInt(a.id.replace(/^[ua]_/, ""), 10) || 0;
    const tb = Number.parseInt(b.id.replace(/^[ua]_/, ""), 10) || 0;
    if (ta !== tb) return ta - tb;
    if (a.role !== b.role) return a.role === "user" ? -1 : 1;
    return 0;
  });
}

export function LearningChat() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [conversations, setConversations] = useState<LearnConversation[]>([]);
  const [activeId, setActiveId] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey())
        ?? (getActiveUserScope() === "demo" ? localStorage.getItem(KEY_BASE) : null);
      if (!raw) {
        const store = emptyStore();
        setConversations(store.conversations);
        setActiveId(store.activeId);
        return;
      }
      const parsed = JSON.parse(raw) as LearnStore;
      if (Array.isArray(parsed.conversations) && parsed.conversations.length > 0) {
        setConversations(
          parsed.conversations.map((c) => ({
            ...c,
            messages: chronological(Array.isArray(c.messages) ? c.messages : []),
          })),
        );
        setActiveId(parsed.activeId || parsed.conversations[0]!.id);
      }
    } catch {
      const store = emptyStore();
      setConversations(store.conversations);
      setActiveId(store.activeId);
    }
  }, []);

  useEffect(() => {
    try {
      if (!conversations.length || !activeId) return;
      localStorage.setItem(storageKey(), JSON.stringify({ activeId, conversations }));
    } catch {
      // quota
    }
  }, [conversations, activeId]);

  const active = conversations.find((c) => c.id === activeId) ?? conversations[0] ?? null;
  const messages = active?.messages ?? [];

  useEffect(() => {
    setNameDraft(active?.name ?? "");
  }, [active?.id, active?.name]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const ordered = useMemo(() => chronological(messages), [messages]);

  const updateActiveConversation = (updater: (conv: LearnConversation) => LearnConversation) => {
    if (!activeId) return;
    setConversations((prev) => prev.map((c) => (c.id === activeId ? updater(c) : c)));
  };

  const addConversation = () => {
    const now = new Date().toISOString();
    const next: LearnConversation = {
      id: uid("c"),
      name: makeConversationName(conversations.length + 1),
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    setConversations((prev) => [next, ...prev]);
    setActiveId(next.id);
    setPrompt("");
    setError(null);
  };

  const renameConversation = (id: string, name: string, { commit }: { commit: boolean }) => {
    if (!commit) {
      setNameDraft(name);
      return;
    }
    const finalName = name.trim() || "Explication";
    setNameDraft(finalName);
    setConversations((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, name: finalName, updatedAt: new Date().toISOString() } : c,
      ),
    );
  };

  const send = async () => {
    const text = prompt.trim();
    if (!text || busy || !active) return;
    const now = Date.now();
    const userMsg: LearnMessage = { id: `u_${now}`, role: "user", text };
    const next = [...ordered, userMsg];
    updateActiveConversation((conv) => ({
      ...conv,
      messages: next,
      updatedAt: new Date().toISOString(),
    }));
    setPrompt("");
    setBusy(true);
    setError(null);
    try {
      // Petit temps de réflexion artificiel pour que ça paraisse plus naturel.
      const thinkMs = 700 + Math.floor(Math.random() * 500); // 700–1200 ms
      const [res] = await Promise.all([
        apiFetch("/api/learn/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: text,
            history: next.slice(-12).map((m) => ({ role: m.role, text: m.text })),
          }),
        }),
        new Promise((resolve) => window.setTimeout(resolve, thinkMs)),
      ]);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Réponse impossible");
      updateActiveConversation((conv) => ({
        ...conv,
        messages: chronological([
          ...conv.messages,
          {
            id: `a_${Date.now()}`,
            role: "assistant",
            text: String(json.reply ?? "Je n’ai pas trouvé de réponse utile."),
          },
        ]),
        updatedAt: new Date().toISOString(),
      }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-0 overflow-hidden bg-[var(--bg)]">
      <aside
        className={`flex shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-elevated)] transition-[width] duration-200 ${
          sidebarOpen ? "w-[260px]" : "w-0 overflow-hidden border-r-0"
        }`}
      >
        <div className="flex items-center justify-between gap-2 px-3 py-3">
          <p className="text-xs font-medium text-[var(--muted)]">Explications</p>
          <button
            type="button"
            onClick={addConversation}
            className="rounded-md px-2 py-1 text-xs text-[var(--text)] hover:bg-[#efefec]"
            title="Nouvelle explication"
          >
            + Nouveau
          </button>
        </div>
        <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {[...conversations]
            .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
            .map((conv) => {
            const selected = conv.id === activeId;
            return (
              <div
                key={conv.id}
                className={`group flex items-center gap-2 rounded-lg px-2 py-2 text-sm ${
                  selected
                    ? "bg-[#efefec] text-[var(--text)]"
                    : "text-[var(--muted)] hover:bg-[#f4f4f1] hover:text-[var(--text)]"
                }`}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left"
                  onClick={() => {
                    setActiveId(conv.id);
                    setError(null);
                  }}
                  title={conv.name}
                >
                  {conv.name}
                </button>
              </div>
            );
          })}
        </div>
        <div className="border-t border-[var(--border)] px-3 py-3 text-[10px] leading-relaxed text-[var(--muted)]">
          Une conversation d’explication garde son propre historique.
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--bg-elevated)] px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--text)]"
              title={sidebarOpen ? "Replier" : "Explications"}
            >
              {sidebarOpen ? "⟨" : "⟩"}
            </button>
            <input
              value={nameDraft}
              onChange={(e) => active && renameConversation(active.id, e.target.value, { commit: false })}
              onBlur={() => active && renameConversation(active.id, nameDraft, { commit: true })}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              placeholder="Nom de l'explication"
              className="min-w-0 max-w-[220px] bg-transparent text-sm font-medium text-[var(--text)] outline-none sm:max-w-xs"
              title="Renommer"
            />
          </div>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-6 sm:px-8">
          {ordered.length === 0 && (
            <div className="mx-auto flex max-w-xl flex-col items-center justify-center pt-16 text-center">
              <p className="text-[1.75rem] font-semibold tracking-tight text-[var(--text)]">
                {active?.name ?? "Explication"}
              </p>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-[var(--muted)]">
                Pose ta question comme tu veux — même très précise. Ex.{" "}
                <strong>comment le RSI est-il calculé ?</strong>
                <br />
                <span className="opacity-90">
                  Ou : c’est quoi la zone 30 ? / MACD vs SMA, ça mesure quoi chacun ?
                </span>
              </p>
              <p className="mt-4 max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2.5 text-left text-[11px] leading-relaxed text-[var(--muted)]">
                On discute pour comprendre les outils — sans conseil en investissement, et sans te
                dire « quoi acheter ».
              </p>
            </div>
          )}

          {chronological(messages).map((m) => (
            <div
              key={m.id}
              className={`mx-auto flex max-w-2xl ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "bg-[var(--text)] text-white whitespace-pre-wrap"
                    : "border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text)] whitespace-pre-wrap"
                }`}
              >
                {m.text}
              </div>
            </div>
          ))}

          {busy && (
            <div className="mx-auto max-w-2xl">
              <p className="text-sm text-[var(--muted)]">Réflexion…</p>
            </div>
          )}

          {error && <p className="mx-auto max-w-2xl text-sm text-red-600">{error}</p>}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-[var(--border)] bg-[var(--bg)] px-4 py-4 sm:px-8">
          <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-card)] px-3 py-2 shadow-sm">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={1}
              placeholder="Écris comme tu parles…"
              className="max-h-32 min-h-[44px] flex-1 resize-none bg-transparent py-2.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted)]"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button
              type="button"
              disabled={busy || !prompt.trim()}
              onClick={() => void send()}
              className="mb-1 shrink-0 rounded-xl bg-[var(--text)] px-3 py-2 text-xs font-medium text-white disabled:opacity-30"
            >
              Envoyer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export type ChatIntent =
  | "build"
  | "answer"
  | "revise"
  | "reject"
  | "restart"
  | "clarify";

export type ChatAction = "restart" | "alternatives" | "revise";

export interface InterpretResponse {
  matched: { id: string; name: string; status: string; confidence: number }[];
  patch: Record<string, unknown>;
  explanation: string[];
  unanswered: string[];
  unsupported: { id: string; reason: string }[];
  source: "gemini" | "lexical";
  reply?: string;
  intent?: ChatIntent;
  clearDraft?: boolean;
  actions?: ChatAction[];
}

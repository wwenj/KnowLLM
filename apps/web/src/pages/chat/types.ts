import type { ModelOption } from "@/api/model";
import type { SessionTiming, SessionToolItem } from "@/api/session";

export type ChatRole = "user" | "assistant";
export type ConnectionStatus = "connecting" | "online" | "offline";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt?: string;
  model?: string;
  timing?: SessionTiming | null;
  thinking?: string;
  streaming?: boolean;
}

export interface ConversationItem {
  id: number;
  title: string;
  updatedAt: string;
}

export interface SendPayload {
  content: string;
  wireContent: string;
  model: string;
}

export type { ModelOption, SessionToolItem };

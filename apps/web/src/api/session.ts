import { http } from "./http";

export interface SessionItem {
  id: number;
  title: string;
  status: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface SessionListResponse {
  list: SessionItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface SessionTiming {
  total_ms: number;
  ttft_ms: number | null;
  steps: unknown[];
}

export interface SessionMessage {
  id: number;
  session_id: number;
  content: string;
  model: string;
  role: "user" | "agent";
  agent_id: string | null;
  thinking: string | null;
  ext: unknown;
  timing: SessionTiming | null;
  op_status: number;
  created_at: string;
}

export interface SessionDetailResponse extends SessionItem {
  messages: SessionMessage[];
  user_info: null;
}

export interface SessionToolItem {
  id: string;
  label: string;
  description: string;
  placeholder?: string;
  defaultFill?: string;
  icon?: string;
}

export const sessionApi = {
  create: (body?: { title?: string }) =>
    http.post<SessionItem>("/api/session/add", body),
  list: (page = 1, pageSize = 50, silent = false) =>
    http.get<SessionListResponse>(
      "/api/session/list",
      { page, page_size: pageSize },
      silent ? { silent: true } : undefined,
    ),
  detail: (sessionId: number, silent = false) =>
    http.get<SessionDetailResponse>(
      "/api/session/detail",
      { session_id: sessionId },
      silent ? { silent: true } : undefined,
    ),
  update: (sessionId: number, body: { title: string }) =>
    http.post<SessionItem>("/api/session/update", body, {
      params: { session_id: sessionId },
    }),
  delete: (sessionId: number) =>
    http.post<{ message: string }>(`/api/session/${sessionId}/delete`),
  updateMessageOpStatus: (messageId: number, opStatus: number) =>
    http.post<{ message: string }>(
      `/api/session/message/${messageId}/op_status`,
      { op_status: opStatus },
    ),
  listTools: (silent = false) =>
    http.get<{ items: SessionToolItem[] }>(
      "/api/session/tools",
      undefined,
      silent ? { silent: true } : undefined,
    ),
};

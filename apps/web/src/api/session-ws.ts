import type { SessionTiming } from "./session";

const WS_BASE = "ws://localhost:39247";
const SOCKET_OPEN = 1;

export interface SessionWsSendPayload {
  type?: "message";
  content: string;
  model?: string;
}

export interface SessionWsEventMap {
  system: { type: "system"; message: string; session_id?: number };
  pong: { type: "pong"; timestamp?: unknown };
  thinking: { type: "thinking"; content: string };
  stream: { type: "stream"; content: string };
  done: {
    type: "done";
    content: string;
    thinking: string;
    model: string;
    timing: SessionTiming | null;
    message_id?: number;
  };
  session_title: { type: "session_title"; session_id: number; title: string };
}

type SessionWsEventName = keyof SessionWsEventMap;
type SessionWsHandler<K extends SessionWsEventName> = (event: SessionWsEventMap[K]) => void;
type ConnectionHandler = (connected: boolean) => void;

export class SessionWsClient {
  private socket: WebSocket | null = null;
  private heartbeat: number | null = null;
  private readonly handlers = new Map<SessionWsEventName, Set<(event: never) => void>>();

  constructor(
    private readonly sessionId: number,
    private readonly onConnectionChange?: ConnectionHandler,
  ) {}

  connect(): Promise<void> {
    this.disconnect();
    const socket = new WebSocket(`${WS_BASE}/api/session/ws/session/${this.sessionId}`);
    this.socket = socket;

    return new Promise((resolve, reject) => {
      socket.onopen = () => {
        this.onConnectionChange?.(true);
        this.startHeartbeat();
        resolve();
      };
      socket.onerror = () => {
        this.onConnectionChange?.(false);
        reject(new Error("WebSocket 连接失败"));
      };
      socket.onclose = () => {
        this.stopHeartbeat();
        this.onConnectionChange?.(false);
      };
      socket.onmessage = (event) => this.handleMessage(event.data);
    });
  }

  disconnect(): void {
    this.stopHeartbeat();
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
  }

  isConnected(): boolean {
    return this.socket?.readyState === SOCKET_OPEN;
  }

  on<K extends SessionWsEventName>(event: K, handler: SessionWsHandler<K>): () => void {
    const set = this.handlers.get(event) ?? new Set<(payload: never) => void>();
    set.add(handler as (payload: never) => void);
    this.handlers.set(event, set);
    return () => set.delete(handler as (payload: never) => void);
  }

  sendMessage(payload: SessionWsSendPayload): boolean {
    return this.send({ type: "message", ...payload });
  }

  sendCancel(): boolean {
    return this.send({ type: "cancel" });
  }

  private send(payload: unknown): boolean {
    if (!this.isConnected() || !this.socket) return false;
    this.socket.send(JSON.stringify(payload));
    return true;
  }

  private handleMessage(raw: unknown): void {
    let payload: { type?: unknown };
    try {
      payload = JSON.parse(String(raw)) as { type?: unknown };
    } catch {
      return;
    }

    const type = typeof payload.type === "string" ? payload.type : "";
    if (!isSessionEventName(type)) return;
    const set = this.handlers.get(type);
    if (!set) return;
    for (const handler of set) handler(payload as never);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = window.setInterval(() => {
      this.send({ type: "ping", timestamp: Date.now() });
    }, 25_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) {
      window.clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }
}

function isSessionEventName(value: string): value is SessionWsEventName {
  return (
    value === "system" ||
    value === "pong" ||
    value === "thinking" ||
    value === "stream" ||
    value === "done" ||
    value === "session_title"
  );
}

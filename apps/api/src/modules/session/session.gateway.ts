import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { RawData, WebSocket, WebSocketServer } from "ws";
import { parseSessionRoute, SessionChatService } from "./services/session-chat.service";
import { SessionStoreService, type SessionTiming } from "./services/session-store.service";

const WS_PATH_RE = /^\/api\/session\/ws\/session\/(\d+)$/;

interface ClientMessage {
  type?: string;
  content?: unknown;
  model?: unknown;
  timestamp?: unknown;
}

@Injectable()
export class SessionGateway implements OnModuleInit, OnModuleDestroy {
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly tasks = new Map<number, AbortController>();
  private httpServer: HttpServer | null = null;
  private readonly upgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    void this.handleUpgrade(req, socket, head);
  };

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly sessions: SessionStoreService,
    private readonly chat: SessionChatService
  ) {}

  onModuleInit(): void {
    this.httpServer = this.httpAdapterHost.httpAdapter.getHttpServer() as HttpServer;
    this.httpServer.on("upgrade", this.upgradeHandler);
  }

  onModuleDestroy(): void {
    this.httpServer?.off("upgrade", this.upgradeHandler);
    this.wss.close();
  }

  private async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const url = new URL(req.url || "/", "http://localhost");
    const match = WS_PATH_RE.exec(url.pathname);
    if (!match) return;
    const sessionId = Number(match[1]);
    try {
      this.sessions.getActiveSession(sessionId);
    } catch {
      rejectUpgrade(socket, 404, "Session Not Found");
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (client) => this.handleConnection(sessionId, client));
  }

  private handleConnection(sessionId: number, socket: WebSocket): void {
    this.send(socket, { type: "system", message: "WebSocket 连接已建立", session_id: sessionId });
    socket.on("message", (raw) => void this.handleMessage(sessionId, socket, raw));
    socket.on("close", () => this.cancel(sessionId));
    socket.on("error", () => this.cancel(sessionId));
  }

  private async handleMessage(sessionId: number, socket: WebSocket, raw: RawData): Promise<void> {
    let data: ClientMessage;
    try {
      data = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      this.send(socket, { type: "done", content: "消息格式错误。", thinking: "", model: "", timing: null });
      return;
    }

    if (data.type === "ping") {
      this.send(socket, { type: "pong", timestamp: data.timestamp });
      return;
    }
    if (data.type === "cancel") {
      this.cancel(sessionId);
      this.send(socket, { type: "system", message: "任务已取消", session_id: sessionId });
      return;
    }
    if (data.type && data.type !== "message") {
      this.send(socket, { type: "done", content: `暂不支持消息类型：${data.type}`, thinking: "", model: "", timing: null });
      return;
    }

    this.cancel(sessionId);
    const controller = new AbortController();
    this.tasks.set(sessionId, controller);
    await this.processUserMessage(sessionId, socket, data, controller);
  }

  private async processUserMessage(
    sessionId: number,
    socket: WebSocket,
    data: ClientMessage,
    controller: AbortController
  ): Promise<void> {
    const started = Date.now();
    const rawContent = String(data.content || "");
    const route = parseSessionRoute(rawContent);
    const content = route.content.trim();
    const model = typeof data.model === "string" ? data.model : "";

    if (!content) {
      this.send(socket, { type: "done", content: "请输入要发送的消息内容。", thinking: "", model, timing: null });
      return;
    }

    this.sessions.saveMessage({
      sessionId,
      content,
      role: "user",
      model,
      opStatus: 0
    });
    const nextTitle = this.sessions.maybeUpdateDefaultTitle(sessionId, content);
    if (nextTitle) this.send(socket, { type: "session_title", session_id: sessionId, title: nextTitle });

    const contentParts: string[] = [];
    const thinkingParts: string[] = [];
    let firstTokenAt: number | null = null;
    let done: { content: string; thinking: string; steps: SessionTiming["steps"] } | null = null;

    try {
      for await (const chunk of this.chat.streamReply({
        route: route.type,
        content,
        history: this.sessions.detail(sessionId).messages,
        model,
        signal: controller.signal
      })) {
        if (controller.signal.aborted) return;
        if (chunk.type === "done") {
          done = chunk.result;
          continue;
        }
        if (firstTokenAt === null) firstTokenAt = Date.now();
        if (chunk.type === "thinking") {
          thinkingParts.push(chunk.content);
          this.send(socket, { type: "thinking", content: chunk.content });
        } else {
          contentParts.push(chunk.content);
          this.send(socket, { type: "stream", content: chunk.content });
        }
      }
      if (controller.signal.aborted) return;
      const finalContent = done?.content || contentParts.join("");
      const finalThinking = done?.thinking || thinkingParts.join("");
      const timing: SessionTiming = {
        total_ms: Date.now() - started,
        ttft_ms: firstTokenAt ? firstTokenAt - started : null,
        steps: done?.steps || []
      };
      const saved = this.sessions.saveMessage({
        sessionId,
        content: finalContent,
        role: "agent",
        model,
        thinking: finalThinking,
        timing,
        opStatus: 1
      });
      this.send(socket, {
        type: "done",
        content: finalContent,
        thinking: finalThinking,
        model,
        timing,
        message_id: saved.id
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      const saved = this.sessions.saveMessage({
        sessionId,
        content: `当前请求处理失败：${message}`,
        role: "agent",
        model,
        opStatus: 2
      });
      this.send(socket, {
        type: "done",
        content: saved.content,
        thinking: "",
        model,
        timing: { total_ms: Date.now() - started, ttft_ms: null, steps: [] },
        message_id: saved.id
      });
    } finally {
      if (this.tasks.get(sessionId) === controller) this.tasks.delete(sessionId);
    }
  }

  private cancel(sessionId: number): void {
    const current = this.tasks.get(sessionId);
    if (current && !current.signal.aborted) current.abort();
    this.tasks.delete(sessionId);
  }

  private send(socket: WebSocket, payload: unknown): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

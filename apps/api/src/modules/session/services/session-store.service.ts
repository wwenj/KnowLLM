import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import * as path from "node:path";
import { getDataRoot } from "../../../config/data-root";
import { nowIso, readJson, writeJson } from "../../../common/fs-json";
import { normalizeWhitespace } from "../../../common/text";

export type SessionMessageRole = "user" | "agent";

export interface SessionRecord {
  id: number;
  title: string;
  status: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface SessionTiming {
  total_ms: number;
  ttft_ms: number | null;
  steps: unknown[];
}

export interface SessionMessageRecord {
  id: number;
  session_id: number;
  content: string;
  model: string;
  role: SessionMessageRole;
  agent_id: string | null;
  thinking: string | null;
  ext: unknown;
  timing: SessionTiming | null;
  op_status: number;
  created_at: string;
}

interface SessionDb {
  lastSessionId: number;
  lastMessageId: number;
  sessions: SessionRecord[];
  messages: SessionMessageRecord[];
}

const ACTIVE_STATUS = 1;
const DELETED_STATUS = 0;
const DEFAULT_TITLE = "新聊天";

@Injectable()
export class SessionStoreService implements OnModuleInit {
  private readonly dbPath = path.join(getDataRoot(), "sessions", "sessions.json");

  onModuleInit(): void {
    this.write(this.read());
  }

  create(title?: string): SessionRecord {
    const db = this.read();
    const now = nowIso();
    const session: SessionRecord = {
      id: db.lastSessionId + 1,
      title: normalizeTitle(title) || DEFAULT_TITLE,
      status: ACTIVE_STATUS,
      created_by: "local",
      created_at: now,
      updated_at: now
    };
    db.lastSessionId = session.id;
    db.sessions.push(session);
    this.write(db);
    return session;
  }

  list(pageInput = 1, pageSizeInput = 20) {
    const page = Math.max(1, Number(pageInput) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(pageSizeInput) || 20));
    const items = this.read()
      .sessions.filter((session) => session.status === ACTIVE_STATUS)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id - a.id);
    return {
      list: items.slice((page - 1) * pageSize, page * pageSize),
      total: items.length,
      page,
      page_size: pageSize
    };
  }

  detail(sessionId: number) {
    const db = this.read();
    const session = this.getActiveSessionFromDb(db, sessionId);
    const messages = db.messages
      .filter((message) => message.session_id === sessionId)
      .sort((a, b) => a.id - b.id);
    return { ...session, messages, user_info: null };
  }

  getActiveSession(sessionId: number): SessionRecord {
    return this.getActiveSessionFromDb(this.read(), sessionId);
  }

  updateTitle(sessionId: number, title: string): SessionRecord {
    const nextTitle = normalizeTitle(title);
    if (!nextTitle) throw new BadRequestException("标题不能为空");
    const db = this.read();
    const session = this.getActiveSessionFromDb(db, sessionId);
    session.title = nextTitle;
    session.updated_at = nowIso();
    this.write(db);
    return session;
  }

  delete(sessionId: number): { message: string } {
    const db = this.read();
    const session = this.getActiveSessionFromDb(db, sessionId);
    session.status = DELETED_STATUS;
    session.updated_at = nowIso();
    this.write(db);
    return { message: "删除成功" };
  }

  saveMessage(input: {
    sessionId: number;
    content: string;
    role: SessionMessageRole;
    model?: string;
    agentId?: string | null;
    thinking?: string | null;
    ext?: unknown;
    timing?: SessionTiming | null;
    opStatus?: number;
  }): SessionMessageRecord {
    const db = this.read();
    const session = this.getActiveSessionFromDb(db, input.sessionId);
    const message: SessionMessageRecord = {
      id: db.lastMessageId + 1,
      session_id: input.sessionId,
      content: input.content,
      model: input.model || "",
      role: input.role,
      agent_id: input.agentId ?? null,
      thinking: input.thinking || null,
      ext: input.ext ?? null,
      timing: input.timing ?? null,
      op_status: input.opStatus ?? (input.role === "agent" ? 1 : 0),
      created_at: nowIso()
    };
    db.lastMessageId = message.id;
    db.messages.push(message);
    session.updated_at = message.created_at;
    this.write(db);
    return message;
  }

  updateMessageOpStatus(messageId: number, opStatus: number): { message: string } {
    const db = this.read();
    const message = db.messages.find((item) => item.id === messageId);
    if (!message) throw new NotFoundException("消息不存在");
    message.op_status = Number.isFinite(opStatus) ? opStatus : message.op_status;
    this.write(db);
    return { message: "更新成功" };
  }

  maybeUpdateDefaultTitle(sessionId: number, firstUserContent: string): string | null {
    const db = this.read();
    const session = this.getActiveSessionFromDb(db, sessionId);
    if (session.title !== DEFAULT_TITLE) return null;
    const title = makeTitle(firstUserContent);
    if (!title) return null;
    session.title = title;
    session.updated_at = nowIso();
    this.write(db);
    return title;
  }

  private getActiveSessionFromDb(db: SessionDb, sessionId: number): SessionRecord {
    if (!Number.isInteger(sessionId) || sessionId <= 0) throw new BadRequestException("session_id 非法");
    const session = db.sessions.find((item) => item.id === sessionId && item.status === ACTIVE_STATUS);
    if (!session) throw new NotFoundException("会话不存在或已删除");
    return session;
  }

  private read(): SessionDb {
    return readJson<SessionDb>(this.dbPath, {
      lastSessionId: 0,
      lastMessageId: 0,
      sessions: [],
      messages: []
    });
  }

  private write(db: SessionDb): void {
    writeJson(this.dbPath, db);
  }
}

function normalizeTitle(title?: string | null): string {
  return String(title || "").trim().slice(0, 255);
}

function makeTitle(content: string): string {
  return normalizeWhitespace(content.replace(/^\s*\[assistant:[^\]]+]\s*/, "")).slice(0, 20);
}

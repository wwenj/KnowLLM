import { Injectable, NotFoundException } from "@nestjs/common";
import * as fs from "node:fs";
import * as path from "node:path";
import { getDataRoot } from "../../../config/data-root";
import { ensureDir, nowIso, randomId, readJson, readText, writeJson, writeText } from "../../../common/fs-json";
import type {
  AgentRunDetail,
  AgentRunEvent,
  AgentRunMeta,
  AgentRunStatus,
  AgentRunSummary
} from "../agent.types";

@Injectable()
export class AgentRunStoreService {
  private readonly root = path.join(getDataRoot(), "agents", "runs");

  newRunId(): string {
    return randomId();
  }

  createPending(args: {
    runId: string;
    agentType: string;
    title: string;
    input: Record<string, unknown>;
  }): AgentRunMeta {
    const meta: AgentRunMeta = {
      runId: safeRunId(args.runId),
      agentType: safeAgentType(args.agentType),
      title: args.title || args.runId,
      status: "running",
      startedAt: nowIso(),
      endedAt: "",
      input: args.input,
      errors: [],
      contentFormat: "markdown",
      runnerMeta: {}
    };
    ensureDir(this.runDir(meta.agentType, meta.runId));
    writeJson(this.metaPath(meta.agentType, meta.runId), meta);
    writeText(this.resultPath(meta.agentType, meta.runId), "");
    writeJson(this.resultJsonPath(meta.agentType, meta.runId), null);
    return meta;
  }

  appendEvent(agentType: string, runId: string, event: AgentRunEvent): void {
    const safeType = safeAgentType(agentType);
    const safeId = safeRunId(runId);
    const enriched = { ...event, ts: event.ts || nowIso() };
    fs.appendFileSync(this.eventsPath(safeType, safeId), `${JSON.stringify(enriched)}\n`, "utf-8");
  }

  finish(args: {
    agentType: string;
    runId: string;
    status: AgentRunStatus;
    content: string;
    resultJson?: Record<string, unknown>;
    errors?: string[];
    runnerMeta?: Record<string, unknown>;
  }): AgentRunDetail {
    const meta = this.loadMeta(args.agentType, args.runId);
    if (!meta) throw new NotFoundException("执行记录不存在");
    writeText(this.resultPath(meta.agentType, meta.runId), args.content || "");
    writeJson(this.resultJsonPath(meta.agentType, meta.runId), args.resultJson || null);
    const next: AgentRunMeta = {
      ...meta,
      status: args.status,
      endedAt: nowIso(),
      errors: args.errors || [],
      runnerMeta: { ...(meta.runnerMeta || {}), ...(args.runnerMeta || {}) }
    };
    writeJson(this.metaPath(meta.agentType, meta.runId), next);
    this.appendEvent(meta.agentType, meta.runId, {
      type: "result",
      status: args.status,
      content: args.content
    });
    return this.loadDetail(meta.agentType, meta.runId);
  }

  updateStatus(agentType: string, runId: string, status: AgentRunStatus, error?: string): AgentRunDetail {
    const meta = this.loadMeta(agentType, runId);
    if (!meta) throw new NotFoundException("执行记录不存在");
    const next: AgentRunMeta = {
      ...meta,
      status,
      endedAt: nowIso(),
      errors: error ? [...meta.errors, error] : meta.errors
    };
    writeJson(this.metaPath(meta.agentType, meta.runId), next);
    return this.loadDetail(meta.agentType, meta.runId);
  }

  loadDetail(agentType: string, runId: string): AgentRunDetail {
    const meta = this.loadMeta(agentType, runId);
    if (!meta) throw new NotFoundException("执行记录不存在");
    return {
      ...meta,
      events: readJsonl(this.eventsPath(meta.agentType, meta.runId)),
      resultMd: readText(this.resultPath(meta.agentType, meta.runId)),
      resultJson: readJson<Record<string, unknown> | null>(this.resultJsonPath(meta.agentType, meta.runId), null)
    };
  }

  listAllRuns(agentTypes: string[], limit = 50): AgentRunSummary[] {
    if (!fs.existsSync(this.root)) return [];
    const allowed = new Set(agentTypes.map(safeAgentType));
    const out: AgentRunSummary[] = [];
    for (const agentDir of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!agentDir.isDirectory()) continue;
      const agentType = agentDir.name;
      if (!allowed.has(agentType)) continue;
      const root = path.join(this.root, agentType);
      for (const runDir of fs.readdirSync(root, { withFileTypes: true })) {
        if (!runDir.isDirectory()) continue;
        const meta = this.loadMeta(agentType, runDir.name);
        if (!meta) continue;
        out.push(toSummary(meta));
      }
    }
    return out
      .sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""))
      .slice(0, Math.min(Math.max(Number(limit) || 50, 1), 500));
  }

  private loadMeta(agentType: string, runId: string): AgentRunMeta | null {
    return readJson<AgentRunMeta | null>(this.metaPath(agentType, runId), null);
  }

  private runDir(agentType: string, runId: string): string {
    return path.join(this.root, safeAgentType(agentType), safeRunId(runId));
  }

  private metaPath(agentType: string, runId: string): string {
    return path.join(this.runDir(agentType, runId), "meta.json");
  }

  private eventsPath(agentType: string, runId: string): string {
    return path.join(this.runDir(agentType, runId), "events.jsonl");
  }

  private resultPath(agentType: string, runId: string): string {
    return path.join(this.runDir(agentType, runId), "result.md");
  }

  private resultJsonPath(agentType: string, runId: string): string {
    return path.join(this.runDir(agentType, runId), "result.json");
  }
}

function safeAgentType(value: string): string {
  const text = String(value || "").trim();
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(text)) throw new Error("agentType 非法");
  return text;
}

function safeRunId(value: string): string {
  const text = String(value || "").trim();
  if (!/^[a-f0-9]{32}$/.test(text)) throw new Error("runId 非法");
  return text;
}

function readJsonl(file: string): AgentRunEvent[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf-8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AgentRunEvent);
}

function toSummary(meta: AgentRunMeta): AgentRunSummary {
  return {
    runId: meta.runId,
    agentType: meta.agentType,
    title: meta.title,
    status: meta.status,
    startedAt: meta.startedAt,
    endedAt: meta.endedAt,
    runnerMeta: meta.runnerMeta || {}
  };
}

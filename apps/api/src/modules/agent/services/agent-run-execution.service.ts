import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import {
  AgentRunDetail,
  AgentRunEvent,
  AgentRunSummary,
  AgentRunnerResult,
  nowIso
} from "../agent.types";
import { AgentRegistryService } from "./agent-registry.service";
import { AgentResultRendererService } from "./agent-result-renderer.service";
import { AgentRunStoreService } from "./agent-run-store.service";

export interface AgentRunExecutionStartOptions {
  signal?: AbortSignal;
  onEvent?: (event: AgentRunEvent) => void;
}

export interface AgentRunExecution {
  runId: string;
  agentType: string;
  status: "running";
  done: Promise<AgentRunDetail>;
}

@Injectable()
export class AgentRunExecutionService implements OnModuleInit {
  private readonly logger = new Logger(AgentRunExecutionService.name);
  private readonly jobs = new Map<string, AbortController>();

  constructor(
    private readonly registry: AgentRegistryService,
    private readonly store: AgentRunStoreService,
    private readonly renderer: AgentResultRendererService
  ) {}

  onModuleInit(): void {
    const recovered = this.store.markRunningCancelled();
    if (recovered > 0) this.logger.warn(`startup recovery: ${recovered} stale agent run(s) marked cancelled`);
  }

  start(agentType: string, input: unknown, options: AgentRunExecutionStartOptions = {}): AgentRunExecution {
    const runner = this.registry.get(agentType);
    const validated = runner.validateInput(input);
    const runId = this.store.newRunId();
    this.store.createPending({
      runId,
      agentType: runner.agentType,
      title: runner.title(validated),
      input: validated
    });

    const controller = new AbortController();
    const key = jobKey(runner.agentType, runId);
    this.jobs.set(key, controller);

    const abortFromParent = () => {
      void this.cancel(runner.agentType, runId);
    };
    if (options.signal) {
      if (options.signal.aborted) abortFromParent();
      else options.signal.addEventListener("abort", abortFromParent, { once: true });
    }

    const appendEvent = (event: AgentRunEvent) => {
      this.store.appendEvent(runner.agentType, runId, event);
      try {
        options.onEvent?.(event);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`agent ${runner.agentType} run ${runId} event callback failed: ${message}`);
      }
    };

    const done = runner
      .start({
        runId,
        agentType: runner.agentType,
        input: validated,
        signal: controller.signal,
        appendEvent,
        updateRunnerMeta: (meta) => this.store.updateRunnerMeta(runner.agentType, runId, meta)
      })
      .then((result) => {
        if (controller.signal.aborted) {
          return this.finish(runner.agentType, runId, {
            status: "cancelled",
            content: "任务被用户取消。",
            errors: ["任务被用户取消"]
          });
        }
        return this.finish(runner.agentType, runId, result);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`agent ${runner.agentType} run ${runId} failed: ${message}`);
        return this.finish(runner.agentType, runId, {
          status: controller.signal.aborted ? "cancelled" : "failed",
          content: renderError(message),
          errors: [message]
        });
      })
      .finally(() => {
        if (options.signal) options.signal.removeEventListener("abort", abortFromParent);
        this.jobs.delete(key);
      });

    return { runId, agentType: runner.agentType, status: "running", done };
  }

  cancel(agentType: string, runId: string): { ok: boolean; runId: string; status: string } {
    const runner = this.registry.get(agentType);
    const meta = this.store.loadMeta(runner.agentType, runId);
    if (!meta) throw new Error("执行记录不存在");
    const key = jobKey(runner.agentType, runId);
    const controller = this.jobs.get(key);
    if (controller && !controller.signal.aborted) {
      controller.abort();
      void runner.cancel?.(runId);
      return { ok: true, runId, status: "cancelling" };
    }
    if (meta.status === "running") {
      this.store.updateMeta(runner.agentType, runId, {
        status: "cancelled",
        endedAt: meta.endedAt || nowIso(),
        errors: [...(meta.errors || []), "任务被强制取消(进程已不存在)"]
      });
      this.store.appendEvent(runner.agentType, runId, {
        type: "result",
        status: "cancelled",
        msg: "任务被强制取消(进程已不存在)"
      });
      return { ok: true, runId, status: "cancelled" };
    }
    return { ok: false, runId, status: meta.status };
  }

  getDetail(agentType: string, runId: string): AgentRunDetail {
    const runner = this.registry.get(agentType);
    return this.store.loadDetail(runner.agentType, runId);
  }

  listAllRuns(limit?: number): { items: AgentRunSummary[] } {
    return { items: this.store.listAllRuns(this.registry.listProfiles().map((profile) => profile.agentType), limit) };
  }

  private finish(agentType: string, runId: string, result: AgentRunnerResult): AgentRunDetail {
    const status = result.status || "success";
    const errors = result.errors || [];
    const artifacts = result.artifacts || [];
    const rendered = this.renderer.render({
      agentType,
      rawContent: result.content,
      artifacts,
      status,
      errors,
      extra: result.resultJson || {}
    });
    this.store.appendEvent(agentType, runId, {
      type: "result",
      msg: status === "success" ? "任务完成" : "任务已结束",
      status,
      contentFormat: "markdown",
      content: rendered.markdown,
      artifacts,
      resultJson: rendered.resultJson
    });
    return this.store.finish({
      agentType,
      runId,
      status,
      content: rendered.markdown,
      resultJson: rendered.resultJson,
      errors,
      runnerMeta: result.runnerMeta,
      tokens: result.tokens,
      stats: result.stats
    });
  }
}

function jobKey(agentType: string, runId: string): string {
  return `${agentType}:${runId}`;
}

function renderError(message: string): string {
  return `# Agent 执行失败\n\n\`\`\`text\n${message}\n\`\`\`\n`;
}

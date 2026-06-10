import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { AgentRunner, AgentRunnerResult } from "../agent.types";
import { LlmWikiAgentRunner } from "../runners/llm-wiki-agent.runner";
import { AgentRunStoreService } from "./agent-run-store.service";

@Injectable()
export class AgentService {
  private readonly jobs = new Map<string, AbortController>();
  private readonly runners: AgentRunner[];

  constructor(
    llmWiki: LlmWikiAgentRunner,
    private readonly store: AgentRunStoreService
  ) {
    this.runners = [llmWiki];
  }

  listAgents() {
    return { items: this.runners.map((runner) => runner.getProfile()) };
  }

  getDefaults(agentType: string): Record<string, unknown> {
    return this.getRunner(agentType).getDefaults();
  }

  submit(agentType: string, input: unknown) {
    const runner = this.getRunner(agentType);
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
    this.store.appendEvent(runner.agentType, runId, { type: "start", msg: "Agent run started" });

    void runner
      .start({
        runId,
        agentType: runner.agentType,
        input: validated,
        signal: controller.signal,
        appendEvent: (event) => this.store.appendEvent(runner.agentType, runId, event)
      })
      .then((result) => this.finish(runner.agentType, runId, result, controller.signal.aborted))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.store.finish({
          agentType: runner.agentType,
          runId,
          status: controller.signal.aborted ? "cancelled" : "failed",
          content: `# Agent 执行失败\n\n${message}\n`,
          errors: [message]
        });
      })
      .finally(() => this.jobs.delete(key));

    return { runId, agentType: runner.agentType, status: "running" as const };
  }

  cancel(agentType: string, runId: string) {
    const runner = this.getRunner(agentType);
    const key = jobKey(runner.agentType, runId);
    const controller = this.jobs.get(key);
    if (controller && !controller.signal.aborted) {
      controller.abort();
      this.store.updateStatus(runner.agentType, runId, "cancelled", "任务被用户取消");
      return { ok: true, runId, status: "cancelled" };
    }
    const detail = this.store.loadDetail(runner.agentType, runId);
    return { ok: false, runId, status: detail.status };
  }

  getDetail(agentType: string, runId: string) {
    const runner = this.getRunner(agentType);
    return this.store.loadDetail(runner.agentType, runId);
  }

  listRuns(limit?: number) {
    return { items: this.store.listAllRuns(["llmWiki"], limit) };
  }

  private finish(agentType: string, runId: string, result: AgentRunnerResult, aborted: boolean) {
    return this.store.finish({
      agentType,
      runId,
      status: aborted ? "cancelled" : result.status || "success",
      content: result.content,
      resultJson: result.resultJson,
      errors: result.errors,
      runnerMeta: result.runnerMeta
    });
  }

  private getRunner(agentType: string): AgentRunner {
    const runner = this.runners.find((item) => item.agentType === agentType);
    if (!runner) throw new NotFoundException(`agent 不存在: ${agentType}`);
    return runner;
  }
}

function jobKey(agentType: string, runId: string): string {
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(agentType)) throw new BadRequestException("agentType 非法");
  if (!/^[a-f0-9]{32}$/.test(runId)) throw new BadRequestException("runId 非法");
  return `${agentType}:${runId}`;
}

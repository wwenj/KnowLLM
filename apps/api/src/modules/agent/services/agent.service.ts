import { Injectable } from "@nestjs/common";
import { AgentRegistryService } from "./agent-registry.service";
import { AgentRunExecutionService } from "./agent-run-execution.service";

@Injectable()
export class AgentService {
  constructor(
    private readonly registry: AgentRegistryService,
    private readonly execution: AgentRunExecutionService
  ) {}

  listAgents() {
    return { items: this.registry.listProfiles() };
  }

  getDefaults(agentType: string): Record<string, unknown> {
    return this.registry.get(agentType).getDefaults();
  }

  submit(agentType: string, input: unknown) {
    const run = this.execution.start(agentType, input);
    return { runId: run.runId, agentType: run.agentType, status: run.status };
  }

  cancel(agentType: string, runId: string) {
    return this.execution.cancel(agentType, runId);
  }

  getDetail(agentType: string, runId: string) {
    return this.execution.getDetail(agentType, runId);
  }

  listRuns(limit?: number) {
    return this.execution.listAllRuns(limit);
  }
}

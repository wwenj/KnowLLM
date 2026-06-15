import { Injectable } from "@nestjs/common";
import { LlmWikiAgentRunner } from "../runners/llm-wiki/llm-wiki-agent.runner";
import type { AgentProfile, AgentRunner } from "../agent.types";

@Injectable()
export class AgentRegistryService {
  private readonly runners: AgentRunner[];

  constructor(llmWiki: LlmWikiAgentRunner) {
    this.runners = [llmWiki];
  }

  listProfiles(): AgentProfile[] {
    return this.runners.map((runner) => runner.getProfile());
  }

  get(agentType: string): AgentRunner {
    const runner = this.runners.find((item) => item.agentType === agentType);
    if (!runner) throw new Error(`agent 不存在: ${agentType}`);
    return runner;
  }
}

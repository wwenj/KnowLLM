import { Injectable } from "@nestjs/common";
import type { AgentRunner, AgentRunnerContext } from "../../agent.types";
import type { LlmWikiAgentInput } from "./llm-wiki-agent.types";
import { LlmWikiAgentWorkflow } from "./llm-wiki-agent.workflow";

@Injectable()
export class LlmWikiAgentRunner implements AgentRunner<LlmWikiAgentInput> {
  readonly agentType = "llmWiki";

  constructor(private readonly workflow: LlmWikiAgentWorkflow) {}

  getProfile() {
    return this.workflow.getProfile();
  }

  getDefaults() {
    return this.workflow.getDefaults();
  }

  validateInput(input: unknown) {
    return this.workflow.validateInput(input);
  }

  title(input: LlmWikiAgentInput) {
    return this.workflow.title(input);
  }

  start(ctx: AgentRunnerContext<LlmWikiAgentInput>) {
    return this.workflow.start(ctx);
  }
}

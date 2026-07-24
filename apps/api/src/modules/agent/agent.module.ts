import { Module } from "@nestjs/common";
import { LlmWikiNextModule } from "../llmWikiNext/llm-wiki-next.module";
import { ModelModule } from "../model/model.module";
import { AgentController } from "./controllers/agent.controller";
import { LlmWikiAgentRunner } from "./runners/llm-wiki/llm-wiki-agent.runner";
import { LlmWikiAgentTools } from "./runners/llm-wiki/llm-wiki-agent.tools";
import { LlmWikiAgentWorkflow } from "./runners/llm-wiki/llm-wiki-agent.workflow";
import { AgentRegistryService } from "./services/agent-registry.service";
import { AgentResultRendererService } from "./services/agent-result-renderer.service";
import { AgentRunExecutionService } from "./services/agent-run-execution.service";
import { AgentRunStoreService } from "./services/agent-run-store.service";
import { AgentService } from "./services/agent.service";

@Module({
  imports: [LlmWikiNextModule, ModelModule],
  controllers: [AgentController],
  providers: [
    AgentRunStoreService,
    AgentRegistryService,
    AgentResultRendererService,
    AgentRunExecutionService,
    AgentService,
    LlmWikiAgentTools,
    LlmWikiAgentWorkflow,
    LlmWikiAgentRunner
  ],
  exports: [AgentRunExecutionService],
})
export class AgentModule {}

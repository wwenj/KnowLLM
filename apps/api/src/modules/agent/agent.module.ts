import { Module } from "@nestjs/common";
import { LlmWikiModule } from "../llmWiki/llm-wiki.module";
import { ModelModule } from "../model/model.module";
import { AgentController } from "./controllers/agent.controller";
import { LlmWikiAgentRunner } from "./runners/llm-wiki-agent.runner";
import { AgentRegistryService } from "./services/agent-registry.service";
import { AgentResultRendererService } from "./services/agent-result-renderer.service";
import { AgentRunExecutionService } from "./services/agent-run-execution.service";
import { AgentRunStoreService } from "./services/agent-run-store.service";
import { AgentService } from "./services/agent.service";

@Module({
  imports: [LlmWikiModule, ModelModule],
  controllers: [AgentController],
  providers: [
    AgentRunStoreService,
    AgentRegistryService,
    AgentResultRendererService,
    AgentRunExecutionService,
    AgentService,
    LlmWikiAgentRunner
  ],
  exports: [AgentRunExecutionService, AgentRunStoreService, AgentService]
})
export class AgentModule {}

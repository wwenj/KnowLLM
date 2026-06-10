import { Module } from "@nestjs/common";
import { LlmWikiModule } from "../llmWiki/llm-wiki.module";
import { ModelModule } from "../model/model.module";
import { AgentController } from "./controllers/agent.controller";
import { LlmWikiAgentRunner } from "./runners/llm-wiki-agent.runner";
import { AgentRunStoreService } from "./services/agent-run-store.service";
import { AgentService } from "./services/agent.service";

@Module({
  imports: [LlmWikiModule, ModelModule],
  controllers: [AgentController],
  providers: [AgentRunStoreService, AgentService, LlmWikiAgentRunner],
  exports: [AgentService]
})
export class AgentModule {}

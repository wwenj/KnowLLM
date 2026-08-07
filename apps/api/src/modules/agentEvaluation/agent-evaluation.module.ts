import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { LlmWikiNextModule } from "../llmWikiNext/llm-wiki-next.module";
import { ModelModule } from "../model/model.module";
import { AgentEvaluationController } from "./agent-evaluation.controller";
import { AgentEvaluationDatasetService } from "./agent-evaluation-dataset.service";
import { AgentEvaluationStoreService } from "./agent-evaluation-store.service";
import { AgentEvaluationDatasetStoreService } from "./agent-evaluation-dataset-store.service";
import { AgentEvaluationService } from "./agent-evaluation.service";

@Module({
  imports: [AgentModule, LlmWikiNextModule, ModelModule],
  controllers: [AgentEvaluationController],
  providers: [
    AgentEvaluationDatasetService,
    AgentEvaluationDatasetStoreService,
    AgentEvaluationStoreService,
    AgentEvaluationService,
  ],
})
export class AgentEvaluationModule {}

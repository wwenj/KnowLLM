import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { LlmWikiModule } from "../llmWiki/llm-wiki.module";
import { ModelModule } from "../model/model.module";
import { AgentEvaluationController } from "./controllers/agent-evaluation.controller";
import { CompileEvaluationController } from "./controllers/compile-evaluation.controller";
import { AgentEvaluationDatasetService } from "./services/agent-evaluation-dataset.service";
import { AgentEvaluationStoreService } from "./services/agent-evaluation-store.service";
import { AgentEvaluationService } from "./services/agent-evaluation.service";
import { CompileEvaluationDatasetService } from "./services/compile-evaluation-dataset.service";
import { CompileEvaluationStoreService } from "./services/compile-evaluation-store.service";
import { CompileEvaluationService } from "./services/compile-evaluation.service";

@Module({
  imports: [LlmWikiModule, ModelModule, AgentModule],
  controllers: [CompileEvaluationController, AgentEvaluationController],
  providers: [
    CompileEvaluationStoreService,
    CompileEvaluationDatasetService,
    CompileEvaluationService,
    AgentEvaluationStoreService,
    AgentEvaluationDatasetService,
    AgentEvaluationService,
  ],
})
export class EvaluationModule {}

import { Module } from "@nestjs/common";
import { LlmWikiModule } from "../llmWiki/llm-wiki.module";
import { ModelModule } from "../model/model.module";
import { CompileEvaluationController } from "./controllers/compile-evaluation.controller";
import { CompileEvaluationDatasetService } from "./services/compile-evaluation-dataset.service";
import { CompileEvaluationStoreService } from "./services/compile-evaluation-store.service";
import { CompileEvaluationService } from "./services/compile-evaluation.service";

@Module({
  imports: [LlmWikiModule, ModelModule],
  controllers: [CompileEvaluationController],
  providers: [
    CompileEvaluationStoreService,
    CompileEvaluationDatasetService,
    CompileEvaluationService,
  ],
})
export class EvaluationModule {}

import { Module } from "@nestjs/common";
import { ModelModule } from "../model/model.module";
import { LlmWikiManagementController } from "./controllers/llm-wiki-management.controller";
import { LlmWikiRetrievalController } from "./controllers/llm-wiki-retrieval.controller";
import { LlmWikiCompilerService } from "./services/llm-wiki-compiler.service";
import { LlmWikiFusionService } from "./services/llm-wiki-fusion.service";
import { LlmWikiIngestService } from "./services/llm-wiki-ingest.service";
import { LlmWikiIssueService } from "./services/llm-wiki-issue.service";
import { LlmWikiLintService } from "./services/llm-wiki-lint.service";
import { LlmWikiManagementService } from "./services/llm-wiki-management.service";
import { LlmWikiRetrievalService } from "./services/llm-wiki-retrieval.service";
import { LlmWikiSchemaService } from "./services/llm-wiki-schema.service";
import { LlmWikiSearchService } from "./services/llm-wiki-search.service";
import { LlmWikiStoreService } from "./services/llm-wiki-store.service";

@Module({
  imports: [ModelModule],
  controllers: [LlmWikiManagementController, LlmWikiRetrievalController],
  providers: [
    LlmWikiStoreService,
    LlmWikiCompilerService,
    LlmWikiFusionService,
    LlmWikiIngestService,
    LlmWikiIssueService,
    LlmWikiLintService,
    LlmWikiManagementService,
    LlmWikiRetrievalService,
    LlmWikiSchemaService,
    LlmWikiSearchService
  ],
  exports: [LlmWikiRetrievalService]
})
export class LlmWikiModule {}

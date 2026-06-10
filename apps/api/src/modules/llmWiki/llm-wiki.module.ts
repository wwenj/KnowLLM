import { Module } from "@nestjs/common";
import { ModelModule } from "../model/model.module";
import { LlmWikiController } from "./controllers/llm-wiki.controller";
import { LlmWikiCompilerService } from "./services/llm-wiki-compiler.service";
import { LlmWikiFusionService } from "./services/llm-wiki-fusion.service";
import { LlmWikiIssueService } from "./services/llm-wiki-issue.service";
import { LlmWikiLintService } from "./services/llm-wiki-lint.service";
import { LlmWikiSchemaService } from "./services/llm-wiki-schema.service";
import { LlmWikiSearchService } from "./services/llm-wiki-search.service";
import { LlmWikiStoreService } from "./services/llm-wiki-store.service";
import { LlmWikiService } from "./services/llm-wiki.service";

@Module({
  imports: [ModelModule],
  controllers: [LlmWikiController],
  providers: [
    LlmWikiStoreService,
    LlmWikiCompilerService,
    LlmWikiFusionService,
    LlmWikiIssueService,
    LlmWikiLintService,
    LlmWikiSchemaService,
    LlmWikiSearchService,
    LlmWikiService
  ],
  exports: [LlmWikiStoreService, LlmWikiSearchService, LlmWikiSchemaService, LlmWikiService]
})
export class LlmWikiModule {}

import { Module } from "@nestjs/common";
import { ModelModule } from "../model/model.module";
import { LlmWikiController } from "./controllers/llm-wiki.controller";
import { LlmWikiCompilerService } from "./services/llm-wiki-compiler.service";
import { LlmWikiIssueService } from "./services/llm-wiki-issue.service";
import { LlmWikiSearchService } from "./services/llm-wiki-search.service";
import { LlmWikiStoreService } from "./services/llm-wiki-store.service";
import { LlmWikiService } from "./services/llm-wiki.service";

@Module({
  imports: [ModelModule],
  controllers: [LlmWikiController],
  providers: [
    LlmWikiStoreService,
    LlmWikiCompilerService,
    LlmWikiIssueService,
    LlmWikiSearchService,
    LlmWikiService
  ],
  exports: [LlmWikiStoreService, LlmWikiSearchService, LlmWikiService]
})
export class LlmWikiModule {}

import { Module } from "@nestjs/common";
import { ModelModule } from "../model/model.module";
import { LlmWikiNextController } from "./llm-wiki-next.controller";
import { LlmWikiNextService } from "./llm-wiki-next.service";
import { LlmWikiNextStore } from "./llm-wiki-next.store";
import { LlmWikiNextToolsService } from "./llm-wiki-next-tools.service";
import { LlmWikiNextWorkspaceFactory } from "./llm-wiki-next-workspace.factory";
import { KnowledgeBaseService } from "./knowledge-base.service";

@Module({
  imports: [ModelModule],
  controllers: [LlmWikiNextController],
  providers: [KnowledgeBaseService, LlmWikiNextStore, LlmWikiNextService, LlmWikiNextWorkspaceFactory, LlmWikiNextToolsService],
  exports: [KnowledgeBaseService, LlmWikiNextWorkspaceFactory, LlmWikiNextToolsService],
})
export class LlmWikiNextModule {}

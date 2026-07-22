import { Module } from "@nestjs/common";
import { ModelModule } from "../model/model.module";
import { LlmWikiNextController } from "./llm-wiki-next.controller";
import { LlmWikiNextService } from "./llm-wiki-next.service";
import { LlmWikiNextStore } from "./llm-wiki-next.store";

@Module({
  imports: [ModelModule],
  controllers: [LlmWikiNextController],
  providers: [LlmWikiNextStore, LlmWikiNextService],
})
export class LlmWikiNextModule {}

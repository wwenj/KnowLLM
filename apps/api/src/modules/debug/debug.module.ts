import { Module } from "@nestjs/common";
import { LlmWikiModule } from "../llmWiki/llm-wiki.module";
import { DebugLlmWikiController } from "./controllers/debug-llm-wiki.controller";

@Module({
  imports: [LlmWikiModule],
  controllers: [DebugLlmWikiController]
})
export class DebugModule {}

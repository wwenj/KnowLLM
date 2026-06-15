import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { LlmWikiRetrievalService } from "../../llmWiki/services/llm-wiki-retrieval.service";

@ApiTags("Debug / LLM Wiki")
@Controller("api/debug/llm-wiki")
export class DebugLlmWikiController {
  constructor(private readonly retrieval: LlmWikiRetrievalService) {}

  @ApiOperation({ summary: "查看 LLM Wiki 调试摘要" })
  @Get("summary")
  summary() {
    return this.retrieval.getManifest();
  }
}

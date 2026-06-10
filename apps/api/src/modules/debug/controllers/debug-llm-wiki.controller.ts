import { Controller, Get, Query } from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { LlmWikiService } from "../../llmWiki/services/llm-wiki.service";

@ApiTags("Debug / LLM Wiki")
@Controller("api/debug/llm-wiki")
export class DebugLlmWikiController {
  constructor(private readonly wiki: LlmWikiService) {}

  @ApiOperation({ summary: "查看 LLM Wiki 调试摘要" })
  @Get("summary")
  summary() {
    return this.wiki.debugSummary();
  }

  @ApiOperation({ summary: "调试 LLM Wiki 搜索结果" })
  @ApiQuery({ name: "q", required: true, description: "搜索关键词" })
  @ApiQuery({ name: "limit", required: false, description: "最大返回数量", example: 10 })
  @Get("search")
  search(@Query("q") q = "", @Query("limit") limit?: string) {
    return this.wiki.searchWiki(q, Number(limit) || 10);
  }
}

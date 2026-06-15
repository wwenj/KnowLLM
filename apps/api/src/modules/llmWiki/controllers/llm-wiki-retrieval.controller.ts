import { BadRequestException, Controller, Get, HttpException, Param, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { LlmWikiRetrievalService } from "../services/llm-wiki-retrieval.service";

@ApiTags("LLM Wiki / Retrieval")
@Controller("api/llm-wiki/retrieval")
export class LlmWikiRetrievalController {
  constructor(private readonly retrieval: LlmWikiRetrievalService) {}

  @Get("manifest")
  manifest() {
    return this.run(() => this.retrieval.getManifest());
  }

  @Get("search")
  search(@Query("q") query = "", @Query("limit") limit?: string) {
    return this.run(() => this.retrieval.search(query, Number(limit)));
  }

  @Get("page")
  page(@Query("path") path = "index.md") {
    return this.run(() => this.retrieval.readPage(path));
  }

  @Get("source/:sourceId")
  source(@Param("sourceId") sourceId: string) {
    return this.run(() => this.retrieval.readSource(sourceId));
  }

  private run<T>(fn: () => T): T {
    try {
      return fn();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new BadRequestException(error instanceof Error ? error.message : String(error));
    }
  }
}

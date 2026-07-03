import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiConsumes, ApiTags } from "@nestjs/swagger";
import { llmWikiConfig } from "../llm-wiki.config";
import { LlmWikiManagementService } from "../services/llm-wiki-management.service";

interface UploadedLlmWikiFile {
  originalname: string;
  buffer: Buffer;
}

@ApiTags("LLM Wiki / Manage")
@Controller("api/llm-wiki/manage")
export class LlmWikiManagementController {
  constructor(private readonly wiki: LlmWikiManagementService) {}

  @Get("overview")
  overview() {
    return this.run(() => this.wiki.overview());
  }

  @Get("sources")
  listSources() {
    return this.run(() => this.wiki.listSources());
  }

  @ApiConsumes("multipart/form-data")
  @Post("sources/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: llmWikiConfig.maxUploadBytes } }))
  uploadSource(@UploadedFile() file?: UploadedLlmWikiFile) {
    if (!file) throw new BadRequestException("请选择上传文件");
    return this.run(() => this.wiki.uploadSource(decodeUploadFilename(file.originalname), file.buffer));
  }

  @Post("sources/:sourceId/ingest")
  ingestSource(
    @Param("sourceId") sourceId: string,
    @Body("model") model = "",
  ) {
    return this.run(() => this.wiki.ingestSource(sourceId, model));
  }

  @Post("sources/:sourceId/rename")
  renameSource(@Param("sourceId") sourceId: string, @Body("filename") filename = "") {
    return this.run(() => this.wiki.renameSource(sourceId, filename));
  }

  @Post("sources/:sourceId/delete")
  deleteSource(@Param("sourceId") sourceId: string) {
    return this.run(() => this.wiki.deleteSource(sourceId));
  }

  @Get("schema")
  schema() {
    return this.run(() => this.wiki.getSchema());
  }

  @Post("schema/save")
  saveSchema(@Body("content") content = "") {
    return this.run(() => this.wiki.saveSchema(content));
  }

  @Post("pages/save")
  savePage(@Body("path") path = "index.md", @Body("content") content = "") {
    return this.run(() => this.wiki.savePage(path, content));
  }

  @Post("pages/delete")
  deletePage(@Body("path") path = "") {
    return this.run(() => this.wiki.deletePage(path));
  }

  @Post("lint")
  lint(@Body("mode") mode?: "structural" | "evidence" | "all") {
    return this.run(() => this.wiki.lintWiki(mode));
  }

  @Get("issues")
  issues(@Query("status") status?: "open" | "resolved" | "all") {
    return this.run(() => this.wiki.listIssues(status));
  }

  @Post("issues/:issueId/resolve")
  resolveIssue(@Param("issueId") issueId: string) {
    return this.run(() => this.wiki.resolveIssue(issueId));
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

function decodeUploadFilename(filename: string): string {
  const raw = filename || "";
  const decoded = Buffer.from(raw, "latin1").toString("utf8");
  return /[ÃÂ]|(?:ç|è|é|æ|å)/.test(raw) && decoded ? decoded : raw;
}

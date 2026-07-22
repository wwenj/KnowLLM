import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger";
import { LlmWikiNextService } from "./llm-wiki-next.service";
import { CompileRequest } from "./llm-wiki-next.types";

interface UploadedSourceFile {
  originalname: string;
  buffer: Buffer;
}

@ApiTags("LLM Wiki Next")
@Controller("api/llm-wiki-next")
export class LlmWikiNextController {
  constructor(private readonly wiki: LlmWikiNextService) {}

  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "上传不可变 Markdown/Text Source" })
  @Post("sources/upload")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  uploadSource(@UploadedFile() file?: UploadedSourceFile) {
    if (!file) throw new BadRequestException("请选择上传文件");
    return this.wiki.uploadSource(
      decodeUploadFilename(file.originalname),
      file.buffer,
    );
  }

  @Get("sources")
  listSources() {
    return { items: this.wiki.listSources() };
  }

  @Get("sources/:sourceId")
  getSource(@Param("sourceId") sourceId: string) {
    return this.wiki.getSource(sourceId);
  }

  @Post("sources/delete")
  deleteSources(@Body() request: { sourceIds?: string[] }) {
    return this.wiki.deleteSources(request?.sourceIds || []);
  }

  @Post("compile/estimate")
  estimateCompile(@Body() request: CompileRequest) {
    return this.wiki.estimateCompile(request || { sourceIds: [], model: "" });
  }

  @Post("compile")
  compile(@Body() request: CompileRequest) {
    return this.wiki.compile(request || { sourceIds: [], model: "" });
  }

  @Get("compile")
  getCompilePool() {
    return this.wiki.getCompilePool();
  }

  @Post("compile/cancel")
  cancelCompilePool() {
    return this.wiki.cancelCompilePool();
  }

  @Get("staging")
  getStaging() {
    return this.wiki.getStaging();
  }

  @Get("staging/pages/:pageKey")
  getStagingPage(@Param("pageKey") pageKey: string) {
    return this.wiki.getStagingPage(pageKey);
  }

  @Post("staging/publish")
  publishStaging() {
    return this.wiki.publishStaging();
  }

  @Post("staging/discard")
  discardStaging() {
    return this.wiki.discardStaging();
  }

  @Get("wiki/manifest")
  getPublishedManifest() {
    return this.wiki.getPublishedManifest();
  }

  @Get("wiki/pages/:pageKey")
  getPublishedPage(@Param("pageKey") pageKey: string) {
    return this.wiki.getPublishedPage(pageKey);
  }

  @Get("wiki/search")
  searchPublished(@Query("q") query = "", @Query("limit") limit = "20") {
    return this.wiki.searchPublished(query, Number(limit));
  }
}

function decodeUploadFilename(filename: string): string {
  const raw = filename || "";
  const decoded = Buffer.from(raw, "latin1").toString("utf8");
  return /[ÃÂ]|(?:ç|è|é|æ|å)/.test(raw) && decoded ? decoded : raw;
}

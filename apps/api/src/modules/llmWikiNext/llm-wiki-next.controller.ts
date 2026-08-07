import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger";
import { KnowledgeBaseService } from "./knowledge-base.service";
import { LlmWikiNextWorkspaceFactory } from "./llm-wiki-next-workspace.factory";
import { LlmWikiNextToolsService } from "./llm-wiki-next-tools.service";
import { CompileRequest } from "./llm-wiki-next.types";

interface UploadedSourceFile {
  originalname: string;
  buffer: Buffer;
}

@ApiTags("LLM Wiki Next")
@Controller("api/llm-wiki-next")
export class LlmWikiNextController {
  constructor(
    private readonly knowledgeBases: KnowledgeBaseService,
    private readonly workspaces: LlmWikiNextWorkspaceFactory,
    private readonly tools: LlmWikiNextToolsService,
  ) {}

  @Get("knowledge-bases")
  listKnowledgeBases() {
    return { items: this.knowledgeBases.list() };
  }

  @Post("knowledge-bases")
  createKnowledgeBase(@Body() body: { name?: string }) {
    return this.knowledgeBases.create(body?.name || "");
  }

  @Post("knowledge-bases/:knowledgeBaseId/rename")
  renameKnowledgeBase(
    @Param("knowledgeBaseId") knowledgeBaseId: string,
    @Body() body: { name?: string },
  ) {
    return this.knowledgeBases.rename(knowledgeBaseId, body?.name || "");
  }

  @Delete("knowledge-bases/:knowledgeBaseId")
  deleteKnowledgeBase(@Param("knowledgeBaseId") knowledgeBaseId: string) {
    if (this.workspaces.hasActiveCompile(knowledgeBaseId)) {
      throw new BadRequestException("知识库正在编译，请先停止编译后再删除");
    }
    if (this.knowledgeBases.hasActiveRuns(knowledgeBaseId)) {
      throw new BadRequestException("知识库存在运行中的 Agent 或评测，请先停止任务后再删除");
    }
    this.workspaces.remove(knowledgeBaseId);
    return this.knowledgeBases.remove(knowledgeBaseId);
  }

  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "上传不可变 Markdown/Text Source" })
  @Post("knowledge-bases/:knowledgeBaseId/sources/upload")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  uploadSource(@Param("knowledgeBaseId") knowledgeBaseId: string, @UploadedFile() file?: UploadedSourceFile) {
    if (!file) throw new BadRequestException("请选择上传文件");
    return this.workspaces.get(knowledgeBaseId).uploadSource(
      decodeUploadFilename(file.originalname),
      file.buffer,
    );
  }

  @Get("knowledge-bases/:knowledgeBaseId/sources")
  listSources(@Param("knowledgeBaseId") knowledgeBaseId: string) {
    return { items: this.workspaces.get(knowledgeBaseId).listSources() };
  }

  @Get("knowledge-bases/:knowledgeBaseId/sources/:sourceId")
  getSource(@Param("knowledgeBaseId") knowledgeBaseId: string, @Param("sourceId") sourceId: string) {
    return this.workspaces.get(knowledgeBaseId).getSource(sourceId);
  }

  @Get("knowledge-bases/:knowledgeBaseId/sources/:sourceId/compile-detail")
  getSourceCompileDetail(@Param("knowledgeBaseId") knowledgeBaseId: string, @Param("sourceId") sourceId: string) {
    return this.workspaces.get(knowledgeBaseId).getSourceCompileDetail(sourceId);
  }

  @Post("knowledge-bases/:knowledgeBaseId/sources/delete")
  deleteSources(@Param("knowledgeBaseId") knowledgeBaseId: string, @Body() request: { sourceIds?: string[] }) {
    return this.workspaces.get(knowledgeBaseId).deleteSources(request?.sourceIds || []);
  }

  @Post("knowledge-bases/:knowledgeBaseId/compile/estimate")
  estimateCompile(@Param("knowledgeBaseId") knowledgeBaseId: string, @Body() request: CompileRequest) {
    return this.workspaces.get(knowledgeBaseId).estimateCompile(request || { sourceIds: [], model: "" });
  }

  @Post("knowledge-bases/:knowledgeBaseId/compile")
  compile(@Param("knowledgeBaseId") knowledgeBaseId: string, @Body() request: CompileRequest) {
    return this.workspaces.get(knowledgeBaseId).compile(request || { sourceIds: [], model: "" });
  }

  @Get("knowledge-bases/:knowledgeBaseId/compile")
  getCompilePool(@Param("knowledgeBaseId") knowledgeBaseId: string) {
    return this.workspaces.get(knowledgeBaseId).getCompilePool();
  }

  @Post("knowledge-bases/:knowledgeBaseId/compile/cancel")
  cancelCompilePool(@Param("knowledgeBaseId") knowledgeBaseId: string) {
    return this.workspaces.get(knowledgeBaseId).cancelCompilePool();
  }

  @Get("knowledge-bases/:knowledgeBaseId/staging")
  getStaging(@Param("knowledgeBaseId") knowledgeBaseId: string) {
    return this.workspaces.get(knowledgeBaseId).getStaging();
  }

  @Get("knowledge-bases/:knowledgeBaseId/staging/pages/:pageKey")
  getStagingPage(@Param("knowledgeBaseId") knowledgeBaseId: string, @Param("pageKey") pageKey: string) {
    return this.workspaces.get(knowledgeBaseId).getStagingPage(pageKey);
  }

  @Post("knowledge-bases/:knowledgeBaseId/staging/publish")
  publishStaging(@Param("knowledgeBaseId") knowledgeBaseId: string) {
    return this.workspaces.get(knowledgeBaseId).publishStaging();
  }

  @Post("knowledge-bases/:knowledgeBaseId/staging/discard")
  discardStaging(@Param("knowledgeBaseId") knowledgeBaseId: string) {
    return this.workspaces.get(knowledgeBaseId).discardStaging();
  }

  @Get("knowledge-bases/:knowledgeBaseId/wiki/manifest")
  getPublishedManifest(@Param("knowledgeBaseId") knowledgeBaseId: string) {
    return this.workspaces.get(knowledgeBaseId).getPublishedManifest();
  }

  @Get("knowledge-bases/:knowledgeBaseId/wiki/pages/:pageKey")
  getPublishedPage(@Param("knowledgeBaseId") knowledgeBaseId: string, @Param("pageKey") pageKey: string) {
    return this.workspaces.get(knowledgeBaseId).getPublishedPage(pageKey);
  }

  @Delete("knowledge-bases/:knowledgeBaseId/wiki/pages/:pageKey")
  deletePublishedPage(
    @Param("knowledgeBaseId") knowledgeBaseId: string,
    @Param("pageKey") pageKey: string,
    @Query("revisionId") revisionId = "",
  ) {
    return this.workspaces.get(knowledgeBaseId).deletePublishedPage(pageKey, revisionId);
  }

  @Get("knowledge-bases/:knowledgeBaseId/wiki/search")
  searchPublished(@Param("knowledgeBaseId") knowledgeBaseId: string, @Query("q") query = "", @Query("limit") limit = "20") {
    return this.workspaces.get(knowledgeBaseId).searchPublished(query, Number(limit));
  }

  @Get("knowledge-bases/:knowledgeBaseId/tools/catalog")
  getToolsCatalog(@Param("knowledgeBaseId") knowledgeBaseId: string) {
    return this.tools.getCatalog(knowledgeBaseId);
  }

  @Get("knowledge-bases/:knowledgeBaseId/tools/pages/:pageKey")
  readToolsPage(@Param("knowledgeBaseId") knowledgeBaseId: string, @Param("pageKey") pageKey: string) {
    return this.tools.readPage(knowledgeBaseId, pageKey);
  }

  @Get("knowledge-bases/:knowledgeBaseId/tools/sources/:sourceId")
  readToolsSource(
    @Param("knowledgeBaseId") knowledgeBaseId: string,
    @Param("sourceId") sourceId: string,
    @Query("startLine") startLine?: string,
    @Query("endLine") endLine?: string,
  ) {
    return this.tools.readSource(
      knowledgeBaseId,
      sourceId,
      startLine === undefined ? undefined : Number(startLine),
      endLine === undefined ? undefined : Number(endLine),
    );
  }

  @Get("knowledge-bases/:knowledgeBaseId/tools/search")
  searchToolsWiki(@Param("knowledgeBaseId") knowledgeBaseId: string, @Query("q") query = "") {
    return this.tools.searchWiki(knowledgeBaseId, query);
  }
}

function decodeUploadFilename(filename: string): string {
  const raw = filename || "";
  const decoded = Buffer.from(raw, "latin1").toString("utf8");
  return /[ÃÂ]|(?:ç|è|é|æ|å)/.test(raw) && decoded ? decoded : raw;
}

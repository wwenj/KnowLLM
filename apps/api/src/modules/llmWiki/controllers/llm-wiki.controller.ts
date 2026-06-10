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
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags
} from "@nestjs/swagger";
import { llmWikiConfig } from "../llm-wiki.config";
import { LlmWikiService } from "../services/llm-wiki.service";

interface UploadedLlmWikiFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

@ApiTags("LLM Wiki")
@Controller("api/llm-wiki")
export class LlmWikiController {
  constructor(private readonly wiki: LlmWikiService) {}

  @ApiOperation({ summary: "查看 LLM Wiki 概览统计" })
  @Get("overview")
  overview() {
    return this.run(() => this.wiki.overview());
  }

  @ApiOperation({ summary: "列出全部 source 及统计信息" })
  @Get("sources")
  listSources() {
    return this.run(() => this.wiki.listSources());
  }

  @ApiOperation({ summary: "上传文本 source" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          format: "binary",
          description: "支持 .md、.txt、.html，最大 10 MB"
        }
      },
      required: ["file"]
    }
  })
  @Post("sources/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: llmWikiConfig.maxUploadBytes } }))
  uploadSource(@UploadedFile() file?: UploadedLlmWikiFile) {
    if (!file) throw new BadRequestException("请选择上传文件");
    return this.run(() => this.wiki.uploadSource(decodeUploadFilename(file.originalname), file.buffer));
  }

  @ApiOperation({ summary: "触发 source 编译" })
  @ApiParam({ name: "sourceId", description: "Source ID" })
  @Post("sources/:sourceId/ingest")
  ingestSource(@Param("sourceId") sourceId: string) {
    return this.run(() => this.wiki.ingestSource(sourceId));
  }

  @ApiOperation({ summary: "重命名 source" })
  @ApiParam({ name: "sourceId", description: "Source ID" })
  @ApiBody({
    schema: {
      type: "object",
      properties: { filename: { type: "string", example: "architecture.md" } },
      required: ["filename"]
    }
  })
  @Post("sources/:sourceId/rename")
  renameSource(@Param("sourceId") sourceId: string, @Body("filename") filename = "") {
    return this.run(() => this.wiki.renameSource(sourceId, filename));
  }

  @ApiOperation({ summary: "删除 source 及其关联内容" })
  @ApiParam({ name: "sourceId", description: "Source ID" })
  @Post("sources/:sourceId/delete")
  deleteSource(@Param("sourceId") sourceId: string) {
    return this.run(() => this.wiki.deleteSource(sourceId));
  }

  @ApiOperation({ summary: "读取 source 原始文本" })
  @ApiParam({ name: "sourceId", description: "Source ID" })
  @Get("sources/:sourceId/raw")
  rawSource(@Param("sourceId") sourceId: string) {
    return this.run(() => this.wiki.rawSource(sourceId));
  }

  @ApiOperation({ summary: "读取 Wiki 页面目录树" })
  @Get("wiki/tree")
  wikiTree() {
    return this.run(() => this.wiki.wikiTree());
  }

  @ApiOperation({ summary: "读取指定 Wiki 页面" })
  @ApiQuery({ name: "path", required: false, description: "Wiki 相对路径", example: "index.md" })
  @Get("wiki/page")
  wikiPage(@Query("path") relPath = "index.md") {
    return this.run(() => this.wiki.getPage(relPath));
  }

  @ApiOperation({ summary: "保存 Wiki 页面" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        path: { type: "string", example: "concepts/agent.md" },
        content: { type: "string", example: "# Agent\n\n页面内容" }
      },
      required: ["path", "content"]
    }
  })
  @Post("wiki/page/save")
  savePage(@Body("path") relPath = "index.md", @Body("content") content = "") {
    return this.run(() => this.wiki.savePage(relPath, content));
  }

  @ApiOperation({ summary: "删除 Wiki 页面" })
  @ApiBody({
    schema: {
      type: "object",
      properties: { path: { type: "string", example: "concepts/agent.md" } },
      required: ["path"]
    }
  })
  @Post("wiki/page/delete")
  deletePage(@Body("path") relPath = "") {
    return this.run(() => this.wiki.deletePage(relPath));
  }

  @ApiOperation({ summary: "搜索 LLM Wiki 页面" })
  @ApiQuery({ name: "q", required: true, description: "搜索关键词" })
  @ApiQuery({ name: "limit", required: false, description: "最大返回数量", example: 20 })
  @Get("search")
  search(@Query("q") q = "", @Query("limit") limit?: string) {
    return this.run(() => this.wiki.searchWiki(q, Number(limit)));
  }

  @ApiOperation({ summary: "读取 LLM Wiki Schema" })
  @Get("schema")
  schema() {
    return this.run(() => this.wiki.getSchema());
  }

  @ApiOperation({ summary: "保存 LLM Wiki Schema" })
  @ApiBody({
    schema: {
      type: "object",
      properties: { content: { type: "string", example: "# LLM Wiki Schema" } },
      required: ["content"]
    }
  })
  @Post("schema/save")
  saveSchema(@Body("content") content = "") {
    return this.run(() => this.wiki.saveSchema(content));
  }

  @ApiOperation({ summary: "检查 Wiki 结构与证据问题" })
  @ApiBody({
    required: false,
    schema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["structural", "evidence", "all"],
          default: "all"
        }
      }
    }
  })
  @Post("lint")
  lint(@Body("mode") mode?: "structural" | "evidence" | "all") {
    return this.run(() => this.wiki.lintWiki(mode));
  }

  @ApiOperation({ summary: "列出 LLM Wiki Issues" })
  @ApiQuery({
    name: "status",
    required: false,
    enum: ["open", "resolved", "all"],
    description: "Issue 状态过滤"
  })
  @Get("issues")
  issues(@Query("status") status?: "open" | "resolved" | "all") {
    return this.run(() => this.wiki.listIssues(status));
  }

  @ApiOperation({ summary: "将 Issue 标记为已解决" })
  @ApiParam({ name: "issueId", description: "Issue ID" })
  @Post("issues/:issueId/resolve")
  resolveIssue(@Param("issueId") issueId: string) {
    return this.run(() => this.wiki.resolveIssue(issueId));
  }

  private run<T>(fn: () => T): T {
    try {
      return fn();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(message);
    }
  }
}

function decodeUploadFilename(filename: string): string {
  const raw = filename || "";
  const decoded = Buffer.from(raw, "latin1").toString("utf8");
  return /[ÃÂ]|(?:ç|è|é|æ|å)/.test(raw) && decoded ? decoded : raw;
}

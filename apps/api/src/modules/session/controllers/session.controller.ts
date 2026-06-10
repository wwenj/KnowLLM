import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query
} from "@nestjs/common";
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags
} from "@nestjs/swagger";
import { SessionStoreService } from "../services/session-store.service";

@ApiTags("Sessions")
@Controller("api/session")
export class SessionController {
  constructor(private readonly sessions: SessionStoreService) {}

  @ApiOperation({ summary: "创建会话" })
  @ApiBody({
    required: false,
    schema: {
      type: "object",
      properties: { title: { type: "string", example: "新聊天" } }
    }
  })
  @Post("add")
  create(@Body("title") title?: string) {
    return this.sessions.create(title);
  }

  @ApiOperation({ summary: "分页列出会话" })
  @ApiQuery({ name: "page", required: false, example: 1 })
  @ApiQuery({ name: "page_size", required: false, example: 20 })
  @Get("list")
  list(@Query("page") page?: string, @Query("page_size") pageSize?: string) {
    return this.sessions.list(toOptionalInt(page), toOptionalInt(pageSize));
  }

  @ApiOperation({ summary: "读取会话及消息详情" })
  @ApiQuery({ name: "session_id", required: true, description: "会话 ID" })
  @Get("detail")
  detail(@Query("session_id") sessionId?: string) {
    return this.sessions.detail(toRequiredPositiveInt(sessionId, "session_id"));
  }

  @ApiOperation({ summary: "更新会话标题" })
  @ApiQuery({ name: "session_id", required: true, description: "会话 ID" })
  @ApiBody({
    schema: {
      type: "object",
      properties: { title: { type: "string", example: "新的会话标题" } },
      required: ["title"]
    }
  })
  @Post("update")
  update(@Query("session_id") sessionId: string | undefined, @Body("title") title = "") {
    return this.sessions.updateTitle(toRequiredPositiveInt(sessionId, "session_id"), title);
  }

  @ApiOperation({ summary: "删除会话" })
  @ApiParam({ name: "session_id", description: "会话 ID" })
  @Post(":session_id/delete")
  delete(@Param("session_id") sessionId?: string) {
    return this.sessions.delete(toRequiredPositiveInt(sessionId, "session_id"));
  }

  @ApiOperation({ summary: "更新消息操作状态" })
  @ApiParam({ name: "message_id", description: "消息 ID" })
  @ApiBody({
    schema: {
      type: "object",
      properties: { op_status: { type: "number", example: 1 } },
      required: ["op_status"]
    }
  })
  @Post("message/:message_id/op_status")
  updateMessageOpStatus(@Param("message_id") messageId: string | undefined, @Body("op_status") opStatus?: number) {
    return this.sessions.updateMessageOpStatus(toRequiredPositiveInt(messageId, "message_id"), Number(opStatus));
  }

  @ApiOperation({ summary: "列出 Chat 可用工具" })
  @Get("tools")
  tools() {
    return {
      items: [
        {
          id: "llmWiki",
          label: "LLM Wiki",
          description: "基于本地 LLM Wiki 检索回答",
          placeholder: "输入要查询的本地知识库问题"
        }
      ]
    };
  }
}

function toOptionalInt(value?: string): number | undefined {
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isInteger(n) ? n : undefined;
}

function toRequiredPositiveInt(value: string | undefined, field: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new BadRequestException(`${field} 非法`);
  return n;
}

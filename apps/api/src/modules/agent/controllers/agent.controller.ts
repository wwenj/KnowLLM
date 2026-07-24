import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger";
import { AgentService } from "../services/agent.service";

@ApiTags("Agents")
@Controller("api/agents")
export class AgentController {
  constructor(private readonly agents: AgentService) {}

  @ApiOperation({ summary: "列出可用 Agent" })
  @Get()
  listAgents() {
    return this.agents.listAgents();
  }

  @ApiOperation({ summary: "列出 Agent 运行记录" })
  @ApiQuery({ name: "limit", required: false, description: "最大返回数量", example: 50 })
  @Get("runs")
  listRuns(@Query("limit") limit?: string) {
    return this.agents.listRuns(limit ? Number(limit) : undefined);
  }

  @ApiOperation({ summary: "获取指定 Agent 的默认配置" })
  @ApiParam({ name: "agentType", description: "Agent 类型，当前仅支持 llmWiki" })
  @Get(":agentType/defaults")
  getDefaults(@Param("agentType") agentType: string) {
    return this.agents.getDefaults(agentType);
  }

  @ApiOperation({ summary: "提交 Agent 运行任务" })
  @ApiParam({ name: "agentType", description: "Agent 类型，当前仅支持 llmWiki" })
  @ApiBody({
    description: "LLM Wiki Agent 输入。fastModel 用于规划和快速检索，qualityModel 用于证据升级和最终回答。",
    schema: {
      type: "object",
      properties: {
        query: { type: "string", example: "Agent 查询如何工作？" },
        limit: { type: "number", example: 8 },
        fastModel: { type: "string", description: "Planner 与快速 ReAct 模型", example: "openapi-gpt:gpt-5.4-mini" },
        qualityModel: { type: "string", description: "质量 ReAct 与最终回答模型", example: "openapi-gpt:gpt-5.5" }
      },
      required: ["query", "limit", "fastModel", "qualityModel"]
    }
  })
  @Post(":agentType/runs")
  createRun(@Param("agentType") agentType: string, @Body() body: unknown) {
    return this.agents.submit(agentType, body);
  }

  @ApiOperation({ summary: "获取 Agent 运行详情" })
  @ApiParam({ name: "agentType", description: "Agent 类型" })
  @ApiParam({ name: "runId", description: "运行记录 ID" })
  @Get(":agentType/runs/:runId")
  getRun(@Param("agentType") agentType: string, @Param("runId") runId: string) {
    return this.agents.getDetail(agentType, runId);
  }

  @ApiOperation({ summary: "取消正在运行的 Agent 任务" })
  @ApiParam({ name: "agentType", description: "Agent 类型" })
  @ApiParam({ name: "runId", description: "运行记录 ID" })
  @Post(":agentType/runs/:runId/cancel")
  cancelRun(@Param("agentType") agentType: string, @Param("runId") runId: string) {
    return this.agents.cancel(agentType, runId);
  }
}

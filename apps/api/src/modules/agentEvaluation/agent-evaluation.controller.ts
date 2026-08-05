import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { AgentEvaluationService } from "./agent-evaluation.service";

interface CreateRunBody {
  caseIds?: string[];
  fastModel: string;
  qualityModel: string;
  judgeModel: string;
}

@Controller("api/evaluations/llm-wiki-agent")
export class AgentEvaluationController {
  constructor(private readonly evaluations: AgentEvaluationService) {}

  @Get("dataset")
  getDataset() {
    return this.evaluations.getDataset();
  }

  @Post("runs")
  createRun(@Body() body: CreateRunBody) {
    return this.evaluations.createRun(body || ({} as CreateRunBody));
  }

  @Get("runs")
  listRuns() {
    return this.evaluations.listRuns();
  }

  @Get("runs/:runId")
  getRun(@Param("runId") runId: string) {
    return this.evaluations.getRun(runId);
  }

  @Post("runs/:runId/cancel")
  cancelRun(@Param("runId") runId: string) {
    return this.evaluations.cancel(runId);
  }

  @Delete("runs/:runId")
  deleteRun(@Param("runId") runId: string) {
    return this.evaluations.delete(runId);
  }
}

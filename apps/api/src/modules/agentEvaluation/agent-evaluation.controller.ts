import { Body, Controller, Delete, Get, Param, Post, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AgentEvaluationService } from "./agent-evaluation.service";

interface CreateRunBody {
  knowledgeBaseId: string;
  datasetId: string;
  caseIds?: string[];
  fastModel: string;
  qualityModel: string;
  judgeModel: string;
}

@Controller("api/evaluations/llm-wiki-agent")
export class AgentEvaluationController {
  constructor(private readonly evaluations: AgentEvaluationService) {}

  @Get("datasets")
  listDatasets(@Query("knowledgeBaseId") knowledgeBaseId = "") {
    return this.evaluations.listDatasets(knowledgeBaseId);
  }

  @Get("datasets/:datasetId")
  getDataset(
    @Param("datasetId") datasetId: string,
    @Query("knowledgeBaseId") knowledgeBaseId = "",
  ) {
    return this.evaluations.getDataset(knowledgeBaseId, datasetId);
  }

  @Post("datasets/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadDataset(
    @Query("knowledgeBaseId") knowledgeBaseId = "",
    @UploadedFile() file?: { buffer: Buffer },
  ) {
    if (!file) throw new Error("请选择评测 JSON 文件");
    return this.evaluations.uploadDataset(knowledgeBaseId, file.buffer);
  }

  @Delete("datasets/:datasetId")
  deleteDataset(
    @Param("datasetId") datasetId: string,
    @Query("knowledgeBaseId") knowledgeBaseId = "",
  ) {
    this.evaluations.deleteDataset(knowledgeBaseId, datasetId);
    return { ok: true };
  }

  @Post("runs")
  createRun(@Body() body: CreateRunBody) {
    return this.evaluations.createRun(body || ({} as CreateRunBody));
  }

  @Get("runs")
  listRuns(@Query("knowledgeBaseId") knowledgeBaseId = "") {
    return this.evaluations.listRuns(knowledgeBaseId);
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

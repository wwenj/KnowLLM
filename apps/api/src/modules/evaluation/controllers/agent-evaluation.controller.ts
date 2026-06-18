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
import { AgentEvaluationDatasetService } from "../services/agent-evaluation-dataset.service";
import { AgentEvaluationService } from "../services/agent-evaluation.service";

interface UploadedDatasetFile {
  buffer: Buffer;
}

@ApiTags("Evaluations / LLM Wiki Agent")
@Controller("api/evaluations/llm-wiki-agent")
export class AgentEvaluationController {
  constructor(
    private readonly datasets: AgentEvaluationDatasetService,
    private readonly evaluations: AgentEvaluationService,
  ) {}

  @ApiConsumes("multipart/form-data")
  @Post("datasets/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 20 * 1024 * 1024 } }))
  uploadDataset(@UploadedFile() file?: UploadedDatasetFile) {
    if (!file) throw new BadRequestException("请选择 Agent 评测数据集 JSON 文件");
    return this.run(() => this.datasets.upload(file.buffer));
  }

  @Get("datasets")
  listDatasets() {
    return this.run(() => this.datasets.list());
  }

  @Get("datasets/:datasetId")
  getDataset(@Param("datasetId") datasetId: string) {
    return this.run(() => this.datasets.get(datasetId));
  }

  @Post("runs")
  createRun(@Body() body: unknown) {
    return this.run(() => this.evaluations.createRun(body));
  }

  @Get("runs")
  listRuns(@Query("limit") limit?: string) {
    return this.run(() => this.evaluations.listRuns(Number(limit)));
  }

  @Get("runs/:runId")
  getRun(@Param("runId") runId: string) {
    return this.run(() => this.evaluations.getRun(runId));
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

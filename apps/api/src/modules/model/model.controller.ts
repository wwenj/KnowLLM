import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { ModelService } from "./model.service";

@ApiTags("Models")
@Controller("api/models")
export class ModelController {
  constructor(private readonly models: ModelService) {}

  @ApiOperation({ summary: "列出当前可用模型" })
  @Get()
  listModels() {
    return { items: this.models.listModels() };
  }
}

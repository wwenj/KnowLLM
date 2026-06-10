import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

@ApiTags("Health")
@Controller("api/health")
export class HealthController {
  @ApiOperation({ summary: "检查 API 服务状态" })
  @Get()
  check() {
    return {
      ok: true,
      service: "knowllm-api",
      ts: new Date().toISOString()
    };
  }
}

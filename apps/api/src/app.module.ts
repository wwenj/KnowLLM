import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { ApiExceptionFilter } from "./common/api-exception.filter";
import { ApiResponseInterceptor } from "./common/api-response.interceptor";
import { getEnvFilePaths } from "./config/env";
import { AgentModule } from "./modules/agent/agent.module";
import { DebugModule } from "./modules/debug/debug.module";
import { HealthModule } from "./modules/health/health.module";
import { LlmWikiModule } from "./modules/llmWiki/llm-wiki.module";
import { ModelModule } from "./modules/model/model.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: getEnvFilePaths()
    }),
    HealthModule,
    ModelModule,
    LlmWikiModule,
    AgentModule,
    DebugModule
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: ApiResponseInterceptor
    },
    {
      provide: APP_FILTER,
      useClass: ApiExceptionFilter
    }
  ]
})
export class AppModule {}

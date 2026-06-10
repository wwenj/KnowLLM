import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: "*",
    methods: "*",
    allowedHeaders: "*",
    credentials: false
  });

  const port = Number(process.env.PORT || process.env.KNOWLLM_API_PORT || 39247);

  if (process.env.NODE_ENV !== "production") {
    const swaggerConfig = new DocumentBuilder()
      .setTitle("KnowLLM API")
      .setDescription("KnowLLM 本地 LLM Wiki、Agent、Session 和调试接口")
      .setVersion("1.0")
      .addServer(`http://localhost:${port}`, "本地开发服务")
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup("api-docs", app, document, {
      jsonDocumentUrl: "api-docs-json",
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true
      }
    });
  }

  await app.listen(port);
  Logger.log(`KnowLLM API listening on http://localhost:${port}`, "Bootstrap");
  if (process.env.NODE_ENV !== "production") {
    Logger.log(`Swagger docs: http://localhost:${port}/api-docs`, "Bootstrap");
  }
}

void bootstrap();

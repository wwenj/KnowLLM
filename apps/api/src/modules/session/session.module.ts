import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { ModelModule } from "../model/model.module";
import { SessionController } from "./controllers/session.controller";
import { SessionChatService } from "./services/session-chat.service";
import { SessionStoreService } from "./services/session-store.service";
import { SessionGateway } from "./session.gateway";

@Module({
  imports: [AgentModule, ModelModule],
  controllers: [SessionController],
  providers: [SessionStoreService, SessionChatService, SessionGateway],
  exports: [SessionStoreService]
})
export class SessionModule {}

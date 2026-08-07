import { Injectable } from "@nestjs/common";
import { ModelService } from "../model/model.service";
import { KnowledgeBaseService } from "./knowledge-base.service";
import { LlmWikiNextService } from "./llm-wiki-next.service";
import { LlmWikiNextStore } from "./llm-wiki-next.store";

/** 每个知识库拥有独立的编译状态与取消控制器，避免异步任务串库。 */
@Injectable()
export class LlmWikiNextWorkspaceFactory {
  private readonly workspaces = new Map<string, LlmWikiNextService>();

  constructor(
    private readonly knowledgeBases: KnowledgeBaseService,
    private readonly store: LlmWikiNextStore,
    private readonly model: ModelService,
  ) {}

  get(knowledgeBaseId: string): LlmWikiNextService {
    const knowledgeBase = this.knowledgeBases.get(knowledgeBaseId);
    const existing = this.workspaces.get(knowledgeBase.id);
    if (existing) return existing;
    const workspace = new LlmWikiNextService(
      this.store.forKnowledgeBase(knowledgeBase.id),
      this.model,
    );
    workspace.initialize();
    this.workspaces.set(knowledgeBase.id, workspace);
    return workspace;
  }

  remove(knowledgeBaseId: string): void {
    this.workspaces.delete(knowledgeBaseId);
  }

  hasActiveCompile(knowledgeBaseId: string): boolean {
    const pool = this.workspaces.get(knowledgeBaseId)?.getCompilePool();
    return Boolean(pool?.items.some((item) =>
      ["queued", "planning", "writing", "committing"].includes(item.phase),
    ));
  }
}

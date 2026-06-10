import type { WorkspaceOverview } from "@knowllm/protocol";

export function getWorkspaceOverview(): WorkspaceOverview {
  return {
    workspaceId: "default",
    sourceCount: 0,
    wikiPageCount: 0,
    openIssueCount: 0,
    lastUpdatedAt: null
  };
}

export function getDefaultWorkspaceDirectories(): string[] {
  return [
    ".knowllm/config",
    ".knowllm/schema",
    ".knowllm/sources",
    ".knowllm/wiki/summaries",
    ".knowllm/wiki/concepts",
    ".knowllm/wiki/entities",
    ".knowllm/wiki/comparisons",
    ".knowllm/issues/open",
    ".knowllm/issues/resolved",
    ".knowllm/meta",
    ".knowllm/tasks",
    ".knowllm/runs"
  ];
}

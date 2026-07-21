import { Fragment, useState } from "react";
import {
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  Trash2,
  Wrench,
} from "lucide-react";
import type { LlmWikiIssue } from "@/api/llmWiki";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  countIssues,
  formatTime,
  isWikiPageTarget,
  issueAdvice,
  issueSeverityClass,
} from "../utils";

interface DiagnosticsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issues: LlmWikiIssue[];
  issueStatus: "open" | "resolved" | "all";
  issueTotals: { open: number; resolved: number; all: number };
  issuesLoading: boolean;
  issuesClearing: boolean;
  lintLoading: boolean;
  onRunLint: () => void;
  onRefresh: () => void;
  onIssueStatusChange: (status: "open" | "resolved" | "all") => void;
  onClearIssues: () => void;
  onResolve: (issue: LlmWikiIssue) => void;
  onOpenTarget: (issue: LlmWikiIssue) => void;
  onCopyTarget: (issue: LlmWikiIssue) => void;
}

export function DiagnosticsDialog({
  open,
  onOpenChange,
  issues,
  issueStatus,
  issueTotals,
  issuesLoading,
  issuesClearing,
  lintLoading,
  onRunLint,
  onRefresh,
  onIssueStatusChange,
  onClearIssues,
  onResolve,
  onOpenTarget,
  onCopyTarget,
}: DiagnosticsDialogProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const counts = countIssues(issues);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[86vh] flex-col overflow-hidden sm:max-w-[1080px]">
        <DialogHeader>
          <DialogTitle>Wiki 诊断</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-700">
              <span>Current</span>
              <span className="font-semibold">{issues.length}</span>
            </span>
            <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-700">
              <span>Open</span>
              <span className="font-semibold">{issueTotals.open}</span>
            </span>
            <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-700">
              <span>Resolved</span>
              <span className="font-semibold">{issueTotals.resolved}</span>
            </span>
            <span className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-rose-700">
              <span>Error</span>
              <span className="font-semibold">{counts.error}</span>
            </span>
            <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">
              <span>Warning</span>
              <span className="font-semibold">{counts.warning}</span>
            </span>
            <span className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-sky-700">
              <span>Info</span>
              <span className="font-semibold">{counts.info}</span>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              disabled={issuesLoading || lintLoading || issuesClearing}
              onClick={onRefresh}
            >
              {issuesLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              刷新
            </Button>
            <Button
              variant="outline"
              disabled={issuesLoading || lintLoading || issuesClearing || !issues.length}
              onClick={onClearIssues}
            >
              {issuesClearing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              清空
            </Button>
            <Button disabled={lintLoading || issuesClearing} onClick={onRunLint}>
              {lintLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Wrench className="size-4" />
              )}
              重新检测
            </Button>
          </div>
        </div>
        <Tabs
          value={issueStatus}
          onValueChange={(value) =>
            onIssueStatusChange(value as "open" | "resolved" | "all")
          }
        >
          <TabsList>
            <TabsTrigger value="open">Open</TabsTrigger>
            <TabsTrigger value="resolved">Resolved</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">级别</th>
                <th className="px-3 py-2 text-left font-medium">类型</th>
                <th className="px-3 py-2 text-left font-medium">目标</th>
                <th className="px-3 py-2 text-left font-medium">说明</th>
                <th className="px-3 py-2 text-left font-medium">建议</th>
                <th className="px-3 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {issuesLoading && !issues.length ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-10 text-center text-slate-400"
                  >
                    <Loader2 className="mx-auto mb-2 size-4 animate-spin" />
                    加载中
                  </td>
                </tr>
              ) : issues.length ? (
                issues.map((issue) => {
                  const targetIsPage = isWikiPageTarget(issue.target);
                  const expanded = expandedId === issue.id;
                  return (
                    <Fragment key={issue.id}>
                      <tr className="border-t border-slate-100 align-top">
                        <td className="px-3 py-2">
                          <div className="flex flex-col items-start gap-1">
                            <span
                              className={`rounded-full border px-2 py-0.5 text-xs ${issueSeverityClass(issue.severity)}`}
                            >
                              {issue.severity}
                            </span>
                            {issueStatus === "all" && (
                              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-500">
                                {issue.status}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-600">
                          {issue.kind}
                        </td>
                        <td className="max-w-[220px] px-3 py-2 font-mono text-xs text-slate-500">
                          <span className="line-clamp-2 break-all">
                            {issue.target}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          <div>{issue.message}</div>
                          {issue.details && (
                            <button
                              className="mt-1 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700"
                              onClick={() =>
                                setExpandedId(expanded ? null : issue.id)
                              }
                            >
                              <ChevronRight
                                className={`size-3 transition ${expanded ? "rotate-90" : ""}`}
                              />
                              详情
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs leading-5 text-slate-500">
                          {issueAdvice(issue.kind)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!targetIsPage}
                              onClick={() => onOpenTarget(issue)}
                            >
                              <ExternalLink className="size-3" />
                              {targetIsPage ? "打开页面" : "不可定位"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => onCopyTarget(issue)}
                            >
                              <Copy className="size-3" />
                              复制
                            </Button>
                            {issue.status === "open" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => onResolve(issue)}
                              >
                                标记解决
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr
                          key={`${issue.id}-details`}
                          className="border-t border-slate-100 bg-slate-50/60"
                        >
                          <td
                            colSpan={6}
                            className="px-3 py-3 text-xs leading-5 text-slate-500"
                          >
                            <div className="grid gap-2 md:grid-cols-[1fr_260px]">
                              <pre className="whitespace-pre-wrap break-words rounded-md bg-white p-3 font-mono text-xs text-slate-600">
                                {issue.details || "无详情"}
                              </pre>
                              <div className="space-y-1 rounded-md bg-white p-3">
                                <div>
                                  source_ids:{" "}
                                  {issue.source_ids.length
                                    ? issue.source_ids.join(", ")
                                    : "-"}
                                </div>
                                <div>
                                  created_at:{" "}
                                  {formatTime(issue.created_at) || "-"}
                                </div>
                                <div>
                                  updated_at:{" "}
                                  {formatTime(issue.updated_at) || "-"}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              ) : (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-10 text-center text-slate-400"
                  >
                    {emptyIssueText(issueStatus)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function emptyIssueText(status: "open" | "resolved" | "all") {
  if (status === "open") return "当前检测未发现 open issue";
  if (status === "resolved") return "暂无 resolved issue";
  return "暂无 issue";
}

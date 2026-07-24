import { useState } from "react";
import {
  AlertCircle,
  Bot,
  Braces,
  CheckCircle2,
  Copy,
  Download,
  ListTree,
  Loader2,
  Search,
  StopCircle,
  Wrench,
  XCircle,
} from "lucide-react";
import type { AgentRunDetail, AgentRunEvent } from "@/api/agent";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AgentType, StatusKey } from "../types";
import {
  eventDetail,
  eventMeta,
  formatDuration,
  formatMetric,
  formatTime,
  statusText,
} from "../utils";

interface RunOutputPanelProps {
  events: AgentRunEvent[];
  detail: AgentRunDetail | null;
  status: StatusKey;
  agentType: AgentType | null;
  runId: string | null;
  activeTab: "process" | "result";
  onTabChange: (value: "process" | "result") => void;
  onCancel: () => void;
  onCopy: () => void;
  onDownload: () => void;
}

interface SelectedEventDetail {
  title: string;
  description: string;
  label: string;
  text: string;
}

export function RunOutputPanel({
  events,
  detail,
  status,
  agentType,
  runId,
  activeTab,
  onTabChange,
  onCancel,
  onCopy,
  onDownload,
}: RunOutputPanelProps) {
  const [selectedDetail, setSelectedDetail] = useState<SelectedEventDetail | null>(null);
  const isRunning = status === "running";
  const modelRounds = detail?.tokens?.modelCalls
    ?? detail?.tokens?.rounds
    ?? detail?.stats?.modelCalls;
  return (
    <>
      <Card className="flex min-h-0 min-w-0 max-w-full flex-col gap-0 overflow-hidden border border-slate-200/70 bg-white/90 py-0 shadow-sm">
      <Tabs
        className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden"
        value={activeTab}
        onValueChange={(value) => onTabChange(value as "process" | "result")}
      >
        <CardHeader className="flex h-14 shrink-0 flex-row items-center justify-between gap-3 overflow-hidden border-b border-slate-200/70 bg-slate-50/95 px-4 py-0">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <TabsList className="h-9 shrink-0 bg-white/90 p-1 shadow-sm ring-1 ring-slate-200/70">
              <TabsTrigger value="process" className="h-7 px-4">
                执行过程
                {isRunning && <Loader2 className="ml-1.5 size-3 animate-spin text-sky-500" />}
              </TabsTrigger>
              <TabsTrigger value="result" className="h-7 px-4">
                执行结果
              </TabsTrigger>
            </TabsList>
            {isRunning && (
              <Button
                variant="outline"
                size="sm"
                onClick={onCancel}
                className="h-7 shrink-0 border-rose-200 px-2 text-xs text-rose-600"
              >
                <StopCircle className="mr-1 size-3.5" />
                取消
              </Button>
            )}
          </div>
          <div className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 truncate font-mono text-xs text-slate-400">
              {runId ? `${agentType || "Agent"} · ${runId.slice(0, 8)}` : "尚未提交任务"}
            </span>
            <Button variant="outline" size="sm" className="h-8 px-2.5" onClick={onCopy} disabled={!runId}>
              <Copy className="size-3.5" />
              复制日志
            </Button>
            <Button variant="outline" size="sm" className="h-8 px-2.5" onClick={onDownload} disabled={!runId}>
              <Download className="size-3.5" />
              下载
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-0 py-0">
          <TabsContent value="process" className="m-0 min-h-0 flex-1 data-[state=inactive]:hidden">
            {!events.length ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                尚未开始执行
              </div>
            ) : (
              <ScrollArea className="h-full overflow-hidden">
                <div className="space-y-2 bg-slate-50/70 p-3">
                  {events.map((event, index) => {
                    const meta = eventMeta(event);
                    const codeDetail = eventDetail(event);
                    const EventIcon = eventIcon(event.type);
                    return (
                      <button
                        type="button"
                        disabled={!codeDetail}
                        key={`${event.ts || index}-${index}`}
                        className={`grid w-full min-w-0 grid-cols-[24px_minmax(0,1fr)] gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left shadow-sm outline-none transition-colors ${
                          codeDetail
                            ? "cursor-pointer hover:border-sky-200 hover:bg-sky-50/40 focus-visible:ring-2 focus-visible:ring-sky-500/60"
                            : "cursor-default"
                        }`}
                        onClick={() => {
                          if (!codeDetail) return;
                          setSelectedDetail({
                            title: event.msg || event.type,
                            description: meta,
                            label: codeDetail.label,
                            text: codeDetail.text,
                          });
                        }}
                      >
                        <EventIcon className={`mt-0.5 size-4 ${eventIconClass(event)}`} />
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center justify-between gap-2">
                            <div className="min-w-0 truncate text-sm font-medium text-slate-800">
                              {event.msg || event.type}
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              {codeDetail && (
                                <span className="text-[11px] text-slate-400">
                                  点击查看详情
                                </span>
                              )}
                              <span className="text-xs text-slate-400">
                                {formatTime(event.ts)}
                              </span>
                            </div>
                          </div>
                          {meta && (
                            <div className="mt-1 line-clamp-2 break-words text-xs leading-5 text-slate-500">
                              {meta}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                  <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700">
                    {isRunning ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : status === "failed" || status === "cancelled" ? (
                      <XCircle className="size-4 text-rose-500" />
                    ) : (
                      <CheckCircle2 className="size-4 text-emerald-500" />
                    )}
                    {isRunning ? "Agent 正在执行" : "执行已结束"}
                  </div>
                </div>
              </ScrollArea>
            )}
          </TabsContent>
          <TabsContent value="result" className="m-0 min-h-0 flex-1 data-[state=inactive]:hidden">
            {!detail ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                {status === "running" ? "等待执行结果…" : "暂无执行结果"}
              </div>
            ) : (
              <div className="h-full overflow-y-auto bg-slate-50/70 p-4">
                <dl className="mb-3 grid grid-cols-2 overflow-hidden rounded-lg border border-slate-200 bg-white sm:grid-cols-4">
                  <div className="border-b border-r border-slate-200 px-3 py-2 sm:border-b-0">
                    <dt className="text-xs text-slate-500">状态</dt>
                    <dd className="mt-0.5 text-sm font-medium text-slate-800">
                      {statusText(detail.status)}
                    </dd>
                  </div>
                  <div className="border-b border-slate-200 px-3 py-2 sm:border-b-0 sm:border-r">
                    <dt className="text-xs text-slate-500">耗时</dt>
                    <dd className="mt-0.5 text-sm font-medium text-slate-800">
                      {formatDuration(detail.startedAt, detail.endedAt)}
                    </dd>
                  </div>
                  <div className="border-r border-slate-200 px-3 py-2">
                    <dt className="text-xs text-slate-500">Token 总数</dt>
                    <dd className="mt-0.5 font-mono text-sm font-medium tabular-nums text-slate-800">
                      {formatMetric(detail.tokens?.totalTokens)}
                    </dd>
                  </div>
                  <div className="px-3 py-2">
                    <dt className="text-xs text-slate-500">模型轮次</dt>
                    <dd className="mt-0.5 font-mono text-sm font-medium tabular-nums text-slate-800">
                      {modelRounds === undefined ? "-" : `${formatMetric(modelRounds)} 次`}
                    </dd>
                  </div>
                </dl>
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <MarkdownRenderer
                    content={detail.resultMd || "暂无结果。"}
                    className="min-w-0 max-w-full overflow-x-hidden break-words [&_pre]:overflow-x-auto"
                  />
                </div>
              </div>
            )}
          </TabsContent>
        </CardContent>
      </Tabs>
      </Card>
      <Dialog
        open={Boolean(selectedDetail)}
        onOpenChange={(open) => {
          if (!open) setSelectedDetail(null);
        }}
      >
        <DialogContent className="flex max-h-[86vh] min-h-[420px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[960px]">
          <DialogHeader className="shrink-0 border-b border-slate-200 px-5 py-4 pr-12">
            <DialogTitle className="leading-5">
              {selectedDetail?.title || "执行详情"}
            </DialogTitle>
            <DialogDescription className="line-clamp-2 leading-5">
              {[selectedDetail?.label, selectedDetail?.description].filter(Boolean).join(" · ")}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto bg-slate-950 p-4">
            <pre className="min-w-full w-max font-mono text-xs leading-5 text-slate-100">
              {selectedDetail?.text || ""}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function eventIcon(type: string) {
  if (type.startsWith("model_")) return Bot;
  if (type.startsWith("tool_")) return type === "tool_response" ? Braces : Wrench;
  if (type === "plan_created") return ListTree;
  if (type.includes("error")) return AlertCircle;
  return Search;
}

function eventIconClass(event: AgentRunEvent): string {
  if (event.type.includes("error") || event.status === "failed" || event.status === "rejected") return "text-rose-600";
  if (event.type === "model_response" || event.type === "tool_response") return "text-emerald-600";
  if (event.type === "model_request" || event.type === "tool_request") return "text-sky-600";
  return "text-slate-500";
}

import {
  CheckCircle2,
  Copy,
  Download,
  Loader2,
  Search,
  StopCircle,
  XCircle,
} from "lucide-react";
import type { AgentRunDetail, AgentRunEvent } from "@/api/agent";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AgentType, StatusKey } from "./types";
import {
  eventDetail,
  eventMeta,
  formatDuration,
  formatTime,
  statusText,
} from "./utils";

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
  const isRunning = status === "running";
  return (
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
            <ProcessPanel events={events} isRunning={isRunning} status={status} />
          </TabsContent>
          <TabsContent value="result" className="m-0 min-h-0 flex-1 data-[state=inactive]:hidden">
            <ResultPanel detail={detail} status={status} />
          </TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  );
}

function ProcessPanel({
  events,
  isRunning,
  status,
}: {
  events: AgentRunEvent[];
  isRunning: boolean;
  status: StatusKey;
}) {
  if (!events.length) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        尚未开始执行
      </div>
    );
  }
  return (
    <ScrollArea className="h-full overflow-hidden">
      <div className="space-y-2 bg-slate-50/70 p-3">
        {events.map((event, index) => (
          <TimelineRow key={`${event.ts || index}-${index}`} event={event} />
        ))}
        <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700">
          {isRunning ? <Loader2 className="size-4 animate-spin" /> : <StatusIcon status={status} />}
          {isRunning ? "Agent 正在执行" : "执行已结束"}
        </div>
      </div>
    </ScrollArea>
  );
}

function TimelineRow({ event }: { event: AgentRunEvent }) {
  const meta = eventMeta(event);
  const detail = eventDetail(event);
  return (
    <div className="grid min-w-0 grid-cols-[24px_minmax(0,1fr)] gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <Search className="mt-0.5 size-4 text-sky-600" />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="truncate text-sm font-medium text-slate-800">{event.msg || event.type}</div>
          <span className="shrink-0 text-xs text-slate-400">{formatTime(event.ts)}</span>
        </div>
        {meta && <div className="mt-1 truncate text-xs text-slate-500">{meta}</div>}
        {detail && (
          <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-950 p-2 text-xs leading-relaxed text-slate-100">
            {detail}
          </pre>
        )}
      </div>
    </div>
  );
}

function ResultPanel({ detail, status }: { detail: AgentRunDetail | null; status: StatusKey }) {
  if (!detail) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        {status === "running" ? "等待执行结果…" : "暂无执行结果"}
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto bg-slate-50/70 p-4">
      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <ResultMetaCard label="状态" value={statusText(detail.status)} />
        <ResultMetaCard label="耗时" value={formatDuration(detail.startedAt, detail.endedAt)} />
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <MarkdownRenderer
          content={detail.resultMd || "暂无结果。"}
          className="min-w-0 max-w-full overflow-x-hidden break-words [&_pre]:overflow-x-auto"
        />
      </div>
    </div>
  );
}

function ResultMetaCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-slate-800">{value}</div>
    </div>
  );
}

function StatusIcon({ status }: { status: StatusKey }) {
  if (status === "failed" || status === "cancelled") {
    return <XCircle className="size-4 text-rose-500" />;
  }
  return <CheckCircle2 className="size-4 text-emerald-500" />;
}

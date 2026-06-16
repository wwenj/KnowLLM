import { History, Loader2, RefreshCw } from "lucide-react";
import type { AgentRunSummary } from "@/api/agent";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  agentTypePillClass,
  agentTypeText,
  formatDateTime,
  statusPillClass,
  statusText,
} from "../utils";

interface HistoryCardProps {
  history: AgentRunSummary[];
  activeRunKey: string | null;
  loading: boolean;
  onRefresh: () => void;
  onSelect: (item: AgentRunSummary) => void;
}

export function HistoryCard({
  history,
  activeRunKey,
  loading,
  onRefresh,
  onSelect,
}: HistoryCardProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-slate-200/70 bg-slate-50/95 px-3">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-800">
          <History className="size-4 shrink-0 text-slate-600" />
          <span className="truncate">历史记录</span>
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200/80">
            {history.length}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="mr-1 size-3 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 size-3" />
          )}
          刷新
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 space-y-1 p-2">
          {history.map((item) => {
            const itemKey = `${item.agentType}:${item.runId}`;
            const active = itemKey === activeRunKey;
            return (
              <button
                key={itemKey}
                type="button"
                onClick={() => onSelect(item)}
                className={[
                  "relative flex w-full min-w-0 max-w-full flex-col overflow-hidden rounded-lg border px-3 py-2 text-left transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out",
                  active
                    ? "border-slate-200 bg-gradient-to-r from-indigo-50/70 via-white to-white text-slate-950 shadow-sm ring-1 ring-indigo-100/80 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:rounded-l-lg before:bg-gradient-to-b before:from-indigo-500 before:to-violet-500"
                    : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                ].join(" ")}
              >
                <div className="grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5 overflow-hidden">
                  <span
                    className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold text-slate-900"
                    title={item.title || item.runId}
                  >
                    {item.title || item.runId}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${agentTypePillClass(item.agentType)}`}
                  >
                    {agentTypeText(item.agentType)}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${statusPillClass(item.status)}`}
                  >
                    {statusText(item.status)}
                  </span>
                </div>
                <div className="mt-1 flex w-full min-w-0 items-center justify-between gap-2 text-xs text-slate-400">
                  <span className="min-w-0 flex-1 truncate font-mono">
                    {item.runId.slice(0, 8)}
                  </span>
                  <span className="shrink-0">
                    {formatDateTime(item.startedAt)}
                  </span>
                </div>
              </button>
            );
          })}
          {!history.length && (
            <div className="flex h-32 items-center justify-center text-sm text-slate-400">
              暂无执行记录
            </div>
          )}
        </div>
      </ScrollArea>
    </section>
  );
}

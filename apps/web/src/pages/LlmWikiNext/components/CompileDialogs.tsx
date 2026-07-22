import { Loader2, Square } from "lucide-react";
import type { CompileEstimate, CompilePool } from "@/api/llmWikiNext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface CompileConfirmationDialogProps {
  open: boolean;
  estimate: CompileEstimate | null;
  sourceNames: Record<string, string>;
  starting: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

interface CompilePoolDialogProps {
  open: boolean;
  pool: CompilePool | null;
  sourceNames: Record<string, string>;
  cancelling: boolean;
  onOpenChange: (open: boolean) => void;
  onClear: () => void;
}

const poolStatusMeta = {
  queued: {
    label: "待编译",
    className: "border-slate-200 bg-slate-50 text-slate-600",
  },
  planning: {
    label: "规划中",
    className: "border-violet-200 bg-violet-50 text-violet-700",
  },
  writing: {
    label: "写入中",
    className: "border-indigo-200 bg-indigo-50 text-indigo-700",
  },
  completed: {
    label: "已暂存",
    className: "border-sky-200 bg-sky-50 text-sky-700",
  },
  failed: {
    label: "失败",
    className: "border-rose-200 bg-rose-50 text-rose-700",
  },
  cancelled: {
    label: "已取消",
    className: "border-slate-200 bg-slate-100 text-slate-600",
  },
};

export function CompileConfirmationDialog({
  open,
  estimate,
  sourceNames,
  starting,
  onOpenChange,
  onConfirm,
}: CompileConfirmationDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" showCloseButton={!starting}>
        <DialogHeader>
          <DialogTitle>确认编译</DialogTitle>
          <DialogDescription>
            编译会依据以下配置写入待发布 Wiki；正式 Wiki 不会在此操作中变更。
          </DialogDescription>
        </DialogHeader>

        {estimate && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-5 gap-y-3 rounded-lg bg-slate-50 px-3 py-3 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-slate-500">文档</dt>
                <dd className="mt-1 font-semibold tabular-nums text-slate-900">
                  {estimate.sourceCount} 个
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Source 并发</dt>
                <dd className="mt-1 font-semibold tabular-nums text-slate-900">
                  {estimate.options.sourceConcurrency}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Compile Unit</dt>
                <dd className="mt-1 font-semibold tabular-nums text-slate-900">
                  {estimate.compileUnitCount}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">模型调用上限</dt>
                <dd className="mt-1 font-semibold tabular-nums text-slate-900">
                  {estimate.maxModelCalls}
                </dd>
              </div>
              <div className="col-span-2 sm:col-span-2">
                <dt className="text-slate-500">输出 Token 上限</dt>
                <dd className="mt-1 font-semibold tabular-nums text-slate-900">
                  {estimate.maxOutputTokens.toLocaleString()}
                </dd>
              </div>
            </dl>

            <section>
              <p className="mb-2 text-xs font-medium text-slate-700">
                本次文档
              </p>
              <div className="max-h-44 divide-y divide-slate-100 overflow-auto rounded-lg border border-slate-200">
                {estimate.sourceIds.map((sourceId) => (
                  <div
                    key={sourceId}
                    className="px-3 py-2 text-sm text-slate-700"
                  >
                    <p
                      className="truncate"
                      title={sourceNames[sourceId] || sourceId}
                    >
                      {sourceNames[sourceId] || sourceId}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            disabled={starting}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button disabled={!estimate || starting} onClick={onConfirm}>
            {starting && <Loader2 className="animate-spin" />}
            开始编译
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CompilePoolDialog({
  open,
  pool,
  sourceNames,
  cancelling,
  onOpenChange,
  onClear,
}: CompilePoolDialogProps) {
  const items = pool?.items || [];
  const runningCount = items.filter(
    (item) => item.status === "planning" || item.status === "writing",
  ).length;
  const queuedCount = items.filter((item) => item.status === "queued").length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>待编译池</DialogTitle>
          <DialogDescription>
            文档列表会同步展示每条编译状态；在这里查看当前任务或清空未完成项。
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 border border-indigo-200 bg-indigo-50 px-3 py-3 text-indigo-950">
          <Loader2 className="size-5 shrink-0 animate-spin text-indigo-700" />
          <div className="min-w-0 text-sm">
            <p className="font-semibold">编译进行中</p>
            <p className="mt-0.5 text-xs text-indigo-800">
              {runningCount} 个正在编译
              {queuedCount ? `，${queuedCount} 个等待` : ""}
            </p>
          </div>
        </div>

        <div className="max-h-72 divide-y divide-slate-100 overflow-auto rounded-lg border border-slate-200">
          {items.map((item) => {
            const meta = poolStatusMeta[item.status];
            return (
              <div key={item.sourceId} className="px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <p
                    className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800"
                    title={sourceNames[item.sourceId] || item.sourceId}
                  >
                    {sourceNames[item.sourceId] || item.sourceId}
                  </p>
                  <span
                    className={cn(
                      "shrink-0 rounded-md border px-2 py-0.5 text-xs",
                      meta.className,
                    )}
                  >
                    {meta.label}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {item.compileUnitCount} Unit · 已调用 {item.modelCalls} /{" "}
                  {item.maxModelCalls}
                </p>
                {item.error && (
                  <p className="mt-1 text-xs text-rose-700">{item.error}</p>
                )}
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          <Button
            variant="destructive"
            disabled={!pool || cancelling}
            onClick={onClear}
          >
            {cancelling ? <Loader2 className="animate-spin" /> : <Square />}
            {cancelling ? "正在清空" : "清空待编译池"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BulkAction } from "../types";

interface SourceBulkActionsProps {
  selectedCount: number;
  bulkAction: BulkAction;
  bulkBusy: boolean;
  onBulkIngest: () => void;
  onOpenBulkDelete: () => void;
  onClearSelection: () => void;
}

export function SourceBulkActions({
  selectedCount,
  bulkAction,
  bulkBusy,
  onBulkIngest,
  onOpenBulkDelete,
  onClearSelection,
}: SourceBulkActionsProps) {
  if (selectedCount <= 0) return null;

  return (
    <div className="flex flex-none flex-col gap-2 border-b border-indigo-100 bg-indigo-50/60 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-xs text-slate-600">
        已选{" "}
        <span className="font-semibold text-slate-900">{selectedCount}</span>{" "}
        个文档
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={bulkBusy}
          onClick={onBulkIngest}
        >
          {bulkAction === "ingest" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          批量解析
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={bulkBusy}
          onClick={onOpenBulkDelete}
        >
          {bulkAction === "delete" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Trash2 className="size-3.5" />
          )}
          批量删除
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={bulkBusy}
          onClick={onClearSelection}
        >
          清空选择
        </Button>
      </div>
    </div>
  );
}

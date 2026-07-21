import { Loader2, Search } from "lucide-react";
import type { LlmWikiStats } from "@/api/llmWiki";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { sourcePageSizeOptions, statusStats } from "../constants";
import type { StatusFilter } from "../types";

interface SourceFiltersProps {
  stats: LlmWikiStats;
  nameDraft: string;
  statusDraft: StatusFilter;
  sourcePageSize: number;
  loading: boolean;
  selectionMode: boolean;
  onNameDraftChange: (value: string) => void;
  onStatusDraftChange: (value: StatusFilter) => void;
  onSourcePageSizeChange: (value: number) => void;
  onApplyFilters: () => void;
  onToggleSelectionMode: () => void;
}

export function SourceFilters({
  stats,
  nameDraft,
  statusDraft,
  sourcePageSize,
  loading,
  selectionMode,
  onNameDraftChange,
  onStatusDraftChange,
  onSourcePageSizeChange,
  onApplyFilters,
  onToggleSelectionMode,
}: SourceFiltersProps) {
  return (
    <div className="flex flex-none flex-col gap-2 border-b border-slate-200 bg-slate-50/70 px-3 py-2.5 2xl:flex-row 2xl:items-center 2xl:justify-between">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-slate-500" />
          全部{" "}
          <strong className="font-semibold text-slate-900">{stats.total}</strong>
        </span>
        {statusStats.map((item) => (
          <span key={item.key} className="inline-flex items-center gap-1.5">
            <span className={`size-1.5 rounded-full ${item.dotClassName}`} />
            {item.label}{" "}
            <strong className="font-semibold text-slate-900">
              {stats[item.key]}
            </strong>
          </span>
        ))}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 sm:w-[260px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            value={nameDraft}
            onChange={(event) => onNameDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onApplyFilters();
            }}
            placeholder="按文档名搜索"
            className="h-8 bg-white pl-8"
          />
        </div>
        <Select
          value={statusDraft}
          onValueChange={(value) => onStatusDraftChange(value as StatusFilter)}
        >
          <SelectTrigger className="h-8 w-full bg-white sm:w-[112px]">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="raw_uploaded">待编译</SelectItem>
            <SelectItem value="compile_planned">编译中</SelectItem>
            <SelectItem value="analysis_ready">待生成页面</SelectItem>
            <SelectItem value="candidate_ready">需检查</SelectItem>
            <SelectItem value="published">已发布</SelectItem>
            <SelectItem value="failed">失败</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={onApplyFilters}
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Search className="size-4" />
          )}
          筛选
        </Button>
        <Select
          value={String(sourcePageSize)}
          onValueChange={(value) => onSourcePageSizeChange(Number(value))}
        >
          <SelectTrigger className="h-8 w-full bg-white sm:w-[112px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            {sourcePageSizeOptions.map((size) => (
              <SelectItem key={size} value={String(size)}>
                每页 {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant={selectionMode ? "secondary" : "outline"}
          size="sm"
          onClick={onToggleSelectionMode}
        >
          {selectionMode ? "退出多选" : "多选"}
        </Button>
      </div>
    </div>
  );
}

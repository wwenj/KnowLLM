import {
  AlertTriangle,
  FolderOpen,
  Loader2,
  RefreshCw,
  Search,
  Settings2,
  Upload,
} from "lucide-react";
import type { RefObject } from "react";
import type { LlmWikiStats } from "@/api/llmWiki";
import type { ModelOption } from "@/api/model";
import { modelOptionLabel } from "@/api/model";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface LlmWikiHeaderProps {
  stats: LlmWikiStats;
  uploading: boolean;
  loading: boolean;
  modelLoading: boolean;
  model: string;
  modelOptions: ModelOption[];
  fileRef: RefObject<HTMLInputElement | null>;
  onUpload: (files?: FileList | null) => void;
  onOpenWiki: () => void;
  onOpenSearch: () => void;
  onOpenSchema: () => void;
  onOpenDiagnostics: () => void;
  onModelChange: (model: string) => void;
  onRefresh: () => void;
}

export function LlmWikiHeader({
  stats,
  uploading,
  loading,
  modelLoading,
  model,
  modelOptions,
  fileRef,
  onUpload,
  onOpenWiki,
  onOpenSearch,
  onOpenSchema,
  onOpenDiagnostics,
  onModelChange,
  onRefresh,
}: LlmWikiHeaderProps) {
  return (
    <header className="flex flex-none flex-col gap-2 border-b border-slate-200 bg-white/90 px-3 py-2.5 xl:flex-row xl:items-center xl:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-slate-600">
          文档
          <strong className="font-semibold tabular-nums text-slate-950">
            {stats.total}
          </strong>
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-slate-600">
          Wiki 页面
          <strong className="font-semibold tabular-nums text-slate-950">
            {stats.page_count}
          </strong>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex min-w-[240px] items-center gap-2">
          <span className="shrink-0 text-xs font-medium text-slate-600">
            解析模型
          </span>
          <Select
            value={model}
            onValueChange={onModelChange}
            disabled={modelLoading || !modelOptions.length}
          >
            <SelectTrigger className="h-8 min-w-0 flex-1 bg-white text-xs">
              <SelectValue
                placeholder={modelLoading ? "加载模型中" : "未配置可用模型"}
              />
            </SelectTrigger>
            <SelectContent>
              {modelOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {modelOptionLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".md,.txt,text/markdown,text/plain"
          className="hidden"
          onChange={(event) => onUpload(event.target.files)}
        />
        <Button disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
          上传文档
        </Button>
        <Button variant="outline" onClick={onOpenWiki}>
          <FolderOpen className="size-4" />
          Wiki
        </Button>
        <Button variant="outline" onClick={onOpenSearch}>
          <Search className="size-4" />
          搜索
        </Button>
        <Button variant="outline" onClick={onOpenSchema}>
          <Settings2 className="size-4" />
          Schema
        </Button>
        <Button variant="outline" onClick={onOpenDiagnostics}>
          <AlertTriangle className="size-4" />
          诊断
        </Button>
        <Button
          size="icon"
          variant="outline"
          disabled={loading}
          title="刷新文档列表"
          aria-label="刷新文档列表"
          onClick={onRefresh}
        >
          <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
        </Button>
      </div>
    </header>
  );
}

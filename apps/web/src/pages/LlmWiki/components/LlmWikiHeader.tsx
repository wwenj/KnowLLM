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
import { Button } from "@/components/ui/button";

interface LlmWikiHeaderProps {
  stats: LlmWikiStats;
  uploading: boolean;
  loading: boolean;
  fileRef: RefObject<HTMLInputElement | null>;
  onUpload: (files?: FileList | null) => void;
  onOpenWiki: () => void;
  onOpenSearch: () => void;
  onOpenSchema: () => void;
  onOpenDiagnostics: () => void;
  onRefresh: () => void;
}

export function LlmWikiHeader({
  stats,
  uploading,
  loading,
  fileRef,
  onUpload,
  onOpenWiki,
  onOpenSearch,
  onOpenSchema,
  onOpenDiagnostics,
  onRefresh,
}: LlmWikiHeaderProps) {
  return (
    <header className="flex flex-none flex-col gap-3 border-b border-slate-200 px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
      <div className="flex min-w-0 items-baseline gap-3">
        <h1 className="shrink-0 text-base font-semibold text-slate-950">
          LLM Wiki
        </h1>
        <span className="truncate text-xs text-slate-500">
          {stats.total} 个文档 · {stats.page_count} 个 Wiki 页面
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
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

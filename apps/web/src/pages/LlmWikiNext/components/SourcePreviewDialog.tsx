import type { SourceSnapshot } from "@/api/llmWikiNext";
import { Loader2, MapPin } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface SourcePreviewDialogProps {
  open: boolean;
  source: SourceSnapshot | null;
  sourceLine: number | null;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
}

function nearbyLines(
  content: string,
  sourceLine: number,
): Array<{ number: number; content: string }> {
  const lines = content.split("\n");
  const start = Math.max(0, sourceLine - 11);
  const end = Math.min(lines.length, sourceLine + 10);
  return lines
    .slice(start, end)
    .map((line, index) => ({ number: start + index + 1, content: line }));
}

/**
 * Facts 只保存“回到原文附近”的轻定位，不携带可验证 evidence。
 * 指定行号时仅渲染附近窗口，避免把超长 Source 的所有行都拆成 DOM 节点。
 */
export function SourcePreviewDialog({
  open,
  source,
  sourceLine,
  loading,
  onOpenChange,
}: SourcePreviewDialogProps) {
  const lineWindow =
    source && sourceLine ? nearbyLines(source.content, sourceLine) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[90vh] w-[min(92vw,1120px)] max-w-[1120px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1120px]"
        showCloseButton
      >
        <DialogHeader className="flex-none border-b border-slate-200 px-4 py-3 pr-12">
          <DialogTitle className="truncate">
            {source?.filename || "读取原文"}
          </DialogTitle>
          {source && (
            <DialogDescription className="font-mono text-xs">
              {source.sourceId}
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {loading ? (
            <div className="flex items-center gap-2 py-10 text-sm text-slate-500">
              <Loader2 className="size-4 animate-spin" />
              读取原文中
            </div>
          ) : source ? (
            lineWindow ? (
              <div>
                <p className="mb-2 inline-flex items-center gap-1.5 text-xs text-slate-500">
                  <MapPin className="size-3.5" />
                  定位到第 {sourceLine} 行附近
                </p>
                <div className="overflow-x-auto rounded-lg bg-slate-50 py-2 font-mono text-xs leading-5 text-slate-700">
                  {lineWindow.map((line) => (
                    <div
                      key={line.number}
                      className={`whitespace-pre ${
                        line.number === sourceLine ? "bg-amber-100/80" : ""
                      }`}
                    >
                      <span className="inline-block w-14 select-none border-r border-slate-200 pr-2 text-right text-slate-400">
                        {line.number}
                      </span>
                      <span className="pl-3">{line.content || " "}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <pre className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 font-mono text-xs leading-5 text-slate-700">
                {source.content}
              </pre>
            )
          ) : (
            <p className="py-10 text-sm text-slate-500">无法读取原文。</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CodeBlockProps {
  code: string;
  language?: string;
  copyable?: boolean;
  className?: string;
}

export function CodeBlock({
  code,
  language,
  copyable = true,
  className,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("已复制");

      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        resetTimerRef.current = null;
      }, 1600);
    } catch {
      toast.error("复制失败");
    }
  };

  return (
    <div
      className={cn(
        "not-prose group/code my-4 overflow-hidden rounded-lg border border-slate-800 bg-slate-950 text-slate-100",
        className,
      )}
    >
      <div className="flex h-9 items-center justify-between gap-3 border-b border-white/10 bg-white/[0.03] px-3">
        <span className="min-w-0 truncate font-mono text-[11px] uppercase text-slate-400">
          {language || "text"}
        </span>
        {copyable && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-slate-300 hover:bg-white/10 hover:text-white"
            title={copied ? "已复制" : "复制代码"}
            aria-label={copied ? "已复制" : "复制代码"}
            onClick={handleCopy}
          >
            {copied ? <Check /> : <Copy />}
          </Button>
        )}
      </div>
      <pre className="m-0 max-w-full overflow-x-auto p-4 text-xs leading-6">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  );
}

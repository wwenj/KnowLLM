import { ExternalLink, ImageOff, Maximize2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface ImageRendererProps {
  src?: string;
  alt?: string;
  preview?: boolean;
  className?: string;
}

export function ImageRenderer({
  src,
  alt,
  preview = true,
  className,
}: ImageRendererProps) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!src) return null;

  if (failed) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-500">
        <ImageOff className="size-3.5" aria-hidden="true" />
        图片加载失败
      </span>
    );
  }

  const image = (
    <img
      src={src}
      alt={alt || ""}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn(
        "max-h-[520px] max-w-full rounded-lg border border-slate-200 bg-white object-contain shadow-sm",
        className,
      )}
    />
  );

  if (!preview) return image;

  return (
    <>
      <button
        type="button"
        className="not-prose group/image relative my-3 block max-w-full cursor-zoom-in rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20"
        title="预览图片"
        onClick={() => setOpen(true)}
      >
        {image}
        <span className="pointer-events-none absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-full bg-slate-950/70 text-white opacity-0 shadow-sm transition-opacity group-hover/image:opacity-100 group-focus-visible/image:opacity-100">
          <Maximize2 className="size-3.5" aria-hidden="true" />
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] max-w-[calc(100vw-2rem)] overflow-hidden p-3 sm:max-w-5xl">
          <DialogTitle className="sr-only">{alt || "图片预览"}</DialogTitle>
          <div className="flex min-h-0 flex-col gap-3">
            <div className="min-h-0 overflow-auto rounded-lg bg-slate-950/95 p-2">
              <img
                src={src}
                alt={alt || ""}
                className="mx-auto max-h-[78vh] max-w-full rounded-md object-contain"
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 flex-1 truncate text-xs text-slate-500">
                {alt || src}
              </p>
              <Button asChild variant="outline" size="icon-sm" title="打开原图">
                <a href={src} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  <span className="sr-only">打开原图</span>
                </a>
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

import { Button } from "./button";

type PaginationItem =
  | { type: "page"; page: number }
  | { type: "ellipsis"; key: string };

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  pageSizeOptions?: readonly number[];
  onPageSizeChange?: (pageSize: number) => void;
  ariaLabel?: string;
  className?: string;
  showSummary?: boolean;
  disabled?: boolean;
}

function formatNumber(n: number): string {
  return n.toLocaleString("zh-CN");
}

function clampPage(page: number, totalPages: number) {
  return Math.min(Math.max(page, 1), totalPages);
}

function getPaginationItems(
  currentPage: number,
  totalPages: number,
): PaginationItem[] {
  const pages = new Set<number>([
    1,
    totalPages,
    currentPage - 1,
    currentPage,
    currentPage + 1,
  ]);
  if (currentPage <= 3) {
    pages.add(2);
    pages.add(3);
  }
  if (currentPage >= totalPages - 2) {
    pages.add(totalPages - 1);
    pages.add(totalPages - 2);
  }

  const sortedPages = Array.from(pages)
    .filter((p) => p >= 1 && p <= totalPages)
    .sort((a, b) => a - b);

  return sortedPages.flatMap((p, index) => {
    const prev = sortedPages[index - 1];
    if (prev && p - prev > 1) {
      return [
        { type: "ellipsis" as const, key: `${prev}-${p}` },
        { type: "page" as const, page: p },
      ];
    }
    return [{ type: "page" as const, page: p }];
  });
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  pageSizeOptions,
  onPageSizeChange,
  ariaLabel = "分页",
  className,
  showSummary = true,
  disabled = false,
}: PaginationProps) {
  if (total <= 0) return null;

  const safePageSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const currentPage = clampPage(page, totalPages);
  const paginationItems = getPaginationItems(currentPage, totalPages);
  const canChangePageSize =
    Boolean(onPageSizeChange) && Boolean(pageSizeOptions?.length);
  const goPage = (nextPage: number) => {
    const clampedPage = clampPage(nextPage, totalPages);
    if (clampedPage !== currentPage) onPageChange(clampedPage);
  };

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-center gap-2 py-2",
        className,
      )}
    >
      {canChangePageSize && (
        <label className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-600">
          <span>每页</span>
          <select
            aria-label="每页显示数量"
            value={pageSize}
            disabled={disabled}
            onChange={(event) => onPageSizeChange?.(Number(event.target.value))}
            className="h-6 cursor-pointer bg-transparent text-xs font-medium text-slate-700 outline-none disabled:cursor-not-allowed"
          >
            {pageSizeOptions?.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <span>条</span>
        </label>
      )}
      <nav
        aria-label={ariaLabel}
        className="inline-flex max-w-full items-center gap-2 overflow-x-auto rounded-lg border border-slate-200/80 bg-white/90 px-2 py-1.5 text-xs shadow-sm backdrop-blur"
      >
        <Button
          variant="outline"
          size="xs"
          title="上一页"
          disabled={disabled || currentPage <= 1}
          onClick={() => goPage(currentPage - 1)}
          className="h-7 rounded-md border-slate-200 bg-white px-2 text-slate-600"
        >
          <ChevronLeft size={14} />
          上一页
        </Button>

        <div className="inline-flex items-center gap-1">
          {paginationItems.map((item) =>
            item.type === "ellipsis" ? (
              <span
                key={item.key}
                className="flex h-7 min-w-7 items-center justify-center px-1 text-slate-400"
              >
                ...
              </span>
            ) : (
              <button
                key={item.page}
                type="button"
                aria-current={item.page === currentPage ? "page" : undefined}
                disabled={disabled}
                onClick={() => goPage(item.page)}
                className={cn(
                  "flex h-7 min-w-7 items-center justify-center rounded-md border px-2 font-medium transition disabled:pointer-events-none disabled:opacity-50",
                  item.page === currentPage
                    ? "border-indigo-600 bg-indigo-600 text-white shadow-sm"
                    : "border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700",
                )}
              >
                {item.page}
              </button>
            ),
          )}
        </div>

        <Button
          variant="outline"
          size="xs"
          title="下一页"
          disabled={disabled || currentPage >= totalPages}
          onClick={() => goPage(currentPage + 1)}
          className="h-7 rounded-md border-slate-200 bg-white px-2 text-slate-600"
        >
          下一页
          <ChevronRight size={14} />
        </Button>

        {showSummary && (
          <span className="shrink-0 border-l border-slate-200 pl-2 text-slate-500">
            第 {currentPage} / {formatNumber(totalPages)} 页，共{" "}
            {formatNumber(total)} 条
          </span>
        )}
      </nav>
    </div>
  );
}

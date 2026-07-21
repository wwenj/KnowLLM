type Status = "success" | "failed" | "running" | "insufficient" | "cancelled" | "ready" | "compiling" | "uploaded" | "ingesting" | string;

const map: Record<string, { label: string; cls: string }> = {
  success: { label: "成功", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  failed: { label: "失败", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  partial: { label: "部分失败", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  evaluation_failed: { label: "评测失败", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  running: { label: "运行中", cls: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  insufficient: { label: "信息不足", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  cancelled: { label: "已取消", cls: "bg-slate-100 text-slate-600 border-slate-200" },
  ready: { label: "已编译", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  raw_uploaded: { label: "待编译", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  compile_planned: { label: "编译中", cls: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  analysis_ready: { label: "待生成页面", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  candidate_ready: { label: "需检查", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  published: { label: "已发布", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  compiling: { label: "编译中", cls: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  ingesting: { label: "编译中", cls: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  uploaded: { label: "待编译", cls: "bg-amber-50 text-amber-700 border-amber-200" },
};

export function StatusTag({ status, labels }: { status: Status; labels?: Record<string, string> }) {
  const item = map[status] ?? { label: status, cls: "bg-slate-100 text-slate-600 border-slate-200" };
  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs leading-5 ${item.cls}`}>
      {labels?.[status] || item.label}
    </span>
  );
}

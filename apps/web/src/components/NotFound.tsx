import { ArrowLeft, Home } from "lucide-react";
import { useNavigate } from "react-router-dom";

const LOGO_URL =
  "https://file.ljcdn.com/nebula/313477d365d143b487d041f741e2ce93_1776847846865.png";

export function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-white px-6 text-center text-slate-800">
      <img
        src={LOGO_URL}
        alt="ZSpace"
        draggable={false}
        className="size-32 object-contain animate-nf-signal-shake animate-nf-signal-flicker animate-nf-signal-glitch"
        style={{ mixBlendMode: "multiply" }}
      />

      <h1 className="relative mt-8 select-none bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 bg-clip-text text-[120px] font-extrabold leading-none tracking-tighter text-transparent drop-shadow-[0_8px_24px_rgba(99,102,241,0.18)] sm:text-[160px]">
        404
        <span
          aria-hidden
          className="absolute inset-0 bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 bg-clip-text text-transparent opacity-50 blur-[2px] animate-nf-glitch"
        >
          404
        </span>
      </h1>

      <p className="mt-2 text-sm uppercase tracking-[0.42em] text-slate-400">
        Signal lost · 页面信号丢失
      </p>

      <div className="mt-8 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="group inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm text-slate-700 transition hover:border-indigo-300 hover:text-indigo-600 hover:shadow-[0_8px_24px_-8px_rgba(99,102,241,0.35)]"
        >
          <ArrowLeft size={16} className="transition group-hover:-translate-x-0.5" />
          返回上一页
        </button>
        <button
          type="button"
          onClick={() => navigate("/llm-wiki", { replace: true })}
          className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 px-5 py-2.5 text-sm font-medium text-white shadow-[0_8px_28px_rgba(99,102,241,0.4)] transition hover:shadow-[0_12px_36px_rgba(168,85,247,0.5)]"
        >
          <span
            aria-hidden
            className="absolute inset-0 bg-[linear-gradient(120deg,transparent_30%,rgba(255,255,255,0.45)_50%,transparent_70%)] bg-[length:200%_100%] animate-nf-shimmer"
          />
          <Home size={16} className="relative" />
          <span className="relative">回到主页</span>
        </button>
      </div>
    </div>
  );
}

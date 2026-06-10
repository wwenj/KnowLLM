import {
  BookOpen,
  MessageSquareText,
  Sparkles,
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";

const navItems = [
  { to: "/llm-wiki", label: "LLM Wiki", icon: BookOpen },
  { to: "/chat", label: "Chat", icon: MessageSquareText },
  { to: "/agents", label: "Agent 调试", icon: Sparkles },
];

export function AppLayout() {
  return (
    <div className="zspace-app">
      <header className="zspace-topbar">
        <div className="zspace-brand">
          <img src="/logo.png" alt="KnowLLM" className="zspace-logo" />
          <div className="zspace-brand-text">
            <span className="zspace-brand-title">KnowLLM</span>
            <span className="zspace-brand-subtitle">LLM Wiki · Agent · Workspace</span>
          </div>
        </div>
        <ServiceState />
      </header>

      <div className="zspace-scroll">
        <div className="zspace-frame">
          <aside className="zspace-sidebar">
            <nav className="zspace-nav">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    isActive ? "zspace-nav-link is-active" : "zspace-nav-link"
                  }
                >
                  <item.icon size={16} aria-hidden />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </nav>
          </aside>

          <main className="zspace-content">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}

function ServiceState() {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200/70 bg-emerald-50/80 px-3 py-1 text-xs font-medium text-emerald-700 shadow-[0_2px_8px_rgba(16,185,129,0.18)] backdrop-blur">
      <span className="relative flex size-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
        <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
      </span>
      服务正常
    </span>
  );
}

import {
  BookOpen,
  Bot,
  ClipboardCheck,
  Sparkles,
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";

const navItems = [
  { to: "/agents", label: "调试中心", icon: Sparkles },
  { to: "/llm-wiki-next", label: "LLM Wiki", icon: BookOpen },
  { to: "/evaluations/llm-wiki-compile", label: "编译评测", icon: ClipboardCheck },
  { to: "/evaluations/llm-wiki-agent", label: "Agent 评测", icon: Bot },
];

export function AppLayout() {
  return (
    <div className="knowllm-app">
      <header className="knowllm-topbar">
        <div className="knowllm-topbar-inner">
          <div className="knowllm-brand">
            <img src="/logo.webp" alt="KnowLLM" className="knowllm-logo" />
            <div className="knowllm-brand-text">
              <span className="knowllm-brand-title">KnowLLM</span>
              <span className="knowllm-brand-subtitle">LLM Wiki · Agent · Workspace</span>
            </div>
          </div>
          <nav className="knowllm-nav" aria-label="主导航">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  isActive ? "knowllm-nav-link is-active" : "knowllm-nav-link"
                }
              >
                <item.icon size={16} aria-hidden />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <div className="knowllm-workspace">
        <main className="knowllm-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

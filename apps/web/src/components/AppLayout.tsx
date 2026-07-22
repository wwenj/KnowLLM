import {
  BookOpen,
  Bot,
  ClipboardCheck,
  Sparkles,
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";

const navItems = [
  { to: "/agents", label: "调试中心", icon: Sparkles },
  { to: "/llm-wiki", label: "LLM Wiki 管理", icon: BookOpen },
  { to: "/llm-wiki-next", label: "LLM Wiki Next", icon: BookOpen },
  { to: "/evaluations/llm-wiki-compile", label: "编译评测", icon: ClipboardCheck },
  { to: "/evaluations/llm-wiki-agent", label: "Agent 评测", icon: Bot },
];

export function AppLayout() {
  return (
    <div className="zspace-app">
      <header className="zspace-topbar">
        <div className="zspace-topbar-inner">
          <div className="zspace-brand">
            <img src="/logo.png" alt="KnowLLM" className="zspace-logo" />
            <div className="zspace-brand-text">
              <span className="zspace-brand-title">KnowLLM</span>
              <span className="zspace-brand-subtitle">LLM Wiki · Agent · Workspace</span>
            </div>
          </div>
          <nav className="zspace-nav" aria-label="主导航">
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
        </div>
      </header>

      <div className="zspace-workspace">
        <main className="zspace-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

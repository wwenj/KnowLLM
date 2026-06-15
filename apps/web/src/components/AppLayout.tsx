import {
  BookOpen,
  MessageSquareText,
  Sparkles,
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";

const navItems = [
  { to: "/chat", label: "对话", icon: MessageSquareText },
  { to: "/agents", label: "调试中心", icon: Sparkles },
  { to: "/llm-wiki", label: "LLM Wiki 管理", icon: BookOpen },
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

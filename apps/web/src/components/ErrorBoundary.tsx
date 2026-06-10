import { AlertTriangle, RefreshCw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("[ErrorBoundary]", error, info);
    }
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-surface px-5 py-8 text-ink-950">
        <div className="w-full max-w-lg rounded border border-line bg-white p-6 shadow-soft">
          <div className="flex items-center gap-3">
            <AlertTriangle className="text-amber-600" size={22} />
            <h1 className="text-lg font-semibold">页面出错了</h1>
          </div>
          <p className="mt-3 text-sm text-ink-500 break-all">{error.message}</p>
          <button
            type="button"
            onClick={this.reset}
            className="mt-5 inline-flex h-9 items-center gap-2 rounded border border-line bg-white px-3 text-sm text-ink-700 transition hover:border-ink-950 hover:text-ink-950"
          >
            <RefreshCw size={15} aria-hidden="true" />
            <span>重试</span>
          </button>
        </div>
      </div>
    );
  }
}

import { Component, type ErrorInfo, type ReactNode } from "react";

interface MarkdownRenderBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  resetKey?: string | number | null;
}

interface MarkdownRenderBoundaryState {
  hasError: boolean;
}

export class MarkdownRenderBoundary extends Component<
  MarkdownRenderBoundaryProps,
  MarkdownRenderBoundaryState
> {
  state: MarkdownRenderBoundaryState = { hasError: false };

  static getDerivedStateFromError(): MarkdownRenderBoundaryState {
    return { hasError: true };
  }

  componentDidUpdate(prevProps: MarkdownRenderBoundaryProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("[MarkdownRenderer]", error, info);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            内容渲染失败
          </div>
        )
      );
    }

    return this.props.children;
  }
}

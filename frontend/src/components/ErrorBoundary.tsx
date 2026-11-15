import { Component, type ErrorInfo, type ReactNode } from 'react';
import { BRAND } from '../config/brand';

interface Props {
  children: ReactNode;
  /** Rendered instead of the full-page fallback when the subtree throws. */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

export function reportError(source: string, error: unknown, extra?: unknown) {
  // No error-reporting service is configured; log to console.
  // eslint-disable-next-line no-console
  console.error(`[${source}]`, error, extra ?? '');
}

/** Catches render errors so a failure shows a message instead of a blank page. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError('ErrorBoundary', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    // Light brand themes (doge/monad/swc) set --eb-* in index.css; the fallbacks keep
    // the default dark look. App's effect removes the <html> theme class when the tree
    // unmounts on a crash, so the fallback re-applies the brand theme class itself.
    return (
      <div
        role="alert"
        className={BRAND.themeClass || undefined}
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 24,
          textAlign: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: 'var(--eb-bg, #111)',
          color: 'var(--eb-fg, #fff)',
        }}
      >
        <h1 style={{ fontSize: 20, margin: 0 }}>Something went wrong</h1>
        <p style={{ margin: 0, opacity: 0.8 }}>
          The page couldn't load. Please try reloading.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: '10px 20px',
            borderRadius: 8,
            border: 'none',
            background: 'var(--eb-btn-bg, #ff393a)',
            color: 'var(--eb-btn-fg, #fff)',
            fontSize: 16,
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}

/** Markdown boundary: on failure show the raw text instead of killing the page. */
export function MarkdownBoundary({ text, children }: { text: string; children: ReactNode }) {
  return (
    <ErrorBoundary fallback={<p style={{ whiteSpace: 'pre-wrap' }}>{text}</p>}>
      {children}
    </ErrorBoundary>
  );
}

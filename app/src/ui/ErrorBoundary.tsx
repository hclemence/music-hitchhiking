import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode; onReload?: () => void };

/** Top-level catch: a render error shows a reload screen instead of a blank page. */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Music Hitchhiking crashed', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const reload = this.props.onReload ?? (() => location.reload());
    return (
      <main className="center-screen" role="alert">
        <p>Something went wrong.</p>
        <button type="button" className="primary" onClick={reload}>Reload</button>
      </main>
    );
  }
}

import { StrictMode, Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

/**
 * Top-level error boundary. A render error anywhere in the app used to unmount
 * the whole tree and leave a blank white screen with nothing to act on. Now it
 * shows the error on-screen (so it can be read/screenshotted) plus a Reload
 * button, and never leaves the user staring at a blank page.
 */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: unknown) { console.error('App crashed:', error, info); }
  render() {
    const err = this.state.error;
    if (!err) return this.props.children;
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui, -apple-system, sans-serif', color: '#3B3641', maxWidth: 640, margin: '0 auto' }}>
        <h2 style={{ color: '#E94F9C', marginBottom: 6 }}>Something went wrong</h2>
        <p style={{ fontWeight: 600, marginTop: 0 }}>The page hit an error. Please screenshot this and tap Reload.</p>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#FDEFF6', padding: 12, borderRadius: 10, fontSize: 12, lineHeight: 1.5 }}>
          {String(err.message || err)}
          {'\n\n'}
          {String(err.stack || '').slice(0, 1400)}
        </pre>
        <button
          onClick={() => { try { location.reload(); } catch { /* ignore */ } }}
          style={{ marginTop: 12, background: '#E94F9C', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 20px', fontWeight: 700, cursor: 'pointer' }}
        >
          Reload
        </button>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

import { Component, lazy, type ReactNode } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Fingerprint, FolderOpen, Plus, ShieldCheck } from 'lucide-react';
import { request } from './lib/api';
import Home from './pages/Home';
const Create = lazy(() => import('./pages/Create'));
const Preparing = lazy(() => import('./pages/Preparing'));
const Investigation = lazy(() => import('./pages/Investigation'));
const Result = lazy(() => import('./pages/Result'));
const History = lazy(() => import('./pages/History'));

class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main className="center-page">
        <p className="eyebrow">ROOM INTERRUPTED</p>
        <h1>Let's reopen the file.</h1>
        <p>
          The page encountered an unexpected error. Your saved investigation is still on the server.
        </p>
        <a className="button primary" href="/history">
          Open case history
        </a>
      </main>
    ) : (
      this.props.children
    );
  }
}
export default function App() {
  const location = useLocation();
  const config = useQuery({
    queryKey: ['config'],
    queryFn: () =>
      request<{
        aiMode: 'mock' | 'gemini';
        freeTierOnly?: boolean;
        mediaProvider?: string;
      }>('/config'),
    staleTime: Infinity,
  });
  return (
    <ErrorBoundary key={location.pathname}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="nav-inner">
          <Link to="/" className="brand" aria-label="AI Mystery Room home">
            <span className="brand-icon">
              <Fingerprint size={26} />
            </span>
            <span>
              AI MYSTERY<span className="brand-light"> ROOM</span>
            </span>
          </Link>
          <nav aria-label="Main navigation">
            <NavLink to="/history" className="history-nav">
              <FolderOpen size={16} />
              <span>Case files</span>
            </NavLink>
            <Link to="/create" className="button nav-create">
              <Plus size={16} />
              <span>New mystery</span>
            </Link>
          </nav>
        </div>
      </header>
      {config.data?.aiMode === 'mock' && (
        <div className="demo-banner">
          <span className="status-dot" />
          Demo Mode{' '}
          <span className="demo-detail">— deterministic test cases and synthetic demo media</span>
        </div>
      )}
      {config.data?.aiMode === 'gemini' && config.data.freeTierOnly && (
        <div className="demo-banner free-ai-banner" role="status" data-testid="free-ai-banner">
          <span className="status-dot" aria-hidden="true" />
          <strong>Free AI mode</strong>
          <span className="demo-detail">
            Daily provider quotas apply. CCTV is reconstructed from AI-generated frames.
          </span>
        </div>
      )}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/create" element={<Create />} />
        <Route path="/cases/:id/preparing" element={<Preparing />} />
        <Route path="/cases/:id/investigate" element={<Investigation />} />
        <Route path="/cases/:id/result" element={<Result />} />
        <Route path="/history" element={<History />} />
        <Route
          path="*"
          element={
            <main id="main" className="center-page">
              <p className="eyebrow">404 / FILE NOT FOUND</p>
              <h1>This trail ends here.</h1>
              <p>The page you're looking for isn't in the archive.</p>
              <Link className="button primary" to="/">
                Back to the room <ArrowUpRight size={16} />
              </Link>
            </main>
          }
        />
      </Routes>
      <footer className="site-footer">
        <div>
          <span className="footer-brand">AI MYSTERY ROOM</span>
          <span>Every detail tells a story.</span>
        </div>
        <p>
          <ShieldCheck size={14} /> All cases and evidence are fictional and AI-generated.
        </p>
      </footer>
    </ErrorBoundary>
  );
}

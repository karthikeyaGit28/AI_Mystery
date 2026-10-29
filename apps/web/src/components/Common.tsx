import { AlertTriangle, ArrowLeft, LoaderCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
export function Loading({ label = 'Opening the case file…' }: { label?: string }) {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle size={25} className="spin" />
      <p>{label}</p>
      <div className="skeleton-line" />
      <div className="skeleton-line short" />
    </div>
  );
}
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <AlertTriangle size={23} />
      <div>
        <h3>We couldn't complete that step.</h3>
        <p>{error instanceof Error ? error.message : 'Please try again in a moment.'}</p>
        {retry && (
          <button className="button small" onClick={retry}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
export function BackLink({
  to = '/',
  children = 'Back to the room',
}: {
  to?: string;
  children?: React.ReactNode;
}) {
  return (
    <Link className="back-link" to={to}>
      <ArrowLeft size={15} />
      {children}
    </Link>
  );
}
export function FictionLabel() {
  return <span className="fiction-label">FICTIONAL / AI-GENERATED</span>;
}

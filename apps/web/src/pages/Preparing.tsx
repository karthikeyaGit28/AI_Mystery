import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Fingerprint, LoaderCircle, RefreshCw } from 'lucide-react';
import { api, mutation } from '../lib/api';
import type { CaseStatus } from '../lib/types';
import { ErrorState } from '../components/Common';
const stages = [
  { key: 'QUEUED', label: 'Opening your case file' },
  { key: 'GENERATING_BLUEPRINT', label: 'Building the incident & suspects' },
  { key: 'VALIDATING', label: 'Checking the clues' },
  { key: 'GENERATING_TEXT', label: 'Compiling chats & documents' },
  { key: 'GENERATING_IMAGES', label: 'Creating photographic evidence' },
  { key: 'GENERATING_VIDEO', label: 'Creating the CCTV reconstruction' },
  { key: 'FINALIZING', label: 'Sealing the case' },
];
export default function Preparing() {
  const { id } = useParams();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const status = useQuery({
    queryKey: ['status', id],
    queryFn: () => api<CaseStatus>(`/cases/${id}/status`),
    refetchInterval: (query) => (query.state.data?.status === 'FAILED' ? false : 3000),
  });
  const retry = useMutation({
    mutationFn: () => mutation(`/cases/${id}/retry`),
    onSuccess: () => cache.invalidateQueries({ queryKey: ['status', id] }),
  });
  useEffect(() => {
    if (status.data?.status === 'READY') navigate(`/cases/${id}/investigate`, { replace: true });
  }, [status.data?.status, id, navigate]);
  const quotaExceeded = status.data?.errorCode === 'FREE_AI_QUOTA_EXCEEDED';
  const index =
    status.data?.status === 'READY'
      ? stages.length
      : Math.max(
          0,
          stages.findIndex((stage) => stage.key === status.data?.status),
        );
  return (
    <main id="main" className="page-width preparing-page">
      <div className="preparing-emblem">
        <Fingerprint size={54} strokeWidth={1} />
      </div>
      <p className="eyebrow">A NEW MYSTERY IS TAKING SHAPE</p>
      <h1>
        {quotaExceeded
          ? 'The free AI quota is used for now.'
          : status.data?.status === 'FAILED'
            ? 'A lead needs a second look.'
            : 'Every detail has a purpose.'}
      </h1>
      <p className="preparing-description">
        {quotaExceeded
          ? 'The provider’s free allowance has been used. Your case is saved. Retry after the provider’s quota resets; retrying immediately will not restore the allowance.'
          : status.data?.status === 'FAILED'
            ? 'The case could not be completed. Your saved progress and locked story will be reused when you retry.'
            : 'We’re building a coherent case, then creating every piece of evidence. The truth is being sealed before your investigation begins.'}
      </p>
      {status.isError ? (
        <ErrorState error={status.error} retry={() => void status.refetch()} />
      ) : (
        <div className="stage-panel panel" aria-live="polite">
          <div className="current-stage">
            {status.data?.status === 'FAILED' ? (
              <RefreshCw size={18} />
            ) : (
              <LoaderCircle className="spin" size={18} />
            )}
            <span>
              {quotaExceeded
                ? status.data?.stageLabel || 'Waiting for the free AI quota to reset'
                : status.data?.status === 'FAILED'
                  ? 'Generation paused'
                  : status.data?.stageLabel || 'Connecting to the case room…'}
            </span>
          </div>
          <ol className="stage-list">
            {stages.map((stage, i) => (
              <li className={i < index ? 'complete' : i === index ? 'current' : ''} key={stage.key}>
                <span className="stage-indicator">
                  {i < index ? <Check size={13} /> : <span />}
                </span>
                {stage.label}
                {i === index && status.data?.status !== 'FAILED' && (
                  <span className="stage-active">IN PROGRESS</span>
                )}
              </li>
            ))}
          </ol>
          {status.data?.status === 'FAILED' && (
            <div className="failure-detail">
              <p>Reference: {status.data.errorCode || 'GENERATION_FAILED'}</p>
              {status.data.canRetry ? (
                <button
                  className="button primary"
                  disabled={retry.isPending}
                  onClick={() => retry.mutate()}
                >
                  <RefreshCw size={16} />
                  {retry.isPending
                    ? 'Requesting retry…'
                    : quotaExceeded
                      ? 'Retry after quota reset'
                      : 'Retry generation'}
                </button>
              ) : (
                <p>
                  {quotaExceeded
                    ? 'This case has no retries left. Wait for the provider’s quota to reset before starting a new case.'
                    : 'The retry limit has been reached. Please start a new case.'}
                </p>
              )}
              {retry.isError && <ErrorState error={retry.error} />}
            </div>
          )}
        </div>
      )}
      <p className="preparing-note">
        You can close this page. Your case will be waiting in Case files.
        <br />
        {status.data?.status === 'FAILED'
          ? 'Return to this page when you are ready to retry.'
          : 'Preparation time depends on the AI provider. This page refreshes automatically.'}
      </p>
      <Link to="/history" className="text-button">
        <ArrowLeft size={15} />
        Back to case files
      </Link>
    </main>
  );
}

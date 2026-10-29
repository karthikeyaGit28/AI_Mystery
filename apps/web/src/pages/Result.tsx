import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, ChevronDown, Flag, FolderOpen, ShieldCheck } from 'lucide-react';
import { ApiError, api, displayTime } from '../lib/api';
import type { CaseData, Verdict } from '../lib/types';
import { BackLink, ErrorState, Loading } from '../components/Common';
export default function Result() {
  const { id } = useParams();
  const result = useQuery({
    queryKey: ['result', id],
    queryFn: () => api<Verdict>(`/cases/${id}/result`),
  });
  const investigation = useQuery({
    queryKey: ['case', id],
    queryFn: () => api<CaseData>(`/cases/${id}`),
    enabled: !!result.data,
  });
  if (result.isPending)
    return (
      <main id="main" className="page-width">
        <Loading label="Unsealing the truth…" />
      </main>
    );
  if (result.isError)
    return (
      <main id="main" className="page-width content-page">
        <ErrorState error={result.error} retry={() => void result.refetch()} />
        {result.error instanceof ApiError && result.error.code === 'RESULT_LOCKED' && (
          <Link className="button primary" to={`/cases/${id}/investigate`}>
            Return to investigation
          </Link>
        )}
      </main>
    );
  const data = result.data;
  const correct = data.isCorrect;
  const suspects = investigation.data?.suspects || [];
  const evidence = investigation.data?.evidence || [];
  return (
    <main id="main" className="page-width result-page">
      <BackLink to="/history">Back to case files</BackLink>
      <div className="result-hero">
        <div className={`result-emblem ${correct ? 'correct' : ''}`}>
          {correct ? (
            <ShieldCheck size={40} strokeWidth={1.25} />
          ) : (
            <Flag size={36} strokeWidth={1.25} />
          )}
        </div>
        <p className="eyebrow">CASE CLOSED / THE TRUTH REVEALED</p>
        <h1>
          {correct ? (
            <>
              You connected <span>the dots.</span>
            </>
          ) : (
            <>
              Every case has <span>something to teach.</span>
            </>
          )}
        </h1>
        <p>
          {correct
            ? 'Your accusation matches the evidence. The hidden story is now yours to read.'
            : 'The evidence leads to a different suspect. Follow the full explanation below to see how the clues fit.'}
        </p>
        <div className="verdict-strip">
          <div>
            <span>THE CULPRIT</span>
            <strong>{data.culpritName}</strong>
            <small>{data.culpritSuspectId}</small>
          </div>
          <div className="verdict-score">
            <strong>
              {data.score}
              <span>/100</span>
            </strong>
            <small>INVESTIGATION SCORE</small>
          </div>
          <div>
            <span>HINTS USED</span>
            <strong>
              {data.hintsUsed}
              <small> of 3</small>
            </strong>
          </div>
        </div>
      </div>
      <div className="result-explanation panel">
        <p className="eyebrow">THE VERDICT</p>
        <h2>What really happened</h2>
        <p>{data.verdictExplanation}</p>
        <div className="motive-grid">
          <div>
            <span>MOTIVE</span>
            <p>{data.motive}</p>
          </div>
          <div>
            <span>METHOD</span>
            <p>{data.method}</p>
          </div>
          <div>
            <span>OPPORTUNITY</span>
            <p>{data.opportunity}</p>
          </div>
        </div>
      </div>
      <div className="result-details">
        <details open>
          <summary>
            How the mystery happened <ChevronDown size={18} />
          </summary>
          <ol className="reveal-timeline">
            {data.actualTimeline.map((event, index) => (
              <li key={index}>
                <time>{displayTime(event.occurredAt, investigation.data?.timezone)}</time>
                <p>{event.event}</p>
              </li>
            ))}
          </ol>
        </details>
        <details open>
          <summary>
            Evidence that proves it <ChevronDown size={18} />
          </summary>
          <div className="proof-grid">
            {data.supportingEvidenceIds.map((evidenceId) => {
              const item = evidence.find((evidenceItem) => evidenceItem.id === evidenceId);
              return (
                <div className="proof-card" key={evidenceId}>
                  <span>
                    <Check size={14} />
                    {evidenceId}
                  </span>
                  <h3>{item?.title || evidenceId}</h3>
                  <p>
                    {item?.description ||
                      'This item supports the proof chain described in the verdict.'}
                  </p>
                  {data.selectedEvidenceIds?.includes(evidenceId) && (
                    <small>YOU CITED THIS CLUE</small>
                  )}
                </div>
              );
            })}
          </div>
        </details>
        <details>
          <summary>
            What the red herrings meant <ChevronDown size={18} />
          </summary>
          <div className="red-herrings">
            {Object.entries(data.redHerringExplanations).map(([evidenceId, text]) => (
              <div key={evidenceId}>
                <span>{evidenceId}</span>
                <p>{text}</p>
              </div>
            ))}
          </div>
          <h3>Why the other suspects were ruled out</h3>
          {Object.entries(data.suspectEliminationReasons).map(([suspectId, text]) => (
            <div className="elimination" key={suspectId}>
              <strong>
                {suspects.find((suspect) => suspect.id === suspectId)?.name || suspectId}
              </strong>
              <p>{text}</p>
            </div>
          ))}
        </details>
        <details>
          <summary>
            Your investigation <ChevronDown size={18} />
          </summary>
          <div className="investigation-summary">
            <p>
              <strong>Your accusation:</strong>{' '}
              {suspects.find((suspect) => suspect.id === data.selectedSuspectId)?.name ||
                data.selectedSuspectId}
            </p>
            <p>
              <strong>Evidence cited:</strong> {data.selectedEvidenceIds?.join(', ') || 'None'}
            </p>
            <p>
              <strong>Hints used:</strong> {data.hintsUsed} of 3
            </p>
            {data.playerReasoning && (
              <p>
                <strong>Your reasoning:</strong> {data.playerReasoning}
              </p>
            )}
            <p>
              <strong>Scoring:</strong> A correct choice earns 70 points, up to 20 for supporting
              citations, and 10 with no hints or 5 with one hint. Incorrect choices score 0.
            </p>
          </div>
        </details>
      </div>
      <div className="result-actions">
        <Link className="button primary large" to="/create">
          Play Another <ArrowRight size={17} />
        </Link>
        <Link className="button large" to="/history">
          <FolderOpen size={17} />
          Back to History
        </Link>
        <Link className="text-button" to={`/cases/${id}/investigate`}>
          Revisit the evidence
        </Link>
      </div>
    </main>
  );
}

import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Camera,
  Check,
  ChevronDown,
  Clock3,
  FileText,
  Flag,
  Lightbulb,
  MapPin,
  MessageSquare,
  ScanLine,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { ApiError, api, displayTime, mutation } from '../lib/api';
import type { CaseData, EvidenceType, Hint, Progress, Suspect, Verdict } from '../lib/types';
import { ErrorState, FictionLabel, Loading } from '../components/Common';
import EvidenceViewer from '../components/EvidenceViewer';
import Modal from '../components/Modal';

const icons = { CHAT: MessageSquare, PHOTO: Camera, CCTV: ScanLine, DOCUMENT: FileText };
function SuspectCard({ suspect }: { suspect: Suspect }) {
  return (
    <details className="suspect-card">
      <summary>
        <span className="suspect-avatar">
          {suspect.name
            .split(' ')
            .map((part) => part[0])
            .slice(0, 2)
            .join('')}
        </span>
        <div>
          <span className="suspect-id">
            {suspect.id} / AGE {suspect.age}
          </span>
          <h3>{suspect.name}</h3>
          <p>{suspect.role}</p>
        </div>
        <ChevronDown size={14} />
      </summary>
      <div className="suspect-details">
        <p>{suspect.relationshipToIncident}</p>
        <span>STATEMENT</span>
        <blockquote>“{suspect.publicStatement}”</blockquote>
        <span>CLAIMED ALIBI</span>
        <p>{suspect.statedAlibi}</p>
        <span>POSSIBLE MOTIVE</span>
        <p>{suspect.motivePossibility}</p>
      </div>
    </details>
  );
}
export default function Investigation() {
  const { id } = useParams();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<EvidenceType | 'ALL'>('ALL');
  const [mobileTab, setMobileTab] = useState('case');
  const [desktopTab, setDesktopTab] = useState('evidence');
  const [mobileViewer, setMobileViewer] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const [accuseOpen, setAccuseOpen] = useState(false);
  const [chosenSuspect, setChosenSuspect] = useState('');
  const [citations, setCitations] = useState<string[]>([]);
  const [reasoning, setReasoning] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const hintKey = useRef(crypto.randomUUID());
  const solveKey = useRef(crypto.randomUUID());
  const investigation = useQuery({
    queryKey: ['case', id],
    queryFn: () => api<CaseData>(`/cases/${id}`),
  });
  const unlocked = useQuery({
    queryKey: ['hints', id],
    queryFn: () => api<{ hints: Hint[]; hintsUsed: number }>(`/cases/${id}/hints`),
    enabled: !!investigation.data,
  });
  const progress = useMutation({
    mutationFn: (body: Pick<Progress, 'reviewedEvidenceIds' | 'bookmarkedEvidenceIds'>) =>
      api(`/cases/${id}/progress`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => cache.invalidateQueries({ queryKey: ['case', id] }),
  });
  const hint = useMutation({
    mutationFn: () => mutation<Hint>(`/cases/${id}/hints`, {}, hintKey.current),
    onSuccess: async () => {
      hintKey.current = crypto.randomUUID();
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['hints', id] }),
        cache.invalidateQueries({ queryKey: ['case', id] }),
      ]);
    },
  });
  const solve = useMutation({
    mutationFn: () =>
      mutation<Verdict>(
        `/cases/${id}/solve`,
        { suspectId: chosenSuspect, evidenceIds: citations, reasoning },
        solveKey.current,
      ),
    onSuccess: (data) => {
      cache.setQueryData(['result', id], data);
      void cache.invalidateQueries({ queryKey: ['history'] });
      navigate(`/cases/${id}/result`);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'ALREADY_SOLVED')
        navigate(`/cases/${id}/result`);
    },
  });
  if (investigation.isPending)
    return (
      <main id="main" className="page-width">
        <Loading />
      </main>
    );
  if (investigation.isError)
    return (
      <main id="main" className="page-width content-page">
        <ErrorState error={investigation.error} retry={() => void investigation.refetch()} />
        {investigation.error instanceof ApiError &&
          investigation.error.code === 'CASE_NOT_READY' && (
            <Link className="button" to={`/cases/${id}/preparing`}>
              View preparation progress
            </Link>
          )}
      </main>
    );
  const data = investigation.data;
  const state = data.progress || {
    reviewedEvidenceIds: [],
    bookmarkedEvidenceIds: [],
    hintsUsed: 0,
  };
  const selected = data.evidence.find((evidence) => evidence.id === selectedId) || data.evidence[0];
  const submitted = data.status === 'SUBMITTED' || !!state.submittedAt;
  const hintsUsed = state.hintsUsed || 0;
  function toggleProgress(
    kind: 'reviewedEvidenceIds' | 'bookmarkedEvidenceIds',
    evidenceId: string,
  ) {
    const next = state[kind].includes(evidenceId)
      ? state[kind].filter((item) => item !== evidenceId)
      : [...state[kind], evidenceId];
    progress.mutate({
      reviewedEvidenceIds: state.reviewedEvidenceIds,
      bookmarkedEvidenceIds: state.bookmarkedEvidenceIds,
      [kind]: next,
    });
  }
  const timeline = (
    <div className="timeline-view">
      <p className="eyebrow">FROM THE PUBLIC EVIDENCE</p>
      <h2>The known timeline</h2>
      <p className="muted">
        Reported observations, not the hidden sequence of events. Compare these with each suspect's
        claim.
      </p>
      <ol>
        {[...data.evidence]
          .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
          .map((evidence) => (
            <li key={evidence.id}>
              <time>{displayTime(evidence.occurredAt, data.timezone)}</time>
              <div>
                <span>
                  {evidence.id} / {evidence.type}
                </span>
                <h3>{evidence.title}</h3>
                <p>{evidence.description}</p>
                <button
                  className="text-button amber"
                  onClick={() => {
                    setSelectedId(evidence.id);
                    setDesktopTab('evidence');
                    setMobileTab('evidence');
                    setMobileViewer(true);
                  }}
                >
                  Inspect evidence <ArrowRight size={13} />
                </button>
              </div>
            </li>
          ))}
      </ol>
    </div>
  );
  return (
    <main id="main" className={`investigation-page ${mobileViewer ? 'mobile-viewing' : ''}`}>
      <div className="case-top page-width">
        <Link className="back-link" to="/history">
          <ArrowLeft size={14} />
          Case files
        </Link>
        <div className="case-title-row">
          <div>
            <p className="eyebrow">
              CASE #{data.caseNumber} <span className="case-difficulty">{data.difficulty}</span>
            </p>
            <h1>{data.title}</h1>
            <div className="case-subtitle">
              <span>
                <MapPin size={13} />
                {data.location}
              </span>
              <span>
                <Clock3 size={13} />
                {data.fictionalDate}
              </span>
            </div>
          </div>
          <div className="case-top-actions">
            <button className="button" onClick={() => setHintOpen(true)}>
              <Lightbulb size={16} />
              Hints <span className="counter">{hintsUsed}/3</span>
            </button>
            {submitted ? (
              <Link className="button primary" to={`/cases/${id}/result`}>
                View verdict <ArrowRight size={16} />
              </Link>
            ) : (
              <button
                data-testid="accuse"
                className="button primary accusation-cta"
                onClick={() => {
                  setAccuseOpen(true);
                  setConfirmed(false);
                }}
              >
                <Flag size={15} />
                Accuse a Suspect
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="mobile-workspace-tabs" role="tablist" aria-label="Investigation sections">
        {[
          { id: 'case', label: 'Case', icon: FileText },
          { id: 'suspects', label: 'Suspects', icon: Users },
          { id: 'evidence', label: 'Evidence', icon: Search },
          { id: 'timeline', label: 'Timeline', icon: Clock3 },
        ].map((tab) => (
          <button
            role="tab"
            id={`tab-${tab.id}`}
            aria-controls={`panel-${tab.id}`}
            aria-selected={mobileTab === tab.id}
            tabIndex={mobileTab === tab.id ? 0 : -1}
            key={tab.id}
            onKeyDown={(event) => {
              const ids = ['case', 'suspects', 'evidence', 'timeline'];
              const current = ids.indexOf(tab.id);
              const next =
                event.key === 'ArrowRight'
                  ? (current + 1) % ids.length
                  : event.key === 'ArrowLeft'
                    ? (current + ids.length - 1) % ids.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? ids.length - 1
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              setMobileTab(ids[next]);
              setMobileViewer(false);
              document.getElementById(`tab-${ids[next]}`)?.focus();
            }}
            onClick={() => {
              setMobileTab(tab.id);
              setMobileViewer(false);
            }}
            className={mobileTab === tab.id ? 'active' : ''}
          >
            <tab.icon size={15} />
            {tab.label}
          </button>
        ))}
      </div>
      <div
        id="panel-case"
        className="case-brief page-width"
        data-mobile-active={mobileTab === 'case'}
      >
        <details open>
          <summary>
            <span className="eyebrow">THE CASE BRIEF</span>
            <ChevronDown size={15} />
          </summary>
          <p>{data.incident}</p>
          <div className="case-objective">
            <ShieldCheck size={16} />
            <strong>Your objective:</strong> {data.objective}
          </div>
          <FictionLabel />
        </details>
      </div>
      <div className="workspace page-width">
        <aside
          id="panel-suspects"
          className="suspects-panel workspace-panel"
          data-mobile-active={mobileTab === 'suspects'}
        >
          <div className="panel-heading">
            <span>
              <Users size={16} />
              The suspects
            </span>
            <span className="counter">04</span>
          </div>
          <p className="panel-intro">Four stories. Read them carefully.</p>
          {data.suspects.map((suspect) => (
            <SuspectCard key={suspect.id} suspect={suspect} />
          ))}
          <div className="suspect-note">
            <FingerprintArt />
            <p>
              An alibi is a claim.
              <br />
              Let the evidence test it.
            </p>
          </div>
        </aside>
        <section
          id="panel-evidence"
          className="evidence-panel workspace-panel"
          data-mobile-active={mobileTab === 'evidence'}
        >
          <div className="panel-heading">
            <span>
              <Search size={16} />
              Evidence locker
            </span>
            <span className="counter">{state.reviewedEvidenceIds.length}/8 reviewed</span>
          </div>
          <div className="evidence-filters" role="group" aria-label="Filter evidence">
            {[
              { type: 'ALL', label: 'All' },
              { type: 'CHAT', label: 'Chats' },
              { type: 'PHOTO', label: 'Photos' },
              { type: 'CCTV', label: 'Video' },
              { type: 'DOCUMENT', label: 'Docs' },
            ].map((option) => (
              <button
                key={option.type}
                aria-pressed={filter === option.type}
                className={filter === option.type ? 'active' : ''}
                onClick={() => setFilter(option.type as EvidenceType | 'ALL')}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="evidence-list">
            {data.evidence
              .filter((evidence) => filter === 'ALL' || evidence.type === filter)
              .map((evidence) => {
                const Icon = icons[evidence.type];
                return (
                  <button
                    data-testid={`evidence-${evidence.id}`}
                    key={evidence.id}
                    className={`evidence-item ${selected.id === evidence.id ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedId(evidence.id);
                      setDesktopTab('evidence');
                      setMobileViewer(true);
                    }}
                  >
                    <div className={`evidence-type-icon type-${evidence.type}`}>
                      <Icon size={19} />
                    </div>
                    <div>
                      <span className="evidence-item-meta">
                        {evidence.id} <span>{displayTime(evidence.occurredAt, data.timezone)}</span>
                      </span>
                      <h3>{evidence.title}</h3>
                      <p>{evidence.summary}</p>
                      <span className="evidence-item-type">
                        {evidence.type === 'CCTV' ? 'AI RECONSTRUCTION' : evidence.type}
                      </span>
                    </div>
                    <span className="evidence-item-flags">
                      {state.reviewedEvidenceIds.includes(evidence.id) && (
                        <Check size={13} aria-label="Reviewed" />
                      )}
                      {state.bookmarkedEvidenceIds.includes(evidence.id) && (
                        <Bookmark size={12} fill="currentColor" aria-label="Bookmarked" />
                      )}
                    </span>
                  </button>
                );
              })}
          </div>
        </section>
        <section
          className="viewer-panel workspace-panel"
          data-mobile-active={mobileTab === 'evidence' && mobileViewer}
        >
          <div className="viewer-tabs">
            <button
              className="mobile-viewer-back text-button"
              onClick={() => setMobileViewer(false)}
            >
              <ArrowLeft size={16} />
              Evidence locker
            </button>
            <button
              className={desktopTab === 'evidence' ? 'active' : ''}
              onClick={() => setDesktopTab('evidence')}
            >
              Evidence viewer
            </button>
            <button
              className={desktopTab === 'timeline' ? 'active' : ''}
              onClick={() => setDesktopTab('timeline')}
            >
              <Clock3 size={14} />
              Timeline
            </button>
          </div>
          {desktopTab === 'timeline' ? (
            timeline
          ) : (
            <EvidenceViewer
              key={selected.id}
              evidence={selected}
              caseId={data.id}
              timezone={data.timezone}
              reviewed={state.reviewedEvidenceIds.includes(selected.id)}
              bookmarked={state.bookmarkedEvidenceIds.includes(selected.id)}
              pending={progress.isPending}
              onReview={() => toggleProgress('reviewedEvidenceIds', selected.id)}
              onBookmark={() => toggleProgress('bookmarkedEvidenceIds', selected.id)}
            />
          )}
          {progress.isError && <ErrorState error={progress.error} />}
        </section>
        <section
          id="panel-timeline"
          className="mobile-timeline workspace-panel"
          data-mobile-active={mobileTab === 'timeline'}
        >
          {timeline}
        </section>
      </div>
      {!submitted && (
        <div className="mobile-accusation">
          <button
            className="button primary full"
            onClick={() => {
              setAccuseOpen(true);
              setConfirmed(false);
            }}
          >
            <Flag size={16} />
            Accuse a Suspect
          </button>
        </div>
      )}
      {hintOpen && (
        <Modal title="A nudge in the right direction" onClose={() => setHintOpen(false)}>
          <p className="muted">
            Hints are revealed in order. Your unused-hint bonus is 10 points with no hints, 5 with
            one, and 0 with two or three.
          </p>
          <div className="hint-list">
            {unlocked.isPending ? (
              <Loading label="Opening unlocked hints…" />
            ) : unlocked.isError ? (
              <ErrorState error={unlocked.error} retry={() => void unlocked.refetch()} />
            ) : (
              unlocked.data.hints.map((item) => (
                <div className="hint-card" key={item.hintNumber}>
                  <span>HINT {item.hintNumber.toString().padStart(2, '0')}</span>
                  <p>{item.text}</p>
                </div>
              ))
            )}
          </div>
          {hint.isError && <ErrorState error={hint.error} />}
          {!submitted && hintsUsed < 3 ? (
            <button
              className="button primary full"
              data-testid="request-hint"
              onClick={() => hint.mutate()}
              disabled={hint.isPending}
            >
              <Lightbulb size={16} />
              {hint.isPending ? 'Revealing…' : `Reveal hint ${hintsUsed + 1} of 3`}
            </button>
          ) : (
            <p className="form-footnote">
              {submitted
                ? 'This investigation has been submitted.'
                : 'All three hints have been revealed.'}
            </p>
          )}
        </Modal>
      )}
      {accuseOpen && (
        <Modal
          title={confirmed ? 'Seal your accusation?' : 'Accuse a suspect'}
          onClose={() => {
            if (!solve.isPending) setAccuseOpen(false);
          }}
        >
          {confirmed ? (
            <>
              <p className="muted">
                You are accusing{' '}
                <strong>
                  {data.suspects.find((suspect) => suspect.id === chosenSuspect)?.name}
                </strong>
                . This is your one final accusation. The result cannot be changed.
              </p>
              <div className="submission-summary">
                <span>
                  {citations.length} evidence item{citations.length !== 1 ? 's' : ''} cited
                </span>
                <span>
                  {hintsUsed} hint{hintsUsed !== 1 ? 's' : ''} used
                </span>
              </div>
              {solve.isError && <ErrorState error={solve.error} />}
              <div className="modal-actions">
                <button
                  className="button"
                  onClick={() => setConfirmed(false)}
                  disabled={solve.isPending}
                >
                  Keep investigating
                </button>
                <button
                  className="button primary"
                  data-testid="submit-accusation"
                  onClick={() => solve.mutate()}
                  disabled={solve.isPending}
                >
                  {solve.isPending ? 'Sealing…' : 'Submit final accusation'}
                  <Flag size={15} />
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="muted">
                Follow the evidence. Choose the suspect whose story doesn't hold up.
              </p>
              <fieldset className="accusation-suspects">
                <legend className="field-label">Who is responsible?</legend>
                {data.suspects.map((suspect) => (
                  <label className={chosenSuspect === suspect.id ? 'chosen' : ''} key={suspect.id}>
                    <input
                      type="radio"
                      name="accused-suspect"
                      value={suspect.id}
                      checked={chosenSuspect === suspect.id}
                      onChange={() => setChosenSuspect(suspect.id)}
                    />
                    <span>
                      <strong>{suspect.name}</strong>
                      <small>{suspect.role}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
              <fieldset className="citation-options">
                <legend className="field-label">
                  Cite evidence <span className="muted">(optional, up to 3)</span>
                </legend>
                {data.evidence.map((evidence) => (
                  <label key={evidence.id}>
                    <input
                      type="checkbox"
                      checked={citations.includes(evidence.id)}
                      disabled={citations.length === 3 && !citations.includes(evidence.id)}
                      onChange={() =>
                        setCitations((current) =>
                          current.includes(evidence.id)
                            ? current.filter((item) => item !== evidence.id)
                            : [...current, evidence.id],
                        )
                      }
                    />
                    <span>
                      <b>{evidence.id}</b> {evidence.title}
                    </span>
                  </label>
                ))}
              </fieldset>
              <label htmlFor="reasoning" className="field-label">
                Your reasoning <span className="muted">(optional)</span>
              </label>
              <textarea
                id="reasoning"
                rows={3}
                maxLength={500}
                value={reasoning}
                onChange={(event) => setReasoning(event.target.value)}
                placeholder="Which contradiction convinced you?"
              />
              <p className="input-meta">
                {reasoning.length}/500 · Reasoning does not affect your score.
              </p>
              <button
                className="button primary full"
                disabled={!chosenSuspect}
                onClick={() => setConfirmed(true)}
              >
                Review accusation <ArrowRight size={16} />
              </button>
            </>
          )}
        </Modal>
      )}
    </main>
  );
}
function FingerprintArt() {
  return <Search size={30} strokeWidth={1} />;
}

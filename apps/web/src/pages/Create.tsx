import { useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ArrowUpRight, Check, FilePlus2, LoaderCircle, LockKeyhole, Sparkles } from 'lucide-react';
import { mutation } from '../lib/api';
import type { Difficulty } from '../lib/types';
import { BackLink, ErrorState } from '../components/Common';
import { examples } from './Home';
export default function Create() {
  const location = useLocation();
  const navigate = useNavigate();
  const [premise, setPremise] = useState<string>(location.state?.premise || '');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [attempted, setAttempted] = useState(false);
  const key = useRef(crypto.randomUUID());
  const create = useMutation({
    mutationFn: () =>
      mutation<{ caseId: string }>('/cases', { premise: premise.trim(), difficulty }, key.current),
    onSuccess: (data) => navigate(`/cases/${data.caseId}/preparing`),
  });
  const valid = premise.trim().length >= 30 && premise.trim().length <= 1200;
  function submit(event: FormEvent) {
    event.preventDefault();
    setAttempted(true);
    if (valid) create.mutate();
  }
  function changePremise(value: string) {
    setPremise(value);
    key.current = crypto.randomUUID();
  }
  return (
    <main id="main" className="page-width create-page">
      <BackLink />
      <div className="create-layout">
        <div className="create-intro">
          <p className="eyebrow">OPEN A NEW INVESTIGATION</p>
          <h1>
            It starts with
            <br />a <span>what if.</span>
          </h1>
          <p>
            Give us the scene. We'll build the suspects, the secrets, and the evidence. The truth is
            yours to uncover.
          </p>
          <div className="create-promise">
            <FilePlus2 size={21} />
            <div>
              <strong>One premise. A complete case.</strong>
              <span>4 suspects · 8 evidence items · 1 hidden truth</span>
            </div>
          </div>
          <div className="create-promise">
            <LockKeyhole size={21} />
            <div>
              <strong>A fair mystery, every time.</strong>
              <span>The answer is fixed before you begin.</span>
            </div>
          </div>
          <div className="case-note">
            <span>DETECTIVE'S NOTE</span>
            <p>“A locked door is only a mystery until you find out who had the key.”</p>
          </div>
        </div>
        <form className="create-form panel" onSubmit={submit}>
          <div className="form-section-heading">
            <span className="section-number">01</span>
            <div>
              <h2>Set the scene</h2>
              <p>A short fictional premise is all it takes.</p>
            </div>
          </div>
          <label htmlFor="premise" className="field-label">
            Your mystery premise
          </label>
          <textarea
            id="premise"
            name="premise"
            rows={6}
            maxLength={1201}
            value={premise}
            onChange={(e) => changePremise(e.target.value)}
            placeholder="During a college festival, a valuable trophy disappears from a locked backstage room…"
            aria-invalid={attempted && !valid}
            aria-describedby="premise-help"
          />
          <div className="input-meta">
            <span id="premise-help" className={attempted && !valid ? 'invalid' : ''}>
              {attempted && !valid
                ? 'Use between 30 and 1,200 characters.'
                : 'Fictional people and places. 30–1,200 characters.'}
            </span>
            <span>{premise.trim().length}/1200</span>
          </div>
          <div className="example-chips">
            <span>Need a lead?</span>
            {examples.map((example) => (
              <button type="button" key={example.icon} onClick={() => changePremise(example.text)}>
                {example.name}
                <Sparkles size={12} />
              </button>
            ))}
          </div>
          <div className="form-divider" />
          <div className="form-section-heading">
            <span className="section-number">02</span>
            <div>
              <h2>Choose your challenge</h2>
              <p>The same fair rules. Different depths of deduction.</p>
            </div>
          </div>
          <fieldset className="difficulty-options">
            <legend className="sr-only">Difficulty</legend>
            {(['easy', 'medium', 'hard'] as Difficulty[]).map((value) => (
              <label
                className={`difficulty-option ${difficulty === value ? 'selected' : ''}`}
                key={value}
              >
                <input
                  type="radio"
                  name="difficulty"
                  value={value}
                  checked={difficulty === value}
                  onChange={() => {
                    setDifficulty(value);
                    key.current = crypto.randomUUID();
                  }}
                />
                <span className="difficulty-bars">
                  {[1, 2, 3].map((bar) => (
                    <i
                      key={bar}
                      className={
                        bar <= (value === 'easy' ? 1 : value === 'medium' ? 2 : 3) ? 'active' : ''
                      }
                    />
                  ))}
                </span>
                <strong>{value}</strong>
                <small>
                  {value === 'easy'
                    ? 'Follow the clues'
                    : value === 'medium'
                      ? 'Read between the lines'
                      : 'Connect every detail'}
                </small>
                {difficulty === value && <Check className="difficulty-check" size={14} />}
              </label>
            ))}
          </fieldset>
          {create.isError && <ErrorState error={create.error} />}
          <button
            className="button primary full generate-button"
            disabled={create.isPending}
            type="submit"
          >
            {create.isPending ? (
              <>
                <LoaderCircle className="spin" size={18} />
                Opening your case…
              </>
            ) : (
              <>
                Generate My Case <ArrowUpRight size={18} />
              </>
            )}
          </button>
          <p className="form-footnote">
            Your case is prepared in the background. You can leave and return.
            <br />
            All characters and evidence are fictional and AI-generated.
          </p>
        </form>
      </div>
    </main>
  );
}

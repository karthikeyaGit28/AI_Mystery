import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Camera,
  Check,
  ChevronRight,
  FileText,
  Fingerprint,
  LockKeyhole,
  MessageSquare,
  Play,
  ScanLine,
  Sparkles,
} from 'lucide-react';

export const examples = [
  {
    name: 'The missing trophy',
    tag: 'THEFT',
    text: 'During a university festival, a valuable trophy disappears from a locked backstage room minutes before the awards.',
    icon: '01',
  },
  {
    name: 'A vanishing act',
    tag: 'DISAPPEARANCE',
    text: 'At a fictional theatre, the lead performer vanishes before the final act. Four crew members tell conflicting stories.',
    icon: '02',
  },
  {
    name: 'The silent sabotage',
    tag: 'SABOTAGE',
    text: 'The power fails at a remote observatory just before an important discovery. Four researchers had access to the control room.',
    icon: '03',
  },
];
function CaseArt() {
  return (
    <div
      className="case-art"
      role="img"
      aria-label="Illustrated fictional detective evidence board"
    >
      <div className="art-glow" />
      <div className="art-grid" />
      <svg className="evidence-threads" viewBox="0 0 580 530" aria-hidden="true">
        <path
          d="M153 125 375 170 380 356 155 330 153 125M155 330 375 170"
          fill="none"
          stroke="#a96446"
          strokeWidth="1.4"
          opacity=".8"
        />
        <circle cx="153" cy="125" r="4" fill="#d9a74d" />
        <circle cx="375" cy="170" r="4" fill="#d9a74d" />
        <circle cx="380" cy="356" r="4" fill="#d9a74d" />
      </svg>
      <div className="art-document">
        <span className="art-doc-top">
          CONFIDENTIAL <span>NO. 028</span>
        </span>
        <div className="art-doc-title">
          THE MIDNIGHT
          <br />
          DISAPPEARANCE
        </div>
        <div className="art-doc-rule" />
        <span className="art-doc-meta">INCIDENT REPORT · 21:14</span>
        <i />
        <i />
        <i />
        <i className="short" />
        <div className="art-stamp">UNSOLVED</div>
        <Fingerprint className="art-fingerprint" size={70} strokeWidth={0.8} />
      </div>
      <div className="art-photo">
        <div className="scene">
          <svg
            viewBox="0 0 300 195"
            role="img"
            aria-label="Illustrated dimly lit fictional corridor"
          >
            <defs>
              <linearGradient id="hall" x1="0" x2="1">
                <stop stopColor="#0d1821" />
                <stop offset=".5" stopColor="#3f554b" />
                <stop offset="1" stopColor="#10202b" />
              </linearGradient>
              <radialGradient id="light">
                <stop stopColor="#d6b76c" stopOpacity=".65" />
                <stop offset="1" stopColor="#d6b76c" stopOpacity="0" />
              </radialGradient>
            </defs>
            <path fill="url(#hall)" d="M0 0h300v195H0z" />
            <path d="M0 0 110 52v92L0 195M300 0 190 52v92l110 51" fill="#0b141d" />
            <path
              d="m110 144-45 51m125-51 45 51M0 195h300M117 158h66M104 177h92M110 52h80v92h-80z"
              fill="none"
              stroke="#779182"
              strokeWidth=".6"
              opacity=".5"
            />
            <path
              d="M12 13v148l47-19V36zM280 15v145l-41-18V36z"
              fill="#182735"
              stroke="#3d514e"
              strokeWidth="1"
            />
            <path d="M133 67h35v77h-35z" fill="#070e15" />
            <ellipse cx="150" cy="65" rx="92" ry="80" fill="url(#light)" />
            <path d="M141 48h17" stroke="#ebd9a3" strokeWidth="3" />
            <path d="M181 110c-1-10-12-12-16-4l-4 24 2 19h15l5-18z" fill="#10151a" />
            <circle cx="172" cy="99" r="6" fill="#12191d" />
            <path d="m165 143-7 26m17-26 6 26" stroke="#10151a" strokeWidth="5" />
            <path d="m181 123 14 6-2 17h-15z" fill="#b3934f" />
            <path
              d="M0 16h300M0 40h300M0 64h300M0 88h300M0 112h300M0 136h300M0 160h300M0 184h300"
              stroke="#fff"
              strokeWidth=".35"
              opacity=".12"
            />
          </svg>
          <div className="scene-time">
            <span className="recording-dot" />
            CAM 02 <span>21:14:07</span>
          </div>
        </div>
        <div className="art-photo-caption">
          EV-05 <span>BACK CORRIDOR / RECONSTRUCTION</span>
        </div>
      </div>
      <div className="art-chat">
        <span>
          <MessageSquare size={13} /> RECOVERED CONVERSATION
        </span>
        <div>Did you return the spare key?</div>
        <div className="outgoing">
          I left it where we agreed.
          <small>
            20:55 <Check size={10} />
          </small>
        </div>
        <div>Then who was there at 21:14?</div>
      </div>
      <div className="art-label">
        <span className="status-dot" /> FOUR SUSPECTS. ONE TRUTH.
      </div>
      <div className="art-evidence-count">
        <ScanLine size={17} />
        <span>
          8 PIECES OF EVIDENCE
          <br />
          <b>Connect the dots.</b>
        </span>
      </div>
    </div>
  );
}
export default function Home() {
  return (
    <main id="main">
      <section className="hero page-width">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="eyebrow-line" /> AN AI-POWERED DETECTIVE EXPERIENCE
          </div>
          <h1>
            Every story
            <br />
            hides a <span>suspect.</span>
          </h1>
          <p className="hero-description">
            A missing trophy. A broken alibi. A detail everyone overlooked. Turn your idea into a
            mystery only you can solve.
          </p>
          <div className="hero-actions">
            <Link to="/create" className="button primary large">
              Create a Mystery <ArrowUpRight size={19} />
            </Link>
            <a href="#how-it-works" className="text-button">
              <span className="play-circle">
                <Play size={11} fill="currentColor" />
              </span>
              How it works
            </a>
          </div>
          <div className="hero-assurances">
            <span>
              <Check size={13} />
              No sign-up needed
            </span>
            <span>
              <Check size={13} />
              Your own original case
            </span>
            <span>
              <Check size={13} />
              Play at your pace
            </span>
          </div>
        </div>
        <CaseArt />
      </section>
      <div className="evidence-strip">
        <div className="page-width">
          <span className="strip-title">THE TRUTH IS IN THE DETAILS</span>
          <span>
            <MessageSquare size={17} /> Chat transcripts
          </span>
          <span>
            <Camera size={17} /> Scene photographs
          </span>
          <span>
            <ScanLine size={17} /> CCTV reconstructions
          </span>
          <span>
            <FileText size={17} /> Case documents
          </span>
        </div>
      </div>
      <section className="page-width starter-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">EVERY CASE STARTS SOMEWHERE</p>
            <h2>
              A spark. A story. <span>A mystery.</span>
            </h2>
          </div>
          <p>
            Bring your own premise,
            <br />
            or follow one of these leads.
          </p>
        </div>
        <div className="example-grid">
          {examples.map((example) => (
            <Link
              key={example.icon}
              to="/create"
              state={{ premise: example.text }}
              className="example-card"
            >
              <div className="example-card-top">
                <span className="case-index">CASE IDEA / {example.icon}</span>
                <ArrowUpRight size={19} />
              </div>
              <span className="tag">{example.tag}</span>
              <h3>{example.name}</h3>
              <p>{example.text}</p>
              <span className="example-cta">
                Investigate this idea <ArrowRight size={15} />
              </span>
            </Link>
          ))}
        </div>
      </section>
      <section id="how-it-works" className="how-section page-width">
        <div className="section-heading">
          <div>
            <p className="eyebrow">FROM WHAT IF TO WHO DID IT</p>
            <h2>
              Your intuition. <span>Their secrets.</span>
            </h2>
          </div>
          <Link className="text-button amber" to="/create">
            Open your first case <ArrowUpRight size={17} />
          </Link>
        </div>
        <div className="steps-grid">
          {[
            {
              num: '01',
              icon: Sparkles,
              title: 'Set the scene',
              text: 'Write a short fictional premise. Choose how deep you want the mystery to go.',
            },
            {
              num: '02',
              icon: Fingerprint,
              title: 'Work the evidence',
              text: 'Study four suspects and eight clues. Compare stories. Find the contradiction.',
            },
            {
              num: '03',
              icon: LockKeyhole,
              title: 'Make your accusation',
              text: 'Name the culprit, connect the clues, and uncover how it really happened.',
            },
          ].map((step) => (
            <div className="step" key={step.num}>
              <div className="step-top">
                <step.icon size={22} />
                <span>{step.num}</span>
              </div>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="closing-cta page-width">
        <div>
          <p className="eyebrow">THE NEXT FILE HAS YOUR NAME ON IT</p>
          <h2>
            Trust your instincts.
            <br />
            Question everything else.
          </h2>
        </div>
        <Link className="button primary large" to="/create">
          Enter the Mystery Room <ChevronRight size={19} />
        </Link>
      </section>
    </main>
  );
}

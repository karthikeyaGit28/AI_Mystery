# AI MYSTERY ROOM — MASTER PRODUCT & ENGINEERING SPECIFICATION

**Document:** `spec.md`  
**Version:** 1.1.0  
**Last updated:** 2026-10-28  
**Status:** Implementation baseline — authoritative for Codex unless the project owner revises it  
**Owner:** Project team  
**Audience:** OpenAI Codex, engineers, designers, QA  
**Stack:** MongoDB, Express, React, Node.js (MERN), TypeScript, Gemini API  

> **SINGLE SOURCE OF TRUTH.** Implement the working application described here. This file takes precedence over assumptions, generated code comments, and ad hoc implementation choices. If a requirement is ambiguous, choose the simplest secure implementation that preserves the user experience and the acceptance criteria; document the choice in the project README. Never silently omit a required feature. Do not implement fake buttons, fake API results, or a purely static demonstration as the completed product.

---

## 0. Codex execution contract

1. Read this entire document before writing code. Make a brief execution plan, then implement in the order specified in §20.
2. Build a runnable monorepo with a real React frontend, Express API, MongoDB persistence, asynchronous worker, Gemini-powered case generation, image generation, and video generation.
3. Use **TypeScript** everywhere (frontend, API, worker, shared packages). Validate inputs and AI responses at runtime.
4. Implement deterministic **mock-provider mode** for local tests without API billing, but use the real Gemini provider when configured. Mock mode is clearly marked in the UI and must never be mistaken for live AI generation.
5. Run formatting, linting, type checks, unit/integration tests, production builds, and the required end-to-end journey. Fix failures before marking complete.
6. Every case has **exactly one fixed culprit**. Freeze the ground truth **before** evidence/media generation. Do not let the model choose a new culprit when the user submits an accusation.
7. Never expose the hidden solution, solution-related IDs, hint scripts, internal prompts, or model responses in player-facing APIs or frontend assets before submission.
8. Do not put Gemini credentials in the browser or expose storage credentials. All Gemini calls run on the backend/worker.
9. Where a third-party API feature is unavailable to the configured account, report a meaningful capability error or use the explicitly defined **AI-frame CCTV fallback**. Never present a stock clip, unrelated clip, or hardcoded placeholder as successfully generated evidence.
10. Finish with instructions to start the project, configure the Google API key, and run the tests. Do not claim completion without the end-to-end acceptance test passing (or clearly identify what was blocked by missing external credentials).

## 1. Product vision

**AI Mystery Room** is a single-player, interactive mystery-solving website. A player writes a short story premise such as *“During a college festival, a valuable trophy disappears from a locked backstage room.”* The app uses Google Gemini to invent a self-contained fictional investigation, including suspects, motive, opportunity, timeline, witnesses, and evidence. The player explores simulated messaging conversations, AI-created photographs, and AI-generated CCTV-style footage, then selects a culprit. The app verifies the accusation against the precomputed answer and reveals an explanation.

**One-sentence promise:** *Type a mystery idea. Step into an AI-created investigation. Study the evidence. Catch the culprit.*

**Core loop:** User premise → AI case generation → fictional evidence generation → investigation interface → accusation → verdict and explanation.

### 1.1 Success criteria

- A first-time user can generate and solve an original case without creating an account.
- The generated mystery is internally consistent, has exactly one culprit, and can be reasonably solved from the displayed clues.
- Each finished case includes readable chat evidence, two AI-generated image clues, and at least one playable AI-based surveillance recording.
- A player cannot get the answer from frontend responses or network calls before making the final accusation.
- Failure of a media-generation call does not corrupt the case, silently change the culprit, or trap the player on a permanent loading screen.
- The site works on desktop and mobile and feels like an immersive detective game rather than a generic admin dashboard.

### 1.2 Target users and assumptions

- Primary audience: students, casual gamers, puzzle lovers, and mystery fans.
- Single-player and English-only in v1.
- Browser-first: desktop priority, fully usable on mobile.
- No account, payment, multiplayer, text/voice interrogation, or user media uploads in MVP.
- The premise is **inspiration**, not a demand to recreate real people, real crimes, or actual leaked material.

## 2. Core Concepts and Working Principles

**Purpose of this section:** This is the plain-English explanation of *how AI Mystery Room works as a product*, not merely the libraries it uses. Codex must implement the concepts below as **observable application behavior**. The detailed, testable implementation rules later in the document take precedence if this overview leaves anything unspecified.

### 2.1 The central idea: story in, playable investigation out

The player is the detective, **not** the author of every clue. The player provides a brief fictional premise (for example: *“A trophy goes missing during a university festival”*) and selects a difficulty. Gemini turns that premise into a new, complete, self-contained mystery. The system presents the case as an investigation room: an incident report, **four plausible suspects**, and **eight pieces of fictional AI-created evidence**. The player studies those clues and makes **one final accusation**. The server compares it with an answer decided **before** the player began investigating, then reveals the reasoning.

The input is a **seed**, not a full screenplay. Gemini may invent fictional adult characters, plausible relationships, locations, exact times, and motives to make the user's premise playable, but the resulting mystery must stay recognizable as an interpretation of that premise. The experience must feel different across live user prompts, not like the same case with names replaced.

**Conceptual flow (not a separate API contract):**

```text
PLAYER: Short premise + difficulty
             |
             v
GEMINI: Private case blueprint
  incident + 4 suspects + culprit + true timeline + motive/method
             |
             v
VALIDATE: Can the answer be deduced fairly from planned public clues?
             |
             v
FREEZE: Lock private solution and evidence-to-fact plan
             |
             v
GENERATE: 2 chats + 2 photos + 1 CCTV reconstruction + 3 documents
             |
             v
PUBLISH: Interactive investigation room (without the secret answer)
             |
             v
PLAYER: Inspect clues -> optional hints -> accuse 1 suspect
             |
             v
SERVER: Compare with locked culprit -> deterministic score -> explanation
```

### 2.2 The private mystery blueprint (ground truth / canon)

Before writing chats or generating media, Gemini must design the **complete true story behind the fictional incident**. This private blueprint, also called the *canon*, contains:

- **Incident:** What happened, where, and when; what the player must solve.
- **Suspects:** Exactly four distinct fictional adults, with roles, possible motives, public statements, and claimed alibis.
- **Fixed culprit:** Exactly one of those four suspects, with motive, method, and opportunity.
- **Actual timeline:** What truly occurred in chronological order, including any lie or false alibi.
- **Canonical facts:** Individually identified, time-grounded facts that evidence is allowed to express.
- **Clue plan:** Which facts each of the eight artifacts supports and how some artifacts may mislead fairly.
- **Solution:** The proof chain, why alternatives are weaker or excluded, a verdict explanation, and three progressively stronger hints.

**Critical rule:** The system does **not** ask Gemini who did it when the player submits an answer. The culprit is already fixed in private persistent storage, and subsequent generated messages, photos, video, and documents must all agree with that truth. If a generation attempt contradicts the canon, it is rejected or regenerated; it cannot silently rewrite the culprit.

### 2.3 Suspects, motives, alibis, and fairness

A suspect is someone a reasonable investigator might consider, not a random name on a card. Each suspect needs an apparent connection to the incident, a reason they might be involved, and an alibi or claim the player can evaluate. The culprit must have a coherent **motive** (why), **method** (how), and **opportunity** (when/how they could act).

The other three suspects may have suspicious behavior, but a fair case must include enough information to avoid making them equally valid answers. **Red herrings** are believable but ultimately explainable distractions, such as an angry message that turns out to be unrelated. They are not false system statements about what actually happened. The case should be solvable by combining evidence, not by guessing the most suspicious-looking character.

Difficulty changes how **obvious or distributed** the clue connections are: easy has clearer guidance, medium requires combining multiple clues, and hard requires deeper cross-checking. It never changes the rule that exactly one answer is well supported.

### 2.4 Evidence generation: eight artifacts, one shared truth

Gemini (and the configured image/video capabilities) renders the blueprint into the following **exact evidence pack**. All eight artifacts must be based on the locked timeline and fact references, rather than independently improvising a new story.

| Type | Count | Player experience | Implementation meaning |
|---|---:|---|---|
| Fictional messaging chats | 2 | Read timestamped, two-sided conversations in a familiar messenger-style viewer | Gemini generates structured participants/messages; **not** real WhatsApp access or actual chat exports |
| AI-generated scene photos | 2 | Examine clues in rooms, objects, and surroundings; zoom and read factual captions | Image model illustrates an authored scene; canon-backed captions/overlays carry any exact text or timestamps |
| AI-based CCTV recording | 1 | Play, pause, and inspect a short fictional surveillance reconstruction with camera/time label | Gemini video if supported, otherwise a playable MP4 made from **AI-generated frames**; timestamp and transcript come from canon |
| Investigation documents | 3 | Read an incident report, witness statement, and access/log record | Gemini produces structured, styled text records, not a fabricated real-world police report |
| **Total** | **8** | One cohesive case dossier | Two chats + two photos + one CCTV + three documents |

**Media are representations of canon, not independent sources of new truth.** If an image generator draws an unexpected object, the game must not quietly use it as a decisive clue. Important identifiers, exact times, and fine-print text must be readable in structured text, accessible descriptions, transcripts, or server-authored overlays. Every artifact is clearly labeled **fictional / AI-generated**.

### 2.5 Clue mapping and solvability: why the mystery has an answer

Each artifact has a stable ID such as `EV-07`. Privately, it links to one or more canonical facts such as `FACT-04`. This is the **evidence-to-fact map**. A player sees natural clues (a badge log, a chat message, an image caption), **not** those private mapping IDs or a hidden `isCulprit` flag.

A reliable solution is a **chain of inferences**, not one line that says “S-03 did it.” For example: a chat establishes access to a key, an access log contradicts a claimed departure time, and CCTV supports movement through a corridor. Combined, these establish opportunity and contradict the culprit's alibi. At least **three meaningful evidence items across two different modalities** must support the fixed answer, and misleading clues need explicit private explanations. Before publishing, a separate Gemini reviewer should try to solve the case using **public clues only**, without being told the solution; if the answer is ambiguous, the blueprint is rejected or regenerated.

### 2.6 Player investigation, hints, accusation, and verdict

After evidence generation succeeds, the player can open a case brief, read the four suspect cards, inspect the eight artifacts, browse a **public-facts-only** timeline, and mark items reviewed or bookmarked. They can request **up to three hints in order**; hints are written from the locked solution, not spontaneously invented during play, and incur the scoring consequences defined later.

The final interaction is **one accusation** of exactly one suspect, with optional cited evidence IDs and free-text reasoning. The backend checks the selected suspect against the private `culpritSuspectId`. It does not ask Gemini to judge the player's writing or regenerate an answer. A correct choice receives a deterministic score (with evidence and unused-hint bonuses); a wrong choice receives zero. **Only after submission** does the website reveal the culprit, actual timeline, clue connections, and explanations of the red herrings. A finished accusation cannot be changed.

### 2.7 Worked example: from a one-sentence prompt to a playable case

The following is a **mock/test illustration**, not a hardcoded production case. Exact dates/times and character details are fictional.

**Player's input:** *“At a university festival, the trophy disappears from a locked backstage room right before the award ceremony.”* Difficulty: **Medium**.

**Gemini creates the hidden case:**

- **S-01 — Festival host:** Had access to the backstage area and argued with organizers, but was on stage during the relevant period.
- **S-02 — Stage assistant:** Once held a spare key, but returned it before the theft window.
- **S-03 — Logistics coordinator (actual culprit):** Borrowed the backstage key and carried a distinctive equipment bag. Claimed to have left the building by 21:00.
- **S-04 — Performer:** Sent an angry message about the prize; the complaint concerned judging, not taking the trophy.
- **Private truth:** S-03 used their own access badge to enter the backstage room at **21:14**, took the trophy, and concealed it in equipment. The badge entry and later movement contradict their alibi. **The player is not shown this paragraph until the verdict.**

**Eight public evidence artifacts are generated from that same private story:**

| ID | Kind | Example of what the player can actually inspect | Role in deduction |
|---|---|---|---|
| `EV-01` | Chat 1 | A fictional organizer's 20:55 chat confirms S-03 borrowed the backstage key | Establishes a means of access |
| `EV-02` | Chat 2 | S-04 complains angrily about the award judging | Plausible but explainable red herring |
| `EV-03` | Photo 1 | AI-generated backstage-room scene showing the empty trophy display | Establishes physical scene, without relying on unreadable text |
| `EV-04` | Photo 2 | AI-generated equipment-area scene showing a distinctive yellow-striped bag | Corroborating visual lead, explained in its caption |
| `EV-05` | CCTV | An AI-based corridor reconstruction, with a canon-backed transcript, shows a yellow-striped bag moving toward equipment storage at 21:17 | Connects movement/location to the incident |
| `EV-06` | Document 1 | Incident report records that the trophy was discovered missing around 21:20 | Establishes the reported incident window |
| `EV-07` | Document 2 | Badge access log shows S-03 entering backstage at 21:14 | Contradicts S-03's claimed 21:00 departure |
| `EV-08` | Document 3 | Witness statement records S-01 onstage and S-02 returning the spare key earlier | Helps eliminate alternative suspects |

**How a player solves it:** The player compares S-03's claim (*“I left at 21:00”*) with the access log (**21:14**), then uses the key-borrowing chat and CCTV/bag evidence to connect S-03 to the room and the removal route. S-04's angry message is suspicious, but it does not establish access or opportunity. The player selects **S-03** and optionally cites `EV-01`, `EV-05`, and `EV-07`.

**What the system reveals:** A correct/incorrect verdict based on the **previously locked culprit**, a deterministic score, the true incident timeline, why the evidence implicates S-03, and why the other suspects' suspicious actions do not establish guilt. The test fixture may fix S-03 as culprit; live Gemini-generated mysteries must not always choose S-03.

### 2.8 Boundaries: what the product does and does not do

- **Does:** invent fictional cases from user prompts, generate fictional evidence assets, let the user inspect them, protect the solution, and score a final choice.
- **Does not:** access real WhatsApp messages, security-camera systems, private accounts, real police records, or real people's identities; it also does not allow live suspect interrogation in the MVP.
- **Does:** use the actual configured Gemini provider for live generation, keep asynchronous progress truthful, and publish only a complete validated case.
- **Does not:** treat static placeholders, unrelated stock footage, or a demo fixture as a successfully generated live case. Mock mode is separately and visibly labeled.

**Codex cross-reference:** The normative details are in **§3 (MVP), §4 (journey), §6 (generation/canon validation), §7 (data contracts), §8 (Gemini/media), §11 (API), §12 (scoring), §18 (acceptance tests), and §19 (test fixture)**. If this conceptual illustration and a strict contract disagree, **follow the strict contract** and flag the discrepancy in the README.

## 3. Frozen MVP scope

### 3.1 Required features (P0)

| ID | Requirement | Testable behavior |
|---|---|---|
| FR-01 | Landing page | Explains experience, displays CTA and example prompts. |
| FR-02 | Story prompt | Accepts a 30–1,200-character fictional premise. |
| FR-03 | Case settings | Player chooses difficulty `easy/medium/hard`; default `medium`. |
| FR-04 | Background generation | Submission creates a persisted job, returns a case ID quickly, and displays progress. |
| FR-05 | Generated mystery | Exactly 4 suspects, 1 culprit, clear incident, timeline, and solvable causal chain. |
| FR-06 | Evidence pack | Exactly 8 items: 2 simulated chats, 2 AI photographs, 1 CCTV clip, 3 written documents. |
| FR-07 | Chat viewer | Renders realistic, fictional messenger-style threads with sender/time/body metadata. |
| FR-08 | Image viewer | Displays both generated photos with zoom, captions, and accessible descriptions. |
| FR-09 | CCTV viewer | Plays a short video with controlled, fictional timestamp and camera labels. |
| FR-10 | Investigation desk | Displays case brief, suspect profiles, evidence tabs, and review/bookmark state. |
| FR-11 | Hints | Up to 3 sequential hints, with an explicit score penalty. |
| FR-12 | Accusation | Select one of four suspect IDs; optionally cite up to 3 evidence items and add reasoning. |
| FR-13 | Verdict | Server validates answer and returns score, correct culprit, causal explanation, and clue-by-clue reveal. |
| FR-14 | Session history | Player can access previously generated cases from the same guest session. |
| FR-15 | Error/retry | Generation failures show a clear state and recoverable retry path without duplicate payments/jobs. |
| FR-16 | Disclosure and safety | All evidence labeled fictional/AI-generated. No real private communications or non-consensual likenesses. |

### 3.2 Excluded from MVP (P1 / future)

- Registered profiles, Google login, achievements, leaderboards, billing, subscriptions.
- Multiplayer rooms, sharing solutions with others, public galleries, social publishing.
- Real-time suspect interrogation/chatbots; live AI improvisation during investigation.
- Case editing after creation, user uploads, voice commands, complex 3D escape rooms.
- Generating arbitrary-length films or multiple CCTV clips per case.
- Automatic SMS, email, WhatsApp integration, real messaging access, or contact-book integration.

**Rule:** Prioritize the full P0 loop over optional polish. A working end-to-end case beats a sophisticated incomplete prototype.

## 4. Primary user experience

### 4.1 Journey

1. **Home** (`/`): cinematic hero *“Every story hides a suspect.”* Show 3 example premises, short instructions, and **Create a Mystery**.
2. **Create** (`/create`): multi-line prompt and difficulty selector. Provide character counter, 3 clickable premise examples, validation, and **Generate My Case**.
3. On submit: backend issues an owner-only case ID and queues generation. Browser moves to `/cases/:caseId/preparing`.
4. **Preparing**: visible stages: *Building the incident → Casting suspects → Checking clues → Creating photographs → Creating CCTV → Sealing the case*. Provide a truthful stage label and indeterminate progress rather than fabricated percentages. Poll every 3 seconds; allow refresh/reconnect.
5. **Investigation room** (`/cases/:caseId/investigate`): show incident and case dossier, four suspects, eight evidence items, and an accusation action. Evidence is available from the start (no hidden unlock prerequisites).
6. Player inspects chat threads, images, CCTV, and reports; can mark evidence **Reviewed**, bookmark it, and open a user-visible timeline built only from public facts.
7. Player may request 0–3 hints. Clicking hint asks server to reveal the next prewritten hint and updates state.
8. Player clicks **Accuse a Suspect**, chooses exactly one suspect, optionally cites 0–3 evidence items, optionally writes up to 500 characters of reasoning, and confirms a final submission.
9. **Verdict** (`/cases/:caseId/result`): success/failure headline, fixed culprit, score, reasoning, evidence connections, clues missed, hint usage, and options **Play Another** / **Back to History**.
10. The player can revisit the result page; submission cannot be changed. A new case requires a new generation.

### 4.2 Case-difficulty contract

- **Easy:** clearer evidence connections, straightforward alibi contradiction, no more than 2 red herrings, specific first hint.
- **Medium:** at least 2 pieces must be combined; one misleading but explainable alibi or motive.
- **Hard:** at least 3 clues across at least 2 modalities required; multiple plausible motives; still a fair unique answer.
- Do not make difficulty depend on obscure trivia, unreadable imagery, or random guessing.

### 4.3 User-visible case format

Case header: `CASE #<shortID>`, title, location, fictional date, difficulty, incident summary, objective.

Suspect cards: name, role, age **(all fictional adults 18+)**, relationship to event, public statement, claimed alibi, motive possibility (not explicit solution).

Evidence cards: evidence ID (`EV-01` etc.), title, type, source, occurrence time, discoverable summary, **AI-GENERATED / FICTIONAL** label, review/bookmark toggle. Clicking opens a full-width modality viewer.

## 5. UX, UI and design system

### 5.1 Visual language

- Direction: cinematic investigative thriller, restrained dark mode, polished and readable.
- Base colors: background `#0B1018`; surface `#151E2A`; raised surface `#1C2837`; foreground `#EEF2F7`; secondary text `#9AABBD`; accent amber `#D9A74D`; danger `#DB6B70`; success `#69B79A`.
- Typography: strong display type (e.g., `Space Grotesk`) and readable body (`Inter`), with system fallbacks. Monospace (`IBM Plex Mono`) for timestamps/evidence IDs.
- Style: soft vignette, restrained grain, dossier borders, subtle hover/focus animations; avoid flashing backgrounds and excessive animated effects.
- Consistent header/nav, cards, buttons, dialogs, skeletons, states, and toasts; use CSS variables or Tailwind theme tokens.
- Accessibility: minimum contrast WCAG AA, visible keyboard focus, reduced motion preference, captions/transcripts for videos, alt text, accessible form labels.

### 5.2 Layouts and screens

| Route | Main elements | State |
|---|---|---|
| `/` | Hero, input preview, 3 example challenges, how it works, footer disclaimer | public |
| `/create` | Story textarea, difficulty tabs, example chips, Create CTA | public |
| `/cases/:id/preparing` | Case title placeholder, stage progress, error retry, return home | owner |
| `/cases/:id/investigate` | Top case brief; desktop 3-column investigation workspace; mobile tabs; suspects, evidence grid, timeline, accuse CTA | owner + READY |
| `/cases/:id/result` | verdict, score, culprit, solved timeline, evidence explanations | owner + SUBMITTED |
| `/history` | recent cases with status, difficulty, created date, resume button | owner |
| `*` | polished 404 / error boundary with navigation | public |

Desktop investigation workspace: left sidebar suspects (approx. 25%), middle evidence list/filters (approx. 35%), right evidence viewer (approx. 40%). At tablet widths collapse panels; on phones use **Case / Suspects / Evidence / Timeline** tabs, a full-screen evidence viewer, and a sticky accusation CTA. No horizontal scrolling for core interactions.

### 5.3 Evidence viewers

**Simulated messenger evidence:** two-sided chat bubbles; pseudonymous fictional contacts; human-readable time; date separators; scrollable transcript; optional pinned media stub only if it resolves to a real evidence asset. Reproduce familiar chat layout but not the WhatsApp logo, trademark, verified badges, or real identities. Label as *“Fictional chat simulation — not an actual WhatsApp export.”* The text must be DOM text, not AI-baked into an image.

**Photographs:** display the generated image, pan/zoom, exact authored caption, optional diagrammed/callout region only when grounded in the canonical case. All important text clues are rendered as verified HTML overlays or captions; do not depend on the image model spelling a license plate or timestamp correctly.

**CCTV:** standard native HTML5 video controls, pause/seek, optional 0.5x speed if supported, mute by default, readable *CAM 02 / 21:14:07* overlay computed from canonical structured fields in a post-processing step, visible *“AI-generated reconstruction”* mark, and a text transcript/description for accessibility. Media cannot contradict the fixed timeline.

**Written documents:** styled PDF-like responsive HTML cards for incident report, witness statement, and access/log record, with date/time/signature source fields. These are structured text, not image OCR.

### 5.4 Interaction constraints

- Show skeletons until valid data arrives; no empty dead-end screens.
- All action buttons work with API calls and show pending/disabled/retry states.
- Visited/reviewed/bookmarked evidence persists in MongoDB.
- Do not automatically show verdict before accusation confirmation.
- Do not expose a button called “Interrogate” in MVP; there is no real interrogation backend.
- Do not show a fake countdown. Investigation time is unrestricted in v1.

## 6. AI mystery construction: the most important requirement

The AI must generate a **canon (ground truth) first**, then generate every player-visible clue from that canon. The culprit cannot change after the canon is frozen. Media models are illustrators, **not** independent authors of the mystery.

### 6.1 Generation stages

1. **Input validation/safety.** Normalize and limit user premise. Refuse clearly disallowed content, unconsented real-person impersonation, and real alleged misconduct; where appropriate, transform a benign real-world setting into fictional people/organizations.
2. **Case blueprint (`generateBlueprint`).** Request structured JSON from Gemini for complete private case canon including four suspects, true timeline, culprit, motive, method, alibi claims, proof chain, and evidence intents.
3. **Schema validation (`validateBlueprint`).** Parse Zod schema; cross-check unique IDs, timestamp ordering, suspect existence, evidence counts, traceable clues, supported facts, and absence of conflicting facts.
4. **Mystery QA (`reviewSolvability`).** Run a separate reviewer prompt on the **public content and clue descriptions only**, without the correct culprit ID. Ask it to identify the most likely culprit, reasons, and ambiguity; compare with private canon. If reviewer cannot find the intended culprit or finds equally supported alternative answers, reject/regenerate.
5. **Freeze truth.** Persist a locked, versioned private solution and stable evidence metadata before any media calls. Make immutable once `blueprintLockedAt` is set.
6. **Render text evidence (`renderTextEvidence`).** Produce structured chat messages and documents from canonical facts. Validate message times, participants, content, and no accidental answer leaks.
7. **Generate photos (`generateImages`).** Use exactly authored photo briefs and a consistent fictional visual style. Persist images to private object storage.
8. **Generate CCTV (`generateCctv`).** Use canonical scene/camera/action brief; obtain a short synthetic clip; post-process text overlay/watermark. See §8.3 for fallback.
9. **Final QA (`verifyEvidencePack`).** Check each item/asset exists, media MIME/dimensions, all required clues present and stable IDs; confirm two-modality support; run optional semantic contradiction check against the locked canon.
10. **Publish.** Move case to `READY` in one atomic finalization step. Only then may the full public investigation data be returned.

### 6.2 Mandatory logical invariants

- Exactly 4 distinct suspects, each a fictional adult.
- Exactly 1 culprit, and its ID exists among suspects.
- Exactly 8 evidence items, typed: `CHAT` ×2, `PHOTO` ×2, `CCTV` ×1, `DOCUMENT` ×3.
- At least 3 independently meaningful evidence items support the truth, spanning **at least 2 distinct modalities**; at least 1 clue contradicts the culprit's stated alibi or directly connects culprit to opportunity/method.
- At least 2 plausible alternative suspects; red herrings must be explicitly explainable in the solution and must not create a second equally valid culprit.
- The answer is deducible **without** needing to recognize tiny AI-imaged lettering, precise faces, or silent off-screen assumptions.
- At least one item gives a fair motive/opportunity lead and at least one reveals a verifiable timeline discrepancy.
- Every generated time has explicit ISO date/time and case timezone. User-facing messages may format to local time but may not change ordering.
- All facts shown in chats, photos' captions, written documents, and CCTV descriptions must belong to the same canon.
- No evidence item exposes a machine-only flag like `isCulprit`, `correctSuspectId`, `solutionExplanation`, `truthLevel`, or internal scoring tags.
- A case is never marked `READY` with broken media paths or missing required evidence.

### 6.3 Evidence relationship model

Every evidence item has a `canonicalFactIds[]` list pointing to defined, immutable canon facts. Each fact is a private structured statement such as `FACT-05: camera access door opened at 21:14 using badge assigned to S-03`. The public card only contains natural-language content, source, and timestamp; not private fact IDs or truth labels. Canon facts also power final explanation and validation. Do not ask the media model to invent new facts.

**For AI imagery:** a generated photo is illustrative. The case treats only its explicit canon-backed visual description as a puzzle fact; a hallucinated sign, accessory, or extra person must not become a clue. Reject or regenerate material deviations when detectable. Keep written captions strictly faithful to locked facts.

**For CCTV:** the video is an AI-generated recreation of a canon-defined camera event, not documentary evidence. Its timestamp/camera label comes from server-side metadata, overlaid after generation. If visuals vary unpredictably, generate a conservative scene without critical face identity; the companion transcript provides the exact canonical observation.

### 6.4 Solver QA criteria

A valid case must answer all six questions:

1. What incident happened, where, and when?
2. Who are the four suspects and how were they connected?
3. Which exact suspect did it and what were motive/method/opportunity?
4. Which 3+ independent clues support that conclusion?
5. Why are the other suspects not equally supported by the evidence?
6. Can a player reach this conclusion using only material in the public evidence pack?

Retry failed blueprint generation at most **2 times** (3 total attempts). If still invalid, mark `FAILED` with a safe error code; do not synthesize a fake success. No retries should mutate a successfully frozen solution.

## 7. Canonical data contracts

Types below are conceptual shared TypeScript contracts, backed by strict Zod validation. **Never send a `CaseSecret` or private `CanonicalFact` to a public endpoint.**

```ts
type Difficulty = 'easy' | 'medium' | 'hard';
type EvidenceType = 'CHAT' | 'PHOTO' | 'CCTV' | 'DOCUMENT';
type GenerationStatus =
  | 'QUEUED' | 'GENERATING_BLUEPRINT' | 'VALIDATING'
  | 'GENERATING_TEXT' | 'GENERATING_IMAGES' | 'GENERATING_VIDEO'
  | 'FINALIZING' | 'READY' | 'FAILED';

type SuspectPublic = {
  id: string;                 // stable: S-01 ... S-04
  name: string;
  age: number;                // >= 18
  role: string;
  relationshipToIncident: string;
  statedAlibi: string;
  publicStatement: string;
  motivePossibility: string;
};

type ChatMessage = {
  id: string;
  sender: string;
  timestamp: string;          // ISO 8601 w/ offset or UTC
  text: string;
};

type EvidencePublic = {
  id: string;                 // EV-01 ... EV-08
  type: EvidenceType;
  title: string;
  source: string;
  occurredAt: string;         // ISO timestamp
  summary: string;
  description: string;        // canonical, playable factual observation
  payload: {
    messages?: ChatMessage[];                // CHAT
    documentBody?: string;                   // DOCUMENT
    documentKind?: 'INCIDENT_REPORT' | 'WITNESS' | 'ACCESS_LOG';
    assetId?: string;                        // PHOTO, CCTV
    cameraLabel?: string;                    // CCTV
    cameraTimestamp?: string;                // CCTV
    transcript?: string;                     // CCTV accessibility
    altText?: string;                        // PHOTO
  };
};

type CasePublic = {
  id: string;
  title: string;
  caseNumber: string;
  premise: string;
  difficulty: Difficulty;
  timezone: string;          // IANA TZ identifier
  fictionalDate: string;
  location: string;
  incident: string;
  objective: string;
  status: 'READY' | 'SUBMITTED';
  suspects: SuspectPublic[];
  evidence: EvidencePublic[];
  createdAt: string;
};

type CanonicalFact = {
  id: string;
  statement: string;
  occurredAt: string | null;
  involvedSuspectIds: string[];
};

type CaseSecret = {
  caseId: string;
  blueprintVersion: number;
  culpritSuspectId: string;
  motive: string;
  method: string;
  opportunity: string;
  actualTimeline: Array<{ occurredAt: string; event: string }>;
  canonicalFacts: CanonicalFact[];
  supportingEvidenceIds: string[];    // >=3; >=2 types
  evidenceFactMap: Record<string, string[]>;
  redHerringExplanations: Record<string, string>; // keyed by evidence ID
  suspectEliminationReasons: Record<string, string>; // the 3 non-culprit suspect IDs
  verdictExplanation: string;
  hintTexts: [string, string, string];
  blueprintLockedAt: string;
};
```

**Note:** Validate payload combinations by evidence type: `CHAT` requires messages; `PHOTO` requires an image asset and alt text; `CCTV` requires a playable MP4 asset, camera metadata, and transcript; `DOCUMENT` requires document text and kind. Never serialize undefined private fields to frontend.

### 7.1 Case blueprint JSON design

Gemini structured output must include at least:

```json
{
  "title": "The Missing Festival Trophy",
  "incident": "The festival trophy vanished from a locked backstage room.",
  "location": "A fictional university auditorium",
  "timezone": "Asia/Kolkata",
  "fictionalDate": "2026-10-28",
  "objective": "Identify who took the trophy and how the lock was bypassed.",
  "suspects": ["4 suspect objects with IDs S-01 through S-04"],
  "culpritSuspectId": "S-03",
  "canonicalFacts": ["structured FACT-xx objects"],
  "actualTimeline": ["time-stamped canonical events"],
  "evidencePlans": [
    {"id":"EV-01","type":"CHAT","factIds":["FACT-01"]},
    {"id":"EV-02","type":"CHAT","factIds":["FACT-03"]},
    {"id":"EV-03","type":"PHOTO","factIds":["FACT-04"]},
    {"id":"EV-04","type":"PHOTO","factIds":["FACT-06"]},
    {"id":"EV-05","type":"CCTV","factIds":["FACT-05"]},
    {"id":"EV-06","type":"DOCUMENT","factIds":["FACT-02"]},
    {"id":"EV-07","type":"DOCUMENT","factIds":["FACT-07"]},
    {"id":"EV-08","type":"DOCUMENT","factIds":["FACT-08"]}
  ],
  "solution": {
    "motive": "fictional motive",
    "method": "fictional method",
    "opportunity": "fictional opportunity",
    "supportingEvidenceIds": ["EV-01","EV-05","EV-07"],
    "verdictExplanation": "Explain the linked clues, culprit, and eliminated suspects.",
    "hintTexts": ["subtle hint","specific connection","strong last hint"]
  }
}
```

This block is **illustrative**, not a literal valid fixture. Real fixtures must match actual Zod schemas and contain full suspect/fact/evidence objects. Map the blueprint into separate public and secret storage; do not store all mixed JSON in an API DTO.

### 7.2 Private generation-plan contract

An individual evidence plan is written by the **blueprint model**, not invented later by the image/video model. Store this type only on the private side of the generation pipeline:

```ts
type EvidencePlan = {
  id: string;                       // EV-01..EV-08
  type: EvidenceType;
  title: string;
  source: string;                   // fictional device/person/document source
  occurredAt: string;
  factIds: string[];                // canonical FACT-xx references
  authoredObservation: string;     // exact fact the user should infer
  renderBrief: string;             // how the artifact should appear
  chatParticipants?: string[];     // required for CHAT
  documentKind?: 'INCIDENT_REPORT' | 'WITNESS' | 'ACCESS_LOG';
  cameraLabel?: string;            // required for CCTV
  cameraTimestamp?: string;        // required for CCTV
};

type PrivateBlueprint = {
  title: string;
  incident: string;
  location: string;
  timezone: string;
  fictionalDate: string;
  objective: string;
  suspects: SuspectPublic[];
  culpritSuspectId: string;
  canonicalFacts: CanonicalFact[];
  actualTimeline: Array<{ occurredAt: string; event: string }>;
  evidencePlans: EvidencePlan[];
  solution: {
    motive: string;
    method: string;
    opportunity: string;
    supportingEvidenceIds: string[];
    redHerringExplanations: Record<string, string>; // by evidence ID
    suspectEliminationReasons: Record<string, string>; // other 3 IDs
    verdictExplanation: string;
    hintTexts: [string, string, string];
  };
};
```

`renderBrief` must be directly supported by the linked `factIds`; it cannot add a new alibi, identity, object, time, or decisive event. Validate exact evidence-type counts and type-specific fields. In the final verdict use `suspectEliminationReasons` to explain why the three non-culprit suspects are ruled out. The solution must not be sent to the client until the final accusation has been committed.

### 7.3 Stability and validation

- Generate UUID/ULID database IDs server-side; model-generated `S-xx`, `EV-xx`, `FACT-xx` are scoped logical IDs, never authorization tokens.
- Reject duplicates, missing references, invalid time zones, bad dates, out-of-range ages, weak clue connections, and solution IDs absent from suspects.
- Use an application-layer validation pass even when Gemini returns schema-compliant JSON; structured output alone does not prove semantic correctness.
- Validate text length and all arrays in `packages/shared`; protect against prompt injection by treating user premise as untrusted data, not control instructions.

## 8. Gemini and multimedia integrations

### 8.1 SDK and configured models (verified 2026-10-28)

Use the **official `@google/genai` JavaScript SDK** from the server only. Model IDs must be env-configurable because Google changes availability, prices, and quotas. Default provider configuration:

| Function | Default model | API role |
|---|---|---|
| Create/review canon and text evidence | `gemini-3.8-flash` | Structured JSON output / reasoning |
| Generate still photos | `gemini-nano-banana-2.1` | Image generation / editing |
| Generate CCTV footage | `gemini-omni-1.1-flash` | Text/image-to-video generation via Interactions API |

**Do not use `veo-3.1-generate-preview` or related Veo 3.1 preview IDs:** these models were shut down in the Gemini API on **2026-10-22**. Model authorization is account/tier dependent; do a real startup capability check or an explicit test-generation command before enabling production traffic. Never hardcode a rate/price or assume every key can generate video.

### 8.2 Structured output and AI prompting

Use schema-constrained JSON wherever supported; parse with Zod. Keep prompts in version-controlled files, separate from controllers:

- `prompts/blueprint.system.md`
- `prompts/reviewer.system.md`
- `prompts/chat-evidence.system.md`
- `prompts/document-evidence.system.md`
- `prompts/photo.system.md`
- `prompts/cctv.system.md`

**Blueprint prompt requirements:** Write a genuinely solvable fictional mystery based on the player's premise. Four plausible adult suspects. One culprit. Specific motive, method, opportunity. Complete true timeline. Eight planned evidence artifacts meeting exact type counts. At least three fair supporting clues across two media types. Red herrings with explanations. Never build a case where exact visual text recognition is the sole proof. Respond only with schema-valid structured data.

**Text evidence prompt requirements:** Given locked canon and exact facts allocated to this evidence ID, write believable dialogue/document wording. No new people, timestamps, locations, or unseen facts that change the solution. No explicit accusation unless the canon calls for it. Messages sound human, have 4–12 bubbles per thread, and have precise authored timestamps. Document types are incident report, witness statement, and access log.

**Reviewer prompt requirements:** Given only the exact public dossier, suspect statements, and text descriptions of all eight clues (without solution/culprit fields), identify who is most strongly supported and any contradictory facts. If not unique, return `REJECT` and explain; do not reveal the reviewer to the player.

Use a maximum of **3 total attempts** per generative stage for transient errors (exponential backoff with jitter). Distinguish network/429/5xx retries from safety blocks/invalid inputs; never retry unsafe content blindly. Save prompt version, model ID, token/media usage, stage duration, and error codes in internal generation logs, not in player responses.

### 8.3 CCTV generation and fallback (P0)

Preferred path:

1. Ask Gemini image model for a reference surveillance keyframe when useful, using the immutable scene description.
2. Call Gemini Omni Flash (`gemini-omni-1.1-flash`) for a short, **single continuous static-camera shot**, 16:9, 720p default; specify no scene cuts, no on-screen names or text, no dramatic music, no unapproved events.
3. Decode/download returned video server-side, validate it using `ffprobe`, and store a private MP4.
4. Use `ffmpeg` to add a deterministic camera ID, exact canonical timestamp, and *“AI-Generated Fictional Reconstruction”* overlay. Render accompanying HTML transcript from the immutable evidence description.
5. If the model generated a conflicting key event, try at most one targeted regeneration; if still unreliable, use the fallback.

**Required fallback:** Generate **two or more AI-created surveillance still frames** based on the locked CCTV scene, then use `ffmpeg` to compile a short H.264 MP4 with subtle crossfade/pan/zoom and server-authored CCTV overlay. This is explicitly labeled *“AI-frame surveillance reconstruction”* (not claimed to be fully motion-generated). All source visual frames are AI-generated, so the product still supplies an AI-based playable camera recording. Keep exact canonical clue in its written transcript. Do not use stock footage or manually drawn placeholder images as production evidence.

If **both** live video generation and AI-frame fallback fail, keep the case in `FAILED` with a retryable media-stage error; do not publish an incomplete case. In mock-provider mode, use bundled test-only media and an explicit `Demo Mode` watermark.

### 8.4 Photo-generation requirements

- Generate two different photos appropriate to the case: e.g., a desk scene with a moved object, a corridor with an unusual item, a dropped badge in a hallway.
- Use consistent fictional scene, lighting, location, and objects across photo/video prompts; where possible, reuse image references and a shared appearance guide.
- No real persons, recognizable copyrighted characters, unconsented likenesses, logos, or forged genuine evidence.
- Use generated imagery for scene appearance; place exact labels, timestamps, or decisive text via application-rendered overlays when needed.
- Store output image as web-friendly `image/webp` or `image/png`, preserve aspect ratio, validate dimensions, generate optimized thumbnails on worker.
- If image generation is blocked or fails after 3 permitted attempts, mark case stage `FAILED` with recoverable retry (same frozen canon).

### 8.5 Provider abstraction

Implement:

```ts
interface MysteryAIProvider {
  generateBlueprint(input: BlueprintInput): Promise<PrivateBlueprint>;
  reviewSolvability(input: PublicReviewInput): Promise<ReviewResult>;
  generateChat(input: LockedEvidenceInput): Promise<ChatMessage[]>;
  generateDocument(input: LockedEvidenceInput): Promise<string>;
  generatePhoto(input: LockedVisualInput): Promise<GeneratedMedia>;
  generateCctvVideo(input: LockedVisualInput): Promise<GeneratedMedia>;
}
```

Create `GeminiAIProvider` and `MockAIProvider` behind the interface. Separate text/image/video implementations if cleaner. Controllers must not import the SDK directly. Video fallback belongs to `MediaPipeline`, not the API route handler.

### 8.6 API usage and compliance

- Keep API keys only in backend environment/secrets manager; do not log payloads with identifying user content beyond need.
- Set explicit request/operation timeouts, backoffs, and per-case budget caps. Video generation may take substantially longer than text.
- Enforce per-user and global rate limits. Quotas differ by API project/model/tier.
- Treat blocked outputs as safe user-facing errors. Never disable required safety controls to force generation.
- Persist media in **our storage**, not a temporary Gemini file URL. Use durable object storage and retain references in MongoDB.
- All player-visible generated content carries a disclosure: *“This case and its evidence are fictional and AI-generated.”*

## 9. Architecture (MERN + required supporting services)

```text
React / Vite / TypeScript (web)
         |
         | HTTPS REST, guest session cookie
         v
Express / Node / TypeScript (API) -----> MongoDB (cases, secrets, progress, sessions)
         |                                  ^
         | enqueue                          |
         v                                  |
Redis + BullMQ  ----------------> Worker (Node/TypeScript)
                                    |
                                    +--> Gemini text (case canon/review/chats/docs)
                                    +--> Gemini image (photos/keyframes)
                                    +--> Gemini Omni video (CCTV)
                                    +--> ffmpeg/ffprobe (CCTV overlays/fallback)
                                    +--> Object storage (private images/video)
```

**MERN remains the core stack.** Redis/BullMQ are used only for durable asynchronous media jobs; S3-compatible object storage is used only for large binary assets. Do **not** store large videos in MongoDB documents. For local development run MongoDB + Redis + MinIO via Docker Compose; for deployment choose compatible managed services.

### 9.1 Monorepo layout

```text
ai-mystery-room/
├── spec.md                         # THIS FILE (authoritative)
├── README.md                       # runbook and architecture notes
├── .env.example                    # no real secrets
├── .gitignore
├── package.json                    # npm workspaces/scripts
├── docker-compose.yml              # MongoDB, Redis, MinIO
├── apps/
│   ├── web/
│   │   ├── src/
│   │   │   ├── app/               # routing/providers
│   │   │   ├── pages/             # home/create/loading/room/result/history
│   │   │   ├── components/        # shared UI + evidence viewers
│   │   │   ├── features/          # cases, suspects, clues, hints, verdict
│   │   │   ├── hooks/
│   │   │   ├── lib/api.ts
│   │   │   └── styles/
│   │   └── tests/
│   ├── api/
│   │   ├── src/
│   │   │   ├── server.ts
│   │   │   ├── routes/
│   │   │   ├── controllers/
│   │   │   ├── middleware/        # session, validation, authorization, limits
│   │   │   ├── services/
│   │   │   ├── models/            # Mongoose schemas
│   │   │   ├── repositories/
│   │   │   ├── queue/
│   │   │   └── config/
│   │   └── tests/
│   └── worker/
│       ├── src/
│       │   ├── worker.ts
│       │   ├── pipeline/
│       │   ├── ai/                # providers and SDK wrappers
│       │   ├── media/
│       │   ├── prompts/
│       │   └── safety/
│       └── tests/
├── packages/
│   └── shared/
│       └── src/                    # TS types, Zod schemas, enums, DTOs
└── e2e/                            # Playwright browser tests
```

### 9.2 Framework and library choices

- Frontend: **React 19 + Vite + TypeScript**, React Router, TanStack Query, Tailwind CSS, Radix/shadcn-compatible accessible components, Lucide icons.
- Backend: Node LTS, Express 5 (if package ecosystem tests pass), Mongoose, Zod, BullMQ, Redis client.
- AI: `@google/genai` official SDK (pin tested version and lockfile).
- Media: `ffmpeg`, `ffprobe`, image processor such as `sharp`.
- Storage: S3-compatible client (`@aws-sdk/client-s3`, signed URLs when appropriate).
- Tests: Vitest + Supertest for API/unit, Playwright for end-to-end, MSW or dependency injection for UI fixtures.
- Observability: Pino structured logs, request IDs, error codes, basic metrics (no raw secret logging).

## 10. Database and ownership model

MongoDB collections (all with timestamps/indexes):

### 10.1 `guest_sessions`

`_id`, `tokenHash`, `createdAt`, `lastSeenAt`, `expiresAt`. Create an unguessable random session token and store **only its hash** in MongoDB; issue raw token as an HTTP-only secure same-site cookie. `expiresAt` 30 days from latest valid use. Do not use arbitrary client-submitted owner IDs for access control.

### 10.2 `cases`

`_id`, `ownerSessionId`, `premise`, `difficulty`, `status`, `generationStage`, `title`, `caseNumber`, `incident`, `location`, `timezone`, `fictionalDate`, `objective`, `suspects[]`, `evidence[]`, `assetIds[]`, `generationAttempts`, `jobId`, `failureCode`, `createdAt`, `updatedAt`, `readyAt`, `expiresAt`, `blueprintLockedAt`, `generationVersion`.

Critical indexes: `{ownerSessionId:1,createdAt:-1}`, `{status:1,updatedAt:1}`, unique `{caseNumber:1}`, and cleanup indexes. Do not rely on Mongo TTL alone to delete external storage files; use cleanup worker.

### 10.3 `case_secrets`

`caseId` (unique), `culpritSuspectId`, `canonicalFacts[]`, `actualTimeline[]`, `evidenceFactMap`, `supportingEvidenceIds[]`, `redHerringExplanations`, `suspectEliminationReasons`, `hintTexts`, `verdictExplanation`, `motive`, `method`, `opportunity`, `blueprintVersion`, `blueprintLockedAt`.

**Absolute boundary:** Only server-side worker and verdict/hint logic may query this collection. Never use generic `populate` on secret data in public controllers. Prefer distinct repository and DTO modules with explicit whitelists.

### 10.4 `player_progress`

`caseId` + `ownerSessionId` unique, `reviewedEvidenceIds[]`, `bookmarkedEvidenceIds[]`, `hintsUsed` (0–3), `submittedAt` (nullable), `selectedSuspectId` (nullable), `selectedEvidenceIds[]`, `playerReasoning` (nullable), `score` (nullable), `isCorrect` (nullable). Enforce one final submission with atomic conditional update (`submittedAt:null`).

### 10.5 `media_assets`

`_id`, `caseId`, `evidenceId`, `kind` (`PHOTO|CCTV|FRAME|THUMBNAIL`), `objectKey`, `mimeType`, `bytes`, `width`, `height`, `durationSeconds`, `sha256`, `generationMethod` (`GEMINI_IMAGE|GEMINI_OMNI_VIDEO|AI_FRAME_VIDEO|MOCK`), `createdAt`.

Store private bucket keys only on the server. API emits URLs via authenticated short-lived access mechanisms, not raw bucket paths. Validate kind/mime and max size.

### 10.6 `generation_events` (internal)

`caseId`, `stage`, `attempt`, `model`, `startedAt`, `endedAt`, `durationMs`, `errorCode`, `usageSummary`, `promptVersion`, `jobId`, `requestId`. Never reveal these details to players.

### 10.7 Retention

- Guest sessions: 30 days sliding expiry.
- Cases, progress, secrets, images, and videos: delete **30 days after case creation** in MVP, with a scheduled cascading cleanup including object storage.
- History UI must disclose retention. If cases are retained longer in a future release, update policy and implementation together.
- Provide deletion of individual cases (`DELETE /api/v1/cases/:id`) to owner; cascade to associated records/media asynchronously and immediately deny access.

## 11. REST API contract

Base prefix: `/api/v1`. All JSON uses camelCase. Standard error format:

```json
{
  "error": {
    "code": "CASE_NOT_READY",
    "message": "Your investigation is still being prepared.",
    "requestId": "req_..."
  }
}
```

### 11.1 Session and creation

**`POST /api/v1/sessions/guest`** — creates or resumes a guest cookie. Response `200 {"sessionReady":true}`. Cookie has `HttpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/`; use CSRF/origin protections on mutating requests.

**`POST /api/v1/cases`** — request body:

```json
{
  "premise": "During the university fest, the event trophy disappears backstage.",
  "difficulty": "medium"
}
```

Validate `premise` length 30–1200 after trim, enum difficulty, and safety. Response **202**:

```json
{
  "caseId": "01J...",
  "status": "QUEUED",
  "statusUrl": "/api/v1/cases/01J.../status"
}
```

Require `Idempotency-Key` request header for create; store a stable hash of owner+key+payload for 24 hours. Repeated same key/payload returns the same case; same key/different payload returns `409`. Per guest allow **at most 1 active generation** and **3 case-generation starts / 24h** in MVP. Return `429` with `Retry-After` for limits.

### 11.2 Status and public case

**`GET /api/v1/cases/:id/status`** — owner only, response:

```json
{
  "caseId": "01J...",
  "status": "GENERATING_IMAGES",
  "stageLabel": "Creating photographic clues",
  "canRetry": false,
  "errorCode": null
}
```

No fake percentage. Stages: `QUEUED`, `GENERATING_BLUEPRINT`, `VALIDATING`, `GENERATING_TEXT`, `GENERATING_IMAGES`, `GENERATING_VIDEO`, `FINALIZING`, `READY`, `FAILED`. The API returns `404` for nonexistent or non-owned case IDs (avoid existence disclosure). `READY` contains no secret fields.

**`GET /api/v1/cases/:id`** — owner only. Before `READY` return `409 CASE_NOT_READY`. When ready return exact `CasePublic` DTO **plus** player's review/bookmark/hint count; after submission still return public DTO, but don't mix in secret (result has dedicated route).

**`GET /api/v1/cases`** — owner's history: paginated page size max 20; include case ID, title, difficulty, status, createdAt, whether submitted, and sanitized failure state, never hidden answer.

**`DELETE /api/v1/cases/:id`** — owner only, returns `202` and immediately revokes access; enqueues media/record deletion.

### 11.3 Evidence and progress

**`GET /api/v1/cases/:id/evidence/:evidenceId`** — owner only, returns `EvidencePublic` with no secret fact IDs.

**`GET /api/v1/cases/:id/assets/:assetId/access`** — owner only; ensure asset belongs to the case and is linked to a published evidence item. Return `{"url":"<time-limited private asset URL>","expiresInSeconds":300,"mimeType":"video/mp4"}`. Never let client supply arbitrary storage keys. Use authenticated streaming if presigned URLs are unavailable.

**`PATCH /api/v1/cases/:id/progress`** — body `{ "reviewedEvidenceIds": ["EV-01"], "bookmarkedEvidenceIds": ["EV-03"] }`; server checks each ID belongs to case, max 8, and updates atomically. After submission can still mark items reviewed/bookmarked; it cannot affect score.

### 11.4 Hints

**`POST /api/v1/cases/:id/hints`** — owner, `READY`, not submitted. Atomically increments `hintsUsed` up to 3 and returns `{"hintNumber":1,"text":"...","hintsRemaining":2}`. Calls private prewritten hint script, **not** a new Gemini call. Attempt 4 returns `409 NO_MORE_HINTS`. On retry of the same request using `Idempotency-Key`, don't spend another hint.

**`GET /api/v1/cases/:id/hints`** — returns only hints **already unlocked**, never future hints.

### 11.5 Accusation and result

**`POST /api/v1/cases/:id/solve`** — owner, `READY`, one-time. Body:

```json
{
  "suspectId": "S-03",
  "evidenceIds": ["EV-01", "EV-05"],
  "reasoning": "The badge log contradicts the alibi."
}
```

`evidenceIds` unique, 0–3. Reasoning optional up to 500 chars, saved but not LLM-scored. Validate IDs belong to current case. Atomic one-time submit, resolve against private `culpritSuspectId`, calculate deterministic score (§12), return **201** with result DTO. If already submitted return `409 ALREADY_SOLVED` and point to GET result (or idempotent same-key response). Never trust a client-supplied correct answer.

**`GET /api/v1/cases/:id/result`** — only after submission; contains culprit name and ID, success, score, motive/method/opportunity, detailed explanation, supporting evidence references, eliminated-suspect reasoning, hint count, and submittedAt. Before submission return `403 RESULT_LOCKED` without any solution.

### 11.6 Health endpoint

**`GET /api/v1/health`** — minimal public liveness; do not disclose keys, hostnames, internal service configuration. Separate internal readiness checks protected for deployment probes as needed.

## 12. Gameplay rules and scoring

The selection is **final**. Do not permit changing, resubmitting, or regenerating the answer inside an existing case.

- **Incorrect culprit:** score `0/100`, then full reveal is shown.
- **Correct culprit:** `70` base points.
- **Evidence bonus:** `+10` for each unique submitted evidence ID that appears in private `supportingEvidenceIds`, capped at `+20` total.
- **Hint bonus:** `+10` if 0 hints used; `+5` if 1 hint; `+0` if 2 or 3 hints.
- Final score capped at `100`. No grade from free-text reasoning. Scores must match deterministic tests.

**After submit:** return a concise verdict first, then expandable *How the mystery happened*, *Evidence that proves it*, *What the red herrings meant*, and *Your investigation*. Do not shame incorrect players. Display clues cited by the player and which actually supported the case.

## 13. Job processing, reliability, and state transitions

### 13.1 State machine

```text
QUEUED -> GENERATING_BLUEPRINT -> VALIDATING -> GENERATING_TEXT
     -> GENERATING_IMAGES -> GENERATING_VIDEO -> FINALIZING -> READY
           |                  |                   |
           +------------------+-------------------+----> FAILED
```

`SUBMITTED` is **player progress**, not a generation status; `CasePublic.status` maps `READY`+submitted to `SUBMITTED` for display. Underlying generation status remains `READY`.

### 13.2 Queue rules

- BullMQ job ID = immutable case ID (or stable `generate:<caseId>`). Prevent duplicate concurrent jobs.
- Worker concurrency defaults to **1** for image/video-heavy generations, configurable per tier.
- Each stage saves enough state to safely resume after worker crash (no re-creation of locked canon). Avoid redoing paid stages if validated assets already exist.
- Use backoff with jitter for 429/5xx/network failures, bounded retry counts, and account for API quota. Model safety blocks / bad prompts require user-safe failure handling.
- Never hold a browser HTTP request open throughout generation.
- User can leave preparing page and return. Status polling handles refresh and offline recovery.
- A stalled generation is marked `FAILED` via watchdog after configured maximum wall time (default 20 minutes), with internal diagnostic logging. This is a timeout policy, not a promise of a 20-minute user wait.
- Retry endpoint for failed media/worker stages: **`POST /api/v1/cases/:id/retry`**. Only case owner; no more than 2 manual retry requests. A retry uses already locked blueprint, text, and completed media when present. If blueprint stage never locked, regenerate blueprint. Do not charge or enqueue duplicates due to repeated requests.

### 13.3 Availability and graceful degradation

- If Omni model is unavailable for a valid API key, use the **AI-frame video fallback**; indicate video mode internally, show honest reconstruction labeling to player.
- If no real Gemini key in local `AI_MODE=mock`, render a deterministic fixture clearly marked demo and allow all UI flows. Real production deployment must require `AI_MODE=gemini` and pass provider health validation.
- If Redis is down, API refuses new jobs with `503 SERVICE_UNAVAILABLE`; never claim a job was queued if it was not.
- If MongoDB or object storage fails, report proper 503/5xx; do not treat partial data as published.
- If video/media is delayed, keep case in a truthful pending stage. Never reveal the answer as a workaround.

## 14. Security, privacy, and content safeguards

### 14.1 Authentication / authorization

- Anonymous **guest session** cookie identifies owner. Random 256-bit token; hash server-side; SameSite=Lax, HttpOnly, Secure on HTTPS, explicit max age.
- CSRF protection: verify Origin/Referer on state-changing requests and use appropriate CSRF defense for deployments with cross-site frontends. Strict CORS allowlist.
- Every case, evidence, progress, asset, retry, hint, and verdict endpoint must enforce ownership before lookup/response. Treat non-owner as 404.
- Rate-limit at IP and guest levels, but avoid using IP address as the sole identity.
- Never expose `case_secrets`, provider credentials, internal model outputs, or raw storage object keys.
- Store secrets in environment variables or cloud secrets manager; commit only `.env.example`.
- Validate input with Zod; sanitize any rich text; render content as text, not unsanitized HTML. Use Helmet, secure cookies, parameterized Mongo queries, and request body limits.
- No open redirects, arbitrary asset URL fetches, filesystem paths from user input, or client-specified model names.

### 14.2 Fiction / impersonation / safety

- All people and places in generated investigations should be fictionalized. If user mentions real persons, regenerate with fictional substitutes without alleging real wrongdoing.
- No generating forged actual private messages, real-person incriminating evidence, doxxing, sexual violence, graphic gore, child harm, or instructions for real wrongdoing. Mystery themes may include theft, disappearance, sabotage, and non-graphic fictional crimes.
- Make it clear every chat, picture, and video is synthetic; don't call generated reconstructions authentic CCTV leaks.
- Use a fictional messenger UI rather than copying WhatsApp trademarks. No integration with WhatsApp or use of real messages.
- Comply with Google policies and blocking decisions; never strip model safety provenance marks. Retain SynthID where provided, and add visible fiction labels.
- Limit raw prompt retention and provide per-case deletion. No public case sharing in MVP.

### 14.3 Basic security checks

Security tests must prove:

1. A second guest cannot view or delete the first guest's case/evidence/media/result (404).
2. `GET /result` and any public DTO before submission contain no culprit, secret fact IDs, hidden hints, or private explanation.
3. Guessing `assetId` is insufficient to access another player's private object.
4. Invalid IDs, huge bodies, repeated requests, HTML injection, and prompt-injection attempts are rejected safely.
5. Concurrency cannot create multiple solves, consume multiple hints for one idempotency key, or run two identical jobs.

## 15. Performance and operational requirements

- API case creation must respond with `202` quickly (target p95 under 2 seconds excluding network); generation happens in worker.
- Frontend should render initial route using code splitting and optimized assets; do not block page rendering on media downloads.
- Video transcode outputs browser-compatible H.264/AAC or silent MP4, fast-start optimized; include poster frame and transcript.
- Images have thumbnails and lazy loading. Max browser payloads are governed by config and actual provider constraints; establish media size validation in worker.
- User-visible stage status must be accurate; do not show fabricated elapsed time or completion percent.
- Budget guardrails: max **1 published CCTV** and **2 published photo evidence items** per case; allow at most **3 additional AI still frames** when generating the AI-frame CCTV fallback; max **3** total tries per stage, worker concurrency **1** by default, max **3** newly generated cases per guest per day. Track per-stage model usage and failed attempts.
- Logs: request ID, case ID, stage, latency, provider error code, fallback usage, cost estimate **only if trustworthy usage data is available**, no keys or sensitive raw content in production logs.
- Implement process signal handling and graceful queue shutdown; Redis/Mongo reconnect behavior; no background work inside a transient web request handler.

## 16. Environment configuration

Create `.env.example` including at least:

```dotenv
NODE_ENV=development
PORT=4000
WEB_ORIGIN=http://localhost:5173
API_BASE_URL=http://localhost:4000
MONGODB_URI=mongodb://localhost:27017/ai_mystery_room
REDIS_URL=redis://localhost:6379
SESSION_COOKIE_NAME=amr_guest
SESSION_SECRET=replace-with-long-random-secret
AI_MODE=mock
GEMINI_API_KEY=
GEMINI_TEXT_MODEL=gemini-3.8-flash
GEMINI_IMAGE_MODEL=gemini-nano-banana-2.1
GEMINI_VIDEO_MODEL=gemini-omni-1.1-flash
STORAGE_ENDPOINT=http://localhost:9000
STORAGE_REGION=us-east-1
STORAGE_BUCKET=ai-mystery-private
STORAGE_ACCESS_KEY=local-dev-only
STORAGE_SECRET_KEY=local-dev-only
STORAGE_FORCE_PATH_STYLE=true
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
MAX_ACTIVE_GENERATIONS_PER_SESSION=1
MAX_NEW_CASES_PER_SESSION_PER_24H=3
GENERATION_WATCHDOG_MINUTES=20
CASE_RETENTION_DAYS=30
```

Web-only variables using `VITE_` prefix may contain only **non-secret** configuration such as API base URL. Never prefix `GEMINI_API_KEY` with `VITE_`.

### 16.1 Local setup command contract

From repo root, these must function (document exact prerequisites in README):

```bash
npm install
cp .env.example .env
# Set secrets/ports as appropriate
docker compose up -d
npm run dev          # launches web, API, worker
npm run lint
npm run typecheck
npm run test
npm run build
npm run e2e
```

- The project must have package-lock and a reproducible Node version declaration (`.nvmrc` and engines).
- Add MongoDB/Redis/MinIO health checks, object-bucket bootstrap, and concise troubleshooting instructions.
- For live mode set `AI_MODE=gemini`, provide a valid `GEMINI_API_KEY`, enable billing/access as required, and verify model capability. Exact fees/limits must be checked in Google AI Studio, not promised by this spec.

## 17. Public API DTO and security boundaries

The frontend must import **only** shared public DTOs. Use distinct names to prevent accidental leaks:

- `CreateCaseRequestSchema`, `CaseStatusResponseSchema`, `CasePublicResponseSchema`, `EvidencePublicSchema`, `PlayerProgressPublicSchema`, `HintPublicResponseSchema`, `SolveRequestSchema`, `VerdictResponseSchema`.
- Server-only `PrivateBlueprintSchema`, `CaseSecretSchema`, `CanonicalFactSchema`, `GenerationEventSchema` in worker/API-private modules; they are **not exported through client-resolvable shared entrypoints**.
- `CasePublicResponseSchema` should be generated by explicit `pick`/manual mapping from the database, **not** `Case.toJSON()` with `delete secret`.
- Integration test recursive JSON values to ensure forbidden keys (`culpritSuspectId`, `solution`, `canonicalFacts`, `hintTexts`, `supportingEvidenceIds`, `verdictExplanation`, `suspectEliminationReasons`, `redHerringExplanations`, `evidenceFactMap`) are absent before submission.

## 18. Acceptance tests (definition of done)

### 18.1 Required automated flows

| Test | Given / action | Expected |
|---|---|---|
| A01 | New guest visits landing | Hero, examples, navigation render and are keyboard usable. |
| A02 | Submit empty, 29-char, or over-1200-char prompt | Inline error; no job created. |
| A03 | Submit valid premise + medium | 202, persisted case ID, preparation route, durable status changes. |
| A04 | Worker builds mock/test case | Exactly 4 suspects, 8 evidence of prescribed types, one locked culprit. |
| A05 | Open chat/photo/CCTV/document viewers | Text readable, images load, video playable, generated-label displayed. |
| A06 | Reload investigation | Same suspect/evidence IDs and progress; no regeneration. |
| A07 | Request hints 1–3 | Distinct correct ordered hints, proper count, no early answer. |
| A08 | Request hint 4 | Error, no extra hints or count changes. |
| A09 | Submit correct suspect + 2 support clues, no hints | Score 100; correct verdict and explanation. |
| A10 | Submit correct suspect + no evidence, 1 hint | Score 75. |
| A11 | Submit incorrect suspect | Score 0; fixed intended answer shown, no new AI decision. |
| A12 | GET result before solve | 403 and zero secret leakage. |
| A13 | Inspect case/status/evidence before solve | No private solution keys anywhere in API responses. |
| A14 | Second guest opens first guest's cases/asset | 404/denied. |
| A15 | Submit solve twice/race requests | Exactly one stored result; no double score updates. |
| A16 | AI text response malformed | Revalidate/regenerate boundedly or mark FAILED; never publish bad canon. |
| A17 | Video provider fails, still-frame AI works | Fallback AI-frame MP4 generated with correct label/transcript. |
| A18 | Video and frame provider both fail | FAILED, retry available; no READY with missing clip. |
| A19 | Retry after worker crash | Reuses locked canon/assets, job idempotent, eventual consistent state. |
| A20 | Delete owned case | Access revoked and records/media scheduled for cleanup. |
| A21 | Phone viewport 390px wide | Prompt, tabs, all viewers, hints, accusation and result remain usable. |
| A22 | Mock provider mode | Clearly labeled `Demo Mode`; complete end-to-end test passes without Google API access. |
| A23 | Live provider smoke test (credentials available) | One original scenario creates real AI photo and Omni/fallback CCTV with no runtime exceptions. |

### 18.2 Unit/integration test targets

- All Zod contracts; cross-reference checks; timeline monotonicity; evidence-count and clue-coverage checks; prompt-injection defensive behavior.
- Scoring function for all hint counts, wrong/correct suspects, duplicate/missing supporting evidence.
- Cookie, owner middleware, case deletion, signed asset authorization, input limit and CSRF/origin checks.
- Stage transitions, idempotent create/retry/hints/solve, worker error and recovery paths, storage failure modes.
- Fake or offline AI provider can be injected without changing controllers.
- AI fixture tests include at least 3 diverse prompts: theft, disappearance, and sabotage.
- Playwright desktop + mobile E2E with deterministic mock fixtures. Use `axe` or equivalent accessibility checks for form, dialog, and evidence viewer.

### 18.3 Manual QA checklist

- [ ] Every navigational button or tab reaches a real working feature.
- [ ] Every image/video is viewable and has an appropriate label.
- [ ] At least one realistic fully generated case has a coherent explanation.
- [ ] User can understand why the correct suspect is guilty without hidden data.
- [ ] No invented timestamps, inconsistent names, or impossible alibis.
- [ ] Result is gated; direct route guessing does not reveal the solution.
- [ ] Refresh, back navigation, browser resizing, and slow network do not lose session.
- [ ] No API key, raw prompt, solution, or credentials visible in frontend bundle/network payloads.
- [ ] All loaders, retries, rate-limit states, and deletion states have useful copy.
- [ ] `npm run lint`, `typecheck`, `test`, `build`, `e2e` pass.

## 19. Example case to use for acceptance tests

**User premise:** "At a fictional university festival, a trophy disappears from a locked backstage room minutes before the awards. Four organizers had access."  
**Fixed, test-only solution:** `S-03` — fictional logistics coordinator.  
**True facts:** An access-card log places S-03 at the room after their claimed departure; an earlier fictional message shows they borrowed the key; the CCTV reconstruction places a matching distinctive bag moving down the back corridor; the trophy was hidden in equipment.  
**Red herrings:** S-01 openly argued about the prize but was onstage during the incident; S-02 had a spare key but returned it earlier; S-04 sent an angry message unrelated to the theft.  
**Proof chain:** `EV-01` chat plus `EV-05` CCTV plus `EV-07` access log, backed by timestamped facts.  
**Test verdict:** S-03 stole the trophy; opportunity + borrowed key + corridor timeline break the alibi.  

This fixture belongs to **mock mode and tests only**. Live cases must be original, diverse, and generated from user input. Never ship the same culprit/script for all live premises.

## 20. Implementation order and deliverables

Implement incrementally in this order; after each phase, run relevant tests. Do not spend all effort on visual design while backend gameplay remains stubbed.

**Phase 1 — Repository and platform**
- Create monorepo, TypeScript configs, shared Zod DTOs, lint/format scripts, React app, Express app, worker entrypoint, Docker Compose dependencies, environment validation, and README.
- Guest session creation, cookie auth, route navigation, Mongo connection, storage abstraction, and initial UI shell.

**Phase 2 — Game data and deterministic end-to-end skeleton**
- Mongoose schemas, ownership checks, case creation/status/list/delete/progress, queue and worker state machine.
- `MockAIProvider` that creates a coherent, schema-valid fixture, deterministic mock image/video assets clearly marked `Demo Mode`.
- Functional investigation and verdict UI, hint API, one-time solve, scoring, session history.
- E2E tests prove the full flow without a Gemini key.

**Phase 3 — Gemini storytelling**
- Gemini provider text model, versioned prompts, structured JSON, schema/semantic/solver validation, immutable canon, chat and document generation.
- Stage-level retry/telemetry and secret leakage tests.

**Phase 4 — AI stills and CCTV**
- Gemini image creation, media storage, thumbnails, signed access, Omni-generated video, ffmpeg overlays, fallback from AI-generated stills, transcripts, media validation.
- Integration + smoke tests with real credentials when provided.

**Phase 5 — Product polish and hardening**
- Final cinematic styling, animations respecting reduced motion, responsive workspace, keyboard/ARIA improvements, loading/error states, performance optimization, abuse limits, cleanup job, README deployment instructions.
- Full lint/typecheck/test/build/E2E run.

### 20.1 Final repository deliverables

- Running `apps/web`, `apps/api`, `apps/worker` with source code (not empty scaffolding).
- Shared types/Zod validators and both AI providers.
- All MongoDB models and fully implemented API routes.
- Real image/video pipelines with documented mock/live behavior and fallback.
- Prompt templates and a coherent test-only fixture.
- Docker Compose and `.env.example` without credentials.
- Unit/API/E2E tests and passing build scripts.
- README: architecture, setup, provider configuration, execution, cleanup, security, known external-service constraints, deployment guidance.
- Existing `spec.md` retained unchanged unless owner explicitly approves a change; report any implementation deviations.

## 21. Locked decisions / assumptions

These values are **decisions**, not questions Codex should ask before proceeding:

| Topic | Decision |
|---|---|
| Account access | Anonymous guest cookie; no sign-up. |
| Language | English only. |
| Difficulty | Easy / Medium / Hard, default Medium. |
| Suspects | Exactly 4, one culprit. |
| Evidence pack | Exactly 8: 2 chat, 2 photo, 1 CCTV, 3 document. |
| Case editing | Not allowed after submission; regenerate as new case. |
| Hints | 3 sequential, precomputed from locked canon. |
| Accusation | One final selection; optional 0–3 evidence citations + reason text. |
| Scoring | Deterministic §12; no AI re-grading. |
| Generation | Asynchronous durable worker. |
| Video | Gemini Omni preferred; AI-generated frames → MP4 fallback. |
| Storage | MongoDB for structured state, private object storage for media. |
| Retention | 30 days, plus owner delete. |
| Sharing | Not in MVP. |
| Real messages | Never fetched; simulated only. |
| Deployment | Environment-agnostic; frontend/API/worker independently deployable. |
| Local demos | Explicit `Demo Mode` only; production requires Gemini. |

## 22. Documentation and external references

Technical choices were checked against Google documentation on **2026-10-28**. Reverify available model IDs, SDK syntax, quota/billing, and permitted usage against docs before deployment:

- Gemini structured JSON output: https://ai.google.dev/gemini-api/docs/structured-output
- Gemini image generation: https://ai.google.dev/gemini-api/docs/image-generation
- Gemini video / deprecated Veo notices: https://ai.google.dev/gemini-api/docs/video
- Gemini Omni Flash video generation: https://ai.google.dev/gemini-api/docs/omni
- Gemini safety settings: https://ai.google.dev/gemini-api/docs/safety-settings
- Gemini rate limits: https://ai.google.dev/gemini-api/docs/rate-limits
- Official SDK repository: https://github.com/googleapis/js-genai

**Implementation note:** The official SDK's Interactions API examples currently use `new GoogleGenAI({})`, `ai.interactions.create({ model, input, ... })`, `interaction.output_text` for text and `interaction.output_image` / `interaction.output_video` for media. Validate these signatures against the installed pinned SDK version rather than copying legacy `generateVideos`/Veo preview snippets.

---

## 23. FINAL DEFINITION OF DONE

**The project is complete only when:** a player opens the website, enters their own fictional premise, receives a genuinely Gemini-generated four-suspect mystery, opens all eight generated evidence items (including two images and one playable AI-generated CCTV reconstruction), can track reviewed items and use hints, submits one accusation, and sees the correct fixed verdict and explanation; the workflow persists through refresh, is owner-protected, handles external AI failures, and passes the automated checks above. A landing page, mock-only prototype, nonfunctional media, or hardcoded answer is **not** a completed AI Mystery Room.

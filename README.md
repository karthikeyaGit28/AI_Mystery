# AI Mystery Room

A single-player detective game that turns a fictional premise into a case with four suspects, eight evidence items, and one immutable answer. The investigation includes fictional messaging threads, two photos, a playable surveillance reconstruction, documents, a public timeline, bookmarks, hints, and a final accusation.

`spec.md` is retained unchanged as the implementation baseline.

For production deployment, follow **[DEPLOYMENT.md](DEPLOYMENT.md)**. The supplied
Blueprint uses one **Render Free** container for the website/API and worker,
**Atlas Free**, **Upstash Redis Free**, and private **Supabase Free Storage**.
Real AI uses Gemini's free text tier plus Cloudflare Workers AI Free images;
CCTV is compiled from AI-generated frames. Quotas and host sleep apply.

After collecting the nine cloud settings in the guide, run
`npm run configure:free`, `npm run deployment:preflight`, and
`npm run deployment:validate` before pushing. Preflight checks configuration
formats offline without printing secrets or consuming AI quota; it cannot
verify provider account plans or whether credentials work.

## Start locally

Prerequisites: Node.js **22.23.4** (the tested runtime; see `.nvmrc`), npm, and Docker Desktop with Compose. The npm media packages provide ffmpeg and ffprobe for supported platforms; set absolute `FFMPEG_PATH` / `FFPROBE_PATH` values to use your own binaries.

```sh
npm install
cp .env.example .env
docker compose up -d
npm run infra:check
npm run dev
```

On PowerShell, use `Copy-Item .env.example .env` instead of `cp` if preferred. `scripts/dev.ps1` can start the app using a project-local portable Node runtime when one exists in `.tools`.

Open **http://localhost:5173**. The API listens on port 4000; the worker runs as a separate process. MongoDB uses port 27017, Redis 6379, and MinIO 9000 (console: 9001). Compose binds services to loopback, initializes the private bucket, and persists data in named volumes. The example storage credentials are for local development only.

The default `AI_MODE=mock` needs no Google key. Its header, images, and video visibly identify **Demo Mode**. It runs the complete persistent game with deterministic test cases and actual playable test media; it does not claim to generate live AI evidence.

## Enable live AI with free providers

The Gemini Interactions integration requires the official `@google/genai` SDK
version **2.0.0 or newer**. Install dependencies from this repository's updated
lockfile; Google has retired the legacy 1.x Interactions protocol. The offline
runtime check verifies this minimum version before deployment.

Edit your untracked `.env`:

```dotenv
AI_MODE=gemini
FREE_TIER_ONLY=true
MEDIA_PROVIDER=cloudflare
GEMINI_API_KEY=your-key-from-google-ai-studio
GEMINI_TEXT_MODEL=gemini-3.8-flash
CLOUDFLARE_ACCOUNT_ID=your-cloudflare-account-id
CLOUDFLARE_API_TOKEN=your-workers-ai-token
CLOUDFLARE_IMAGE_MODEL=@cf/black-forest-labs/flux-1-schnell
```

Run `npm run configure:free` to apply the guarded free-mode flags while preserving
your secret values and `AI_MODE`. Keep the Google API project unbilled and the
Cloudflare Workers plan Free. The code blocks Gemini photo/video calls in free
mode and only permits the configured free text/image models. Provider-side
billing tiers cannot be inspected or disabled by the app.

An optional `npm run provider:check -w @amr/worker -- --full` verifies real case,
photo, and AI-frame video generation locally and consumes free quotas. Free
worker cold starts perform an offline SDK/config check rather than repeatedly
spending AI requests. The first live case verifies provider access. All provider
calls stay on the server; browser variables must never contain API secrets.

Cloudflare generates actual photos and surveillance frames. The free profile
compiles those frames into a labeled 640×360 H.264 MP4 with authored camera/time
overlays, captions, and a transcript. Quota exhaustion fails safely for a later
retry; it does not enable paid motion video or substitute unrelated footage.

Official references: [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing),
[Cloudflare Free AI](https://developers.cloudflare.com/workers-ai/platform/pricing/),
[FLUX model](https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/).

## Architecture

```text
apps/web         React 19 / Vite / Router / TanStack Query
apps/api         Express REST / guest ownership / hints / scoring
apps/worker      BullMQ / Gemini text / Cloudflare images / mock / media / cleanup
packages/shared  Public Zod contracts and TypeScript DTOs only
packages/server  Private Mongoose models, configuration, queues, S3 storage
e2e              Playwright desktop and mobile journeys
```

The API persists cases in MongoDB and enqueues durable Redis jobs. Generation constructs and validates a private blueprint, has an independent reviewer solve the public clues, freezes the solution, renders evidence from canonical facts, validates media, and publishes only a complete case. Worker checkpoints reuse the locked blueprint, text, frames, and completed media after retries or crashes. No LLM is called to decide the verdict.

Each case has exactly two chats, two photos, one CCTV reconstruction, and three documents. Three or more supporting clues span at least two modalities. The public package excludes private schemas and solution information. Public responses are built from explicit allowlists and validated again before being returned.

Scoring: a wrong suspect scores 0; a correct suspect scores 70 plus 10 per unique supporting citation (maximum 20), plus a hint bonus of 10/5/0 for zero/one/two-or-three hints. Optional free-text reasoning is retained but not graded. The final accusation is atomic and cannot be changed.

## Commands and verification

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run e2e:install
npm run e2e
```

The first five checks run without Google credentials. Media tests execute the real ffmpeg pipeline. API tests exercise ownership, DTO secrecy, invalid inputs, cookies/origins, hints, races, and deterministic scoring through injected test infrastructure. Browser tests require the real local MongoDB/Redis/private-storage services and exercise desktop and phone layouts, evidence loading, video playback, refresh persistence, hints, accusation, score, and deletion. Playwright uses Demo Mode and never spends Google API credits. Set `PLAYWRIGHT_CHANNEL=chrome` to use an installed Chrome instead of downloading Playwright Chromium.

For environments without Docker, the optional `npm run services:test` starts a real downloaded MongoDB process, an installed native Redis executable, and a filesystem S3 test server. Set `TEST_REDIS_BINARY` to your Redis executable (or place a portable build in `.tools/redis`). Run the app and browser tests with `STORAGE_ACCESS_KEY=S3RVER` and `STORAGE_SECRET_KEY=S3RVER`. This infrastructure is for tests only and must not be exposed publicly. Native test dependencies never replace the production MongoDB/Redis/S3 architecture.

On this Windows workspace, the portable Node and Redis binaries are already available. To run the local demo without Docker, use two PowerShell terminals:

```powershell
# Terminal 1: local test infrastructure
$env:Path = "$PWD\.tools\node-v22.23.4-win-x64;$env:Path"
npm.cmd run services:test

# Terminal 2: app, API, and worker
$env:STORAGE_ACCESS_KEY = 'S3RVER'
$env:STORAGE_SECRET_KEY = 'S3RVER'
.\scripts\dev.ps1
```

The free deployment checks cover provider/model guards, quota handling, bounded image responses, request pacing, process supervision, and real ffmpeg compilation of mocked provider images. Hosted browser checks cover the compiled application on desktop and mobile, including the Free AI mode banner and private-file isolation. External AI calls and cloud credentials require your accounts; Linux container verification runs in GitHub CI because Docker is unavailable in this workspace.

Verified on 2026-10-30: all 182 automated tests, including 25 offline deployment-input checks and SDK 2 request serialization, passed. The 14 hosted browser checks passed, plus formatting, lint, TypeScript, production builds, Blueprint validation, and offline runtime checks.

Implementation choices: the interface uses tokenized CSS and accessible native dialogs instead of Tailwind/Radix. Private media uses authenticated, signed, expiring streaming URLs rather than exposing object-store URLs; the specification explicitly permits authenticated streaming. Production deployment is prepared in `render.yaml` and `Dockerfile`; creating cloud resources remains an account setup step in the deployment guide.

## API and ownership

REST endpoints use `/api/v1`. Call `POST /sessions/guest` first. Browser requests include the HTTP-only guest cookie; mutating requests must originate from `WEB_ORIGIN`. Create, hints, and solve use `Idempotency-Key` headers. Routes cover case creation/list/status/retry/deletion, public case/evidence, progress, unlocked hints, one-time solve, and gated result. `GET /config` exposes only public provider/profile flags; `/health` is minimal liveness.

Guest tokens contain 256 bits of randomness; only hashes are stored. Sessions slide for 30 days. Every case and media operation checks ownership, returning 404 to other guests. Media access is authenticated, short-lived, supports byte-range playback, and is revoked when the case is deleted. Keys, raw storage paths, private facts, future hints, and provider outputs do not appear in public case DTOs. CORS, origin checks, strict input limits, security headers, and rate limits are enabled. For a cross-site frontend deployment, add a deliberate cross-site cookie/CSRF configuration; the default is a same-site deployment.

The free Render profile allows one active generation and one start per guest in a rolling 24 hours; local defaults allow three starts. Stages use bounded retries and a 20-minute watchdog. The owner can manually retry a failed case at most twice. Cases and their private media expire 30 days after creation; maintenance performs cascading cleanup. Owner deletion revokes access immediately and schedules cleanup, with periodic recovery if enqueueing fails.

## Deployment and troubleshooting

Build with `npm ci && npm run build`. With `SERVE_WEB=true`, Express serves only
`apps/web/dist`, including the SPA route fallback; API misses keep JSON 404s.
This is the same-origin setup used by [the Render deployment](DEPLOYMENT.md).
`TRUST_PROXY_HOPS` defaults to 0 locally and is set to 1 behind Render's edge.
The API and worker run as separate processes in one free container; the image retains the
`tsx` runtime, workspace source, and worker prompts while pruning dev dependencies.
Run the worker as a persistent service, never inside a serverless HTTP request.
Use the free managed services and private storage listed in the deployment guide.
Production requires HTTPS origins, a strong `SESSION_SECRET`, Gemini/Cloudflare
credentials, and `AI_MODE=gemini`. `FREE_TIER_ONLY=true` enforces the model/provider
allowlist, one worker, lower media limits, and lower-memory processing.
Your local `.env` is excluded from the container and does not configure Render.

- **Queue unavailable:** start Redis and check `REDIS_URL`; no successful queue response is fabricated.
- **Private media fails:** check the bucket bootstrap, S3 endpoint/region/credentials, and worker logs. Restarting does not regenerate a locked solution.
- **Media tools unavailable:** npm must install the matching platform binaries; set explicit ffmpeg/ffprobe paths if your platform needs system packages.
- **Gemini capability denied:** verify the key, billing, model ID, and account permissions. The app reports a safe failure; it does not silently switch live mode to demo.
- **A guest case disappears:** cookies identify the owner. Another browser profile cannot access it. Cases also expire after 30 days.
- **OneDrive/Windows tool access:** development tools may need normal filesystem access to resolve parent directories. Stop running processes before moving a synchronized checkout.

No live Gemini verification is claimed without external credentials. The included test fixture fixes S-03 only in Demo Mode/tests; live cases use the generated immutable culprit. The MVP remains English-only and single-player, without accounts, payments, sharing, uploads, or live interrogation.

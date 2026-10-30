# Deploy using only free plans

The default deployment now uses **one Render Free web service** with external
free databases/storage and free AI allocations. The previous paid Render worker,
paid Render queue, and R2 setup are removed from this deployment.

This code change does not cancel any cloud resources you may already have
created. Review existing subscriptions separately; the new Blueprint creates
only the one Free service described below.

| Component            | Free service                               | What it does                                       |
| -------------------- | ------------------------------------------ | -------------------------------------------------- |
| Website, API, worker | Render Free Docker web service             | Two supervised Node processes share one container  |
| Case records         | Your existing MongoDB Atlas Free cluster   | Private canon, progress, guest sessions            |
| Durable job queue    | Upstash Redis Free                         | BullMQ jobs and recovery after host restarts       |
| Private files        | Supabase Free Storage                      | Photos, AI frames, thumbnails, MP4 recordings      |
| Story and text clues | Gemini 3.8 Flash API free tier             | Canon, blind review, chats, documents              |
| Generated images     | Cloudflare Workers AI Free, FLUX.1 Schnell | Two actual generated photos plus CCTV stills       |
| CCTV                 | Local ffmpeg in the free container         | A playable 360p reconstruction from real AI frames |

The four-suspect/eight-evidence game remains intact. To satisfy your newer
free-only requirement, **Cloudflare replaces Gemini for image generation** and
CCTV always uses the specified AI-frame fallback. This provider change is
intentional; `spec.md` remains unchanged. These are real generated images, not
Demo Mode fixtures.

## What “free” means here

Use each provider's actual **Free** plan/account, not a paid plan with introductory
credits. No automatic paid fallback is implemented. The code pins supported
free AI models and blocks direct Gemini photo/video calls in free mode.

Account billing remains under your control: code cannot inspect or disable a
provider's billing account. Use a Gemini API project **without paid billing** and
Cloudflare **Workers Free**. Keep the Upstash account without a payment method:
its current policy automatically converts free resources to pay-as-you-go when
a payment method is added. See [Upstash's upgrade policy](https://upstash.com/docs/redis/howto/upgrade-database).

Keep Render without a payment method as well: its Free resource overages can
then suspend service rather than charge for extra usage. See [Render's Free limits](https://render.com/docs/free).

Free quotas can stop generation or suspend a service. They do not provide an
unlimited, always-on production SLA. This walkthrough does not require upgrading
or entering payment details to bypass an exhausted quota.

## Where to save the values

Complete steps 1-5 first. As you collect credentials, save them privately in the
root `.env` that is already open in your editor. Replace an existing setting
rather than adding a second line with the same name. Do not replace your entire
`.env` or share it in chat.

In step 7, copy the nine collected values into Render's secret input fields.
Your local `.env` is ignored by Git and excluded from the Docker image; it does
not automatically become Render's environment. The Blueprint supplies the other
production settings, including a generated session secret and public HTTPS URLs.

## 1. Keep MongoDB Atlas Free

Your existing active Free cluster is suitable; you do not need another cluster.

1. In Atlas, select your `AI_Mystery` project and `Cluster0`.
2. If you need the URI again, use **Connect / Get connection string**, then choose
   the JavaScript / Node.js driver connection method.
3. Replace `<db_password>` with the password for your **database user**, not the
   password you use to log in to Atlas. URL-encode special characters in that
   password before inserting it into the URI.
4. Put `ai_mystery_room` immediately after the host's `/`, as shown below.
5. Save the complete URI as `MONGODB_URI` in your local `.env`.

```text
mongodb+srv://<database-user>:<encoded-password>@<cluster-host>/ai_mystery_room?retryWrites=true&w=majority
```

If the database user does not exist, create one under **Database & Network
Access**, in the database-user section, with read/write access to this
application's database. The app creates its collections when it connects; you
do not need to create them in Data Explorer.

Network access is a separate step. After Render creates the service, add its
outbound IP ranges in step 7. See [Atlas IP access lists](https://www.mongodb.com/docs/atlas/security/ip-access-list/).

## 2. Create Supabase Free storage

1. Open [Supabase](https://supabase.com/dashboard), sign in, and choose **New
   project** in a **Free** organization. Name it `ai-mystery-storage` and choose
   a nearby region. Supabase may ask for a database password while creating the
   project; that password is not used by this app's storage client.
2. Wait for the project to become ready, then open **Storage** and create a
   bucket named **`ai-mystery-private`**.
3. Keep **Public bucket OFF**. Default file-type and size settings are suitable.
   If you set custom restrictions, permit JPEG, PNG, WebP and MP4 files and allow
   files up to at least 20 MiB.
4. Open [Storage S3 configuration](https://supabase.com/dashboard/project/_/storage/s3)
   for this project. Generate an S3 **Access Key ID** and **Secret Access Key**.
5. Copy the S3 endpoint and the exact project region displayed on that page:

   ```text
   https://<project-ref>.storage.supabase.co/storage/v1/s3
   ```

6. Save these four values in `.env`: `STORAGE_ENDPOINT`, `STORAGE_REGION`,
   `STORAGE_ACCESS_KEY`, and `STORAGE_SECRET_KEY`. Keep
   `STORAGE_BUCKET=ai-mystery-private` and `STORAGE_FORCE_PATH_STYLE=true`.

Use the generated S3 pair, rather than the Supabase database password or an
`anon`/`service_role` API key. The app still stores its case records in Atlas;
Supabase supplies private file storage only. The S3 credentials stay on the
server, and owner-checked API routes stream the files to players.

Supabase Free currently includes 1 GB of files and limited egress; inactive
projects may pause. S3 support is documented without a paid-plan restriction,
but credential issuance has not been tested in your account. Sources:
[Free plan](https://supabase.com/pricing), [S3 credentials](https://supabase.com/docs/guides/storage/s3/authentication),
[S3 operations](https://supabase.com/docs/guides/storage/s3/compatibility).

## 3. Create an Upstash Redis Free database

1. Open [Upstash](https://console.upstash.com/), select **Redis**, and create a
   database named `ai-mystery-queue` on the **Free** plan.
2. Choose an available free region near the Render region if possible.
3. Keep eviction disabled, so queued jobs are not silently evicted.
4. Open the database's connection details. Copy its **Redis/TLS connection URL**,
   which starts with `rediss://`. If the console shows a `redis-cli` command,
   copy only the URL, without `redis-cli`, `--tls`, or surrounding shell syntax.
   Do not use the HTTP REST URL or REST token:

   ```text
   rediss://default:<password>@<redis-host>:6379
   ```

5. Save that complete URL as `REDIS_URL` in `.env`.

This becomes `REDIS_URL`. Do not add a payment method or upgrade the account for
this free-only setup. The advertised free allocation is 250 MB and 500K commands
per month. The app uses slower idle polling, but actual command usage still needs
monitoring. Sources: [Free limits](https://upstash.com/pricing/redis),
[BullMQ support](https://upstash.com/docs/redis/integrations/bullmq),
[persistence](https://upstash.com/docs/redis/features/durability).

## 4. Use Gemini's free text API

1. Open [Google AI Studio's API Keys page](https://aistudio.google.com/apikey)
   and sign in with your Google account.
2. Select or create a project **without paid billing**. If you already have a
   suitable restricted Gemini key in that project, you can keep using it.
3. Otherwise choose **Create API key** for that project and copy the key.
4. Save it as `GEMINI_API_KEY` in `.env`. Leave
   `GEMINI_TEXT_MODEL=gemini-3.8-flash`.

The configured text model currently has a free tier. Do not enable billing
to bypass rate limits. Current key setup is documented in
[Google's API key guide](https://ai.google.dev/gemini-api/docs/api-key).

The app spaces text calls 15 seconds apart in the free profile. A complete case
needs several calls, so generation can take minutes. Your account's actual
request/token limits determine how many cases can be generated. Quota errors
stop the case with a readable retry-after-reset message.

Cold starts check SDK/configuration locally and defer AI network validation to
case generation, so passive visits do not consume your free text allowance.

Gemini's configured image and motion-video models have no API free tier, so
the free profile never calls them. See [Google's API pricing](https://ai.google.dev/gemini-api/docs/pricing).

## 5. Enable Cloudflare Workers AI Free

This step is **Workers AI**, not R2 storage. No R2 subscription is needed.

1. Open the [Cloudflare dashboard](https://dash.cloudflare.com/) and go to **Workers AI**.
2. Keep the Workers plan **Free**.
3. Select **Use REST API → Create a Workers AI API Token**.
4. Use the provided token template, then copy the token and **Account ID**.
5. Save them as `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in `.env`.
   Account ID is a 32-character hexadecimal identifier. Use the account ID shown
   by Workers AI, rather than a website's zone ID.

The allowlisted model is `@cf/black-forest-labs/flux-1-schnell`. The app uses it for
photos and two surveillance frames, then creates the labeled MP4 locally.
Workers Free includes a daily allocation; requests fail at the limit unless you
upgrade. This deployment does not upgrade or switch providers automatically.

Official sources: [REST setup](https://developers.cloudflare.com/workers-ai/get-started/rest-api/),
[FLUX model](https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/),
[Free quota](https://developers.cloudflare.com/workers-ai/platform/pricing/).

## 6. Check your settings and push the updated code

Open a new PowerShell terminal at the project root and run:

```powershell
cd "C:\Users\Dell\OneDrive\Desktop\NW\AI Mystery Room"
$env:Path = (Resolve-Path ".\.tools\node-v22.23.4-win-x64").Path + ";" + $env:Path
npm.cmd run configure:free
```

`configure:free` applies the free provider/model limits and adds missing
Cloudflare key fields. It preserves your existing secret values, database/storage
settings, and `AI_MODE`; it does not create provider accounts or fill credentials.

Make sure the nine values from steps 1-5 are saved in `.env`, then run:

```powershell
npm.cmd run deployment:preflight
npm.cmd run deployment:validate
```

Preflight reports setting names and fixed instructions without printing your
secret values. It checks the formats used by this free deployment, including
Atlas, Upstash TLS, Supabase S3, and Cloudflare's account ID. Fix every reported
setting before continuing. It makes no network calls and spends no AI quota;
a pass does not verify account plans, valid credentials, bucket privacy, or live
connectivity. Local `AI_MODE=mock` is allowed because Render sets its own live
mode automatically. Existing PowerShell environment variables take precedence
over `.env`; use a new terminal to avoid old local-test overrides. A region or
key that passes a format check still needs to match the provider's actual value.

Use GitHub Free with paid Actions usage disabled. The workflow uses standard
Linux runners, which are free for public repositories; private repositories have
limited included compute/storage. Without a payment method, additional compute
is blocked after the allowance is exhausted. If your account already enables
paid usage, configure a zero-spend Actions budget with **Stop usage when budget
limit is reached** before pushing. Keep the repository's current visibility.
See [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
and [hard budgets](https://docs.github.com/en/billing/how-tos/set-up-budgets).

After both checks pass, use the same PowerShell terminal:

```powershell
git ls-files .env
```

That command should print nothing. Then commit and push:

```powershell
git add .
git commit -m "Switch deployment to free service plans and AI providers"
git push origin main
```

Keep credentials in your local `.env` or provider secret settings. The Blueprint,
container, and CI files are tracked; downloaded tools, test results, and `.env`
are not. If `origin` is not configured, create an empty GitHub repository and
follow GitHub's instructions to add it as the remote, then push this project's
current branch. Do not change an existing remote merely because a push fails.

## 7. Create exactly one free Render service

1. Open [Render](https://dashboard.render.com/) and choose **New → Blueprint**.
2. Select this GitHub repository and its `main` branch.
3. Use the root `render.yaml` with the repository root as the Docker context.
4. Confirm that the preview contains **only `amr-web`, plan Free**. It must not
   contain a paid background worker, managed queue, database, or disk.
5. Enter the requested values from your local `.env`. In Render's value fields,
   paste only the actual value, without `KEY=`, example placeholders, or the
   surrounding quotes you may have used in `.env`:

   | Render setting          | Source                                 |
   | ----------------------- | -------------------------------------- |
   | `MONGODB_URI`           | Atlas Free connection string           |
   | `REDIS_URL`             | Upstash Free Redis/TLS URL             |
   | `GEMINI_API_KEY`        | Unbilled Gemini text API project       |
   | `CLOUDFLARE_ACCOUNT_ID` | Workers AI account ID                  |
   | `CLOUDFLARE_API_TOKEN`  | Workers AI REST token                  |
   | `STORAGE_ENDPOINT`      | Supabase S3 endpoint                   |
   | `STORAGE_REGION`        | Exact region from Supabase S3 settings |
   | `STORAGE_ACCESS_KEY`    | Supabase S3 Access Key ID              |
   | `STORAGE_SECRET_KEY`    | Supabase S3 Secret Access Key          |

6. Create the Free service without adding paid resources. Session secret and
   public URLs are wired automatically.
7. Once the service appears, open the service's **Connect → Outbound** tab and
   copy **all** its listed CIDR ranges, including their `/` suffixes.
8. Return to Atlas: **Security → Database & Network Access → IP Access List**
   (some dashboards label this **Network Access**). Choose **Add IP Address**,
   paste one Render range, add a label such as `Render`, and confirm. Repeat for
   every listed range and wait for the entries to become active.
9. Return to Render. If the first deploy failed while the IP entries were being
   added, choose **Manual Deploy → Deploy latest commit**.

The local `.env`'s `NODE_ENV`, `PORT`, `WEB_ORIGIN`, `API_BASE_URL`, and
`SESSION_SECRET` should not be copied into this Blueprint's secret fields. It
already configures production values. You do not need Docker Desktop installed
locally for Render to build the Dockerfile.

The worker is a second supervised process inside the same container. Both share
the free host's CPU/memory, with one generation at a time. Redis/case data/media
remain external, so host restarts can resume locked cases.

Sources: [Render Free](https://render.com/docs/free),
[outbound addresses](https://render.com/docs/outbound-ip-addresses).

## 8. Verify using the website and logs

Render Free does **not** provide dashboard Shell/SSH or one-off jobs. Use its
logs and the website:

1. Wait for GitHub's code/container checks and the Render deployment.
2. Logs should show **AI Mystery Room API ready** and **Worker ready**.
3. Open the assigned HTTPS `onrender.com` URL. The header should show **Free AI mode**.
4. Open `/api/v1/health` and confirm `{"status":"ok"}`.
5. Create one case. Inspect all eight artifacts, play the CCTV reconstruction,
   refresh, use a hint, and submit an accusation.
6. Check the provider dashboards for remaining free usage.

For an optional local provider check, configure your local `.env` with the same
free-account credentials and run `npm run configure:free`, then set `AI_MODE=gemini`
and run `npm run provider:check -w @amr/worker -- --full`. This consumes free quotas;
do not run it repeatedly alongside the live worker.

## If a deployment step fails

If the Blueprint page shows only **Retry**, read the error above its YAML
preview. Render checks plan-specific restrictions in addition to the official
JSON schema used by the local validator. Keep credentials in the dashboard's
secret inputs when setup resumes.

| Symptom                                                      | Next action                                                                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd` is not recognized                                  | Run the PowerShell `$env:Path` line in step 6 in that same terminal.                                                                        |
| Preflight names a missing/invalid setting                    | Replace that one `.env` value using its provider dashboard; save and rerun preflight.                                                       |
| `WORKER_DATABASE_UNAVAILABLE` / API database startup failure | Recheck the Atlas URI, encoded database password, and every Render outbound CIDR in Atlas.                                                  |
| `WORKER_STORAGE_UNAVAILABLE`                                 | Check the Supabase project is active, bucket exists, endpoint ends in `/storage/v1/s3`, region matches, and keys are the generated S3 pair. |
| Queue startup failure                                        | Recopy Upstash's `rediss://` URL, including its password; check the database is Free and within quota.                                      |
| Case reports free AI quota exhausted                         | Wait for the provider's reset, then retry the saved case; keep paid billing disabled.                                                       |
| Home page works but a case fails                             | Check both API and worker logs; the health URL alone does not test AI generation.                                                           |
| First page load is slow                                      | Allow Render's Free service to wake, then retry the page.                                                                                   |

## Free-service limits

- Render sleeps after 15 minutes without inbound traffic and can take time to
  wake. Keep the preparation page open during generation. Do not add artificial
  keepalive pings to bypass free hosting restrictions.
- Render's filesystem is ephemeral. Only temporary media uses local disk.
- Atlas Free and Upstash Free have storage/connection/command limits. BullMQ
  polling counts against Redis usage even when no new case is generated.
- Supabase Free has a 1 GB file allocation and limited egress and may pause
  inactive projects. Delete old cases when necessary; uploads fail safely at limits.
- Google and Cloudflare enforce free AI quotas. If exhausted, wait for reset;
  there is no automatic paid-model fallback.
- Free hosting uses lower-memory **640×360 AI-frame CCTV**, one worker, 20 MiB
  asset limits, and a default one new case per guest per day. Providers can limit
  the entire app more tightly than this per-guest allowance.
- Free-service availability and quotas can change. The application can enforce
  selected providers/models, but cannot determine whether you upgraded a provider
  account. Retain Free plans and unbilled API accounts to maintain zero charges.

## What changed from the original specification

Your newer free-only instruction takes priority over the previous paid setup.
Gemini still creates the immutable canon and text evidence. Cloudflare creates
genuine image evidence; the existing AI-frame fallback supplies video. API and
worker remain separate processes but share one free container. No feature is
represented as generated when it is a stock asset or fixture. Local `AI_MODE=mock`
is still separately labeled Demo Mode.

The original `spec.md` is retained unchanged. Cloud provisioning, account-tier
verification, and real provider calls require your accounts; local tests do not
prove your external credentials or deployed resource limits.

Local verification on 2026-10-30: all 181 automated tests, including 25 offline
deployment-input checks, passed. The 14 hosted
desktop/mobile browser checks passed, along with formatting, lint, TypeScript,
production builds, Blueprint validation, and offline runtime checks. Provider
responses were mocked; the media tests ran real ffmpeg. Linux Docker execution
still needs GitHub CI because Docker is unavailable in this workspace.

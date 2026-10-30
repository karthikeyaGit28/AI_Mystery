# Deploy AI Mystery Room on Render

This walkthrough deploys the existing MERN project. React and Express share one
public HTTPS address; a separate persistent worker generates cases and media.
MongoDB Atlas stores records, Render Key Value stores BullMQ jobs, and a private
Cloudflare R2 bucket stores generated images and video.

The configuration is in [render.yaml](render.yaml). It creates these services in
Singapore:

| Service      | Purpose                                         | Configured plan |
| ------------ | ----------------------------------------------- | --------------- |
| `amr-web`    | React website and Express API                   | `0.5c-512mb`    |
| `amr-worker` | Gemini, ffmpeg, cleanup, and durable generation | `1c-2g`         |
| `amr-queue`  | Private, persistent Redis-compatible job queue  | `256mb`         |

These are paid Render services. Review the estimate before confirming creation;
MongoDB, R2, and Google may have their own usage charges. The worker's 2 GB plan
is a starting allocation for media processing, not a measured guarantee. Plans
can be adjusted after monitoring. See [Render compute plans](https://render.com/docs/compute-plans)
and [persistent Key Value](https://render.com/docs/key-value).

## 1. Put the project on GitHub

Use a private repository if you want to keep the source private. The running
website still uses ordinary anonymous guest sessions.

From the project root in PowerShell:

```powershell
cd "C:\Users\Dell\OneDrive\Desktop\NW\AI Mystery Room"
$env:Path = (Resolve-Path ".\.tools\node-v22.23.4-win-x64").Path + ";" + $env:Path

npm.cmd run deployment:validate
git status
git ls-files .env
```

The final command should print nothing. `.env`, downloaded tools, local database
files, and `node_modules` are ignored. Keep real credentials in your local `.env`
or Render's secret settings; do not paste them into tracked files.

Commit the deployment changes and push to your repository's default branch:

```powershell
git add .
git commit -m "Prepare production deployment on Render"
git push
```

If the repository is not connected to GitHub yet, create an empty GitHub repository,
add its HTTPS URL as `origin`, then push your default branch. GitHub's repository
page shows the exact commands. The included Actions workflow validates the code
and builds the Linux Docker image after a push to `main` or `master`.

## 2. Create MongoDB Atlas

1. Create or open an Atlas project and cluster. Choose a region near the Render
   services where your selected Atlas tier supports it.
2. Under **Database Access**, create a **database user** for this application.
   This is separate from your Atlas account login. Give it read/write access to
   the `ai_mystery_room` database.
3. Choose **Connect → Drivers → Node.js**, and copy the connection string.
4. Set the database name to `ai_mystery_room`. Replace the user/password
   placeholders with the database user's credentials. URL-encode special
   characters in the password.

Its shape is:

```text
mongodb+srv://<db-user>:<encoded-password>@<cluster-host>/ai_mystery_room?retryWrites=true&w=majority
```

Save this privately for `MONGODB_URI`. You will add Render's outbound IP ranges
in step 6, once the services exist. The official [Atlas/Render integration guide](https://www.mongodb.com/docs/atlas/reference/partner-integrations/render/)
describes the network and connection setup.

## 3. Create private media storage in Cloudflare R2

1. Open **R2 Object Storage** in Cloudflare.
2. Create a bucket named **`ai-mystery-private`**. This matches the Blueprint.
3. Leave public access, `r2.dev`, and public custom-domain access disabled.
4. Create R2 API credentials with **Object Read & Write** permissions restricted
   to this bucket.
5. Save the **Access Key ID**, **Secret Access Key**, and the account's S3 endpoint:

   ```text
   https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   ```

Use the S3 Access Key ID and Secret Access Key, rather than the general Cloudflare
API token string. The Blueprint already sets `STORAGE_REGION=auto` and
`STORAGE_FORCE_PATH_STYLE=true`. The browser requests media through the authenticated
API, so this setup does not require exposing the bucket or configuring direct
browser-to-bucket CORS.

See Cloudflare's [S3 SDK settings](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/),
[R2 credential instructions](https://developers.cloudflare.com/r2/api/tokens/), and
[public-access settings](https://developers.cloudflare.com/r2/buckets/public-buckets/).

## 4. Prepare Google Gemini access

Create a Gemini API key for a Google project with the required model access and
billing configuration. The deployment uses `AI_MODE=gemini`; production does not
allow mock mode. The model IDs are environment settings, so change them if your
account's available models differ from the specification's defaults.

Keep the key ready for Render's secret input. Do not add a `VITE_` prefix: it must
stay on the API/worker side. Model capabilities are checked at worker startup and
with the full smoke test in step 8. Check current availability in Google's
[model documentation](https://ai.google.dev/gemini-api/docs/models) and your project.

## 5. Create the Render Blueprint

1. Sign in to [Render](https://dashboard.render.com/).
2. Choose **New → Blueprint**.
3. Connect your GitHub account and select this repository and its default branch.
4. Use the root **`render.yaml`** file. Leave the project root at the repository
   root; do not select `apps/api` as the build context.
5. Enter the five requested settings:

   | Render input         | Value                               |
   | -------------------- | ----------------------------------- |
   | `MONGODB_URI`        | Atlas connection string from step 2 |
   | `GEMINI_API_KEY`     | Google API key from step 4          |
   | `STORAGE_ENDPOINT`   | R2 HTTPS S3 endpoint from step 3    |
   | `STORAGE_ACCESS_KEY` | R2 Access Key ID                    |
   | `STORAGE_SECRET_KEY` | R2 Secret Access Key                |

6. Review the three service plans and estimated charges, then confirm creation
   when the estimate is acceptable to you.

Render builds the Dockerfile and provides HTTPS. The Blueprint generates one
session secret, connects both services to the same private queue, and shares the
storage/database/provider settings with the worker. It derives the website and
API origins from Render's assigned URL. No separate static-site service,
frontend API URL, manually copied Redis URL, or local `.env` upload is needed.

The queue uses `noeviction`, journal/snapshot persistence, and internal-only
network access. The worker stays running independently of HTTP requests. These
settings follow Render's [Blueprint reference](https://render.com/docs/blueprint-spec)
and [background-worker model](https://render.com/docs/background-workers).

## 6. Allow Render to connect to Atlas

As soon as the services appear in Render:

1. Open `amr-web`, then **Connect → Outbound**.
2. Copy its listed outbound IP ranges/CIDRs.
3. In Atlas, open **Network Access**, and add those exact ranges.
4. Check `amr-worker` the same way and add any additional ranges. Services in the
   same Render region usually share the documented regional ranges.
5. Wait until Atlas marks the entries active.

Do this while the image builds if possible. If an initial deployment fails to
connect to MongoDB, finish this step and use **Manual Deploy → Deploy latest
commit** for both services. The configuration intentionally does not open Atlas
to `0.0.0.0/0`. Render explains where to find the addresses in its
[outbound-IP documentation](https://render.com/docs/outbound-ip-addresses).

## 7. Confirm the services are running

Wait for GitHub's `checks` and `container` jobs to pass and for Render's deployments
to become live. With `autoDeployTrigger: checksPass`, future pushes wait for the
repository's checks before automatically deploying.

In Render logs:

- `amr-web` should report **AI Mystery Room API ready**.
- `amr-worker` should report **Worker ready** after its MongoDB, storage, queue,
  and Gemini text checks succeed.
- `amr-queue` should be available on the private network.

Open the HTTPS address shown on `amr-web`, such as
`https://amr-web-<assigned-suffix>.onrender.com`. That one address serves both the
website and `/api/v1`.

Open `/api/v1/health` on that address. It should return:

```json
{ "status": "ok" }
```

This is API liveness, not proof that paid image/video generation has succeeded.
Complete the next step before treating the live game as verified.

## 8. Verify production infrastructure and real generation

Open the **Shell** for `amr-web` in Render and run from `/app`:

```sh
npm run deployment:runtime-check
npm run infra:check
npm run provider:check -w @amr/worker -- --full
```

The runtime check is offline. The infrastructure check connects to MongoDB,
Redis, and the private bucket. The full provider smoke test makes paid Gemini
requests to generate a case, text, two photos, and a video or AI-frame fallback.
Its temporary artifacts are diagnostic; player cases are stored in MongoDB/R2.

Then use the real website:

1. Create a case from a new fictional premise.
2. Wait for truthful generation stages to finish.
3. Open both chats, both images, the playable CCTV reconstruction, and all three
   documents.
4. Bookmark/review evidence and refresh; the state should persist.
5. Request a hint, submit an accusation, and read the fixed explanation.
6. Open the case URL in an incognito browser; it should deny another guest access.
7. Delete the case and confirm it becomes inaccessible.

Local automated checks cannot replace this credential-dependent live test.

## 9. Future changes and custom domains

Commit and push application changes. CI and Render rebuild from the repository;
do not upload `node_modules`, `.tools`, or a local database. The worker has a
bounded shutdown and checkpoints, so an interrupted job can resume after BullMQ
recovers its stalled lock.

Change credentials through Render's environment settings. Worker values reference
the web service: after changing a shared web value, **sync the Blueprint and
redeploy both services**, or explicitly update the worker's matching value.
References are resolved during sync rather than continuously following changes.

For a custom domain, first add and verify it in the web service's domain settings.
Then replace the web service's `WEB_ORIGIN` and `API_BASE_URL` entries in
`render.yaml` with the final HTTPS origin:

```yaml
- key: WEB_ORIGIN
  value: https://mystery.example.com
- key: API_BASE_URL
  value: https://mystery.example.com
```

Use the same origin for both, without `/api/v1` or a trailing path. Sync and
redeploy so the worker inherits the new settings. Choose your final public host
before inviting players, because anonymous guest cookies belong to that host.

## Troubleshooting

| Symptom                                         | Check                                                                                                           |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Docker build fails                              | Read GitHub's `container` job and Render build logs; use the repo root context and commit the updated lockfile. |
| API exits before listening                      | Atlas credentials/allowlist and R2 endpoint, bucket, and object permissions.                                    |
| `WORKER_CONFIGURATION_INVALID`                  | Production HTTPS origins, nonlocal session secret, `AI_MODE=gemini`, and required secret inputs.                |
| `WORKER_DATABASE_UNAVAILABLE`                   | Atlas database user, URI password encoding, database name, and both services' outbound IP ranges.               |
| `WORKER_STORAGE_UNAVAILABLE`                    | Pre-created private bucket, R2 Access Key ID/Secret Access Key, endpoint, and region `auto`.                    |
| `WORKER_GEMINI_UNAVAILABLE`                     | Run the provider check; verify key, billing, quota, and configured model access.                                |
| `WORKER_QUEUE_UNAVAILABLE` or cases stay queued | Worker deployment status and the automatically linked private Key Value connection.                             |
| `ORIGIN_REJECTED` or missing guest session      | Public HTTPS host must match `WEB_ORIGIN` and `API_BASE_URL`; use the same host for website and media.          |
| Media generation exceeds memory                 | Keep worker concurrency at 1, inspect worker memory metrics, and adjust the worker plan if needed.              |

## What was verified during preparation

On 2026-10-29, all **122 unit/integration tests** and **12 desktop/mobile
production-hosting browser checks** passed. TypeScript checking, lint, formatting,
the application builds, offline runtime checks, and the Render schema validator
also passed. These browser tests exercised the actual built React app served by
Express; they did not contact MongoDB or paid AI services.

Docker is not installed on the preparation machine, so the Linux image build was
not run locally. The included GitHub `container` job builds it and checks runtime
packaging after you push. Actual cloud provisioning and the live Gemini smoke
test require your accounts and are not claimed as completed by these local changes.

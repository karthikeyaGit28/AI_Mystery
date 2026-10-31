import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { randomBytes, randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z, ZodError } from 'zod';
import pino from 'pino';
import {
  CreateCaseRequestSchema,
  SolveRequestSchema,
  EvidencePublicSchema,
  CasePublicResponseSchema,
} from '@amr/shared';
import {
  config,
  CaseModel,
  SecretModel,
  ProgressModel,
  GuestModel,
  AssetModel,
  IdempotencyModel,
  generateQueue,
  cleanupQueue,
  assertQueueAvailable,
  storage,
} from '@amr/server';
import {
  HttpError,
  hashValue,
  scoreAccusation,
  assertSafePremise,
  stageLabels,
  normalizeByteRange,
  publicGenerationFailure,
} from './domain.js';
import { configureProxyTrust, mountWebApp } from './hosting.js';

const logger = pino({ level: config.NODE_ENV === 'test' ? 'silent' : 'info' });
const DAY = 86_400_000;
const uuid = z.uuid();
const idempotencyKeySchema = z.string().regex(/^[a-zA-Z0-9._:-]{8,128}$/);
const progressSchema = z
  .object({
    reviewedEvidenceIds: z
      .array(z.string())
      .max(8)
      .refine((ids) => new Set(ids).size === ids.length),
    bookmarkedEvidenceIds: z
      .array(z.string())
      .max(8)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .strict();
type Context = { requestId: string; guestId?: string };
function context(res: Response): Context {
  return res.locals as Context;
}
function key(req: Request) {
  const value = req.get('Idempotency-Key');
  if (!value)
    throw new HttpError(
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Include an Idempotency-Key header for this action.',
    );
  return idempotencyKeySchema.parse(value);
}
function requireId(req: Request) {
  return uuid.parse(String(req.params.id));
}
function owner(res: Response) {
  return context(res).guestId!;
}
function assetSignature(caseId: string, assetId: string, guestId: string, expires: number) {
  return createHmac('sha256', config.SESSION_SECRET)
    .update(`${caseId}:${assetId}:${guestId}:${expires}`)
    .digest('hex');
}
async function ownedCase(req: Request, res: Response, ready = false) {
  const record = await CaseModel.findOne({
    _id: requireId(req),
    ownerSessionId: owner(res),
    deletedAt: null,
    expiresAt: { $gt: new Date() },
  });
  if (!record) throw new HttpError(404, 'NOT_FOUND', 'This case is unavailable.');
  if (ready && record.status !== 'READY')
    throw new HttpError(409, 'CASE_NOT_READY', 'Your investigation is still being prepared.');
  return record;
}
function publicProgress(progress: any) {
  return {
    reviewedEvidenceIds: progress.reviewedEvidenceIds ?? [],
    bookmarkedEvidenceIds: progress.bookmarkedEvidenceIds ?? [],
    hintsUsed: progress.hintsUsed ?? 0,
    submittedAt: progress.submittedAt ? new Date(progress.submittedAt).toISOString() : null,
  };
}
export function mapPublicCase(record: any, progress: any) {
  const result = {
    id: String(record._id),
    title: record.title,
    caseNumber: record.caseNumber,
    premise: record.premise,
    difficulty: record.difficulty,
    timezone: record.timezone,
    fictionalDate: record.fictionalDate,
    location: record.location,
    incident: record.incident,
    objective: record.objective,
    status: progress.submittedAt ? 'SUBMITTED' : 'READY',
    suspects: (record.suspects ?? []).map((s: any) => ({
      id: s.id,
      name: s.name,
      age: s.age,
      role: s.role,
      relationshipToIncident: s.relationshipToIncident,
      statedAlibi: s.statedAlibi,
      publicStatement: s.publicStatement,
      motivePossibility: s.motivePossibility,
    })),
    evidence: (record.evidence ?? []).map((e: any) => EvidencePublicSchema.parse(e)),
    createdAt: new Date(record.createdAt).toISOString(),
    progress: publicProgress(progress),
  };
  return CasePublicResponseSchema.parse(result);
}
async function verdict(record: any, progress: any) {
  if (!progress.submittedAt)
    throw new HttpError(
      403,
      'RESULT_LOCKED',
      'Submit your final accusation to reveal the solution.',
    );
  const secret = await SecretModel.findOne({ caseId: record._id });
  if (!secret)
    throw new HttpError(503, 'SERVICE_UNAVAILABLE', 'The case result is temporarily unavailable.');
  return {
    caseId: record._id,
    isCorrect: progress.isCorrect,
    score: progress.score,
    culpritSuspectId: secret.culpritSuspectId,
    culpritName: record.suspects.find((s: any) => s.id === secret.culpritSuspectId)?.name,
    motive: secret.motive,
    method: secret.method,
    opportunity: secret.opportunity,
    actualTimeline: secret.actualTimeline,
    supportingEvidenceIds: secret.supportingEvidenceIds,
    evidenceExplanations: record.evidence
      .filter((e: any) => secret.supportingEvidenceIds.includes(e.id))
      .map((e: any) => ({ evidenceId: e.id, title: e.title, description: e.description })),
    suspectEliminationReasons: secret.suspectEliminationReasons,
    redHerringExplanations: secret.redHerringExplanations,
    verdictExplanation: secret.verdictExplanation,
    hintsUsed: progress.hintsUsed,
    submittedAt: new Date(progress.submittedAt).toISOString(),
    selectedSuspectId: progress.selectedSuspectId,
    selectedEvidenceIds: progress.selectedEvidenceIds,
    playerReasoning: progress.playerReasoning ?? '',
  };
}
function validateEvidenceIds(record: any, ids: string[]) {
  if (ids.some((id) => !record.evidence.some((e: any) => e.id === id)))
    throw new HttpError(400, 'INVALID_EVIDENCE', 'Choose evidence from this investigation.');
}
async function getProgress(record: any, res: Response) {
  const progress = await ProgressModel.findOne({ caseId: record._id, ownerSessionId: owner(res) });
  if (!progress)
    throw new HttpError(
      503,
      'SERVICE_UNAVAILABLE',
      'Your investigation progress is temporarily unavailable.',
    );
  return progress;
}
async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[config.SESSION_COOKIE_NAME];
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token))
      throw new HttpError(401, 'SESSION_REQUIRED', 'Start a guest session to continue.');
    const guest = await GuestModel.findOneAndUpdate(
      { tokenHash: hashValue(token), expiresAt: { $gt: new Date() } },
      { $set: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 30 * DAY) } },
      { new: true },
    );
    if (!guest)
      throw new HttpError(
        401,
        'SESSION_REQUIRED',
        'Your guest session has expired. Start a new session.',
      );
    context(res).guestId = guest._id;
    res.cookie(config.SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.NODE_ENV === 'production',
      path: '/',
      maxAge: 30 * DAY,
    });
    next();
  } catch (error) {
    next(error);
  }
}

export function createApp(
  options: { serveWeb?: boolean; webDistPath?: string; trustProxyHops?: number } = {},
) {
  const app = express();
  const serveWeb = options.serveWeb ?? config.SERVE_WEB ?? false;
  configureProxyTrust(app, options.trustProxyHops ?? config.TRUST_PROXY_HOPS ?? 0);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    context(res).requestId = randomUUID();
    res.setHeader('X-Request-Id', context(res).requestId);
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: serveWeb ? 'same-origin' : 'cross-origin' },
      contentSecurityPolicy: {
        directives: {
          'script-src': ["'self'"],
          'connect-src': ["'self'"],
          'img-src': ["'self'", 'data:', 'blob:'],
          'media-src': ["'self'", 'blob:'],
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'https://fonts.gstatic.com'],
          'frame-ancestors': ["'none'"],
          'upgrade-insecure-requests': config.NODE_ENV === 'production' ? [] : null,
        },
      },
    }),
  );
  app.use(
    cors({
      origin: config.WEB_ORIGIN,
      credentials: true,
      allowedHeaders: ['Content-Type', 'Idempotency-Key'],
    }),
  );
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: 180,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skip: (req) => req.method === 'GET' && req.originalUrl.split('?')[0] === '/api/v1/health',
      handler: (_req, _res, next) =>
        next(new HttpError(429, 'RATE_LIMITED', 'Too many requests. Please try again shortly.')),
    }),
  );
  app.use((req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('Origin');
      let refererOrigin: string | undefined;
      try {
        refererOrigin = req.get('Referer') ? new URL(req.get('Referer')!).origin : undefined;
      } catch {
        /* invalid referer is rejected */
      }
      if ((origin ?? refererOrigin) !== new URL(config.WEB_ORIGIN).origin)
        return next(
          new HttpError(
            403,
            'ORIGIN_REJECTED',
            'This request did not originate from the application.',
          ),
        );
    }
    next();
  });
  app.use(express.json({ limit: '16kb', strict: true }));
  app.use(cookieParser());
  const router = express.Router();
  router.get('/health', (_req, res) => {
    // Render supplies this public source revision. Keep the liveness body small
    // while allowing a release to be verified without dashboard credentials.
    const revision = process.env.RENDER_GIT_COMMIT;
    if (revision && /^[a-f0-9]{40}$/i.test(revision)) res.set('X-App-Revision', revision);
    res.json({ status: 'ok' });
  });
  router.get('/config', (_req, res) =>
    res.json({
      aiMode: config.AI_MODE,
      freeTierOnly: config.FREE_TIER_ONLY ?? false,
      mediaProvider: config.MEDIA_PROVIDER ?? 'gemini',
    }),
  );
  router.post('/sessions/guest', async (req, res) => {
    const current = req.cookies?.[config.SESSION_COOKIE_NAME];
    let token: string;
    if (
      typeof current === 'string' &&
      /^[a-f0-9]{64}$/.test(current) &&
      (await GuestModel.exists({ tokenHash: hashValue(current), expiresAt: { $gt: new Date() } }))
    ) {
      token = current;
      await GuestModel.updateOne(
        { tokenHash: hashValue(token) },
        { $set: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 30 * DAY) } },
      );
    } else {
      token = randomBytes(32).toString('hex');
      await GuestModel.create({
        tokenHash: hashValue(token),
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * DAY),
      });
    }
    res.cookie(config.SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.NODE_ENV === 'production',
      path: '/',
      maxAge: 30 * DAY,
    });
    res.json({ sessionReady: true });
  });
  router.use('/cases', authenticate);
  router.post('/cases', async (req, res) => {
    const input = CreateCaseRequestSchema.parse(req.body);
    assertSafePremise(input.premise);
    const requestKey = key(req);
    const payloadHash = hashValue(JSON.stringify(input));
    const identity = { ownerSessionId: owner(res), scope: 'create', key: requestKey };
    const now = new Date();
    // The unique key can be reclaimed immediately; MongoDB's TTL sweep is asynchronous.
    await IdempotencyModel.deleteOne({ ...identity, expiresAt: { $lte: now } });
    const existing = await IdempotencyModel.findOne({ ...identity, expiresAt: { $gt: now } });
    if (existing) {
      if (existing.payloadHash !== payloadHash)
        throw new HttpError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'This key was already used with a different premise.',
        );
      if (!existing.response)
        throw new HttpError(
          409,
          'REQUEST_PENDING',
          'This generation request is already being processed.',
        );
      return res.status(existing.responseStatus ?? 202).json(existing.response);
    }
    await assertQueueAvailable().catch(() => {
      throw new HttpError(
        503,
        'SERVICE_UNAVAILABLE',
        'The generation queue is unavailable. Please retry shortly.',
      );
    });
    let reservation;
    try {
      reservation = await IdempotencyModel.create({
        ownerSessionId: owner(res),
        scope: 'create',
        key: requestKey,
        payloadHash,
        expiresAt: new Date(Date.now() + DAY),
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000)
        throw new HttpError(409, 'REQUEST_PENDING', 'This request is already being processed.');
      throw error;
    }
    const caseId = randomUUID();
    let created = false;
    try {
      const guest = await GuestModel.findById(owner(res));
      if (guest?.activeGenerationCaseId) {
        const active = await CaseModel.findById(guest.activeGenerationCaseId);
        if (!active || ['READY', 'FAILED'].includes(active.status) || active.deletedAt)
          await GuestModel.updateOne(
            { _id: guest._id, activeGenerationCaseId: guest.activeGenerationCaseId },
            { $set: { activeGenerationCaseId: null } },
          );
      }
      const cutoff = new Date(Date.now() - DAY);
      const claimed = await GuestModel.findOneAndUpdate(
        {
          _id: owner(res),
          activeGenerationCaseId: null,
          $expr: {
            $lt: [
              {
                $size: {
                  $filter: {
                    input: '$generationStarts',
                    as: 'time',
                    cond: { $gt: ['$$time', cutoff] },
                  },
                },
              },
              config.MAX_NEW_CASES_PER_SESSION_PER_24H,
            ],
          },
        },
        [
          {
            $set: {
              activeGenerationCaseId: caseId,
              generationStarts: {
                $concatArrays: [
                  {
                    $filter: {
                      input: '$generationStarts',
                      as: 'time',
                      cond: { $gt: ['$$time', cutoff] },
                    },
                  },
                  [new Date()],
                ],
              },
            },
          },
        ],
        { new: true },
      );
      if (!claimed) {
        res.setHeader('Retry-After', '60');
        throw new HttpError(
          429,
          'GENERATION_LIMIT',
          'Finish your active case generation first. Each guest can start up to three cases per day.',
        );
      }
      await CaseModel.create({
        _id: caseId,
        ownerSessionId: owner(res),
        ...input,
        status: 'QUEUED',
        caseNumber: `AMR-${caseId.slice(0, 8).toUpperCase()}`,
        jobId: caseId,
        expiresAt: new Date(Date.now() + config.CASE_RETENTION_DAYS * DAY),
      });
      created = true;
      await ProgressModel.create({ caseId, ownerSessionId: owner(res) });
      await generateQueue.add(
        'generate',
        { caseId },
        { jobId: caseId, attempts: 1, removeOnComplete: 1000, removeOnFail: 1000 },
      );
      const response = { caseId, status: 'QUEUED', statusUrl: `/api/v1/cases/${caseId}/status` };
      await IdempotencyModel.updateOne(
        { _id: reservation._id },
        { $set: { response, responseStatus: 202 } },
      );
      res.status(202).json(response);
    } catch (error) {
      if (created)
        await CaseModel.updateOne(
          { _id: caseId },
          { $set: { status: 'FAILED', failureCode: 'QUEUE_UNAVAILABLE' } },
        );
      await GuestModel.updateOne(
        { _id: owner(res), activeGenerationCaseId: caseId },
        { $set: { activeGenerationCaseId: null } },
      );
      await IdempotencyModel.deleteOne({ _id: reservation._id });
      throw error;
    }
  });
  router.get('/cases', async (req, res) => {
    const page = z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page);
    const records = await CaseModel.find({
      ownerSessionId: owner(res),
      deletedAt: null,
      expiresAt: { $gt: new Date() },
    })
      .sort({ createdAt: -1 })
      .skip((page - 1) * 20)
      .limit(21);
    const progress = await ProgressModel.find({
      ownerSessionId: owner(res),
      caseId: { $in: records.map((r) => r._id) },
    });
    res.json({
      cases: records.slice(0, 20).map((r) => {
        const submitted = Boolean(progress.find((p) => p.caseId === r._id)?.submittedAt);
        return {
          id: r._id,
          title: r.title || 'Untitled investigation',
          caseNumber: r.caseNumber,
          difficulty: r.difficulty,
          status: submitted ? 'SUBMITTED' : r.status,
          createdAt: new Date(r.createdAt).toISOString(),
          submitted,
          errorCode: publicGenerationFailure(r.status, r.failureCode),
        };
      }),
      page,
      hasMore: records.length > 20,
    });
  });
  router.get('/cases/:id/status', async (req, res) => {
    const record = await ownedCase(req, res);
    const errorCode = publicGenerationFailure(record.status, record.failureCode);
    res.json({
      caseId: record._id,
      status: record.status,
      stageLabel:
        errorCode === 'FREE_AI_QUOTA_EXCEEDED'
          ? 'The free AI quota has been used. Try again after the provider quota resets.'
          : (stageLabels[record.status] ?? 'Preparing your case'),
      canRetry: record.status === 'FAILED' && record.manualRetries < 2,
      errorCode,
    });
  });
  router.get('/cases/:id', async (req, res) => {
    const record = await ownedCase(req, res, true);
    res.json(mapPublicCase(record, await getProgress(record, res)));
  });
  router.delete('/cases/:id', async (req, res) => {
    const record = await ownedCase(req, res);
    await CaseModel.updateOne(
      { _id: record._id, ownerSessionId: owner(res), deletedAt: null },
      { $set: { deletedAt: new Date() } },
    );
    await GuestModel.updateOne(
      { _id: owner(res), activeGenerationCaseId: record._id },
      { $set: { activeGenerationCaseId: null } },
    );
    try {
      await assertQueueAvailable();
      await cleanupQueue.add(
        'delete',
        { caseId: record._id },
        {
          jobId: `delete-${record._id}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: true,
        },
      );
    } catch {
      // deletedAt is a durable cleanup marker. The worker's sweep recovers an interrupted enqueue.
      logger.warn(
        { caseId: record._id, requestId: context(res).requestId },
        'Cleanup will be recovered by the scheduled sweep',
      );
    }
    res.status(202).json({ deleted: true });
  });
  router.post('/cases/:id/retry', async (req, res) => {
    const record = await ownedCase(req, res);
    if (record.status !== 'FAILED' || record.manualRetries >= 2)
      throw new HttpError(409, 'RETRY_UNAVAILABLE', 'This case cannot be retried again.');
    await assertQueueAvailable().catch(() => {
      throw new HttpError(503, 'SERVICE_UNAVAILABLE', 'The generation queue is unavailable.');
    });
    const old = await generateQueue.getJob(record._id);
    if (old && (await old.getState()) === 'active')
      throw new HttpError(409, 'REQUEST_PENDING', 'The worker is still finishing this case.');
    const guest = await GuestModel.findById(owner(res));
    if (guest?.activeGenerationCaseId) {
      const active = await CaseModel.findById(guest.activeGenerationCaseId);
      if (!active || ['READY', 'FAILED'].includes(active.status) || active.deletedAt)
        await GuestModel.updateOne(
          { _id: guest._id, activeGenerationCaseId: guest.activeGenerationCaseId },
          { $set: { activeGenerationCaseId: null } },
        );
    }
    const claimed = await GuestModel.findOneAndUpdate(
      { _id: owner(res), activeGenerationCaseId: null },
      { $set: { activeGenerationCaseId: record._id } },
      { new: true },
    );
    if (!claimed)
      throw new HttpError(
        409,
        'GENERATION_ACTIVE',
        'A generation is already running for your guest session.',
      );
    try {
      // Removal can fail if a waiting job becomes active; do not spend a retry before this succeeds.
      if (old) await old.remove();
      const updated = await CaseModel.findOneAndUpdate(
        { _id: record._id, status: 'FAILED', manualRetries: { $lt: 2 }, deletedAt: null },
        { $set: { status: 'QUEUED', failureCode: null }, $inc: { manualRetries: 1 } },
        { new: true },
      );
      if (!updated)
        throw new HttpError(409, 'RETRY_UNAVAILABLE', 'This case is already being retried.');
      await generateQueue.add(
        'generate',
        { caseId: record._id },
        { jobId: record._id, attempts: 1, removeOnComplete: 1000, removeOnFail: 1000 },
      );
      res.status(202).json({ caseId: record._id, status: 'QUEUED' });
    } catch (error) {
      await GuestModel.updateOne(
        { _id: owner(res), activeGenerationCaseId: record._id },
        { $set: { activeGenerationCaseId: null } },
      );
      await CaseModel.updateOne(
        { _id: record._id, status: 'QUEUED' },
        { $set: { status: 'FAILED', failureCode: 'QUEUE_UNAVAILABLE' } },
      );
      throw error;
    }
  });
  router.get('/cases/:id/evidence/:evidenceId', async (req, res) => {
    const record = await ownedCase(req, res, true);
    const item = record.evidence.find((e: any) => e.id === req.params.evidenceId);
    if (!item) throw new HttpError(404, 'NOT_FOUND', 'This evidence is unavailable.');
    res.json(EvidencePublicSchema.parse(item));
  });
  async function assetFor(req: Request, res: Response) {
    const record = await ownedCase(req, res, true);
    const assetId = uuid.parse(String(req.params.assetId));
    if (
      !record.evidence.some(
        (e: any) =>
          e.payload?.assetId === assetId ||
          e.payload?.thumbnailAssetId === assetId ||
          e.payload?.posterAssetId === assetId,
      )
    )
      throw new HttpError(404, 'NOT_FOUND', 'This evidence asset is unavailable.');
    const asset = await AssetModel.findOne({ _id: assetId, caseId: record._id });
    if (!asset) throw new HttpError(404, 'NOT_FOUND', 'This evidence asset is unavailable.');
    return asset;
  }
  router.get('/cases/:id/assets/:assetId/access', async (req, res) => {
    const asset = await assetFor(req, res);
    const expires = Math.floor(Date.now() / 1000) + 300;
    const signature = assetSignature(String(req.params.id), asset._id, owner(res), expires);
    res.json({
      url: `${config.API_BASE_URL}/api/v1/cases/${req.params.id}/assets/${asset._id}/content?expires=${expires}&signature=${signature}`,
      expiresInSeconds: 300,
      mimeType: asset.mimeType,
    });
  });
  router.get('/cases/:id/assets/:assetId/content', async (req, res) => {
    const asset = await assetFor(req, res);
    const expires = z.coerce.number().int().parse(req.query.expires);
    const signature = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(req.query.signature);
    const expected = assetSignature(String(req.params.id), asset._id, owner(res), expires);
    if (
      expires <= Date.now() / 1000 ||
      expires > Date.now() / 1000 + 301 ||
      !timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))
    )
      throw new HttpError(
        403,
        'ASSET_ACCESS_EXPIRED',
        'Reopen this evidence to refresh media access.',
      );
    let object;
    try {
      const range = normalizeByteRange(req.get('Range'), asset.bytes);
      object = await storage.getObject(asset.objectKey, range);
    } catch (error) {
      if (
        (error instanceof HttpError && error.status === 416) ||
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 416
      ) {
        res.setHeader('Content-Range', `bytes */${asset.bytes}`);
        throw new HttpError(416, 'INVALID_RANGE', 'This media range cannot be satisfied.');
      }
      throw error;
    }
    res.status(object.ContentRange ? 206 : 200);
    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Accept-Ranges', 'bytes');
    if (object.ContentLength !== undefined) res.setHeader('Content-Length', object.ContentLength);
    if (object.ContentRange) res.setHeader('Content-Range', object.ContentRange);
    if (!object.Body)
      throw new HttpError(503, 'ASSET_UNAVAILABLE', 'This media could not be loaded.');
    await pipeline(object.Body as Readable, res);
  });
  router.patch('/cases/:id/progress', async (req, res) => {
    const record = await ownedCase(req, res, true);
    const input = progressSchema.parse(req.body);
    validateEvidenceIds(record, [...input.reviewedEvidenceIds, ...input.bookmarkedEvidenceIds]);
    const progress = await ProgressModel.findOneAndUpdate(
      { caseId: record._id, ownerSessionId: owner(res) },
      { $set: input },
      { new: true },
    );
    res.json(publicProgress(progress));
  });
  router.get('/cases/:id/hints', async (req, res) => {
    const record = await ownedCase(req, res, true);
    const progress = await getProgress(record, res);
    const secret = await SecretModel.findOne({ caseId: record._id });
    const count = progress.hintsUsed ?? 0;
    res.json({
      hints: (secret?.hintTexts ?? [])
        .slice(0, count)
        .map((text: string, index: number) => ({ hintNumber: index + 1, text })),
      hintsUsed: count,
      hintsRemaining: 3 - count,
    });
  });
  router.post('/cases/:id/hints', async (req, res) => {
    const record = await ownedCase(req, res, true);
    const requestKey = key(req);
    const initial = await getProgress(record, res);
    const requests = initial.hintRequests ?? [];
    const prior = requests.findIndex((item: any) => item.key === requestKey);
    const secret = await SecretModel.findOne({ caseId: record._id });
    if (!secret?.hintTexts || secret.hintTexts.length !== 3)
      throw new HttpError(503, 'SERVICE_UNAVAILABLE', 'Hints are temporarily unavailable.');
    if (prior >= 0)
      return res.json({
        hintNumber: prior + 1,
        text: secret.hintTexts[prior],
        hintsRemaining: 3 - initial.hintsUsed,
      });
    if (initial.submittedAt)
      throw new HttpError(409, 'ALREADY_SOLVED', 'This investigation has already been submitted.');
    const progress = await ProgressModel.findOneAndUpdate(
      {
        caseId: record._id,
        ownerSessionId: owner(res),
        submittedAt: null,
        hintsUsed: { $lt: 3 },
        'hintRequests.key': { $ne: requestKey },
      },
      { $inc: { hintsUsed: 1 }, $push: { hintRequests: { key: requestKey } } },
      { new: true },
    );
    if (!progress) {
      const latest = await getProgress(record, res);
      const index = (latest.hintRequests ?? []).findIndex((item: any) => item.key === requestKey);
      if (index >= 0)
        return res.json({
          hintNumber: index + 1,
          text: secret.hintTexts[index],
          hintsRemaining: 3 - latest.hintsUsed,
        });
      throw new HttpError(
        409,
        latest.submittedAt ? 'ALREADY_SOLVED' : 'NO_MORE_HINTS',
        latest.submittedAt
          ? 'This investigation has already been submitted.'
          : 'All three hints have been used.',
      );
    }
    res.json({
      hintNumber: progress.hintsUsed,
      text: secret.hintTexts[progress.hintsUsed - 1],
      hintsRemaining: 3 - progress.hintsUsed,
    });
  });
  router.post('/cases/:id/solve', async (req, res) => {
    const record = await ownedCase(req, res, true);
    const input = SolveRequestSchema.parse(req.body);
    const requestKey = req.get('Idempotency-Key');
    if (requestKey) idempotencyKeySchema.parse(requestKey);
    validateEvidenceIds(record, input.evidenceIds ?? []);
    if (!record.suspects.some((s: any) => s.id === input.suspectId))
      throw new HttpError(400, 'INVALID_SUSPECT', 'Choose a suspect from this investigation.');
    const secret = await SecretModel.findOne({ caseId: record._id });
    if (!secret)
      throw new HttpError(503, 'SERVICE_UNAVAILABLE', 'The verdict is temporarily unavailable.');
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const initial = await getProgress(record, res);
      if (initial.submittedAt) {
        if (
          requestKey &&
          initial.solveKey === requestKey &&
          initial.selectedSuspectId === input.suspectId &&
          JSON.stringify(initial.selectedEvidenceIds) === JSON.stringify(input.evidenceIds ?? []) &&
          (initial.playerReasoning ?? '') === (input.reasoning ?? '')
        )
          return res.status(201).json(await verdict(record, initial));
        throw new HttpError(
          409,
          'ALREADY_SOLVED',
          'Your accusation is final. Open the result to review it.',
        );
      }
      const isCorrect = input.suspectId === secret.culpritSuspectId;
      const score = scoreAccusation(
        isCorrect,
        input.evidenceIds ?? [],
        secret.supportingEvidenceIds,
        initial.hintsUsed,
      );
      const progress = await ProgressModel.findOneAndUpdate(
        {
          caseId: record._id,
          ownerSessionId: owner(res),
          submittedAt: null,
          hintsUsed: initial.hintsUsed,
        },
        {
          $set: {
            submittedAt: new Date(),
            selectedSuspectId: input.suspectId,
            selectedEvidenceIds: input.evidenceIds ?? [],
            playerReasoning: input.reasoning ?? '',
            score,
            isCorrect,
            solveKey: requestKey ?? null,
          },
        },
        { new: true },
      );
      if (progress) return res.status(201).json(await verdict(record, progress));
    }
    throw new HttpError(409, 'REQUEST_CONFLICT', 'Your progress changed. Please submit again.');
  });
  router.get('/cases/:id/result', async (req, res) => {
    const record = await ownedCase(req, res, true);
    res.json(await verdict(record, await getProgress(record, res)));
  });
  app.use('/api/v1', router);
  app.use('/api', (_req, _res, next) =>
    next(new HttpError(404, 'NOT_FOUND', 'This API endpoint is unavailable.')),
  );
  if (serveWeb) mountWebApp(app, options.webDistPath ?? config.WEB_DIST_PATH);
  app.use((_req, _res, next) =>
    next(new HttpError(404, 'NOT_FOUND', 'This endpoint is unavailable.')),
  );
  app.use((error: any, req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const status =
      error instanceof HttpError
        ? error.status
        : error instanceof ZodError
          ? 400
          : error.type === 'entity.too.large'
            ? 413
            : error.type === 'entity.parse.failed'
              ? 400
              : 503;
    const code =
      error instanceof HttpError
        ? error.code
        : error instanceof ZodError
          ? 'VALIDATION_ERROR'
          : status === 413
            ? 'BODY_TOO_LARGE'
            : status === 400
              ? 'INVALID_JSON'
              : 'SERVICE_UNAVAILABLE';
    const message =
      error instanceof HttpError
        ? error.message
        : error instanceof ZodError
          ? 'Please check your input and try again.'
          : status === 413
            ? 'This request is too large.'
            : status === 400
              ? 'Send valid JSON.'
              : 'A required service is temporarily unavailable. Please try again.';
    if (status >= 500)
      logger.error(
        { requestId: context(res).requestId, code, method: req.method, errorName: error?.name },
        'Request failed',
      );
    if (status === 429) res.setHeader('Retry-After', '60');
    res.status(status).json({ error: { code, message, requestId: context(res).requestId } });
  });
  return app;
}

import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const state = vi.hoisted(() => ({
  guestId: 'guest-one',
  record: null as any,
  progress: {
    submittedAt: null,
    hintsUsed: 0,
    reviewedEvidenceIds: [],
    bookmarkedEvidenceIds: [],
  } as any,
  secretReads: vi.fn(),
  queueJob: null as any,
  idempotency: null as any,
}));
vi.mock('@amr/server', () => ({
  config: {
    NODE_ENV: 'test',
    WEB_ORIGIN: 'http://localhost:5173',
    API_BASE_URL: 'http://localhost:4000',
    AI_MODE: 'mock',
    SESSION_COOKIE_NAME: 'amr_guest',
    CASE_RETENTION_DAYS: 30,
    MAX_NEW_CASES_PER_SESSION_PER_24H: 3,
  },
  GuestModel: {
    findOneAndUpdate: vi.fn(async () => ({ _id: state.guestId })),
    findById: vi.fn(async () => ({ _id: state.guestId, activeGenerationCaseId: null })),
    exists: vi.fn(),
    create: vi.fn(),
    updateOne: vi.fn(),
  },
  CaseModel: {
    create: vi.fn(async (input: any) => input),
    findOneAndUpdate: vi.fn(),
    findOne: vi.fn(async (query: any) =>
      query._id === state.record?._id &&
      query.ownerSessionId === state.record?.ownerSessionId &&
      !state.record.deletedAt
        ? state.record
        : null,
    ),
  },
  ProgressModel: {
    create: vi.fn(),
    findOne: vi.fn(async () => structuredClone(state.progress)),
    findOneAndUpdate: vi.fn(async (query: any, update: any) => {
      const current = state.progress;
      if (query.submittedAt === null && current.submittedAt !== null) return null;
      if (typeof query.hintsUsed === 'number' && query.hintsUsed !== current.hintsUsed) return null;
      if (query.hintsUsed?.$lt !== undefined && current.hintsUsed >= query.hintsUsed.$lt)
        return null;
      if (
        query['hintRequests.key']?.$ne &&
        current.hintRequests.some((item: any) => item.key === query['hintRequests.key'].$ne)
      )
        return null;
      for (const [field, value] of Object.entries(update.$set ?? {})) current[field] = value;
      for (const [field, value] of Object.entries(update.$inc ?? {}))
        current[field] = (current[field] ?? 0) + Number(value);
      for (const [field, value] of Object.entries(update.$push ?? {})) current[field].push(value);
      return structuredClone(current);
    }),
  },
  SecretModel: { findOne: state.secretReads },
  AssetModel: { findOne: vi.fn() },
  IdempotencyModel: {
    findOne: vi.fn(async (query: any) =>
      state.idempotency && state.idempotency.expiresAt > query.expiresAt.$gt
        ? structuredClone(state.idempotency)
        : null,
    ),
    deleteOne: vi.fn(async (query: any) => {
      if (
        state.idempotency &&
        (query._id === state.idempotency._id ||
          (query.expiresAt && state.idempotency.expiresAt <= query.expiresAt.$lte))
      )
        state.idempotency = null;
    }),
    create: vi.fn(async (input: any) => {
      if (state.idempotency) throw Object.assign(new Error('Duplicate key'), { code: 11000 });
      state.idempotency = { _id: 'idempotency-test', ...input };
      return structuredClone(state.idempotency);
    }),
    updateOne: vi.fn(async (_query: any, update: any) => {
      Object.assign(state.idempotency, update.$set);
    }),
  },
  generateQueue: { getJob: vi.fn(async () => state.queueJob), add: vi.fn(async () => ({})) },
  cleanupQueue: {},
  assertQueueAvailable: vi.fn(async () => undefined),
  storage: {},
}));
import { createApp, mapPublicCase } from '../src/app.js';
import { VerdictResponseSchema } from '@amr/shared';
import { CaseModel, generateQueue } from '@amr/server';

const app = createApp();
const caseId = 'de9d8d8c-3b18-4a00-80ca-5df0a259d360';
const base = `/api/v1/cases/${caseId}`;
const cookie = `amr_guest=${'a'.repeat(64)}`;
function record() {
  const item = (id: string, type: string, payload: any) => ({
    id,
    type,
    title: `Evidence ${id}`,
    source: 'Fictional source',
    occurredAt: '2026-10-28T21:00:00+05:30',
    summary: 'Public observation',
    description: 'A factual observation available to the detective.',
    payload,
    canonicalFactIds: ['FACT-SECRET'],
    isCulprit: true,
  });
  return {
    _id: caseId,
    ownerSessionId: 'guest-one',
    deletedAt: null,
    status: 'READY',
    expiresAt: new Date(Date.now() + 100000),
    title: 'The Missing Trophy',
    caseNumber: 'AMR-TEST',
    premise: 'At a fictional university festival, a trophy disappears backstage.',
    difficulty: 'medium',
    timezone: 'Asia/Kolkata',
    fictionalDate: '2026-10-28',
    location: 'University hall',
    incident: 'A trophy vanished.',
    objective: 'Find the culprit.',
    createdAt: new Date(),
    suspects: Array.from({ length: 4 }, (_, i) => ({
      id: `S-0${i + 1}`,
      name: `Person ${i + 1}`,
      age: 25,
      role: 'Organizer',
      relationshipToIncident: 'Organized the event',
      statedAlibi: 'At the stage',
      publicStatement: 'I was working.',
      motivePossibility: 'A disagreement',
      isCulprit: i === 2,
    })),
    evidence: [
      item('EV-01', 'CHAT', {
        messages: Array.from({ length: 4 }, (_, i) => ({
          id: `m${i}`,
          sender: i % 2 ? 'Bea' : 'Alex',
          timestamp: '2026-10-28T20:55:00+05:30',
          text: 'A public chat message.',
        })),
      }),
      item('EV-02', 'CHAT', {
        messages: Array.from({ length: 4 }, (_, i) => ({
          id: `m${i}`,
          sender: i % 2 ? 'Bea' : 'Alex',
          timestamp: '2026-10-28T20:55:00+05:30',
          text: 'A public chat message.',
        })),
      }),
      item('EV-03', 'PHOTO', { assetId: 'photo-1', altText: 'An empty trophy case.' }),
      item('EV-04', 'PHOTO', { assetId: 'photo-2', altText: 'A striped bag.' }),
      item('EV-05', 'CCTV', {
        assetId: 'video-1',
        cameraLabel: 'CAM 02',
        cameraTimestamp: '2026-10-28T21:17:00+05:30',
        transcript: 'A striped bag moves down the corridor.',
      }),
      item('EV-06', 'DOCUMENT', {
        documentKind: 'INCIDENT_REPORT',
        documentBody: 'The trophy was reported missing.',
      }),
      item('EV-07', 'DOCUMENT', {
        documentKind: 'ACCESS_LOG',
        documentBody: 'A badge entry was recorded.',
      }),
      item('EV-08', 'DOCUMENT', {
        documentKind: 'WITNESS',
        documentBody: 'The host was on stage.',
      }),
    ],
    culpritSuspectId: 'S-03',
    solution: 'private',
    hintTexts: ['private hint'],
    evidenceFactMap: { 'EV-01': ['FACT-SECRET'] },
  };
}
beforeEach(() => {
  state.queueJob = null;
  state.idempotency = null;
  vi.mocked(CaseModel.findOneAndUpdate).mockClear();
  vi.mocked(generateQueue.add).mockClear();
  state.guestId = 'guest-one';
  state.record = record();
  state.progress = {
    submittedAt: null,
    hintsUsed: 0,
    reviewedEvidenceIds: [],
    bookmarkedEvidenceIds: [],
    hintRequests: [],
  };
  state.secretReads.mockReset();
  state.secretReads.mockResolvedValue({
    culpritSuspectId: 'S-03',
    supportingEvidenceIds: ['EV-01', 'EV-05', 'EV-07'],
    hintTexts: [
      'Check the timeline.',
      'Compare the badge log and alibi.',
      'Follow the borrowed key and striped bag.',
    ],
    motive: 'To hide a funding dispute.',
    method: 'Borrowed a key and concealed the trophy.',
    opportunity: 'Accessed backstage after the claimed departure.',
    actualTimeline: [
      { occurredAt: '2026-10-28T21:14:00+05:30', event: 'The coordinator entered backstage.' },
    ],
    verdictExplanation: 'The badge log breaks the alibi and the key establishes access.',
    redHerringExplanations: { 'EV-02': 'An angry message concerned judging.' },
    suspectEliminationReasons: {
      'S-01': 'On stage.',
      'S-02': 'Returned the key.',
      'S-04': 'No access.',
    },
  });
});

describe('HTTP security boundaries', () => {
  it('offers minimal liveness and clearly distinguishes mock mode', async () => {
    expect((await request(app).get('/api/v1/health')).body).toEqual({ status: 'ok' });
    expect((await request(app).get('/api/v1/config')).body).toEqual({
      aiMode: 'mock',
      freeTierOnly: false,
      mediaProvider: 'gemini',
    });
  });
  it('reports exhausted free AI quota without leaking internal provider errors', async () => {
    state.record.status = 'FAILED';
    state.record.manualRetries = 0;
    state.record.failureCode = 'FREE_AI_QUOTA_EXCEEDED';
    state.record.providerError = 'private provider payload with credential-like data';
    const response = await request(app).get(`${base}/status`).set('Cookie', cookie);
    expect(response.status).toBe(200);
    expect(response.body.errorCode).toBe('FREE_AI_QUOTA_EXCEEDED');
    expect(response.body.stageLabel).toMatch(/free AI quota/i);
    expect(JSON.stringify(response.body)).not.toContain('private provider payload');
    state.record.failureCode = 'UNRECOGNIZED_PRIVATE_PROVIDER_MESSAGE';
    expect((await request(app).get(`${base}/status`).set('Cookie', cookie)).body.errorCode).toBe(
      'GENERATION_FAILED',
    );
  });
  it('rejects untrusted and absent origins before state-changing handlers', async () => {
    for (const origin of [undefined, 'https://attacker.example']) {
      const call = request(app).post('/api/v1/sessions/guest');
      if (origin) call.set('Origin', origin);
      const response = await call.send({});
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ORIGIN_REJECTED');
    }
  });
  it('requires an unpredictable guest cookie', async () => {
    expect((await request(app).get(base)).status).toBe(401);
    expect((await request(app).get(base).set('Cookie', 'amr_guest=guess')).status).toBe(401);
  });
  it('denies every case resource to another guest without revealing existence', async () => {
    state.guestId = 'guest-two';
    for (const endpoint of [
      base,
      `${base}/status`,
      `${base}/evidence/EV-01`,
      `${base}/result`,
      `${base}/assets/de9d8d8c-3b18-4a00-80ca-5df0a259d361/access`,
    ]) {
      expect((await request(app).get(endpoint).set('Cookie', cookie)).status).toBe(404);
    }
    expect(
      (await request(app).delete(base).set('Cookie', cookie).set('Origin', 'http://localhost:5173'))
        .status,
    ).toBe(404);
    expect(state.secretReads).not.toHaveBeenCalled();
  });
  it('gates result access before even querying the secret collection', async () => {
    const response = await request(app).get(`${base}/result`).set('Cookie', cookie);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('RESULT_LOCKED');
    expect(state.secretReads).not.toHaveBeenCalled();
  });
  it('strips private keys recursively from case, suspects and evidence', async () => {
    const response = await request(app).get(base).set('Cookie', cookie);
    expect(response.status).toBe(200);
    const serialized = JSON.stringify(response.body);
    for (const forbidden of [
      'culpritSuspectId',
      'solution',
      'canonicalFacts',
      'canonicalFactIds',
      'hintTexts',
      'supportingEvidenceIds',
      'verdictExplanation',
      'suspectEliminationReasons',
      'redHerringExplanations',
      'evidenceFactMap',
      'isCulprit',
      'FACT-SECRET',
    ])
      expect(serialized).not.toContain(forbidden);
    expect(response.body.evidence).toHaveLength(8);
  });
  it('immediately denies access to deleted cases', async () => {
    state.record.deletedAt = new Date();
    expect((await request(app).get(base).set('Cookie', cookie)).status).toBe(404);
  });
  it('rejects invalid IDs and oversized requests safely', async () => {
    expect((await request(app).get('/api/v1/cases/not-a-uuid').set('Cookie', cookie)).status).toBe(
      400,
    );
    expect(
      (
        await request(app)
          .post('/api/v1/cases')
          .set('Origin', 'http://localhost:5173')
          .set('Cookie', cookie)
          .send({ premise: 'x'.repeat(20000) })
      ).status,
    ).toBe(413);
  });
  it.each(['', 'x'.repeat(29), 'x'.repeat(1201)])(
    'rejects invalid premise lengths without creating a job',
    async (premise) => {
      const response = await request(app)
        .post('/api/v1/cases')
        .set('Cookie', cookie)
        .set('Origin', 'http://localhost:5173')
        .set('Idempotency-Key', 'new-case-request-key')
        .send({ premise, difficulty: 'medium' });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    },
  );
  it('maps only the public whitelist even when source objects contain secrets', () => {
    const mapped = mapPublicCase(record(), state.progress);
    expect(mapped).not.toHaveProperty('ownerSessionId');
    expect(mapped.suspects[2]).not.toHaveProperty('isCulprit');
    expect(mapped.evidence[0]).not.toHaveProperty('canonicalFactIds');
  });
});

describe('one-time game actions', () => {
  it('does not spend a manual retry while the original job is still active', async () => {
    state.record.status = 'FAILED';
    state.record.manualRetries = 0;
    state.queueJob = { getState: vi.fn(async () => 'active'), remove: vi.fn() };
    const response = await request(app)
      .post(`${base}/retry`)
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:5173')
      .send({});
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('REQUEST_PENDING');
    expect(CaseModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(state.record.manualRetries).toBe(0);
    expect(state.queueJob.remove).not.toHaveBeenCalled();
  });
  it('reclaims an expired create key immediately and keeps concurrent requests unique', async () => {
    const requestKey = 'expired-create-request';
    state.idempotency = {
      _id: 'old-expired-record',
      ownerSessionId: 'guest-one',
      scope: 'create',
      key: requestKey,
      expiresAt: new Date(Date.now() - 1000),
      payloadHash: 'old-payload',
      response: { caseId: 'old-case', status: 'QUEUED' },
      responseStatus: 202,
    };
    const input = {
      premise: 'At a fictional university festival, a trophy disappears backstage.',
      difficulty: 'medium',
    };
    const create = () =>
      request(app)
        .post('/api/v1/cases')
        .set('Cookie', cookie)
        .set('Origin', 'http://localhost:5173')
        .set('Idempotency-Key', requestKey)
        .send(input);
    const responses = await Promise.all([create(), create()]);
    const created = responses.find((response) => response.status === 202)!;
    expect(created).toBeDefined();
    expect(created.body.caseId).not.toBe('old-case');
    expect(responses.every((response) => [202, 409].includes(response.status))).toBe(true);
    expect(generateQueue.add).toHaveBeenCalledTimes(1);
    const repeated = await create();
    expect(repeated.status).toBe(202);
    expect(repeated.body.caseId).toBe(created.body.caseId);
    expect(generateQueue.add).toHaveBeenCalledTimes(1);
  });
  const mutate = (path: string, requestKey: string) =>
    request(app)
      .post(path)
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:5173')
      .set('Idempotency-Key', requestKey);
  it('reveals only unlocked hints and consumes the same request key once', async () => {
    expect((await request(app).get(`${base}/hints`).set('Cookie', cookie)).body.hints).toEqual([]);
    const responses = await Promise.all([
      mutate(`${base}/hints`, 'same-hint-request').send({}),
      mutate(`${base}/hints`, 'same-hint-request').send({}),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(responses[0].body.text).toBe(responses[1].body.text);
    expect(state.progress.hintsUsed).toBe(1);
    const unlocked = (await request(app).get(`${base}/hints`).set('Cookie', cookie)).body;
    expect(unlocked.hints).toEqual([{ hintNumber: 1, text: 'Check the timeline.' }]);
    expect(JSON.stringify(unlocked)).not.toContain('borrowed key');
  });
  it('enforces three ordered hints and no fourth consumption', async () => {
    for (let i = 1; i <= 3; i += 1) {
      const response = await mutate(`${base}/hints`, `hint-request-key-${i}`).send({});
      expect(response.status).toBe(200);
      expect(response.body.hintNumber).toBe(i);
    }
    const fourth = await mutate(`${base}/hints`, 'hint-request-key-four').send({});
    expect(fourth.status).toBe(409);
    expect(fourth.body.error.code).toBe('NO_MORE_HINTS');
    expect(state.progress.hintsUsed).toBe(3);
  });
  it('stores one verdict when final accusations race and supports exact retry', async () => {
    const input = {
      suspectId: 'S-03',
      evidenceIds: ['EV-01', 'EV-05'],
      reasoning: 'The badge entry contradicts the alibi.',
    };
    const responses = await Promise.all([
      mutate(`${base}/solve`, 'final-request-first').send(input),
      mutate(`${base}/solve`, 'final-request-second').send(input),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const success = responses.find((r) => r.status === 201)!;
    expect(VerdictResponseSchema.parse(success.body).score).toBe(100);
    const retry = await mutate(`${base}/solve`, state.progress.solveKey).send(input);
    expect(retry.status).toBe(201);
    expect(retry.body.submittedAt).toBe(success.body.submittedAt);
    expect(
      (await mutate(`${base}/solve`, state.progress.solveKey).send({ ...input, suspectId: 'S-01' }))
        .status,
    ).toBe(409);
  });
  it('scores a wrong accusation zero while revealing the original fixed answer', async () => {
    const response = await mutate(`${base}/solve`, 'wrong-final-request').send({
      suspectId: 'S-01',
      evidenceIds: ['EV-01', 'EV-05'],
    });
    expect(response.status).toBe(201);
    expect(response.body.score).toBe(0);
    expect(response.body.culpritSuspectId).toBe('S-03');
    const result = await request(app).get(`${base}/result`).set('Cookie', cookie);
    expect(result.body).toEqual(response.body);
  });
  it('keeps score and hint count consistent when hint and solve race', async () => {
    const responses = await Promise.all([
      mutate(`${base}/hints`, 'racing-hint-request').send({}),
      mutate(`${base}/solve`, 'racing-solve-request').send({ suspectId: 'S-03', evidenceIds: [] }),
    ]);
    expect(responses[1].status).toBe(201);
    expect(state.progress.score).toBe(state.progress.hintsUsed === 0 ? 80 : 75);
    expect([200, 409]).toContain(responses[0].status);
    expect((await mutate(`${base}/hints`, 'post-solve-hint-request').send({})).status).toBe(409);
  });
});

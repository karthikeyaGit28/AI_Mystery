import mongoose, { Schema } from 'mongoose';
import { randomUUID } from 'node:crypto';

// Private persistence is deliberately separate from the strict public DTO package.
// Flexible records let worker stages store versioned provider metadata without exporting it to clients.
export type DatabaseRecord = { _id: string; [key: string]: any };
const mixed = Schema.Types.Mixed;
function makeModel(
  name: string,
  fields: Record<string, unknown>,
  indexes: Array<[Record<string, number>, Record<string, unknown>]> = [],
) {
  const schema = new Schema<DatabaseRecord>(
    { _id: { type: String, default: () => randomUUID() }, ...fields },
    { timestamps: true, strict: false, minimize: false },
  );
  for (const [keys, options] of indexes) schema.index(keys as never, options);
  return (
    (mongoose.models[name] as mongoose.Model<DatabaseRecord> | undefined) ??
    mongoose.model<DatabaseRecord>(name, schema)
  );
}
export const GuestModel = makeModel(
  'GuestSession',
  {
    tokenHash: { type: String, required: true, unique: true },
    lastSeenAt: Date,
    expiresAt: { type: Date, required: true },
    activeGenerationCaseId: { type: String, default: null },
    generationStarts: { type: [Date], default: [] },
  },
  [[{ expiresAt: 1 }, { expireAfterSeconds: 0 }]],
);
export const CaseModel = makeModel(
  'Case',
  {
    ownerSessionId: { type: String, required: true, index: true },
    premise: String,
    difficulty: String,
    status: { type: String, default: 'QUEUED', index: true },
    generationStage: String,
    title: String,
    caseNumber: { type: String, unique: true },
    incident: String,
    location: String,
    timezone: String,
    fictionalDate: String,
    objective: String,
    suspects: { type: [mixed], default: [] },
    evidence: { type: [mixed], default: [] },
    assetIds: { type: [String], default: [] },
    generationAttempts: { type: Number, default: 0 },
    manualRetries: { type: Number, default: 0 },
    jobId: String,
    failureCode: String,
    readyAt: Date,
    expiresAt: Date,
    blueprintLockedAt: Date,
    generationVersion: Number,
    deletedAt: { type: Date, default: null },
  },
  [
    [{ ownerSessionId: 1, createdAt: -1 }, {}],
    [{ status: 1, updatedAt: 1 }, {}],
    [{ expiresAt: 1 }, {}],
  ],
);
export const SecretModel = makeModel('CaseSecret', {
  caseId: { type: String, required: true, unique: true },
  blueprint: mixed,
  culpritSuspectId: String,
  canonicalFacts: [mixed],
  actualTimeline: [mixed],
  evidenceFactMap: mixed,
  supportingEvidenceIds: [String],
  redHerringExplanations: mixed,
  suspectEliminationReasons: mixed,
  hintTexts: [String],
  verdictExplanation: String,
  motive: String,
  method: String,
  opportunity: String,
  blueprintVersion: Number,
  blueprintLockedAt: Date,
});
export const ProgressModel = makeModel(
  'PlayerProgress',
  {
    caseId: { type: String, required: true },
    ownerSessionId: { type: String, required: true },
    reviewedEvidenceIds: { type: [String], default: [] },
    bookmarkedEvidenceIds: { type: [String], default: [] },
    hintsUsed: { type: Number, default: 0 },
    hintRequests: { type: [mixed], default: [] },
    submittedAt: { type: Date, default: null },
    selectedSuspectId: String,
    selectedEvidenceIds: { type: [String], default: [] },
    playerReasoning: String,
    score: Number,
    isCorrect: Boolean,
  },
  [[{ caseId: 1, ownerSessionId: 1 }, { unique: true }]],
);
export const AssetModel = makeModel('MediaAsset', {
  caseId: { type: String, required: true, index: true },
  evidenceId: String,
  kind: String,
  objectKey: { type: String, required: true },
  mimeType: String,
  bytes: Number,
  width: Number,
  height: Number,
  durationSeconds: Number,
  sha256: String,
  generationMethod: String,
});
export const EventModel = makeModel('GenerationEvent', {
  caseId: { type: String, index: true },
  stage: String,
  attempt: Number,
  model: String,
  startedAt: Date,
  endedAt: Date,
  durationMs: Number,
  errorCode: String,
  usageSummary: mixed,
  promptVersion: String,
  jobId: String,
  requestId: String,
});
export const IdempotencyModel = makeModel(
  'Idempotency',
  {
    ownerSessionId: { type: String, required: true },
    scope: { type: String, required: true },
    key: { type: String, required: true },
    payloadHash: String,
    response: mixed,
    responseStatus: Number,
    expiresAt: Date,
  },
  [
    [{ ownerSessionId: 1, scope: 1, key: 1 }, { unique: true }],
    [{ expiresAt: 1 }, { expireAfterSeconds: 0 }],
  ],
);
export async function connectDatabase() {
  await mongoose.connect((await import('./config.js')).config.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
  });
  await Promise.all(
    [
      GuestModel,
      CaseModel,
      SecretModel,
      ProgressModel,
      AssetModel,
      EventModel,
      IdempotencyModel,
    ].map((model) => model.init()),
  );
}
export async function disconnectDatabase() {
  await mongoose.disconnect();
}

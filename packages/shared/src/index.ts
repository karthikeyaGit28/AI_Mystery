import { z } from 'zod';

export const DifficultySchema = z.enum(['easy', 'medium', 'hard']);
export type Difficulty = z.infer<typeof DifficultySchema>;
export const GenerationStatusSchema = z.enum([
  'QUEUED',
  'GENERATING_BLUEPRINT',
  'VALIDATING',
  'GENERATING_TEXT',
  'GENERATING_IMAGES',
  'GENERATING_VIDEO',
  'FINALIZING',
  'READY',
  'FAILED',
]);
export type GenerationStatus = z.infer<typeof GenerationStatusSchema>;
export const EvidenceTypeSchema = z.enum(['CHAT', 'PHOTO', 'CCTV', 'DOCUMENT']);
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;
const iso = z.string().datetime({ offset: true });
const text = z.string().trim().min(1).max(12000);
export const SuspectPublicSchema = z.object({
  id: z.string().regex(/^S-0[1-4]$/),
  name: text,
  age: z.number().int().min(18).max(110),
  role: text,
  relationshipToIncident: text,
  statedAlibi: text,
  publicStatement: text,
  motivePossibility: text,
});
export type SuspectPublic = z.infer<typeof SuspectPublicSchema>;
export const ChatMessageSchema = z.object({
  id: z.string().min(1).max(80),
  sender: text,
  timestamp: iso,
  text,
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
const EvidenceBaseSchema = z.object({
  id: z.string().regex(/^EV-0[1-8]$/),
  title: text,
  source: text,
  occurredAt: iso,
  summary: text,
  description: text,
});
export const EvidencePublicSchema = z.discriminatedUnion('type', [
  EvidenceBaseSchema.extend({
    type: z.literal('CHAT'),
    payload: z.object({ messages: z.array(ChatMessageSchema).min(4).max(12) }),
  }),
  EvidenceBaseSchema.extend({
    type: z.literal('PHOTO'),
    payload: z.object({
      assetId: z.string().min(1),
      altText: text,
      thumbnailAssetId: z.string().min(1).optional(),
    }),
  }),
  EvidenceBaseSchema.extend({
    type: z.literal('CCTV'),
    payload: z.object({
      assetId: z.string().min(1),
      cameraLabel: text,
      cameraTimestamp: iso,
      transcript: text,
      generationMethod: z.enum(['GEMINI_OMNI_VIDEO', 'AI_FRAME_VIDEO', 'MOCK']).optional(),
      posterAssetId: z.string().optional(),
    }),
  }),
  EvidenceBaseSchema.extend({
    type: z.literal('DOCUMENT'),
    payload: z.object({
      documentBody: text,
      documentKind: z.enum(['INCIDENT_REPORT', 'WITNESS', 'ACCESS_LOG']),
    }),
  }),
]);
export type EvidencePublic = z.infer<typeof EvidencePublicSchema>;
export const CreateCaseRequestSchema = z
  .object({
    premise: z
      .string()
      .trim()
      .min(30, 'Write at least 30 characters.')
      .max(1200, 'Use at most 1,200 characters.'),
    difficulty: DifficultySchema.default('medium'),
  })
  .strict();
export type CreateCaseRequest = z.infer<typeof CreateCaseRequestSchema>;
export const PlayerProgressPublicSchema = z.object({
  reviewedEvidenceIds: z.array(z.string()).max(8),
  bookmarkedEvidenceIds: z.array(z.string()).max(8),
  hintsUsed: z.number().int().min(0).max(3),
  submittedAt: iso.nullable(),
});
export type PlayerProgressPublic = z.infer<typeof PlayerProgressPublicSchema>;
export const CasePublicSchema = z.object({
  id: z.string(),
  title: text,
  caseNumber: text,
  premise: text,
  difficulty: DifficultySchema,
  timezone: text,
  fictionalDate: z.string(),
  location: text,
  incident: text,
  objective: text,
  status: z.enum(['READY', 'SUBMITTED']),
  suspects: z.array(SuspectPublicSchema).length(4),
  evidence: z.array(EvidencePublicSchema).length(8),
  createdAt: iso,
});
export type CasePublic = z.infer<typeof CasePublicSchema>;
export const CasePublicResponseSchema = CasePublicSchema.extend({
  progress: PlayerProgressPublicSchema,
});
export type CasePublicResponse = z.infer<typeof CasePublicResponseSchema>;
export const CaseStatusResponseSchema = z.object({
  caseId: z.string(),
  status: GenerationStatusSchema,
  stageLabel: text,
  canRetry: z.boolean(),
  errorCode: z.string().nullable(),
});
export type CaseStatusResponse = z.infer<typeof CaseStatusResponseSchema>;
export const HintPublicResponseSchema = z.object({
  hintNumber: z.number().int().min(1).max(3),
  text,
  hintsRemaining: z.number().int().min(0).max(2),
});
export type HintPublicResponse = z.infer<typeof HintPublicResponseSchema>;
export const SolveRequestSchema = z
  .object({
    suspectId: z.string().regex(/^S-0[1-4]$/),
    evidenceIds: z
      .array(z.string().regex(/^EV-0[1-8]$/))
      .max(3)
      .refine((ids) => new Set(ids).size === ids.length, 'Choose unique evidence.')
      .default([]),
    reasoning: z.string().trim().max(500).optional(),
  })
  .strict();
export type SolveRequest = z.infer<typeof SolveRequestSchema>;
export const VerdictResponseSchema = z.object({
  caseId: z.string(),
  culpritSuspectId: z.string(),
  culpritName: text,
  isCorrect: z.boolean(),
  score: z.number().int().min(0).max(100),
  motive: text,
  method: text,
  opportunity: text,
  actualTimeline: z.array(z.object({ occurredAt: iso, event: text })),
  supportingEvidenceIds: z.array(z.string()),
  verdictExplanation: text,
  redHerringExplanations: z.record(z.string(), z.string()),
  suspectEliminationReasons: z.record(z.string(), z.string()),
  selectedSuspectId: z.string(),
  selectedEvidenceIds: z.array(z.string()),
  playerReasoning: z.string().nullable().optional(),
  hintsUsed: z.number().int().min(0).max(3),
  submittedAt: iso,
});
export type VerdictResponse = z.infer<typeof VerdictResponseSchema>;

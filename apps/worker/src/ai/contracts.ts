import { z } from 'zod';

const text = z.string().trim().min(1).max(12000);
const id = z.string().regex(/^S-0[1-4]$/);
const evidenceId = z.string().regex(/^EV-0[1-8]$/);
const timestamp = z.string().datetime({ offset: true });
export const MessageSchema = z
  .object({ id: text, sender: text, timestamp, text: text.max(2000) })
  .strict();
export const SuspectSchema = z
  .object({
    id,
    name: text.max(100),
    age: z.number().int().min(18).max(100),
    role: text,
    relationshipToIncident: text,
    statedAlibi: text,
    publicStatement: text,
    motivePossibility: text,
  })
  .strict();
export const CanonicalFactSchema = z
  .object({
    id: z.string().regex(/^FACT-\d{2}$/),
    statement: text,
    occurredAt: timestamp.nullable(),
    involvedSuspectIds: z.array(id).max(4),
  })
  .strict();
export const EvidencePlanSchema = z
  .object({
    id: evidenceId,
    type: z.enum(['CHAT', 'PHOTO', 'CCTV', 'DOCUMENT']),
    title: text.max(160),
    source: text.max(300),
    occurredAt: timestamp,
    factIds: z
      .array(z.string().regex(/^FACT-\d{2}$/))
      .min(1)
      .max(20),
    authoredObservation: text,
    renderBrief: text,
    chatParticipants: z.array(text.max(100)).min(2).max(4).optional(),
    documentKind: z.enum(['INCIDENT_REPORT', 'WITNESS', 'ACCESS_LOG']).optional(),
    cameraLabel: text.max(40).optional(),
    cameraTimestamp: timestamp.optional(),
  })
  .strict();
export const PrivateBlueprintSchema = z
  .object({
    title: text.max(160),
    incident: text,
    location: text.max(300),
    timezone: text.max(100),
    fictionalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    objective: text,
    suspects: z.array(SuspectSchema).length(4),
    culpritSuspectId: id,
    canonicalFacts: z.array(CanonicalFactSchema).min(6).max(40),
    actualTimeline: z
      .array(z.object({ occurredAt: timestamp, event: text }).strict())
      .min(4)
      .max(30),
    evidencePlans: z.array(EvidencePlanSchema).length(8),
    solution: z
      .object({
        motive: text,
        method: text,
        opportunity: text,
        supportingEvidenceIds: z.array(evidenceId).min(3).max(8),
        redHerringExplanations: z.record(evidenceId, text),
        suspectEliminationReasons: z.record(id, text),
        verdictExplanation: text,
        hintTexts: z.tuple([text.max(1000), text.max(1000), text.max(1000)]),
      })
      .strict(),
  })
  .strict();
export type PrivateBlueprint = z.infer<typeof PrivateBlueprintSchema>;
export type EvidencePlan = z.infer<typeof EvidencePlanSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type BlueprintInput = { premise: string; difficulty: 'easy' | 'medium' | 'hard' };
export type LockedEvidenceInput = { blueprint: PrivateBlueprint; plan: EvidencePlan };
export type LockedVisualInput = LockedEvidenceInput & { frameIndex?: number };
export type GeneratedMedia = {
  data: Buffer;
  mimeType: string;
  method: 'MOCK' | 'GEMINI_IMAGE' | 'GEMINI_OMNI_VIDEO' | 'AI_FRAME_VIDEO';
};
export type PublicReviewInput = Pick<
  PrivateBlueprint,
  'title' | 'incident' | 'location' | 'timezone' | 'fictionalDate' | 'objective' | 'suspects'
> & {
  evidence: Array<{ id: string; type: string; occurredAt: string; observation: string }>;
};
export const ReviewResultSchema = z
  .object({
    verdict: z.enum(['ACCEPT', 'REJECT']),
    suspectId: id.nullable(),
    reasons: text,
    ambiguous: z.boolean(),
  })
  .strict();
export type ReviewResult = z.infer<typeof ReviewResultSchema>;
export interface MysteryAIProvider {
  readonly mode: 'mock' | 'gemini';
  generateBlueprint(input: BlueprintInput): Promise<PrivateBlueprint>;
  reviewSolvability(input: PublicReviewInput): Promise<ReviewResult>;
  generateChat(input: LockedEvidenceInput): Promise<Message[]>;
  generateDocument(input: LockedEvidenceInput): Promise<string>;
  generatePhoto(input: LockedVisualInput): Promise<GeneratedMedia>;
  generateCctvVideo(input: LockedVisualInput): Promise<GeneratedMedia>;
}

export class GenerationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = true,
  ) {
    super(message);
    this.name = 'GenerationError';
  }
}

export function publicReviewInput(blueprint: PrivateBlueprint): PublicReviewInput {
  return {
    title: blueprint.title,
    incident: blueprint.incident,
    location: blueprint.location,
    timezone: blueprint.timezone,
    fictionalDate: blueprint.fictionalDate,
    objective: blueprint.objective,
    suspects: blueprint.suspects,
    evidence: blueprint.evidencePlans.map((p) => ({
      id: p.id,
      type: p.type,
      occurredAt: p.occurredAt,
      observation: p.authoredObservation,
    })),
  };
}

export function validateBlueprint(value: unknown): PrivateBlueprint {
  const b = PrivateBlueprintSchema.parse(value);
  const fail = (message: string): never => {
    throw new GenerationError('INVALID_CANON', message);
  };
  const unique = (values: string[]) => new Set(values).size === values.length;
  if (!unique(b.suspects.map((s) => s.id)) || !unique(b.suspects.map((s) => s.name.toLowerCase())))
    fail('Suspects must be distinct.');
  if (!b.suspects.some((s) => s.id === b.culpritSuspectId)) fail('Culprit not in suspects.');
  if (!unique(b.evidencePlans.map((e) => e.id)) || !unique(b.canonicalFacts.map((f) => f.id)))
    fail('Duplicate evidence or fact IDs.');
  if (!unique(b.solution.supportingEvidenceIds)) fail('Supporting clues must be unique.');
  const facts = new Set(b.canonicalFacts.map((f) => f.id));
  const suspectIds = new Set(b.suspects.map((s) => s.id));
  const counts = { CHAT: 0, PHOTO: 0, CCTV: 0, DOCUMENT: 0 };
  for (const plan of b.evidencePlans) {
    counts[plan.type]++;
    if (plan.factIds.some((f) => !facts.has(f)) || !unique(plan.factIds))
      fail('Evidence references missing/duplicate facts.');
    if (plan.type === 'CHAT' && !plan.chatParticipants) fail('Chat participants missing.');
    if (plan.type === 'DOCUMENT' && !plan.documentKind) fail('Document kind missing.');
    if (plan.type === 'CCTV' && (!plan.cameraLabel || !plan.cameraTimestamp))
      fail('CCTV metadata missing.');
  }
  if (counts.CHAT !== 2 || counts.PHOTO !== 2 || counts.CCTV !== 1 || counts.DOCUMENT !== 3)
    fail('Wrong evidence pack counts.');
  const documentKinds = b.evidencePlans
    .filter((e) => e.type === 'DOCUMENT')
    .map((e) => e.documentKind!);
  if (new Set(documentKinds).size !== 3) fail('Exactly one of each document kind required.');
  if (b.canonicalFacts.some((f) => f.involvedSuspectIds.some((s) => !suspectIds.has(s))))
    fail('Fact references missing suspect.');
  const supported = b.solution.supportingEvidenceIds.map(
    (e) => b.evidencePlans.find((p) => p.id === e) ?? fail('Missing supporting evidence.'),
  );
  if (new Set(supported.map((p) => p.type)).size < 2)
    fail('Need supporting clues in at least two modalities.');
  if (
    !supported.some((p) =>
      p.factIds.some((f) =>
        b.canonicalFacts
          .find((fact) => fact.id === f)
          ?.involvedSuspectIds.includes(b.culpritSuspectId),
      ),
    )
  )
    fail('Supporting clues must connect culprit to canon.');
  if (
    b.actualTimeline.some(
      (event, i, all) => i > 0 && Date.parse(event.occurredAt) < Date.parse(all[i - 1]!.occurredAt),
    )
  )
    fail('Timeline not chronological.');
  if (
    Number.isNaN(Date.parse(b.fictionalDate)) ||
    new Date(b.fictionalDate).toISOString().slice(0, 10) !== b.fictionalDate
  )
    fail('Invalid fictional date.');
  try {
    new Intl.DateTimeFormat('en', { timeZone: b.timezone }).format();
  } catch {
    fail('Invalid case timezone.');
  }
  const eliminated = Object.keys(b.solution.suspectEliminationReasons).sort();
  if (
    JSON.stringify(eliminated) !==
    JSON.stringify(
      b.suspects
        .filter((s) => s.id !== b.culpritSuspectId)
        .map((s) => s.id)
        .sort(),
    )
  )
    fail('Explain all three alternative suspects.');
  if (
    Object.keys(b.solution.redHerringExplanations).some(
      (e) => !b.evidencePlans.some((p) => p.id === e),
    )
  )
    fail('Unknown red herring.');
  const culprit = b.suspects.find((s) => s.id === b.culpritSuspectId)!;
  if (
    !unique(b.solution.hintTexts) ||
    b.solution.hintTexts.some(
      (hint) => hint.includes(culprit.name) || hint.includes(b.culpritSuspectId),
    )
  )
    fail('Hints must be distinct and cannot explicitly name culprit.');
  return b;
}

export function validateChat(value: unknown, plan: EvidencePlan): Message[] {
  const messages = z.array(MessageSchema).min(4).max(12).parse(value);
  if (
    new Set(messages.map((m) => m.id)).size !== messages.length ||
    messages.some((m) => !plan.chatParticipants?.includes(m.sender))
  )
    throw new GenerationError('INVALID_CHAT', 'Unknown sender or duplicate message.');
  if (
    new Set(messages.map((m) => m.sender)).size < 2 ||
    messages.some(
      (m, i) => i > 0 && Date.parse(m.timestamp) < Date.parse(messages[i - 1]!.timestamp),
    )
  )
    throw new GenerationError('INVALID_CHAT', 'Chat must be two-sided and chronological.');
  return messages;
}

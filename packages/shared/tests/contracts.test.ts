import { describe, expect, it } from 'vitest';
import { CreateCaseRequestSchema, SolveRequestSchema, EvidencePublicSchema } from '../src/index.js';

describe('public request contracts', () => {
  it('trims premises and rejects bounds and extra control fields', () => {
    expect(
      CreateCaseRequestSchema.parse({ premise: `  ${'x'.repeat(30)}  ` }).premise,
    ).toHaveLength(30);
    for (const premise of ['', 'x'.repeat(29), 'x'.repeat(1201)])
      expect(CreateCaseRequestSchema.safeParse({ premise }).success).toBe(false);
    expect(
      CreateCaseRequestSchema.safeParse({ premise: 'x'.repeat(30), culpritSuspectId: 'S-01' })
        .success,
    ).toBe(false);
  });
  it('rejects repeated clues, invalid suspect IDs, and long reasoning', () => {
    expect(
      SolveRequestSchema.safeParse({ suspectId: 'S-03', evidenceIds: ['EV-01', 'EV-01'] }).success,
    ).toBe(false);
    expect(SolveRequestSchema.safeParse({ suspectId: 'S-09' }).success).toBe(false);
    expect(
      SolveRequestSchema.safeParse({ suspectId: 'S-03', reasoning: 'x'.repeat(501) }).success,
    ).toBe(false);
  });
  it('does not accept a missing playable video or incorrect payload modality', () => {
    const base = {
      id: 'EV-05',
      title: 'Hall camera',
      source: 'Hall',
      occurredAt: '2026-10-28T21:17:00+05:30',
      summary: 'A bag passes.',
      description: 'A bag passes the corridor camera.',
    };
    expect(
      EvidencePublicSchema.safeParse({
        ...base,
        type: 'CCTV',
        payload: { transcript: 'A bag passes.' },
      }).success,
    ).toBe(false);
    expect(
      EvidencePublicSchema.safeParse({
        ...base,
        type: 'PHOTO',
        payload: { documentBody: 'Wrong type.' },
      }).success,
    ).toBe(false);
  });
});

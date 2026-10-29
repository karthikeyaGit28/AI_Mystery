import { describe, expect, it, vi } from 'vitest';
import {
  GenerationError,
  publicReviewInput,
  validateBlueprint,
  validateChat,
} from '../src/ai/contracts.js';
import { MockAIProvider, mockBlueprint } from '../src/ai/mock.js';
import { boundedRetry, renderTextEvidence } from '../src/pipeline/generate.js';

const input = {
  premise: 'At a fictional university festival a trophy disappears from a locked backstage room.',
  difficulty: 'medium' as const,
};
describe('private canon and fair evidence contracts', () => {
  it.each([
    'At a fictional university festival a trophy disappears from a locked backstage room.',
    'The exhibition sculpture vanishes before the museum opens, leaving four adults under suspicion.',
    'Someone sabotaged the soundboard before the concert at a fictional university festival.',
  ])('builds a coherent fixture for %s', async (premise) => {
    const provider = new MockAIProvider();
    const blueprint = validateBlueprint(await provider.generateBlueprint({ ...input, premise }));
    const review = await provider.reviewSolvability(publicReviewInput(blueprint));
    expect(blueprint.suspects).toHaveLength(4);
    expect(blueprint.evidencePlans).toHaveLength(8);
    expect(review).toMatchObject({
      verdict: 'ACCEPT',
      suspectId: blueprint.culpritSuspectId,
      ambiguous: false,
    });
    expect(blueprint.solution.supportingEvidenceIds).toContain('EV-07');
  });
  it('has distinct theft, disappearance and sabotage narratives', () => {
    const titles = [
      'theft at a fictional college festival',
      'exhibition sculpture disappearance',
      'soundboard sabotage',
    ].map((premise) => mockBlueprint({ ...input, premise }).title);
    expect(new Set(titles).size).toBe(3);
  });
  it.each([
    'culprit',
    'duplicate',
    'fact',
    'timeline',
    'timezone',
    'modality',
    'elimination',
    'hint',
  ] as const)('rejects invalid %s before any media generation', (kind) => {
    const blueprint = structuredClone(mockBlueprint(input));
    if (kind === 'culprit') blueprint.culpritSuspectId = 'S-05';
    if (kind === 'duplicate') blueprint.evidencePlans[1]!.id = blueprint.evidencePlans[0]!.id;
    if (kind === 'fact') blueprint.evidencePlans[0]!.factIds = ['FACT-99'];
    if (kind === 'timeline') blueprint.actualTimeline.reverse();
    if (kind === 'timezone') blueprint.timezone = 'Mars/Olympus';
    if (kind === 'modality') blueprint.solution.supportingEvidenceIds = ['EV-06', 'EV-07', 'EV-08'];
    if (kind === 'elimination') delete blueprint.solution.suspectEliminationReasons['S-01'];
    if (kind === 'hint') blueprint.solution.hintTexts[0] = 'Mira Sen is the answer.';
    expect(() => validateBlueprint(blueprint)).toThrow();
  });
  it('the independent reviewer receives no solution, private fact IDs or hint scripts', () => {
    const serialized = JSON.stringify(publicReviewInput(mockBlueprint(input)));
    for (const forbidden of [
      'culpritSuspectId',
      'canonicalFacts',
      'FACT-01',
      'supportingEvidenceIds',
      'hintTexts',
      'actualTimeline',
      'solution',
    ])
      expect(serialized).not.toContain(forbidden);
  });
  it('validates chat participants, ordering and two-sided content', async () => {
    const blueprint = mockBlueprint(input);
    const plan = blueprint.evidencePlans[0]!;
    const messages = await new MockAIProvider().generateChat({ blueprint, plan });
    expect(validateChat(messages, plan)).toHaveLength(4);
    expect(() =>
      validateChat(
        messages.map((m) => ({ ...m, sender: 'Unknown person' })),
        plan,
      ),
    ).toThrow();
    expect(() => validateChat([...messages].reverse(), plan)).toThrow();
  });
  it('resumes rendered text checkpoints without repeating provider calls', async () => {
    const provider = new MockAIProvider();
    const blueprint = mockBlueprint(input);
    const first = await renderTextEvidence(provider, blueprint);
    const chat = vi.spyOn(provider, 'generateChat');
    const document = vi.spyOn(provider, 'generateDocument');
    const resumed = await renderTextEvidence(provider, blueprint, first.slice(0, 3));
    expect(resumed).toHaveLength(5);
    expect(chat).not.toHaveBeenCalled();
    expect(document).toHaveBeenCalledTimes(2);
  });
});

describe('bounded failure recovery', () => {
  it('never exceeds three attempts for malformed provider output', async () => {
    const operation = vi
      .fn()
      .mockRejectedValue(new GenerationError('INVALID_MODEL_OUTPUT', 'Malformed provider output'));
    await expect(boundedRetry(operation, 3, 0)).rejects.toMatchObject({
      code: 'INVALID_MODEL_OUTPUT',
    });
    expect(operation).toHaveBeenCalledTimes(3);
  });
  it('does not retry safety blocks', async () => {
    const operation = vi
      .fn()
      .mockRejectedValue(new GenerationError('CONTENT_BLOCKED', 'Blocked', false));
    await expect(boundedRetry(operation, 3, 0)).rejects.toMatchObject({ code: 'CONTENT_BLOCKED' });
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

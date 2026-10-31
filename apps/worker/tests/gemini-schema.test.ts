import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PrivateBlueprintSchema, validateBlueprint } from '../src/ai/contracts.js';
import { mockBlueprint } from '../src/ai/mock.js';
import { toGeminiResponseSchema } from '../src/ai/gemini-schema.js';

const input = {
  premise: 'At a fictional university festival a trophy disappears from a locked backstage room.',
  difficulty: 'medium' as const,
};

describe('Gemini response grammar simplification', () => {
  it('preserves schema shape, required fields, enum choices and strict objects without mutating its input', () => {
    const original = z.toJSONSchema(PrivateBlueprintSchema);
    const snapshot = JSON.stringify(original);
    const wire = toGeminiResponseSchema(original) as any;
    const source = original as any;
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(wire).not.toBe(original);
    expect(wire.type).toBe('object');
    expect(wire.required).toEqual(source.required);
    expect(Object.keys(wire.properties)).toEqual(Object.keys(source.properties));
    expect(wire.additionalProperties).toBe(false);
    expect(wire.properties.suspects.items.required).toEqual(
      source.properties.suspects.items.required,
    );
    expect(wire.properties.evidencePlans.items.properties.type.enum).toEqual([
      'CHAT',
      'PHOTO',
      'CCTV',
      'DOCUMENT',
    ]);
    expect(wire.properties.evidencePlans.items.additionalProperties).toBe(false);
    expect(wire.properties.culpritSuspectId.pattern).toBe('^S-0[1-4]$');
    expect(wire.properties.title.maxLength).toBe(160);
    expect(
      wire.properties.solution.properties.redHerringExplanations.additionalProperties.type,
    ).toBe('string');
    wire.properties.title.maxLength = 1;
    expect(source.properties.title.maxLength).toBe(160);
  });
  it('moves expensive nested item bounds and numeric ranges into descriptions', () => {
    const wire = toGeminiResponseSchema(z.toJSONSchema(PrivateBlueprintSchema)) as any;
    expect(wire.properties.suspects).not.toHaveProperty('minItems');
    expect(wire.properties.suspects).not.toHaveProperty('maxItems');
    expect(wire.properties.suspects.description).toContain('exactly 4');
    expect(wire.properties.canonicalFacts.description).toContain('at least 6');
    expect(wire.properties.canonicalFacts.description).toContain('at most 40');
    const facts = wire.properties.evidencePlans.items.properties.factIds;
    expect(facts).not.toHaveProperty('maxItems');
    expect(facts.description).toContain('at most 20');
    const age = wire.properties.suspects.items.properties.age;
    expect(age.type).toBe('integer');
    expect(age).not.toHaveProperty('minimum');
    expect(age).not.toHaveProperty('maximum');
    expect(age.description).toContain('>= 18');
    expect(age.description).toContain('<= 100');
  });
  it('removes both datetime constraints while retaining nullable union types and ordinary ID patterns', () => {
    const wire = toGeminiResponseSchema(z.toJSONSchema(PrivateBlueprintSchema)) as any;
    const timestamp = wire.properties.canonicalFacts.items.properties.occurredAt.anyOf[0];
    expect(timestamp.type).toBe('string');
    expect(timestamp).not.toHaveProperty('format');
    expect(timestamp).not.toHaveProperty('pattern');
    expect(timestamp.description).toContain('ISO 8601');
    expect(wire.properties.canonicalFacts.items.properties.occurredAt.anyOf[1]).toEqual({
      type: 'null',
    });
    expect(wire.properties.actualTimeline.items.properties.occurredAt).not.toHaveProperty('format');
    expect(wire.properties.evidencePlans.items.properties.cameraTimestamp).not.toHaveProperty(
      'pattern',
    );
    expect(wire.properties.fictionalDate.pattern).toBe('^\\d{4}-\\d{2}-\\d{2}$');
  });
  it('normalizes identical hint tuple positions to homogeneous items with the same exact count', () => {
    const original = z.toJSONSchema(PrivateBlueprintSchema) as any;
    const wire = toGeminiResponseSchema(original) as any;
    const hints = wire.properties.solution.properties.hintTexts;
    expect(hints).not.toHaveProperty('prefixItems');
    expect(hints.items).toEqual({ type: 'string', minLength: 1, maxLength: 1000 });
    expect(hints.minItems).toBe(3);
    expect(hints.maxItems).toBe(3);
    expect(original.properties.solution.properties.hintTexts.prefixItems).toHaveLength(3);
    expect(original.properties.solution.properties.hintTexts.items).toBe(false);
  });
  it('preserves existing descriptions and application properties whose names resemble schema keywords', () => {
    const wire = toGeminiResponseSchema({
      type: 'object',
      properties: {
        format: { type: 'string' },
        minimum: { type: 'integer', minimum: 2, description: 'Existing guidance.' },
      },
      required: ['format', 'minimum'],
    }) as any;
    expect(wire.properties.format).toEqual({ type: 'string' });
    expect(wire.properties.minimum.description).toBe('Existing guidance. Value must be >= 2.');
    expect(wire.required).toEqual(['format', 'minimum']);
  });
  it.each([
    'suspect count',
    'evidence count',
    'adult age',
    'timestamp',
    'hint count',
    'fact reference',
  ])('still rejects invalid %s through the original runtime validators', (kind) => {
    toGeminiResponseSchema(z.toJSONSchema(PrivateBlueprintSchema));
    const blueprint = structuredClone(mockBlueprint(input));
    if (kind === 'suspect count') blueprint.suspects.pop();
    if (kind === 'evidence count') blueprint.evidencePlans.pop();
    if (kind === 'adult age') blueprint.suspects[0]!.age = 17;
    if (kind === 'timestamp') blueprint.actualTimeline[0]!.occurredAt = 'not-an-ISO-timestamp';
    if (kind === 'hint count') blueprint.solution.hintTexts.pop();
    if (kind === 'fact reference') blueprint.evidencePlans[0]!.factIds = ['FACT-99'];
    expect(() => validateBlueprint(blueprint)).toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import {
  AssetModel,
  CaseModel,
  EventModel,
  GuestModel,
  IdempotencyModel,
  ProgressModel,
  SecretModel,
} from '../src/models.js';

describe('UUID defaults during Mongoose upsert', () => {
  it.each([
    AssetModel,
    CaseModel,
    EventModel,
    GuestModel,
    IdempotencyModel,
    ProgressModel,
    SecretModel,
  ])('generates IDs with a null document scope for $modelName', (model) => {
    // setDefaultsOnInsert calls default functions with null as both receiver and argument.
    // Passing crypto.randomUUID directly forwards null as its options argument and throws.
    const idPath = model.schema.path('_id') as unknown as {
      getDefault(scope: null, init: boolean): string;
    };
    const first = idPath.getDefault(null, true);
    const second = idPath.getDefault(null, true);
    expect(first).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(second).not.toBe(first);
  });
});

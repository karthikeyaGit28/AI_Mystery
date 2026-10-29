import { describe, expect, it, vi } from 'vitest';
import { MockAIProvider, mockBlueprint } from '../src/ai/mock.js';
import { GenerationError } from '../src/ai/contracts.js';
import { extractPoster, MediaPipeline, normalizedPhoto } from '../src/media/pipeline.js';

const input = {
  premise: 'At a fictional university festival a trophy disappears from the locked backstage room.',
  difficulty: 'medium' as const,
};
describe('real demo media pipeline', () => {
  it('generates distinct labelled photos, valid webp images and thumbnails', async () => {
    const provider = new MockAIProvider();
    const blueprint = mockBlueprint(input);
    const plans = blueprint.evidencePlans.filter((plan) => plan.type === 'PHOTO');
    const first = await normalizedPhoto(
      await provider.generatePhoto({ blueprint, plan: plans[0]! }),
    );
    const second = await normalizedPhoto(
      await provider.generatePhoto({ blueprint, plan: plans[1]! }),
    );
    expect(first.width).toBe(1280);
    expect(first.height).toBe(720);
    expect(first.data.subarray(8, 12).toString()).toBe('WEBP');
    expect(first.thumbnail.length).toBeLessThan(first.data.length);
    expect(first.data.equals(second.data)).toBe(false);
  });
  it('compiles playable H.264 CCTV from two test frames and extracts a poster', async () => {
    const provider = new MockAIProvider();
    const blueprint = mockBlueprint(input);
    const generated = vi.spyOn(provider, 'generatePhoto');
    const clip = await new MediaPipeline(provider).createCctv({
      blueprint,
      plan: blueprint.evidencePlans.find((p) => p.type === 'CCTV')!,
    });
    expect(generated).toHaveBeenCalledTimes(2);
    expect(clip.method).toBe('MOCK');
    expect(clip.fallback).toBe(true);
    expect(clip.durationSeconds).toBeCloseTo(6, 0);
    expect(clip.width).toBe(1280);
    expect(clip.data.subarray(4, 8).toString()).toBe('ftyp');
    expect((await extractPoster(clip.data)).subarray(8, 12).toString()).toBe('WEBP');
  }, 60000);
  it('fails explicitly when video and AI frames both fail', async () => {
    const provider = new MockAIProvider();
    const blueprint = mockBlueprint(input);
    vi.spyOn(provider, 'generatePhoto').mockRejectedValue(
      new GenerationError('IMAGE_CAPABILITY_UNAVAILABLE', 'Frames unavailable', false),
    );
    await expect(
      new MediaPipeline(provider).createCctv({
        blueprint,
        plan: blueprint.evidencePlans.find((p) => p.type === 'CCTV')!,
      }),
    ).rejects.toMatchObject({ code: 'IMAGE_CAPABILITY_UNAVAILABLE' });
  });
  it('rejects malformed or tiny image data', async () => {
    await expect(
      normalizedPhoto({ data: Buffer.from('invalid'), mimeType: 'image/png', method: 'MOCK' }),
    ).rejects.toThrow();
  });
});

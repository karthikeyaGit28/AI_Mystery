import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { mockBlueprint, MockAIProvider } from '../src/ai/mock.js';

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    interactions = { create };
  },
}));
vi.mock('@amr/server', () => ({
  config: {
    FREE_TIER_ONLY: true,
    GEMINI_API_KEY: 'test-only-key',
    GEMINI_TEXT_MODEL: 'gemini-3.8-flash',
    GEMINI_TEXT_MIN_INTERVAL_MS: 0,
    GEMINI_IMAGE_MODEL: 'gemini-nano-banana-2.1',
    GEMINI_VIDEO_MODEL: 'gemini-omni-1.1-flash',
    MAX_MEDIA_BYTES: 20 * 1024 * 1024,
    FFMPEG_PATH: '',
    FFPROBE_PATH: '',
  },
}));

import {
  CloudflareImageProvider,
  CloudflareMediaProvider,
  cloudflareVisualPrompt,
  FREE_CLOUDFLARE_IMAGE_MODEL,
  validateFreeVisualBriefs,
} from '../src/ai/cloudflare.js';
import { GeminiAIProvider } from '../src/ai/gemini.js';
import { RequestPacer } from '../src/ai/pacer.js';
import {
  ffmpegPath,
  MediaPipeline,
  mediaDimensions,
  mediaProcessArguments,
} from '../src/media/pipeline.js';

const blueprint = mockBlueprint({
  premise: 'At a fictional university festival a trophy disappears from the locked backstage room.',
  difficulty: 'medium',
});
const visual = { blueprint, plan: blueprint.evidencePlans.find((plan) => plan.type === 'PHOTO')! };
const accountId = 'a'.repeat(32);
const options = { accountId, apiToken: 'test-token', model: FREE_CLOUDFLARE_IMAGE_MODEL };
const image = Buffer.alloc(120, 42);
beforeEach(() => {
  create.mockReset();
});

describe('free real image provider', () => {
  it('calls the documented FLUX REST endpoint and decodes its base64 result with correct provenance', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ success: true, result: { image: image.toString('base64') } }),
      );
    const result = await new CloudflareImageProvider({ ...options, fetch: request }).generatePhoto(
      visual,
    );
    expect(result).toEqual({ data: image, mimeType: 'image/jpeg', method: 'CLOUDFLARE_IMAGE' });
    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${FREE_CLOUDFLARE_IMAGE_MODEL}`,
    );
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: 'Bearer test-token' },
    });
    const body = JSON.parse(init!.body as string) as { prompt: string; steps: number };
    expect(body.steps).toBe(4);
    expect(body.prompt).toContain(visual.plan.renderBrief);
    expect(body.prompt.length).toBeLessThanOrEqual(2048);
    expect(body.prompt).not.toContain('culpritSuspectId');
    expect(body.prompt).not.toContain('hintTexts');
  });
  it('rejects other models before making a provider request', () => {
    const request = vi.fn<typeof fetch>();
    expect(
      () =>
        new CloudflareImageProvider({ ...options, model: '@cf/some-paid/model', fetch: request }),
    ).toThrow('free-tier');
    expect(request).not.toHaveBeenCalled();
  });
  it('exposes exhausted free quota as a nonretrying recoverable case error', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ success: false }, { status: 429 }));
    await expect(
      new CloudflareImageProvider({ ...options, fetch: request }).generatePhoto(visual),
    ).rejects.toMatchObject({ code: 'FREE_AI_QUOTA_EXCEEDED', retryable: false });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([
    { success: true, result: {} },
    { success: true, result: { image: 'invalid base64!' } },
    { success: false, result: { image: image.toString('base64') } },
  ])('rejects malformed provider media', async (body) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body));
    await expect(
      new CloudflareImageProvider({ ...options, fetch: request }).generatePhoto(visual),
    ).rejects.toMatchObject({ code: 'INVALID_CLOUDFLARE_OUTPUT' });
  });
  it('fails an oversized locked brief instead of silently dropping canonical visual facts', () => {
    expect(() =>
      cloudflareVisualPrompt({
        ...visual,
        plan: { ...visual.plan, renderBrief: 'x'.repeat(2100) },
      }),
    ).toThrow('provider limit');
  });
  it('rejects an unrenderable candidate before canon locking with a retryable generation error', () => {
    const candidate = structuredClone(blueprint);
    candidate.evidencePlans.find((plan) => plan.type === 'CCTV')!.renderBrief = 'x'.repeat(2100);
    expect(() => validateFreeVisualBriefs(candidate)).toThrowError(
      expect.objectContaining({ code: 'INVALID_VISUAL_BRIEF', retryable: true }),
    );
    expect(candidate.evidencePlans.find((plan) => plan.type === 'CCTV')!.renderBrief).toHaveLength(
      2100,
    );
  });
  it('accepts complete boundary-sized visual briefs without truncation', () => {
    const candidate = structuredClone(blueprint);
    candidate.location = 'L'.repeat(300);
    for (const plan of candidate.evidencePlans.filter(
      (item) => item.type === 'PHOTO' || item.type === 'CCTV',
    ))
      plan.renderBrief = 'V'.repeat(1200);
    expect(validateFreeVisualBriefs(candidate)).toBe(candidate);
    for (const plan of candidate.evidencePlans.filter(
      (item) => item.type === 'PHOTO' || item.type === 'CCTV',
    ))
      expect(cloudflareVisualPrompt({ blueprint: candidate, plan }).length).toBeLessThanOrEqual(
        2048,
      );
  });
  it('delegates text and photos while selecting the AI-frame path without any motion-video request', async () => {
    const text = new MockAIProvider();
    const motion = vi.spyOn(text, 'generateCctvVideo');
    const photos = new CloudflareImageProvider({
      ...options,
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ success: true, result: { image: image.toString('base64') } }),
        ),
    });
    const provider = new CloudflareMediaProvider(text, photos);
    expect(
      (await provider.generateBlueprint({ premise: blueprint.incident, difficulty: 'medium' }))
        .title,
    ).toBe(blueprint.title);
    expect((await provider.generatePhoto(visual)).method).toBe('CLOUDFLARE_IMAGE');
    await expect(provider.generateCctvVideo()).rejects.toMatchObject({
      code: 'VIDEO_CAPABILITY_UNAVAILABLE',
    });
    expect(motion).not.toHaveBeenCalled();
  });
  it('compiles a playable 360p AI-frame recording from real decoded Cloudflare response images', async () => {
    const plan = blueprint.evidencePlans.find((item) => item.type === 'CCTV')!;
    const fixture = await new MockAIProvider().generatePhoto({ blueprint, plan });
    const jpeg = await sharp(fixture.data).jpeg().toBuffer();
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        Response.json({ success: true, result: { image: jpeg.toString('base64') } }),
      );
    const provider = new CloudflareMediaProvider(
      new MockAIProvider(),
      new CloudflareImageProvider({ ...options, fetch: request }),
    );
    const clip = await new MediaPipeline(provider).createCctv({ blueprint, plan });
    expect(request).toHaveBeenCalledTimes(2);
    expect(clip).toMatchObject({
      width: 640,
      height: 360,
      method: 'AI_FRAME_VIDEO',
      fallback: true,
    });
    expect(clip.data.subarray(4, 8).toString()).toBe('ftyp');
    expect(clip.durationSeconds).toBeCloseTo(6, 0);
  }, 60000);
});

describe('free-only billing guards', () => {
  it('checks local SDK capability without consuming a free provider request', () => {
    new GeminiAIProvider().checkLocalCapability();
    expect(create).not.toHaveBeenCalled();
  });
  it('constrains blueprint generation to concise free-provider visual briefs before returning a candidate', async () => {
    create.mockResolvedValue({
      status: 'completed',
      outputs: [{ type: 'text', text: JSON.stringify(blueprint) }],
    });
    expect(
      (
        await new GeminiAIProvider().generateBlueprint({
          premise: blueprint.incident,
          difficulty: 'medium',
        })
      ).title,
    ).toBe(blueprint.title);
    const request = create.mock.calls[0]![0] as {
      input: string;
      response_format: {
        properties: {
          location: { maxLength: number };
          evidencePlans: { items: { properties: { renderBrief: { maxLength: number } } } };
        };
      };
    };
    expect(request.response_format.properties.location.maxLength).toBe(200);
    expect(
      request.response_format.properties.evidencePlans.items.properties.renderBrief.maxLength,
    ).toBe(1000);
    expect(request.input).toContain('visualConstraints');
  });
  it('blocks direct Gemini photos and video before the SDK can make a request', async () => {
    const provider = new GeminiAIProvider();
    await expect(provider.generatePhoto(visual)).rejects.toMatchObject({
      code: 'PAID_MEDIA_DISABLED',
      retryable: false,
    });
    await expect(provider.generateCctvVideo(visual)).rejects.toMatchObject({
      code: 'PAID_MEDIA_DISABLED',
      retryable: false,
    });
    expect(create).not.toHaveBeenCalled();
  });
  it('maps Gemini free text rate limits without silently moving to a paid model', async () => {
    create.mockRejectedValue({ status: 429, message: 'quota exhausted' });
    await expect(new GeminiAIProvider().checkCapability()).rejects.toMatchObject({
      code: 'FREE_AI_QUOTA_EXCEEDED',
      retryable: false,
    });
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('uses low-memory dimensions and single-threaded media processing', () => {
    expect(mediaDimensions()).toEqual({ width: 640, height: 360 });
    const args = mediaProcessArguments(ffmpegPath(), ['-y', '-i', 'source.png', 'output.mp4']);
    expect(args).toContain('-filter_complex_threads');
    expect(args.slice(-3)).toEqual(['-threads', '1', 'output.mp4']);
  });
});

describe('request pacing without real-time waits', () => {
  it('serializes request starts across simultaneous callers using the shared interval', async () => {
    let now = 1000;
    const waits: number[] = [];
    const pacer = new RequestPacer(
      () => now,
      async (duration) => {
        waits.push(duration);
        now += duration;
      },
    );
    await Promise.all([pacer.pace(15000), pacer.pace(15000), pacer.pace(15000)]);
    expect(waits).toEqual([15000, 15000]);
  });
  it('leaves standard-mode calls unpaced', async () => {
    const wait = vi.fn(async () => {});
    const pacer = new RequestPacer(() => 0, wait);
    await Promise.all([pacer.pace(0), pacer.pace(0)]);
    expect(wait).not.toHaveBeenCalled();
  });
});

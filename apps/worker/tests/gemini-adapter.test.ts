import { describe, expect, it, vi } from 'vitest';
import { GoogleGenAI } from '@google/genai';
import { config } from '@amr/server';
import { GeminiAIProvider, interactionRequest, normalizeInteraction } from '../src/ai/gemini.js';

describe('installed official Gemini SDK contract', () => {
  it('uses the documented Interactions structured-text wrapper', () => {
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } } };
    expect(
      interactionRequest('configured-text-model', 'input', { type: 'text', schema }),
    ).toMatchObject({
      response_format: { type: 'text', mime_type: 'application/json', schema },
      stream: false,
      store: false,
    });
    expect(
      interactionRequest('configured-text-model', 'input', { type: 'text', schema }),
    ).not.toHaveProperty('response_mime_type');
    expect(
      interactionRequest('configured-text-model', 'input', { type: 'text', schema }),
    ).not.toHaveProperty('response_modalities');
  });
  it('serializes the structured-text wrapper through the installed SDK without a network request', async () => {
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
    // SDK 2 supports public fetch injection. Capture actual serialized HTTP JSON
    // while ensuring this test can never contact Google's service.
    const request = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
      const outbound = url instanceof Request ? url : new Request(url, options);
      const body = await outbound.json();
      expect(body).toMatchObject({
        response_format: { type: 'text', mime_type: 'application/json', schema },
        stream: false,
        store: false,
      });
      expect(body).not.toHaveProperty('response_mime_type');
      expect(body).not.toHaveProperty('response_modalities');
      expect(body).not.toHaveProperty('automatic_continuation');
      expect(
        outbound.headers.get('x-goog-api-client') ?? outbound.headers.get('user-agent'),
      ).toContain('2.32.0');
      return Response.json({
        id: 'offline-interaction',
        created: '2026-10-30T00:00:00Z',
        updated: '2026-10-30T00:00:00Z',
        status: 'completed',
        steps: [{ type: 'model_output', content: [{ type: 'text', text: '{"ok":true}' }] }],
      });
    });
    const client = new GoogleGenAI({
      apiKey: 'offline-wire-test-key',
      httpOptions: { fetch: request },
    });
    const response = await client.interactions.create(
      interactionRequest('configured-text-model', 'input', { type: 'text', schema }),
      { retries: { strategy: 'none' } },
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(normalizeInteraction(response).output_text).toBe('{"ok":true}');
  });
  it.each([
    { status: 400, name: 'BadRequestError', code: 'PROVIDER_REQUEST_FAILED', retryable: false },
    {
      status: 400,
      name: 'BadRequestError',
      code: 'PROVIDER_SCHEMA_REJECTED',
      retryable: false,
      message: 'The specified schema produces a constraint that has too many states for serving.',
    },
    { status: 429, name: 'RateLimitError', code: 'FREE_AI_QUOTA_EXCEEDED', retryable: false },
    { status: 503, code: 'PROVIDER_BUSY', retryable: true },
  ])(
    'maps actual SDK HTTP $status errors without hidden retries',
    async ({ status, name, code, retryable, message }) => {
      const request = vi.fn<typeof fetch>().mockImplementation(async () =>
        Response.json(
          {
            error: {
              code: status,
              message: message ?? 'Offline HTTP error fixture',
              status:
                status === 429
                  ? 'RESOURCE_EXHAUSTED'
                  : status === 503
                    ? 'UNAVAILABLE'
                    : 'INVALID_ARGUMENT',
            },
          },
          { status },
        ),
      );
      const client = new GoogleGenAI({
        apiKey: 'offline-http-error-key',
        httpOptions: { fetch: request },
      });
      await expect(
        client.interactions.create(
          interactionRequest('gemini-3.8-flash', 'offline', {
            type: 'text',
            schema: { type: 'object' },
          }),
          { retries: { strategy: 'none' } },
        ),
      ).rejects.toMatchObject({ ...(name ? { name } : {}), status, statusCode: status });
      expect(request).toHaveBeenCalledTimes(1);

      request.mockClear();
      const freeTierOnly = config.FREE_TIER_ONLY;
      config.FREE_TIER_ONLY = true;
      try {
        const provider = new GeminiAIProvider();
        // Use the same real SDK with its injected offline transport in the adapter.
        // No provider endpoint can be reached, and the adapter receives SDK errors.
        Reflect.set(provider, 'ai', client);
        await expect(provider.checkCapability()).rejects.toMatchObject({ code, retryable });
        expect(request).toHaveBeenCalledTimes(1);
      } finally {
        config.FREE_TIER_ONLY = freeTierOnly;
      }
    },
  );
  it('uses current image and video response formats without legacy configuration', () => {
    expect(interactionRequest('configured-image-model', 'input', { type: 'image' })).toMatchObject({
      response_format: {
        type: 'image',
        mime_type: 'image/jpeg',
        aspect_ratio: '16:9',
        image_size: '1K',
        delivery: 'inline',
      },
    });
    expect(interactionRequest('configured-video-model', 'input', { type: 'video' })).toMatchObject({
      response_format: { type: 'video', aspect_ratio: '16:9', delivery: 'inline' },
    });
    expect(
      interactionRequest('configured-image-model', 'input', { type: 'image' }),
    ).not.toHaveProperty('generation_config');
    expect(
      interactionRequest('configured-video-model', 'input', { type: 'video' }),
    ).not.toHaveProperty('response_modalities');
  });
  it('normalizes the actual pinned SDK outputs and newer convenience fields', () => {
    expect(
      normalizeInteraction({
        status: 'completed',
        outputs: [
          { type: 'text', text: '{"ok":true}' },
          { type: 'image', data: 'photo', mime_type: 'image/png' },
          { type: 'video', data: 'clip', mime_type: 'video/mp4' },
        ],
      }),
    ).toMatchObject({
      output_text: '{"ok":true}',
      output_image: { data: 'photo' },
      output_video: { data: 'clip' },
    });
    expect(
      normalizeInteraction({
        output_text: 'text',
        output_image: { data: 'image' },
        output_video: { data: 'video' },
      }),
    ).toMatchObject({
      output_text: 'text',
      output_image: { data: 'image' },
      output_video: { data: 'video' },
    });
  });
  it('never treats user input or reasoning steps as generated media', () => {
    expect(
      normalizeInteraction({
        steps: [
          { type: 'user_input', content: [{ type: 'image', data: 'input' }] },
          { type: 'thought', content: [{ type: 'text', text: 'private reasoning' }] },
          { type: 'model_output', content: [{ type: 'video', data: 'generated' }] },
        ],
      }),
    ).toMatchObject({
      output_text: '',
      output_image: undefined,
      output_video: { data: 'generated' },
    });
  });
});

import { describe, expect, it } from 'vitest';
import { interactionRequest, normalizeInteraction } from '../src/ai/gemini.js';

describe('installed official Gemini SDK contract', () => {
  it('uses the pinned SDK JSON schema and separate MIME fields', () => {
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } } };
    expect(
      interactionRequest('configured-text-model', 'input', { type: 'text', schema }),
    ).toMatchObject({
      response_format: schema,
      response_mime_type: 'application/json',
      response_modalities: ['text'],
      stream: false,
      store: false,
    });
  });
  it('requests images through modalities and image generation configuration', () => {
    expect(interactionRequest('configured-image-model', 'input', { type: 'image' })).toMatchObject({
      response_modalities: ['image'],
      generation_config: { image_config: { aspect_ratio: '16:9' } },
    });
    expect(interactionRequest('configured-video-model', 'input', { type: 'video' })).toMatchObject({
      response_modalities: ['video'],
    });
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

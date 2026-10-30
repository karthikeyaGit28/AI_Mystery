import { z } from 'zod';
import { config } from '@amr/server';
import {
  GenerationError,
  type BlueprintInput,
  type GeneratedMedia,
  type LockedEvidenceInput,
  type LockedVisualInput,
  type MysteryAIProvider,
  type PrivateBlueprint,
  type PublicReviewInput,
} from './contracts.js';

export const FREE_CLOUDFLARE_IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';
const ResponseSchema = z
  .object({
    success: z.literal(true),
    result: z.object({ image: z.string().min(1) }).passthrough(),
  })
  .passthrough();
type CloudflareOptions = {
  accountId: string;
  apiToken: string;
  model: string;
  fetch?: typeof fetch;
};

export function cloudflareVisualPrompt({ blueprint, plan, frameIndex }: LockedVisualInput) {
  const prompt = [
    'Create a fictional photorealistic scene with fictional adults only. No real likenesses, brands, logos, written labels or extra clue objects. Match the locked brief exactly.',
    `Location: ${blueprint.location}`,
    `Locked visual brief: ${plan.renderBrief}`,
    plan.type === 'CCTV'
      ? `Static high-angle security camera, indistinct faces, 16:9 composition. Frame ${(frameIndex ?? 0) + 1}: a subtly different moment of the same permitted action; no additional events.`
      : 'Natural photographic framing and consistent scene lighting.',
  ].join('\n');
  if (prompt.length > 2048)
    throw new GenerationError(
      'VISUAL_BRIEF_TOO_LONG',
      'The locked visual brief exceeds the image provider limit.',
      false,
    );
  return prompt;
}

export function validateFreeVisualBriefs(blueprint: PrivateBlueprint): PrivateBlueprint {
  for (const plan of blueprint.evidencePlans.filter(
    (item) => item.type === 'PHOTO' || item.type === 'CCTV',
  )) {
    try {
      cloudflareVisualPrompt({ blueprint, plan });
      if (plan.type === 'CCTV') cloudflareVisualPrompt({ blueprint, plan, frameIndex: 1 });
    } catch (error) {
      if (error instanceof GenerationError && error.code === 'VISUAL_BRIEF_TOO_LONG')
        throw new GenerationError(
          'INVALID_VISUAL_BRIEF',
          'The proposed mystery has visual briefs that exceed the free image provider limit.',
          true,
        );
      throw error;
    }
  }
  return blueprint;
}

export class CloudflareImageProvider {
  private readonly options: CloudflareOptions;
  private readonly request: typeof fetch;
  constructor(
    options: CloudflareOptions = {
      accountId: config.CLOUDFLARE_ACCOUNT_ID,
      apiToken: config.CLOUDFLARE_API_TOKEN,
      model: config.CLOUDFLARE_IMAGE_MODEL,
    },
  ) {
    if (options.model !== FREE_CLOUDFLARE_IMAGE_MODEL)
      throw new GenerationError(
        'PAID_MEDIA_DISABLED',
        'Only the explicitly supported free-tier Cloudflare image model is allowed.',
        false,
      );
    if (!/^[a-f0-9]{32}$/i.test(options.accountId) || !options.apiToken)
      throw new GenerationError(
        'CLOUDFLARE_NOT_CONFIGURED',
        'A valid Cloudflare account ID and Workers AI token are required.',
        false,
      );
    this.options = options;
    this.request = options.fetch ?? fetch;
  }
  async generatePhoto(input: LockedVisualInput): Promise<GeneratedMedia> {
    const prompt = cloudflareVisualPrompt(input);
    let response: Response;
    try {
      response = await this.request(
        `https://api.cloudflare.com/client/v4/accounts/${this.options.accountId}/ai/run/${this.options.model}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.options.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ prompt, steps: 4 }),
          redirect: 'error',
          signal: AbortSignal.timeout(120000),
        },
      );
    } catch {
      throw new GenerationError(
        'CLOUDFLARE_REQUEST_FAILED',
        'The free image service could not be reached.',
      );
    }
    if (response.status === 429)
      throw new GenerationError(
        'FREE_AI_QUOTA_EXCEEDED',
        'The free AI image quota or capacity is exhausted. Try again after it resets.',
        false,
      );
    if (!response.ok)
      throw new GenerationError(
        response.status === 401 || response.status === 403
          ? 'CLOUDFLARE_ACCESS_DENIED'
          : 'CLOUDFLARE_REQUEST_FAILED',
        'The free image service rejected this generation.',
        response.status >= 500,
      );
    if (!response.body)
      throw new GenerationError(
        'INVALID_CLOUDFLARE_OUTPUT',
        'The image service returned an empty response.',
      );
    const maxBytes = Math.min(config.MAX_MEDIA_BYTES, 20 * 1024 * 1024);
    const maxEncodedBytes = Math.ceil((maxBytes * 4) / 3) + 8192;
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > maxEncodedBytes) {
          await reader.cancel();
          throw new GenerationError(
            'MEDIA_TOO_LARGE',
            'The free image response exceeded the configured limit.',
            false,
          );
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    let encoded: string;
    try {
      encoded = ResponseSchema.parse(JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')))
        .result.image;
    } catch {
      throw new GenerationError(
        'INVALID_CLOUDFLARE_OUTPUT',
        'The free image service returned malformed image content.',
      );
    }
    if (
      encoded.length > Math.ceil((maxBytes * 4) / 3) + 8 ||
      encoded.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
    )
      throw new GenerationError(
        'INVALID_CLOUDFLARE_OUTPUT',
        'The free image service returned invalid or oversized image content.',
      );
    const data = Buffer.from(encoded, 'base64');
    if (data.length < 100 || data.length > maxBytes)
      throw new GenerationError(
        'INVALID_CLOUDFLARE_OUTPUT',
        'The free image output size is invalid.',
      );
    return { data, mimeType: 'image/jpeg', method: 'CLOUDFLARE_IMAGE' };
  }
}

export class CloudflareMediaProvider implements MysteryAIProvider {
  readonly mode = 'gemini' as const;
  constructor(
    private readonly text: MysteryAIProvider,
    private readonly images: CloudflareImageProvider,
  ) {}
  generateBlueprint(input: BlueprintInput) {
    return this.text.generateBlueprint(input);
  }
  reviewSolvability(input: PublicReviewInput) {
    return this.text.reviewSolvability(input);
  }
  generateChat(input: LockedEvidenceInput) {
    return this.text.generateChat(input);
  }
  generateDocument(input: LockedEvidenceInput) {
    return this.text.generateDocument(input);
  }
  generatePhoto(input: LockedVisualInput) {
    return this.images.generatePhoto(input);
  }
  async generateCctvVideo(): Promise<GeneratedMedia> {
    // The real AI frames are compiled by MediaPipeline; no paid video request is made.
    throw new GenerationError(
      'VIDEO_CAPABILITY_UNAVAILABLE',
      'This provider uses AI-generated surveillance frames instead of paid motion video.',
      false,
    );
  }
}

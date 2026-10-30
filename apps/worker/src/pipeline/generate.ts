import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { EvidencePublicSchema, type EvidencePublic, type GenerationStatus } from '@amr/shared';
import {
  AssetModel,
  CaseModel,
  EventModel,
  GuestModel,
  SecretModel,
  config,
  storage,
} from '@amr/server';
import {
  GenerationError,
  publicReviewInput,
  validateBlueprint,
  validateChat,
  type GeneratedMedia,
  type LockedVisualInput,
  type MysteryAIProvider,
  type PrivateBlueprint,
} from '../ai/contracts.js';
import { GeminiAIProvider } from '../ai/gemini.js';
import { MockAIProvider } from '../ai/mock.js';
import { CloudflareImageProvider, CloudflareMediaProvider } from '../ai/cloudflare.js';
import { extractPoster, MediaPipeline, normalizedPhoto } from '../media/pipeline.js';

export function createProvider(): MysteryAIProvider {
  if (config.AI_MODE === 'mock') return new MockAIProvider();
  const text = new GeminiAIProvider();
  return config.MEDIA_PROVIDER === 'cloudflare'
    ? new CloudflareMediaProvider(text, new CloudflareImageProvider())
    : text;
}
export function safeGenerationCode(error: unknown) {
  return error instanceof GenerationError ? error.code : 'GENERATION_FAILED';
}

export async function boundedRetry<T>(
  operation: (attempt: number) => Promise<T>,
  attempts = 3,
  pause = 500,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= attempts || (error instanceof GenerationError && !error.retryable))
        throw error;
      await delay(
        Math.min(10000, pause * 2 ** (attempt - 1)) +
          Math.floor(Math.random() * Math.max(1, pause / 2)),
      );
    }
  }
}

export async function renderTextEvidence(
  provider: MysteryAIProvider,
  blueprint: PrivateBlueprint,
  checkpoint: EvidencePublic[] = [],
  persist: (items: EvidencePublic[]) => Promise<void> = async () => {},
) {
  const evidence = [...checkpoint];
  for (const plan of blueprint.evidencePlans.filter(
    (p) => p.type === 'CHAT' || p.type === 'DOCUMENT',
  )) {
    if (evidence.some((item) => item.id === plan.id)) continue;
    const base = {
      id: plan.id,
      type: plan.type,
      title: plan.title,
      source: plan.source,
      occurredAt: plan.occurredAt,
      summary: plan.authoredObservation,
      description: plan.authoredObservation,
    };
    const payload =
      plan.type === 'CHAT'
        ? { messages: validateChat(await provider.generateChat({ blueprint, plan }), plan) }
        : {
            documentBody: await provider.generateDocument({ blueprint, plan }),
            documentKind: plan.documentKind,
          };
    evidence.push(EvidencePublicSchema.parse({ ...base, payload }));
    await persist(evidence);
  }
  return evidence;
}

async function assertActive(caseId: string) {
  const record = await CaseModel.findOne({ _id: caseId, deletedAt: null }).lean();
  if (!record || record.status === 'FAILED' || record.status === 'READY')
    throw new GenerationError('CASE_NOT_ACTIVE', 'This case is no longer generating.', false);
  return record;
}

async function runStage<T>(
  caseId: string,
  stage: GenerationStatus,
  operation: () => Promise<T>,
  model: string,
) {
  await assertActive(caseId);
  await CaseModel.updateOne(
    { _id: caseId, deletedAt: null, status: { $nin: ['READY', 'FAILED'] } },
    { $set: { status: stage, generationStage: stage } },
  );
  return boundedRetry(async (attempt) => {
    await assertActive(caseId);
    const startedAt = new Date();
    try {
      const result = await operation();
      await EventModel.create({
        caseId,
        stage,
        attempt,
        model,
        promptVersion: '1',
        startedAt,
        endedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
        errorCode: null,
      });
      return result;
    } catch (error) {
      await EventModel.create({
        caseId,
        stage,
        attempt,
        model,
        promptVersion: '1',
        startedAt,
        endedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
        errorCode: safeGenerationCode(error),
      });
      throw error;
    }
  });
}

type AssetInput = {
  caseId: string;
  evidenceId: string;
  kind: 'PHOTO' | 'CCTV' | 'FRAME' | 'THUMBNAIL';
  data: Buffer;
  mimeType: string;
  method: GeneratedMedia['method'];
  width?: number;
  height?: number;
  durationSeconds?: number;
  frameIndex?: number;
};
async function saveAsset(input: AssetInput) {
  await assertActive(input.caseId);
  const id = randomUUID();
  const extension =
    input.mimeType === 'video/mp4'
      ? 'mp4'
      : input.mimeType === 'image/png'
        ? 'png'
        : input.mimeType === 'image/jpeg'
          ? 'jpg'
          : 'webp';
  const objectKey = `cases/${input.caseId}/${id}.${extension}`;
  if (input.data.length > config.MAX_MEDIA_BYTES)
    throw new GenerationError(
      'MEDIA_TOO_LARGE',
      'A generated asset exceeded the configured media limit.',
    );
  await storage.putObject(objectKey, input.data, input.mimeType);
  try {
    await assertActive(input.caseId);
    return await AssetModel.create({
      _id: id,
      caseId: input.caseId,
      evidenceId: input.evidenceId,
      kind: input.kind,
      objectKey,
      mimeType: input.mimeType,
      bytes: input.data.length,
      width: input.width,
      height: input.height,
      durationSeconds: input.durationSeconds,
      sha256: createHash('sha256').update(input.data).digest('hex'),
      generationMethod: input.method,
      frameIndex: input.frameIndex,
    });
  } catch (error) {
    await storage.deleteObject(objectKey).catch(() => {});
    throw error;
  }
}

async function savedFrames(provider: MysteryAIProvider, input: LockedVisualInput, caseId: string) {
  const frames: GeneratedMedia[] = [];
  for (let frameIndex = 0; frameIndex < 2; frameIndex++) {
    const saved = await AssetModel.findOne({
      caseId,
      evidenceId: input.plan.id,
      kind: 'FRAME',
      frameIndex,
    }).lean();
    if (saved) {
      const object = await storage.getObject(saved.objectKey);
      if (!object.Body)
        throw new GenerationError('FRAME_STORAGE_UNAVAILABLE', 'A saved AI frame is unavailable.');
      frames.push({
        data: Buffer.from(await object.Body.transformToByteArray()),
        mimeType: saved.mimeType,
        method: saved.generationMethod,
      });
    } else {
      await assertActive(caseId);
      const frame = await provider.generatePhoto({ ...input, frameIndex });
      await saveAsset({ caseId, evidenceId: input.plan.id, kind: 'FRAME', ...frame, frameIndex });
      frames.push(frame);
    }
  }
  return frames;
}

export async function generateCase(caseId: string, provider: MysteryAIProvider = createProvider()) {
  const existing = await CaseModel.findOne({ _id: caseId, deletedAt: null }).lean();
  if (!existing || existing.status === 'READY' || existing.status === 'FAILED') {
    await GuestModel.updateOne(
      { activeGenerationCaseId: caseId },
      { $set: { activeGenerationCaseId: null } },
    );
    return;
  }
  try {
    let stored = await SecretModel.findOne({ caseId }).lean();
    let blueprint: PrivateBlueprint;
    if (stored?.blueprint) {
      blueprint = validateBlueprint(stored.blueprint);
    } else {
      blueprint = await runStage(
        caseId,
        'GENERATING_BLUEPRINT',
        async () => {
          const candidate = validateBlueprint(
            await provider.generateBlueprint({
              premise: existing.premise,
              difficulty: existing.difficulty,
            }),
          );
          await CaseModel.updateOne(
            { _id: caseId, deletedAt: null, status: { $nin: ['FAILED', 'READY'] } },
            { $set: { status: 'VALIDATING', generationStage: 'VALIDATING' } },
          );
          const review = await provider.reviewSolvability(publicReviewInput(candidate));
          if (
            review.verdict !== 'ACCEPT' ||
            review.ambiguous ||
            review.suspectId !== candidate.culpritSuspectId
          )
            throw new GenerationError(
              'AMBIGUOUS_MYSTERY',
              'The mystery could not be solved uniquely from its public clues.',
            );
          return candidate;
        },
        provider.mode === 'mock' ? 'mock-v1' : config.GEMINI_TEXT_MODEL,
      );
      const blueprintLockedAt = new Date();
      await assertActive(caseId);
      stored = await SecretModel.findOneAndUpdate(
        { caseId },
        {
          $setOnInsert: {
            caseId,
            blueprint,
            blueprintVersion: 1,
            blueprintLockedAt,
            culpritSuspectId: blueprint.culpritSuspectId,
            canonicalFacts: blueprint.canonicalFacts,
            actualTimeline: blueprint.actualTimeline,
            evidenceFactMap: Object.fromEntries(
              blueprint.evidencePlans.map((p) => [p.id, p.factIds]),
            ),
            ...blueprint.solution,
          },
        },
        { upsert: true, new: true },
      ).lean();
      blueprint = validateBlueprint(stored!.blueprint);
    }
    await CaseModel.updateOne(
      { _id: caseId, deletedAt: null, status: { $nin: ['READY', 'FAILED'] } },
      {
        $set: {
          title: blueprint.title,
          incident: blueprint.incident,
          location: blueprint.location,
          timezone: blueprint.timezone,
          fictionalDate: blueprint.fictionalDate,
          objective: blueprint.objective,
          suspects: blueprint.suspects,
          blueprintLockedAt: stored!.blueprintLockedAt,
          generationVersion: 1,
        },
      },
    );
    let evidence = await runStage(
      caseId,
      'GENERATING_TEXT',
      async () =>
        renderTextEvidence(
          provider,
          blueprint,
          ((await assertActive(caseId)).textEvidence ?? []) as EvidencePublic[],
          async (items) => {
            await assertActive(caseId);
            await CaseModel.updateOne(
              { _id: caseId, deletedAt: null },
              { $set: { textEvidence: items } },
            );
          },
        ),
      provider.mode === 'mock' ? 'mock-v1' : config.GEMINI_TEXT_MODEL,
    );

    // Recheck the exact rendered public text, not just the author's original clue plan.
    await runStage(
      caseId,
      'VALIDATING',
      async () => {
        const input = publicReviewInput(blueprint);
        input.evidence = input.evidence.map((item) => {
          const rendered = evidence.find((e) => e.id === item.id);
          return {
            ...item,
            observation:
              item.observation +
              (rendered ? `\nRendered evidence: ${JSON.stringify(rendered.payload)}` : ''),
          };
        });
        const review = await provider.reviewSolvability(input);
        if (
          review.verdict !== 'ACCEPT' ||
          review.ambiguous ||
          review.suspectId !== blueprint.culpritSuspectId
        )
          throw new GenerationError(
            'RENDERED_CLUES_INVALID',
            'The rendered clues did not preserve the fair solution.',
            false,
          );
      },
      provider.mode === 'mock' ? 'mock-v1' : config.GEMINI_TEXT_MODEL,
    );

    await runStage(
      caseId,
      'GENERATING_IMAGES',
      async () => {
        for (const plan of blueprint.evidencePlans.filter((p) => p.type === 'PHOTO')) {
          if (evidence.some((item) => item.id === plan.id)) continue;
          let asset = await AssetModel.findOne({
            caseId,
            evidenceId: plan.id,
            kind: 'PHOTO',
          }).lean();
          let thumbnail = await AssetModel.findOne({
            caseId,
            evidenceId: plan.id,
            kind: 'THUMBNAIL',
          }).lean();
          if (!asset) {
            const media = await provider.generatePhoto({ blueprint, plan });
            const image = await normalizedPhoto(media);
            asset = (
              await saveAsset({
                caseId,
                evidenceId: plan.id,
                kind: 'PHOTO',
                data: image.data,
                mimeType: image.mimeType,
                method: media.method,
                width: image.width,
                height: image.height,
              })
            ).toObject();
            thumbnail = (
              await saveAsset({
                caseId,
                evidenceId: plan.id,
                kind: 'THUMBNAIL',
                data: image.thumbnail,
                mimeType: 'image/webp',
                method: media.method,
              })
            ).toObject();
          } else if (!thumbnail) {
            const object = await storage.getObject(asset.objectKey);
            if (!object.Body)
              throw new GenerationError('ASSET_UNAVAILABLE', 'A saved photo is unavailable.');
            const image = await normalizedPhoto({
              data: Buffer.from(await object.Body.transformToByteArray()),
              mimeType: asset.mimeType,
              method: asset.generationMethod,
            });
            thumbnail = (
              await saveAsset({
                caseId,
                evidenceId: plan.id,
                kind: 'THUMBNAIL',
                data: image.thumbnail,
                mimeType: 'image/webp',
                method: asset.generationMethod,
              })
            ).toObject();
          }
          evidence.push(
            EvidencePublicSchema.parse({
              id: plan.id,
              type: plan.type,
              title: plan.title,
              source: plan.source,
              occurredAt: plan.occurredAt,
              summary: plan.authoredObservation,
              description: plan.authoredObservation,
              payload: {
                assetId: asset!._id,
                thumbnailAssetId: thumbnail!._id,
                altText: plan.authoredObservation,
              },
            }),
          );
        }
      },
      provider.mode === 'mock'
        ? 'mock-v1'
        : config.MEDIA_PROVIDER === 'cloudflare'
          ? config.CLOUDFLARE_IMAGE_MODEL
          : config.GEMINI_IMAGE_MODEL,
    );

    await runStage(
      caseId,
      'GENERATING_VIDEO',
      async () => {
        const plan = blueprint.evidencePlans.find((p) => p.type === 'CCTV')!;
        let asset = await AssetModel.findOne({ caseId, evidenceId: plan.id, kind: 'CCTV' }).lean();
        let poster = await AssetModel.findOne({
          caseId,
          evidenceId: plan.id,
          kind: 'THUMBNAIL',
        }).lean();
        if (!asset) {
          const input = { blueprint, plan };
          const video = await new MediaPipeline(provider).createCctv(input, () =>
            savedFrames(provider, input, caseId),
          );
          asset = (
            await saveAsset({
              caseId,
              evidenceId: plan.id,
              kind: 'CCTV',
              data: video.data,
              mimeType: 'video/mp4',
              method: video.method,
              width: video.width,
              height: video.height,
              durationSeconds: video.durationSeconds,
            })
          ).toObject();
          poster = (
            await saveAsset({
              caseId,
              evidenceId: plan.id,
              kind: 'THUMBNAIL',
              data: video.poster,
              mimeType: 'image/webp',
              method: video.method,
            })
          ).toObject();
        }
        if (!poster) {
          const object = await storage.getObject(asset!.objectKey);
          if (!object.Body)
            throw new GenerationError('ASSET_UNAVAILABLE', 'A saved recording is unavailable.');
          const image = await extractPoster(Buffer.from(await object.Body.transformToByteArray()));
          poster = (
            await saveAsset({
              caseId,
              evidenceId: plan.id,
              kind: 'THUMBNAIL',
              data: image,
              mimeType: 'image/webp',
              method: asset!.generationMethod,
            })
          ).toObject();
        }
        evidence = evidence.filter((e) => e.id !== plan.id);
        evidence.push(
          EvidencePublicSchema.parse({
            id: plan.id,
            type: plan.type,
            title: plan.title,
            source: plan.source,
            occurredAt: plan.occurredAt,
            summary: plan.authoredObservation,
            description: plan.authoredObservation,
            payload: {
              assetId: asset!._id,
              posterAssetId: poster._id,
              cameraLabel: plan.cameraLabel,
              cameraTimestamp: plan.cameraTimestamp,
              transcript: `${asset!.generationMethod === 'MOCK' ? 'Demo Mode — fictional test reconstruction.' : asset!.generationMethod === 'AI_FRAME_VIDEO' ? 'AI-frame surveillance reconstruction.' : 'AI-generated fictional reconstruction.'}\n${plan.authoredObservation}`,
              generationMethod: asset!.generationMethod,
            },
          }),
        );
      },
      provider.mode === 'mock'
        ? 'mock-v1'
        : config.MEDIA_PROVIDER === 'cloudflare'
          ? 'ffmpeg-ai-frame'
          : config.GEMINI_VIDEO_MODEL,
    );

    await runStage(
      caseId,
      'FINALIZING',
      async () => {
        evidence.sort((a, b) => a.id.localeCompare(b.id));
        if (evidence.length !== 8 || new Set(evidence.map((item) => item.id)).size !== 8)
          throw new GenerationError('INCOMPLETE_EVIDENCE', 'The case is missing evidence.');
        evidence.forEach((item) => EvidencePublicSchema.parse(item));
        const assets = await AssetModel.find({ caseId }).lean();
        for (const item of evidence) {
          if (item.type !== 'PHOTO' && item.type !== 'CCTV') continue;
          const asset = assets.find(
            (a) => a._id === item.payload.assetId && a.evidenceId === item.id,
          );
          if (
            !asset ||
            !asset.bytes ||
            !asset.width ||
            !asset.height ||
            (item.type === 'CCTV' && (!asset.durationSeconds || asset.mimeType !== 'video/mp4'))
          )
            throw new GenerationError(
              'INVALID_MEDIA_PACK',
              'Required media is missing or invalid.',
            );
          const storedObject = await storage.getObject(asset.objectKey, 'bytes=0-0');
          await storedObject.Body?.transformToByteArray();
        }
        const published = await CaseModel.updateOne(
          { _id: caseId, deletedAt: null, status: 'FINALIZING' },
          {
            $set: {
              evidence,
              assetIds: assets.filter((a) => a.kind !== 'FRAME').map((a) => a._id),
              status: 'READY',
              generationStage: 'READY',
              readyAt: new Date(),
              failureCode: null,
            },
            $unset: { textEvidence: '' },
          },
        );
        if (published.modifiedCount !== 1)
          throw new GenerationError(
            'CASE_NOT_ACTIVE',
            'The case was cancelled before publication.',
            false,
          );
      },
      'validation-v1',
    );
    await GuestModel.updateOne(
      { activeGenerationCaseId: caseId },
      { $set: { activeGenerationCaseId: null } },
    );
  } catch (error) {
    await CaseModel.updateOne(
      { _id: caseId, deletedAt: null, status: { $ne: 'READY' } },
      { $set: { status: 'FAILED', failureCode: safeGenerationCode(error) } },
    );
    await GuestModel.updateOne(
      { activeGenerationCaseId: caseId },
      { $set: { activeGenerationCaseId: null } },
    );
    throw error;
  }
}

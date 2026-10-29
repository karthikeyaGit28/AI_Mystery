import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import sharp from 'sharp';
import { config } from '@amr/server';
import {
  GenerationError,
  type GeneratedMedia,
  type LockedVisualInput,
  type MysteryAIProvider,
} from '../ai/contracts.js';

const escapeXml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
export const ffmpegPath = () =>
  !config.FFMPEG_PATH || config.FFMPEG_PATH === 'ffmpeg'
    ? ffmpegInstaller.path
    : config.FFMPEG_PATH;
export const ffprobePath = () =>
  !config.FFPROBE_PATH || config.FFPROBE_PATH === 'ffprobe'
    ? ffprobeInstaller.path
    : config.FFPROBE_PATH;

export async function runProcess(
  binary: string,
  args: string[],
  timeout = 120000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new GenerationError('MEDIA_TIMEOUT', 'Media processing exceeded its time limit.'));
    }, timeout);
    child.stdout.on('data', (value: Buffer) => {
      stdout += value.toString();
    });
    child.stderr.on('data', (value: Buffer) => {
      stderr = (stderr + value.toString()).slice(-8000);
    });
    child.once('error', () => {
      clearTimeout(timer);
      reject(
        new GenerationError(
          'MEDIA_TOOL_UNAVAILABLE',
          'ffmpeg or ffprobe could not start. Install the configured media tools.',
          false,
        ),
      );
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else
        reject(
          new GenerationError(
            'MEDIA_PROCESSING_FAILED',
            `Media processing failed (${code ?? 'signal'}). ${stderr.replace(/\r?\n/g, ' ').slice(-1200)}`,
          ),
        );
    });
  });
}

export async function normalizedPhoto(media: GeneratedMedia) {
  if (!media.mimeType.startsWith('image/') || media.data.length > 20 * 1024 * 1024)
    throw new GenerationError('INVALID_IMAGE', 'Invalid generated image format or size.');
  const metadata = await sharp(media.data, { limitInputPixels: 40_000_000 }).metadata();
  if (!metadata.width || !metadata.height || metadata.width < 256 || metadata.height < 256)
    throw new GenerationError('INVALID_IMAGE', 'The generated image is too small.');
  const data = await sharp(media.data, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 87 })
    .toBuffer();
  const dimensions = await sharp(data).metadata();
  const thumbnail = await sharp(data)
    .resize({ width: 420, height: 300, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 75 })
    .toBuffer();
  return {
    data,
    thumbnail,
    width: dimensions.width!,
    height: dimensions.height!,
    mimeType: 'image/webp',
  };
}

export type BuiltCctv = {
  data: Buffer;
  poster: Buffer;
  width: number;
  height: number;
  durationSeconds: number;
  method: GeneratedMedia['method'];
  fallback: boolean;
};

export async function extractPoster(video: Buffer): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), 'amr-poster-'));
  try {
    const source = join(directory, 'source.mp4');
    const output = join(directory, 'poster.webp');
    await writeFile(source, video);
    await runProcess(ffmpegPath(), ['-y', '-i', source, '-frames:v', '1', output]);
    return await readFile(output);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export class MediaPipeline {
  constructor(private readonly provider: MysteryAIProvider) {}
  async createCctv(
    input: LockedVisualInput,
    savedFrames?: () => Promise<GeneratedMedia[]>,
  ): Promise<BuiltCctv> {
    let direct: GeneratedMedia | undefined;
    try {
      direct = await this.provider.generateCctvVideo(input);
    } catch (error) {
      if (error instanceof GenerationError && error.code === 'CONTENT_BLOCKED') throw error;
    }
    if (direct) {
      try {
        return await this.compile(input, direct, []);
      } catch (error) {
        if (error instanceof GenerationError && error.code === 'MEDIA_TOOL_UNAVAILABLE')
          throw error;
      }
    }
    const frames = savedFrames ? await savedFrames() : await this.generateFrames(input);
    if (frames.length < 2 || frames.length > 3)
      throw new GenerationError(
        'INVALID_FRAME_COUNT',
        'CCTV needs two or three AI-generated frames.',
      );
    if (this.provider.mode === 'gemini' && frames.some((frame) => frame.method !== 'GEMINI_IMAGE'))
      throw new GenerationError(
        'NON_AI_FALLBACK',
        'Live fallback requires genuine AI frames.',
        false,
      );
    return this.compile(input, undefined, frames);
  }
  private async generateFrames(input: LockedVisualInput) {
    const frames: GeneratedMedia[] = [];
    for (let frameIndex = 0; frameIndex < 2; frameIndex++)
      frames.push(await this.provider.generatePhoto({ ...input, frameIndex }));
    return frames;
  }
  private overlay(input: LockedVisualInput, fallback: boolean) {
    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone: input.blueprint.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(input.plan.cameraTimestamp!));
    const label =
      this.provider.mode === 'mock'
        ? 'DEMO MODE — FICTIONAL TEST RECONSTRUCTION'
        : fallback
          ? 'AI-FRAME SURVEILLANCE RECONSTRUCTION'
          : 'AI-GENERATED FICTIONAL RECONSTRUCTION';
    return Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect x="0" y="0" width="1280" height="66" fill="#080c12" fill-opacity=".92"/><text x="24" y="42" fill="#eef2f7" font-family="sans-serif" font-size="24">${escapeXml(input.plan.cameraLabel!)} · EVENT ${escapeXml(time)} · ${escapeXml(input.blueprint.timezone)}</text><rect x="0" y="660" width="1280" height="60" fill="#080c12" fill-opacity=".92"/><text x="24" y="698" fill="#d9a74d" font-family="sans-serif" font-size="20">${escapeXml(label)}</text></svg>`,
    );
  }
  private async compile(
    input: LockedVisualInput,
    direct: GeneratedMedia | undefined,
    frames: GeneratedMedia[],
  ): Promise<BuiltCctv> {
    const directory = await mkdtemp(join(tmpdir(), 'amr-media-'));
    try {
      const output = join(directory, 'output.mp4');
      const posterPath = join(directory, 'poster.webp');
      if (direct) {
        const source = join(directory, 'source.mp4');
        const overlay = join(directory, 'overlay.png');
        await writeFile(source, direct.data);
        await this.probe(source);
        await writeFile(overlay, await sharp(this.overlay(input, false)).png().toBuffer());
        await runProcess(ffmpegPath(), [
          '-y',
          '-i',
          source,
          '-loop',
          '1',
          '-i',
          overlay,
          '-filter_complex',
          '[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720[base];[base][1:v]overlay=0:0:shortest=1,format=yuv420p[v]',
          '-map',
          '[v]',
          '-an',
          '-t',
          '8',
          '-r',
          '25',
          '-c:v',
          'libx264',
          '-preset',
          'fast',
          '-crf',
          '23',
          '-movflags',
          '+faststart',
          output,
        ]);
      } else {
        const sources: string[] = [];
        for (let index = 0; index < frames.length; index++) {
          const path = join(directory, `frame-${index}.png`);
          const image = await sharp(frames[index]!.data)
            .resize(1280, 720, { fit: 'cover' })
            .composite([{ input: this.overlay(input, true) }])
            .png()
            .toBuffer();
          await writeFile(path, image);
          sources.push(path);
        }
        const args = sources.flatMap((source) => ['-i', source]);
        const zoomFilters = sources.map(
          (_, index) =>
            `[${index}:v]zoompan=z='min(zoom+0.0004,1.025)':d=75:s=1280x720:fps=25,setpts=PTS-STARTPTS[v${index}]`,
        );
        const concat = `${sources.map((_, index) => `[v${index}]`).join('')}concat=n=${sources.length}:v=1:a=0,format=yuv420p[v]`;
        await runProcess(ffmpegPath(), [
          '-y',
          ...args,
          '-filter_complex',
          `${zoomFilters.join(';')};${concat}`,
          '-map',
          '[v]',
          '-an',
          '-c:v',
          'libx264',
          '-preset',
          'fast',
          '-crf',
          '23',
          '-movflags',
          '+faststart',
          output,
        ]);
      }
      const metadata = await this.probe(output);
      await runProcess(ffmpegPath(), ['-y', '-i', output, '-frames:v', '1', posterPath]);
      const data = await readFile(output);
      if (data.length > 60 * 1024 * 1024)
        throw new GenerationError(
          'VIDEO_TOO_LARGE',
          'Processed video exceeds the media size limit.',
        );
      return {
        data,
        poster: await readFile(posterPath),
        ...metadata,
        method:
          this.provider.mode === 'mock' ? 'MOCK' : direct ? 'GEMINI_OMNI_VIDEO' : 'AI_FRAME_VIDEO',
        fallback: !direct,
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  private async probe(path: string) {
    const data = JSON.parse(
      await runProcess(ffprobePath(), [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_type,codec_name,width,height:format=duration',
        '-of',
        'json',
        path,
      ]),
    ) as {
      streams: Array<{ codec_type: string; width?: number; height?: number }>;
      format: { duration: string };
    };
    const video = data.streams.find((stream) => stream.codec_type === 'video');
    const durationSeconds = Number(data.format.duration);
    if (
      !video?.width ||
      !video.height ||
      !Number.isFinite(durationSeconds) ||
      durationSeconds < 1 ||
      durationSeconds > 60
    )
      throw new GenerationError('INVALID_VIDEO', 'Video metadata is missing or invalid.');
    return { width: video.width, height: video.height, durationSeconds };
  }
}

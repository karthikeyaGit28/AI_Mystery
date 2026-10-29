import { createHash } from 'node:crypto';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function scoreAccusation(
  correct: boolean,
  submitted: string[],
  supporting: string[],
  hints: number,
) {
  if (!correct) return 0;
  const matches = new Set(submitted.filter((id) => supporting.includes(id))).size;
  return Math.min(100, 70 + Math.min(matches, 2) * 10 + (hints === 0 ? 10 : hints === 1 ? 5 : 0));
}
export function hashValue(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
export function normalizeByteRange(range: string | undefined, bytes: number) {
  if (!range) return undefined;
  const invalid = () =>
    new HttpError(416, 'INVALID_RANGE', 'This media range is invalid or cannot be satisfied.');
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(bytes) || bytes <= 0)
    throw invalid();
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw invalid();
    return `bytes=${Math.max(0, bytes - suffix)}-${bytes - 1}`;
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : bytes - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= bytes || end < start)
    throw invalid();
  return `bytes=${start}-${Math.min(end, bytes - 1)}`;
}
export function assertSafePremise(premise: string) {
  if (
    /<\/?(?:script|iframe|img|svg)\b/i.test(premise) ||
    /ignore (?:all |the )?(?:previous|prior|system) instructions|reveal (?:the )?(?:system prompt|api key|hidden solution)|sexual violence|child (?:abuse|harm)|doxx/i.test(
      premise,
    )
  ) {
    throw new HttpError(
      422,
      'UNSAFE_PREMISE',
      'Use a fictional, non-graphic mystery premise without embedded instructions.',
    );
  }
}
export const stageLabels: Record<string, string> = {
  QUEUED: 'Your case is in the queue',
  GENERATING_BLUEPRINT: 'Building the incident and suspects',
  VALIDATING: 'Checking that the clues tell a fair story',
  GENERATING_TEXT: 'Writing chats and investigation records',
  GENERATING_IMAGES: 'Creating photographic clues',
  GENERATING_VIDEO: 'Creating the CCTV reconstruction',
  FINALIZING: 'Sealing your case dossier',
  READY: 'Your investigation is ready',
  FAILED: 'The case could not be completed',
};

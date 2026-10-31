export const VERIFIED_FREE_TEXT_MODELS = Object.freeze(['gemini-3.8-flash', 'gemini-3.6-flash']);
export const DEFAULT_FREE_TEXT_MODEL = 'gemini-3.8-flash';

export function isVerifiedFreeTextModel(model) {
  return VERIFIED_FREE_TEXT_MODELS.includes(model);
}

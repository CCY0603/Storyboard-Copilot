import {
  generateImage,
  generateVideo,
  getGenerateImageJob,
  setApiKey,
  submitGenerateImageJob,
} from '@/commands/ai';
import { imageUrlToDataUrl, persistImageLocally } from '@/features/canvas/application/imageData';

import type { AiGateway, GenerateImagePayload, VideoGeneratePayload } from '../application/ports';

async function normalizeReferenceImages(payload: GenerateImagePayload): Promise<string[] | undefined> {
  const isKieModel = payload.model.startsWith('kie/');
  const isFalModel = payload.model.startsWith('fal/');
  return payload.referenceImages
    ? await Promise.all(
      payload.referenceImages.map(async (imageUrl) =>
        isKieModel || isFalModel
          ? await imageUrlToDataUrl(imageUrl)
          : await persistImageLocally(imageUrl)
      )
    )
    : undefined;
}

async function normalizeVideoReferenceImages(payload: VideoGeneratePayload): Promise<string[] | undefined> {
  // Video API needs HTTP URLs, not base64 data URLs
  // Pass reference images as-is so the Rust backend can handle them
  return payload.referenceImages?.length ? payload.referenceImages : undefined;
}

export const tauriAiGateway: AiGateway = {
  setApiKey,
  generateImage: async (payload: GenerateImagePayload) => {
    const normalizedReferenceImages = await normalizeReferenceImages(payload);

    return await generateImage({
      prompt: payload.prompt,
      model: payload.model,
      size: payload.size,
      aspect_ratio: payload.aspectRatio,
      reference_images: normalizedReferenceImages,
      extra_params: payload.extraParams,
    });
  },
  generateVideo: async (payload: VideoGeneratePayload) => {
    const normalizedReferenceImages = await normalizeVideoReferenceImages(payload);

    return await generateVideo({
      prompt: payload.prompt,
      model: payload.model,
      size: payload.size,
      aspect_ratio: payload.aspectRatio,
      reference_images: normalizedReferenceImages,
      extra_params: payload.extraParams,
      duration: payload.duration,
    });
  },
  submitGenerateImageJob: async (payload: GenerateImagePayload) => {
    const normalizedReferenceImages = await normalizeReferenceImages(payload);
    return await submitGenerateImageJob({
      prompt: payload.prompt,
      model: payload.model,
      size: payload.size,
      aspect_ratio: payload.aspectRatio,
      reference_images: normalizedReferenceImages,
      extra_params: payload.extraParams,
    });
  },
  getGenerateImageJob,
};

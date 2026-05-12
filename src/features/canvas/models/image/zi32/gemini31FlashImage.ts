import type { ImageModelDefinition } from '../../types';
import { createFixedResolutionPricing } from '@/features/canvas/pricing';

export const ZI32_GEMINI_31_FLASH_IMAGE_MODEL_ID = 'zi32/gemini-3.1-flash-image-preview';

const GEMINI_FLASH_ASPECT_RATIOS = [
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
] as const;

export const imageModel: ImageModelDefinition = {
  id: ZI32_GEMINI_31_FLASH_IMAGE_MODEL_ID,
  mediaType: 'image',
  displayName: 'Gemini 3.1 Flash',
  providerId: 'zi32',
  description: 'Gemini 3.1 Flash 图像生成（32zi Google兼容，Nano Banana 2）',
  eta: '15s',
  expectedDurationMs: 15000,
  defaultAspectRatio: '1:1',
  defaultResolution: '1K',
  aspectRatios: GEMINI_FLASH_ASPECT_RATIOS.map((value) => ({ value, label: value })),
  resolutions: [
    { value: '1K', label: '1K' },
    { value: '2K', label: '2K' },
  ],
  pricing: createFixedResolutionPricing({
    currency: 'USD',
    standardRates: { '1K': 0.02, '2K': 0.04 },
  }),
  maxReferenceImages: 16,
  resolveRequest: ({ referenceImageCount }) => ({
    requestModel: ZI32_GEMINI_31_FLASH_IMAGE_MODEL_ID,
    modeLabel: referenceImageCount > 0 ? '编辑模式' : '生成模式',
  }),
};
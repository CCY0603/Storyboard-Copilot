import type { ImageModelDefinition } from '../../types';
import { createFixedResolutionPricing } from '@/features/canvas/pricing';

export const ZI32_GEMINI_25_FLASH_IMAGE_MODEL_ID = 'zi32/gemini-2.5-flash-image';

const GEMINI_25_FLASH_ASPECT_RATIOS = [
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
] as const;

export const imageModel: ImageModelDefinition = {
  id: ZI32_GEMINI_25_FLASH_IMAGE_MODEL_ID,
  mediaType: 'image',
  displayName: 'Gemini 2.5 Flash',
  providerId: 'zi32',
  description: 'Gemini 2.5 Flash 图像生成（32zi Google兼容}',
  eta: '12s',
  expectedDurationMs: 12000,
  defaultAspectRatio: '1:1',
  defaultResolution: '1K',
  aspectRatios: GEMINI_25_FLASH_ASPECT_RATIOS.map((value) => ({ value, label: value })),
  resolutions: [
    { value: '1K', label: '1K' },
    { value: '2K', label: '2K' },
  ],
  pricing: createFixedResolutionPricing({
    currency: 'USD',
    standardRates: { '1K': 0.015, '2K': 0.03 },
  }),
  resolveRequest: ({ referenceImageCount: _referenceImageCount }) => ({
    requestModel: ZI32_GEMINI_25_FLASH_IMAGE_MODEL_ID,
    modeLabel: '生成模式',
  }),
};
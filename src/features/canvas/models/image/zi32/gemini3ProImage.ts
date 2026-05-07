import type { ImageModelDefinition } from '../../types';
import { createFixedResolutionPricing } from '@/features/canvas/pricing';

export const ZI32_GEMINI_3_PRO_IMAGE_MODEL_ID = 'zi32/gemini-3-pro-image';

const GEMINI_PRO_ASPECT_RATIOS = [
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '5:4',
  '4:5',
  '21:9',
  '9:21',
] as const;

export const imageModel: ImageModelDefinition = {
  id: ZI32_GEMINI_3_PRO_IMAGE_MODEL_ID,
  mediaType: 'image',
  displayName: 'Gemini 3 Pro',
  providerId: 'zi32',
  description: 'Gemini 3 Pro 图像生成（32zi Google兼容，Nano Banana Pro）',
  eta: '30s',
  expectedDurationMs: 30000,
  defaultAspectRatio: '1:1',
  defaultResolution: '2K',
  aspectRatios: GEMINI_PRO_ASPECT_RATIOS.map((value) => ({ value, label: value })),
  resolutions: [
    { value: '1K', label: '1K' },
    { value: '2K', label: '2K' },
    { value: '4K', label: '4K' },
  ],
  pricing: createFixedResolutionPricing({
    currency: 'USD',
    standardRates: { '1K': 0.05, '2K': 0.10, '4K': 0.20 },
  }),
  resolveRequest: ({ referenceImageCount: _referenceImageCount }) => ({
    requestModel: ZI32_GEMINI_3_PRO_IMAGE_MODEL_ID,
    modeLabel: '生成模式',
  }),
};
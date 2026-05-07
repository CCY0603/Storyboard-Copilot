import type { ImageModelDefinition } from '../../types';
import { createFixedResolutionPricing } from '@/features/canvas/pricing';

export const ZI32_GPT_IMAGE_2_MODEL_ID = 'zi32/gpt-image-2';

const GPT_IMAGE_ASPECT_RATIOS = [
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
] as const;

export const imageModel: ImageModelDefinition = {
  id: ZI32_GPT_IMAGE_2_MODEL_ID,
  mediaType: 'image',
  displayName: 'GPT-Image 2',
  providerId: 'zi32',
  description: 'GPT-Image 2 图像生成与编辑（32zi OpenAI兼容）',
  eta: '30s',
  expectedDurationMs: 30000,
  defaultAspectRatio: '1:1',
  defaultResolution: '1K',
  aspectRatios: GPT_IMAGE_ASPECT_RATIOS.map((value) => ({ value, label: value })),
  resolutions: [
    { value: '1K', label: '1K (1024x1024)' },
  ],
  pricing: createFixedResolutionPricing({
    currency: 'USD',
    standardRates: { '1K': 0.08 },
  }),
  resolveRequest: ({ referenceImageCount }) => ({
    requestModel: ZI32_GPT_IMAGE_2_MODEL_ID,
    modeLabel: referenceImageCount > 0 ? '编辑模式' : '生成模式',
  }),
};
import type { ImageModelDefinition } from '../../types';
import { createGrsaiPointsPricing } from '@/features/canvas/pricing';

export const GRSAI_GPT_IMAGE_2_MODEL_ID = 'grsai/gpt-image-2';

const GPT_IMAGE_2_ASPECT_RATIOS = [
  '1:1', '16:9', '9:16', '4:3', '3:4',
  '3:2', '2:3', '5:4', '4:5', '21:9',
] as const;

export const imageModel: ImageModelDefinition = {
  id: GRSAI_GPT_IMAGE_2_MODEL_ID,
  mediaType: 'image',
  displayName: 'GPT Image 2',
  providerId: 'grsai',
  description: 'GPT Image 2 绘画模型，能力媲美 Nano Banana 2',
  eta: '1min',
  expectedDurationMs: 60000,
  defaultAspectRatio: '1:1',
  defaultResolution: '1K',
  aspectRatios: GPT_IMAGE_2_ASPECT_RATIOS.map((value) => ({ value, label: value })),
  resolutions: [
    { value: '1K', label: '1K' },
  ],
  pricing: createGrsaiPointsPricing(() => 600),
  resolveRequest: ({ referenceImageCount }) => ({
    requestModel: GRSAI_GPT_IMAGE_2_MODEL_ID,
    modeLabel: referenceImageCount > 0 ? '编辑模式' : '生成模式',
  }),
};
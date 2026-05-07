import type { VideoModelDefinition } from '../../types';

export const ZI32_GROK_VIDEOS_MODEL_ID = 'zi32/grok-videos';

export const videoModel: VideoModelDefinition = {
  id: ZI32_GROK_VIDEOS_MODEL_ID,
  mediaType: 'video',
  displayName: 'Grok Videos',
  providerId: 'zi32',
  description: 'grok视频模型，OpenAI格式，支持参考生视频',
  eta: '1-3min',
  expectedDurationMs: 180000,
  defaultAspectRatio: '16:9',
  aspectRatios: [
    { value: '16:9', label: '16:9' },
    { value: '9:16', label: '9:16' },
    { value: '1:1', label: '1:1' },
    { value: '3:2', label: '3:2' },
    { value: '2:3', label: '2:3' },
  ],
  resolutions: [
    { value: '720P', label: '720P' },
    { value: '1080P', label: '1080P' },
  ],
  defaultResolution: '720P',
  durations: [6, 10],
  defaultDuration: 6,
  resolveRequest: ({ referenceImageCount }) => ({
    requestModel: ZI32_GROK_VIDEOS_MODEL_ID,
    modeLabel: referenceImageCount > 0 ? '图生视频' : '文生视频',
    extraParams: {
      duration: 5,
      resolution: '720P',
    },
  }),
};

import type { VideoModelDefinition } from '../../types';

export const ZI32_GROK_VIDEO_3_10S_MODEL_ID = 'zi32/grok-video-3-10s';

export const videoModel: VideoModelDefinition = {
  id: ZI32_GROK_VIDEO_3_10S_MODEL_ID,
  mediaType: 'video',
  displayName: 'Grok V3 10s',
  providerId: 'zi32',
  description: 'grok最新视频模型，10秒，支持音画同出，参考生视频',
  eta: '2-5min',
  expectedDurationMs: 300000,
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
  ],
  defaultResolution: '720P',
  durations: [10],
  defaultDuration: 10,
  resolveRequest: ({ referenceImageCount }) => ({
    requestModel: ZI32_GROK_VIDEO_3_10S_MODEL_ID,
    modeLabel: referenceImageCount > 0 ? '图生视频' : '文生视频',
    extraParams: {
      duration: 10,
      resolution: '720P',
    },
  }),
};

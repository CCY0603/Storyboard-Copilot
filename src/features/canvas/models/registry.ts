import type {
  ImageModelDefinition,
  ImageModelRuntimeContext,
  ModelProviderDefinition,
  ResolutionOption,
  VideoModelDefinition,
} from './types';

const providerModules = import.meta.glob<{ provider: ModelProviderDefinition }>(
  './providers/*.ts',
  { eager: true }
);
const modelModules = import.meta.glob<{ imageModel: ImageModelDefinition }>(
  './image/**/*.ts',
  { eager: true }
);
const videoModelModules = import.meta.glob<{ videoModel: VideoModelDefinition }>(
  './video/**/*.ts',
  { eager: true }
);

const providers: ModelProviderDefinition[] = Object.values(providerModules)
  .map((module) => module.provider)
  .filter((provider): provider is ModelProviderDefinition => Boolean(provider))
  .sort((a, b) => a.id.localeCompare(b.id));

const imageModels: ImageModelDefinition[] = Object.values(modelModules)
  .map((module) => module.imageModel)
  .filter((model): model is ImageModelDefinition => Boolean(model))
  .sort((a, b) => a.id.localeCompare(b.id));

const videoModels: VideoModelDefinition[] = Object.values(videoModelModules)
  .map((module) => module.videoModel)
  .filter((model): model is VideoModelDefinition => Boolean(model))
  .sort((a, b) => a.id.localeCompare(b.id));

const providerMap = new Map<string, ModelProviderDefinition>(
  providers.map((provider) => [provider.id, provider])
);
const imageModelMap = new Map<string, ImageModelDefinition>(
  imageModels.map((model) => [model.id, model])
);
const videoModelMap = new Map<string, VideoModelDefinition>(
  videoModels.map((model) => [model.id, model])
);

export const DEFAULT_IMAGE_MODEL_ID = 'kie/nano-banana-2';
export const DEFAULT_VIDEO_MODEL_ID = 'zi32/grok-video-3';

const imageModelAliasMap = new Map<string, string>([
  ['gemini-3.1-flash', 'ppio/gemini-3.1-flash'],
  ['gemini-3.1-flash-edit', 'ppio/gemini-3.1-flash'],
  // 32zi aliases
  ['grok-image-2', 'zi32/grok-image-2'],
  ['grok-image-1.5', 'zi32/grok-image-1.5'],
  ['grok-image-1', 'zi32/grok-image-1'],
  ['grok-image-1-mini', 'zi32/grok-image-1-mini'],
  ['gpt-image-2', 'zi32/gpt-image-2'],
  ['gpt-image-1.5', 'zi32/gpt-image-1.5'],
  ['gpt-image-1', 'zi32/gpt-image-1'],
  ['gpt-image-1-mini', 'zi32/gpt-image-1-mini'],
  ['gemini-3.1-flash-image', 'zi32/gemini-3.1-flash-image'],
  ['gemini-3-pro-image', 'zi32/gemini-3-pro-image'],
  ['gemini-2.5-flash-image', 'zi32/gemini-2.5-flash-image'],
]);

const videoModelAliasMap = new Map<string, string>([
  // 32zi video model aliases
  ['grok-videos', 'zi32/grok-videos'],
  ['grok-video-3', 'zi32/grok-video-3'],
  ['grok-video-3-10s', 'zi32/grok-video-3-10s'],
]);

export function listImageModels(): ImageModelDefinition[] {
  return imageModels;
}

export function listVideoModels(): VideoModelDefinition[] {
  return videoModels;
}

export function listModelProviders(): ModelProviderDefinition[] {
  return providers;
}

export function getImageModel(modelId: string): ImageModelDefinition {
  const resolvedModelId = imageModelAliasMap.get(modelId) ?? modelId;
  return imageModelMap.get(resolvedModelId) ?? imageModelMap.get(DEFAULT_IMAGE_MODEL_ID)!;
}

export function getVideoModel(modelId: string): VideoModelDefinition | null {
  const resolvedModelId = videoModelAliasMap.get(modelId) ?? modelId;
  return videoModelMap.get(resolvedModelId) ?? null;
}

export function resolveImageModelResolutions(
  model: ImageModelDefinition,
  context: ImageModelRuntimeContext = {}
): ResolutionOption[] {
  const resolvedOptions = model.resolveResolutions?.(context);
  return resolvedOptions && resolvedOptions.length > 0 ? resolvedOptions : model.resolutions;
}

export function resolveImageModelResolution(
  model: ImageModelDefinition,
  requestedResolution: string | undefined,
  context: ImageModelRuntimeContext = {}
): ResolutionOption {
  const resolutionOptions = resolveImageModelResolutions(model, context);

  return (
    (requestedResolution
      ? resolutionOptions.find((item) => item.value === requestedResolution)
      : undefined) ??
    resolutionOptions.find((item) => item.value === model.defaultResolution) ??
    resolutionOptions[0] ??
    model.resolutions[0]
  );
}

export function getModelProvider(providerId: string): ModelProviderDefinition {
  return (
    providerMap.get(providerId) ?? {
      id: 'unknown',
      name: 'Unknown Provider',
      label: 'Unknown',
    }
  );
}

export function isVideoModel(modelId: string): boolean {
  const resolvedModelId = videoModelAliasMap.get(modelId) ?? modelId;
  return videoModelMap.has(resolvedModelId);
}

export function isImageModel(modelId: string): boolean {
  const resolvedModelId = imageModelAliasMap.get(modelId) ?? modelId;
  return imageModelMap.has(resolvedModelId);
}

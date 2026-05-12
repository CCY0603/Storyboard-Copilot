import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { GrsaiCreditTierId } from '@/features/canvas/pricing/types';

export type Theme = 'dark' | 'light' | 'system';
export type ThemeTone = 'neutral' | 'warm' | 'cool';
export type EdgeStyle = 'smoothstep' | 'straight' | 'step';
export type Language = 'zh' | 'en';
export type PromptLanguage = 'zh' | 'en' | 'auto';
export type PromptMode = 'simple' | 'advanced';

export interface SettingsState {
  theme: Theme;
  themeTone: ThemeTone;
  edgeStyle: EdgeStyle;
  language: Language;
  showWelcome: boolean;
  enablePreviewPanel: boolean;
  showToolbarOnHover: boolean;
  usePromptLibrary: boolean;
  promptLanguage: PromptLanguage;
  promptMode: PromptMode;
  alignmentEnabled: boolean;
  apiKeys: Record<string, string>;
  grsaiNanoBananaProModel: string;
  hideProviderGuidePopover: boolean;
  downloadPresetPaths: string[];
  useUploadFilenameAsNodeTitle: boolean;
  storyboardGenKeepStyleConsistent: boolean;
  storyboardGenDisableTextInImage: boolean;
  storyboardGenAutoInferEmptyFrame: boolean;
  ignoreAtTagWhenCopyingAndGenerating: boolean;
  enableStoryboardGenGridPreviewShortcut: boolean;
  showStoryboardGenAdvancedRatioControls: boolean;
  showNodePrice: boolean;
  priceDisplayCurrencyMode: 'auto' | 'cny' | 'usd';
  usdToCnyRate: number;
  preferDiscountedPrice: boolean;
  grsaiCreditTierId: GrsaiCreditTierId;
  uiRadiusPreset: 'compact' | 'default' | 'large';
  themeTonePreset: 'neutral' | 'warm' | 'cool';
  accentColor: string;
  canvasEdgeRoutingMode: 'spline' | 'orthogonal' | 'smartOrthogonal';
  autoCheckAppUpdateOnLaunch: boolean;
  enableUpdateDialog: boolean;
  setTheme: (theme: Theme) => void;
  setThemeTone: (tone: ThemeTone) => void;
  setEdgeStyle: (style: EdgeStyle) => void;
  setLanguage: (language: Language) => void;
  setShowWelcome: (show: boolean) => void;
  setEnablePreviewPanel: (enabled: boolean) => void;
  setShowToolbarOnHover: (show: boolean) => void;
  setUsePromptLibrary: (enabled: boolean) => void;
  setPromptLanguage: (language: PromptLanguage) => void;
  setPromptMode: (mode: PromptMode) => void;
  setAlignmentEnabled: (enabled: boolean) => void;
  setProviderApiKey: (providerId: string, apiKey: string) => void;
  setGrsaiNanoBananaProModel: (model: string) => void;
  setHideProviderGuidePopover: (hide: boolean) => void;
  setDownloadPresetPaths: (paths: string[]) => void;
  setUseUploadFilenameAsNodeTitle: (enabled: boolean) => void;
  setStoryboardGenKeepStyleConsistent: (enabled: boolean) => void;
  setStoryboardGenDisableTextInImage: (enabled: boolean) => void;
  setStoryboardGenAutoInferEmptyFrame: (enabled: boolean) => void;
  setIgnoreAtTagWhenCopyingAndGenerating: (enabled: boolean) => void;
  setEnableStoryboardGenGridPreviewShortcut: (enabled: boolean) => void;
  setShowStoryboardGenAdvancedRatioControls: (enabled: boolean) => void;
  setShowNodePrice: (enabled: boolean) => void;
  setPriceDisplayCurrencyMode: (mode: 'auto' | 'cny' | 'usd') => void;
  setUsdToCnyRate: (rate: number) => void;
  setPreferDiscountedPrice: (enabled: boolean) => void;
  setGrsaiCreditTierId: (tierId: string) => void;
  setUiRadiusPreset: (preset: 'compact' | 'default' | 'large') => void;
  setThemeTonePreset: (preset: 'neutral' | 'warm' | 'cool') => void;
  setAccentColor: (color: string) => void;
  setCanvasEdgeRoutingMode: (mode: 'spline' | 'orthogonal' | 'smartOrthogonal') => void;
  setAutoCheckAppUpdateOnLaunch: (enabled: boolean) => void;
  setEnableUpdateDialog: (enabled: boolean) => void;
}

export function getConfiguredApiKeyCount(
  apiKeys: Record<string, string>,
  providerIds: string[]
): number {
  return providerIds.filter(
    (providerId) => typeof apiKeys[providerId] === 'string' && apiKeys[providerId].length > 0
  ).length;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      themeTone: 'neutral',
      edgeStyle: 'smoothstep',
      language: 'zh',
      showWelcome: true,
      enablePreviewPanel: true,
      showToolbarOnHover: false,
      usePromptLibrary: false,
      promptLanguage: 'auto',
      promptMode: 'advanced',
      alignmentEnabled: true,
      apiKeys: {},
      grsaiNanoBananaProModel: '',
      hideProviderGuidePopover: false,
      downloadPresetPaths: [],
      useUploadFilenameAsNodeTitle: true,
      storyboardGenKeepStyleConsistent: true,
      storyboardGenDisableTextInImage: false,
      storyboardGenAutoInferEmptyFrame: true,
      ignoreAtTagWhenCopyingAndGenerating: false,
      enableStoryboardGenGridPreviewShortcut: false,
      showStoryboardGenAdvancedRatioControls: false,
      showNodePrice: false,
      priceDisplayCurrencyMode: 'auto',
      usdToCnyRate: 7.2,
      preferDiscountedPrice: true,
      grsaiCreditTierId: 'tier-10',
      uiRadiusPreset: 'default',
      themeTonePreset: 'neutral',
      accentColor: '#3B82F6',
      canvasEdgeRoutingMode: 'spline',
      autoCheckAppUpdateOnLaunch: true,
      enableUpdateDialog: true,
      setTheme: (theme) => set({ theme }),
      setThemeTone: (tone) => set({ themeTone: tone }),
      setEdgeStyle: (style) => set({ edgeStyle: style }),
      setLanguage: (language) => set({ language }),
      setShowWelcome: (show) => set({ showWelcome: show }),
      setEnablePreviewPanel: (enabled) => set({ enablePreviewPanel: enabled }),
      setShowToolbarOnHover: (show) => set({ showToolbarOnHover: show }),
      setUsePromptLibrary: (enabled) => set({ usePromptLibrary: enabled }),
      setPromptLanguage: (language) => set({ promptLanguage: language }),
      setPromptMode: (mode) => set({ promptMode: mode }),
      setAlignmentEnabled: (enabled) => set({ alignmentEnabled: enabled }),
      setProviderApiKey: (providerId, apiKey) =>
        set((state) => ({
          apiKeys: { ...state.apiKeys, [providerId]: apiKey },
        })),
      setGrsaiNanoBananaProModel: (model) => set({ grsaiNanoBananaProModel: model }),
      setHideProviderGuidePopover: (hide) => set({ hideProviderGuidePopover: hide }),
      setDownloadPresetPaths: (paths) => set({ downloadPresetPaths: paths }),
      setUseUploadFilenameAsNodeTitle: (enabled) => set({ useUploadFilenameAsNodeTitle: enabled }),
      setStoryboardGenKeepStyleConsistent: (enabled) => set({ storyboardGenKeepStyleConsistent: enabled }),
      setStoryboardGenDisableTextInImage: (enabled) => set({ storyboardGenDisableTextInImage: enabled }),
      setStoryboardGenAutoInferEmptyFrame: (enabled) => set({ storyboardGenAutoInferEmptyFrame: enabled }),
      setIgnoreAtTagWhenCopyingAndGenerating: (enabled) => set({ ignoreAtTagWhenCopyingAndGenerating: enabled }),
      setEnableStoryboardGenGridPreviewShortcut: (enabled) => set({ enableStoryboardGenGridPreviewShortcut: enabled }),
      setShowStoryboardGenAdvancedRatioControls: (enabled) => set({ showStoryboardGenAdvancedRatioControls: enabled }),
      setShowNodePrice: (enabled) => set({ showNodePrice: enabled }),
      setPriceDisplayCurrencyMode: (mode) => set({ priceDisplayCurrencyMode: mode }),
      setUsdToCnyRate: (rate) => set({ usdToCnyRate: rate }),
      setPreferDiscountedPrice: (enabled) => set({ preferDiscountedPrice: enabled }),
      setGrsaiCreditTierId: (tierId) => set({ grsaiCreditTierId: tierId as GrsaiCreditTierId }),
      setUiRadiusPreset: (preset) => set({ uiRadiusPreset: preset }),
      setThemeTonePreset: (preset) => set({ themeTonePreset: preset }),
      setAccentColor: (color) => set({ accentColor: color }),
      setCanvasEdgeRoutingMode: (mode) => set({ canvasEdgeRoutingMode: mode }),
      setAutoCheckAppUpdateOnLaunch: (enabled) => set({ autoCheckAppUpdateOnLaunch: enabled }),
      setEnableUpdateDialog: (enabled) => set({ enableUpdateDialog: enabled }),
    }),
    {
      name: 'settings-storage',
      version: 12,
      migrate: (persistedState: unknown) => {
        const state = (persistedState ?? {}) as {
          theme?: Theme;
          themeTone?: ThemeTone;
          edgeStyle?: EdgeStyle;
          language?: Language;
          showWelcome?: boolean;
          enablePreviewPanel?: boolean;
          showToolbarOnHover?: boolean;
          usePromptLibrary?: boolean;
          promptLanguage?: PromptLanguage;
          promptMode?: PromptMode;
          alignmentEnabled?: boolean;
          apiKeys?: Record<string, string>;
          grsaiNanoBananaProModel?: string;
          hideProviderGuidePopover?: boolean;
          downloadPresetPaths?: string[];
          useUploadFilenameAsNodeTitle?: boolean;
          storyboardGenKeepStyleConsistent?: boolean;
          storyboardGenDisableTextInImage?: boolean;
          storyboardGenAutoInferEmptyFrame?: boolean;
          ignoreAtTagWhenCopyingAndGenerating?: boolean;
          enableStoryboardGenGridPreviewShortcut?: boolean;
          showStoryboardGenAdvancedRatioControls?: boolean;
          showNodePrice?: boolean;
          priceDisplayCurrencyMode?: 'auto' | 'cny' | 'usd';
          usdToCnyRate?: number;
          preferDiscountedPrice?: boolean;
          grsaiCreditTierId?: string;
          uiRadiusPreset?: 'compact' | 'default' | 'large';
          themeTonePreset?: 'neutral' | 'warm' | 'cool';
          accentColor?: string;
          canvasEdgeRoutingMode?: 'spline' | 'orthogonal' | 'smartOrthogonal';
          autoCheckAppUpdateOnLaunch?: boolean;
          enableUpdateDialog?: boolean;
        };
        return {
          ...(persistedState as object),
          theme: state.theme ?? 'dark',
          themeTone: state.themeTone ?? 'neutral',
          edgeStyle: state.edgeStyle ?? 'smoothstep',
          language: state.language ?? 'zh',
          showWelcome: state.showWelcome ?? true,
          enablePreviewPanel: state.enablePreviewPanel ?? true,
          showToolbarOnHover: state.showToolbarOnHover ?? false,
          usePromptLibrary: state.usePromptLibrary ?? false,
          promptLanguage: state.promptLanguage ?? 'auto',
          promptMode: state.promptMode ?? 'advanced',
          alignmentEnabled: state.alignmentEnabled ?? true,
          apiKeys: state.apiKeys ?? {},
          grsaiNanoBananaProModel: state.grsaiNanoBananaProModel ?? '',
          hideProviderGuidePopover: state.hideProviderGuidePopover ?? false,
          downloadPresetPaths: state.downloadPresetPaths ?? [],
          useUploadFilenameAsNodeTitle: state.useUploadFilenameAsNodeTitle ?? true,
          storyboardGenKeepStyleConsistent: state.storyboardGenKeepStyleConsistent ?? true,
          storyboardGenDisableTextInImage: state.storyboardGenDisableTextInImage ?? false,
          storyboardGenAutoInferEmptyFrame: state.storyboardGenAutoInferEmptyFrame ?? true,
          ignoreAtTagWhenCopyingAndGenerating: state.ignoreAtTagWhenCopyingAndGenerating ?? false,
          enableStoryboardGenGridPreviewShortcut: state.enableStoryboardGenGridPreviewShortcut ?? false,
          showStoryboardGenAdvancedRatioControls: state.showStoryboardGenAdvancedRatioControls ?? false,
          showNodePrice: state.showNodePrice ?? false,
          priceDisplayCurrencyMode: state.priceDisplayCurrencyMode ?? 'auto',
          usdToCnyRate: state.usdToCnyRate ?? 7.2,
          preferDiscountedPrice: state.preferDiscountedPrice ?? true,
          grsaiCreditTierId: state.grsaiCreditTierId ?? 'tier-10',
          uiRadiusPreset: state.uiRadiusPreset ?? 'default',
          themeTonePreset: state.themeTonePreset ?? 'neutral',
          accentColor: state.accentColor ?? '#3B82F6',
          canvasEdgeRoutingMode: state.canvasEdgeRoutingMode ?? 'spline',
          autoCheckAppUpdateOnLaunch: state.autoCheckAppUpdateOnLaunch ?? true,
          enableUpdateDialog: state.enableUpdateDialog ?? true,
        };
      },
    }
  )
);
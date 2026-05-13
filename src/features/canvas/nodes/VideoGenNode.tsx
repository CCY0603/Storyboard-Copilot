import {
  type KeyboardEvent,
  memo,
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  CANVAS_NODE_TYPES,
  EXPORT_RESULT_NODE_DEFAULT_WIDTH,
  EXPORT_RESULT_NODE_LAYOUT_HEIGHT,
  type VideoGenNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import {
  canvasAiGateway,
  graphImageResolver,
} from '@/features/canvas/application/canvasServices';
import { resolveErrorContent, showErrorDialog } from '@/features/canvas/application/errorDialog';
import {
  resolveImageDisplayUrl,
} from '@/features/canvas/application/imageData';
import {
  buildGenerationErrorReport,
  getRuntimeDiagnostics,
  type GenerationDebugContext,
} from '@/features/canvas/application/generationErrorReport';
import {
  findReferenceTokens,
  insertReferenceToken,
  removeTextRange,
  resolveReferenceAwareDeleteRange,
} from '@/features/canvas/application/referenceTokenEditing';
import {
  DEFAULT_VIDEO_MODEL_ID,
  getVideoModel,
  listVideoModels,
  listModelProviders,
} from '@/features/canvas/models';
import {
  NODE_CONTROL_CHIP_CLASS,
  NODE_CONTROL_ICON_CLASS,
  NODE_CONTROL_MODEL_CHIP_CLASS,
  NODE_CONTROL_PARAMS_CHIP_CLASS,
  NODE_CONTROL_PRIMARY_BUTTON_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { UiButton } from '@/components/ui';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';

type VideoGenNodeProps = NodeProps & {
  id: string;
  data: VideoGenNodeData;
  selected?: boolean;
};

interface AspectRatioChoice {
  value: string;
  label: string;
}

interface PickerAnchor {
  left: number;
  top: number;
}

const PICKER_FALLBACK_ANCHOR: PickerAnchor = { left: 8, top: 8 };
const PICKER_Y_OFFSET_PX = 20;

function getTextareaCaretOffset(
  textarea: HTMLTextAreaElement,
  caretIndex: number
): PickerAnchor {
  const mirror = document.createElement('div');
  const computed = window.getComputedStyle(textarea);
  const mirrorStyle = mirror.style;

  mirrorStyle.position = 'absolute';
  mirrorStyle.visibility = 'hidden';
  mirrorStyle.pointerEvents = 'none';
  mirrorStyle.whiteSpace = 'pre-wrap';
  mirrorStyle.overflowWrap = 'break-word';
  mirrorStyle.wordBreak = 'break-word';
  mirrorStyle.boxSizing = computed.boxSizing;
  mirrorStyle.width = `${textarea.clientWidth}px`;
  mirrorStyle.font = computed.font;
  mirrorStyle.letterSpacing = computed.letterSpacing;
  mirrorStyle.padding = computed.padding;
  mirrorStyle.lineHeight = computed.lineHeight;

  const textBeforeCaret = textarea.value.substring(0, caretIndex);
  mirror.textContent = textBeforeCaret;

  const span = document.createElement('span');
  span.textContent = textarea.value.substring(caretIndex, caretIndex + 1) || '.';
  mirror.appendChild(span);

  document.body.appendChild(mirror);
  const spanRect = span.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  document.body.removeChild(mirror);

  return {
    left: spanRect.left - mirrorRect.left,
    top: spanRect.top - mirrorRect.top + spanRect.height,
  };
}

function resolvePickerAnchor(
  container: HTMLDivElement | null,
  textarea: HTMLTextAreaElement,
  caretIndex: number
): PickerAnchor {
  if (!container) {
    return PICKER_FALLBACK_ANCHOR;
  }

  const containerRect = container.getBoundingClientRect();
  const textareaRect = textarea.getBoundingClientRect();
  const caretOffset = getTextareaCaretOffset(textarea, caretIndex);

  return {
    left: Math.max(0, textareaRect.left - containerRect.left + caretOffset.left),
    top: Math.max(0, textareaRect.top - containerRect.top + caretOffset.top + PICKER_Y_OFFSET_PX),
  };
}

function renderPromptWithHighlights(prompt: string, maxImageCount: number): React.ReactNode {
  if (!prompt) {
    return ' ';
  }

  const segments: React.ReactNode[] = [];
  let lastIndex = 0;
  const referenceTokens = findReferenceTokens(prompt, maxImageCount);
  for (const token of referenceTokens) {
    const matchStart = token.start;
    const matchText = token.token;

    if (matchStart > lastIndex) {
      segments.push(
        <span key={`plain-${lastIndex}`}>{prompt.slice(lastIndex, matchStart)}</span>
      );
    }

    segments.push(
      <span
        key={`ref-${matchStart}`}
        className="relative z-0 mr-1 inline-block text-white [text-shadow:0.24px_0_currentColor,-0.24px_0_currentColor] before:absolute before:-inset-x-[2px] before:-inset-y-[1px] before:-z-10 before:rounded-[6px] before:bg-accent/55 before:content-['']"
      >
        {matchText}
      </span>
    );

    lastIndex = matchStart + matchText.length;
  }

  if (lastIndex < prompt.length) {
    segments.push(<span key={`plain-${lastIndex}`}>{prompt.slice(lastIndex)}</span>);
  }

  return segments;
}

const VIDEO_GEN_NODE_MIN_WIDTH = 400;
const VIDEO_GEN_NODE_MIN_HEIGHT = 340;
const VIDEO_GEN_NODE_MAX_WIDTH = 1200;
const VIDEO_GEN_NODE_MAX_HEIGHT = 900;
const VIDEO_GEN_NODE_DEFAULT_WIDTH = 480;
const VIDEO_GEN_NODE_DEFAULT_HEIGHT = 480;

function buildAiResultNodeTitle(prompt: string, fallbackTitle: string): string {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) {
    return fallbackTitle;
  }
  return normalizedPrompt;
}

export const VideoGenNode = memo(({ id, data, selected, width, height }: VideoGenNodeProps) => {
  const { t } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const [error, setError] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const promptHighlightRef = useRef<HTMLDivElement>(null);
  const [promptDraft, setPromptDraft] = useState(() => data.prompt ?? '');
  const promptDraftRef = useRef(promptDraft);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [pickerCursor, setPickerCursor] = useState<number | null>(null);
  const [pickerActiveIndex, setPickerActiveIndex] = useState(0);
  const [pickerAnchor, setPickerAnchor] = useState<PickerAnchor>(PICKER_FALLBACK_ANCHOR);

  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const addNode = useCanvasStore((state) => state.addNode);
  const findNodePosition = useCanvasStore((state) => state.findNodePosition);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const apiKeys = useSettingsStore((state) => state.apiKeys);

  const incomingImages = useMemo(
    () => graphImageResolver.collectInputImages(id, nodes, edges),
    [id, nodes, edges]
  );

  const incomingImageItems = useMemo(
    () =>
      incomingImages.map((imageUrl, index) => ({
        imageUrl,
        displayUrl: resolveImageDisplayUrl(imageUrl),
        label: `图${index + 1}`,
      })),
    [incomingImages]
  );
  const incomingImageViewerList = useMemo(
    () => incomingImageItems.map((item) => resolveImageDisplayUrl(item.imageUrl)),
    [incomingImageItems]
  );

  const videoModels = useMemo(() => listVideoModels(), []);
  const modelProviders = useMemo(() => listModelProviders(), []);

  // Get providers that have video models
  const videoProviders = useMemo(() => {
    const providerIds = new Set(videoModels.map((m) => m.providerId));
    return modelProviders.filter((p) => providerIds.has(p.id));
  }, [modelProviders, videoModels]);

  // Get models filtered by selected provider
  const selectedProviderId = useMemo(() => {
    const modelId = data.model ?? DEFAULT_VIDEO_MODEL_ID;
    const model = getVideoModel(modelId);
    return model?.providerId ?? videoProviders[0]?.id ?? 'zi32';
  }, [data.model, videoProviders]);

  const filteredVideoModels = useMemo(
    () => videoModels.filter((m) => m.providerId === selectedProviderId),
    [videoModels, selectedProviderId]
  );

  const selectedModel = useMemo(() => {
    const modelId = data.model ?? DEFAULT_VIDEO_MODEL_ID;
    return getVideoModel(modelId) ?? videoModels[0];
  }, [data.model, videoModels]);

  const providerApiKey = apiKeys[selectedModel.providerId] ?? '';

  const aspectRatioOptions = useMemo<AspectRatioChoice[]>(
    () => selectedModel.aspectRatios.map((item) => ({ value: item.value, label: item.label })),
    [selectedModel.aspectRatios]
  );

  const durationOptions = useMemo(() => {
    return selectedModel.durations ?? [5, 10, 15];
  }, [selectedModel.durations]);

  const resolutionOptions = useMemo(() => {
    return selectedModel.resolutions ?? [{ value: '720P', label: '720P' }];
  }, [selectedModel.resolutions]);

  const selectedResolution = useMemo(
    () =>
      resolutionOptions.find((item) => item.value === selectedModel.defaultResolution) ??
      resolutionOptions[0],
    [resolutionOptions, selectedModel.defaultResolution]
  );

  const selectedAspectRatio = useMemo(
    () =>
      aspectRatioOptions.find((item) => item.value === selectedModel.defaultAspectRatio) ??
      aspectRatioOptions[0],
    [aspectRatioOptions, selectedModel.defaultAspectRatio]
  );

  const selectedDuration = useMemo(
    () => data.duration ?? selectedModel.defaultDuration ?? 5,
    [data.duration, selectedModel.defaultDuration]
  );

  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.videoGen, data),
    [data]
  );

  const resolvedWidth = Math.max(VIDEO_GEN_NODE_MIN_WIDTH, Math.round(width ?? VIDEO_GEN_NODE_DEFAULT_WIDTH));
  const resolvedHeight = Math.max(VIDEO_GEN_NODE_MIN_HEIGHT, Math.round(height ?? VIDEO_GEN_NODE_DEFAULT_HEIGHT));

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedHeight, resolvedWidth, updateNodeInternals]);

  useEffect(() => {
    const externalPrompt = data.prompt ?? '';
    if (externalPrompt !== promptDraftRef.current) {
      promptDraftRef.current = externalPrompt;
      setPromptDraft(externalPrompt);
    }
  }, [data.prompt]);

  const commitPromptDraft = useCallback((nextPrompt: string) => {
    promptDraftRef.current = nextPrompt;
    updateNodeData(id, { prompt: nextPrompt });
  }, [id, updateNodeData]);

  const syncPromptHighlightScroll = () => {
    if (!promptRef.current || !promptHighlightRef.current) {
      return;
    }

    promptHighlightRef.current.scrollTop = promptRef.current.scrollTop;
    promptHighlightRef.current.scrollLeft = promptRef.current.scrollLeft;
  };

  const insertImageReference = useCallback((imageIndex: number) => {
    const marker = `@图${imageIndex + 1}`;
    const currentPrompt = promptDraftRef.current;
    const cursor = pickerCursor ?? currentPrompt.length;
    
    // Remove the trigger '@' character before inserting the reference token
    const textWithoutTriggerAt = cursor > 0 && currentPrompt[cursor - 1] === '@'
      ? currentPrompt.slice(0, cursor - 1) + currentPrompt.slice(cursor)
      : currentPrompt;
    const adjustedCursor = cursor > 0 && currentPrompt[cursor - 1] === '@' ? cursor - 1 : cursor;
    
    const { nextText: nextPrompt, nextCursor } = insertReferenceToken(textWithoutTriggerAt, adjustedCursor, marker);

    setPromptDraft(nextPrompt);
    commitPromptDraft(nextPrompt);
    setShowImagePicker(false);
    setPickerCursor(null);
    setPickerActiveIndex(0);

    requestAnimationFrame(() => {
      promptRef.current?.focus();
      promptRef.current?.setSelectionRange(nextCursor, nextCursor);
      syncPromptHighlightScroll();
    });
  }, [commitPromptDraft, pickerCursor]);

  const checkAndShowImagePicker = useCallback(() => {
    if (incomingImages.length === 0) {
      return;
    }

    const textarea = promptRef.current;
    if (!textarea) {
      return;
    }

    const cursor = textarea.selectionStart ?? promptDraftRef.current.length;
    const textBeforeCursor = promptDraftRef.current.slice(0, cursor);
    
    // Check if the last character before cursor is '@'
    if (textBeforeCursor.endsWith('@')) {
      setPickerAnchor(resolvePickerAnchor(rootRef.current, textarea, cursor));
      setPickerCursor(cursor);
      setShowImagePicker(true);
      setPickerActiveIndex(0);
    }
  }, [incomingImages.length]);

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Backspace' || event.key === 'Delete') {
      const currentPrompt = promptDraftRef.current;
      const selectionStart = event.currentTarget.selectionStart ?? currentPrompt.length;
      const selectionEnd = event.currentTarget.selectionEnd ?? selectionStart;
      const deletionDirection = event.key === 'Backspace' ? 'backward' : 'forward';
      const deleteRange = resolveReferenceAwareDeleteRange(
        currentPrompt,
        selectionStart,
        selectionEnd,
        deletionDirection,
        incomingImages.length
      );
      if (deleteRange) {
        event.preventDefault();
        const { nextText, nextCursor } = removeTextRange(currentPrompt, deleteRange);
        setPromptDraft(nextText);
        commitPromptDraft(nextText);
        requestAnimationFrame(() => {
          promptRef.current?.focus();
          promptRef.current?.setSelectionRange(nextCursor, nextCursor);
          syncPromptHighlightScroll();
        });
        return;
      }
    }

    if (showImagePicker && incomingImages.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setPickerActiveIndex((previous) => (previous + 1) % incomingImages.length);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setPickerActiveIndex((previous) =>
          previous === 0 ? incomingImages.length - 1 : previous - 1
        );
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        insertImageReference(pickerActiveIndex);
        return;
      }
    }

    if (event.key === 'Escape' && showImagePicker) {
      event.preventDefault();
      setShowImagePicker(false);
      setPickerCursor(null);
      setPickerActiveIndex(0);
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void handleGenerate();
    }
  };

  const handlePromptCompositionEnd = () => {
    // After composition ends (e.g., Chinese IME), check if we should show the picker
    requestAnimationFrame(() => {
      checkAndShowImagePicker();
    });
  };

  useEffect(() => {
    if (data.model !== selectedModel.id) {
      updateNodeData(id, { model: selectedModel.id });
    }
  }, [data.model, id, selectedModel.id, updateNodeData]);

  const handleGenerate = useCallback(async () => {
    const prompt = promptDraft.trim();
    if (!prompt) {
      const errorMessage = t('node.videoGen.promptRequired');
      setError(errorMessage);
      void showErrorDialog(errorMessage, t('common.error'));
      return;
    }

    if (!providerApiKey) {
      const errorMessage = t('node.videoGen.apiKeyRequired');
      setError(errorMessage);
      void showErrorDialog(errorMessage, t('common.error'));
      return;
    }

    const generationDurationMs = selectedModel.expectedDurationMs ?? 120000;
    const generationStartedAt = Date.now();
    const resultNodeTitle = buildAiResultNodeTitle(prompt, t('node.videoGen.resultTitle'));
    const runtimeDiagnostics = await getRuntimeDiagnostics();
    setError(null);

    const newNodePosition = findNodePosition(
      id,
      EXPORT_RESULT_NODE_DEFAULT_WIDTH,
      EXPORT_RESULT_NODE_LAYOUT_HEIGHT
    );
    const newNodeId = addNode(
      CANVAS_NODE_TYPES.exportImage,
      newNodePosition,
      {
        isGenerating: true,
        generationStartedAt,
        generationDurationMs,
        resultKind: 'generic',
        displayName: resultNodeTitle,
        model: selectedModel.id,
      }
    );
    addEdge(id, newNodeId);

    try {
      await canvasAiGateway.setApiKey(selectedModel.providerId, providerApiKey);

      const videoUrl = await canvasAiGateway.generateVideo({
        prompt,
        model: selectedModel.id,
        size: selectedResolution.value,
        aspectRatio: selectedAspectRatio.value,
        referenceImages: incomingImages,
        extraParams: { duration: selectedDuration, resolution: selectedResolution.value },
        duration: selectedDuration,
      });

      const generationDebugContext: GenerationDebugContext = {
        sourceType: 'videoGen',
        providerId: selectedModel.providerId,
        requestModel: selectedModel.id,
        requestSize: selectedAspectRatio.value,
        requestAspectRatio: selectedAspectRatio.value,
        prompt,
        extraParams: { duration: selectedDuration },
        referenceImageCount: incomingImages.length,
        referenceImagePlaceholders: [],
        appVersion: runtimeDiagnostics.appVersion,
        osName: runtimeDiagnostics.osName,
        osVersion: runtimeDiagnostics.osVersion,
        osBuild: runtimeDiagnostics.osBuild,
        userAgent: runtimeDiagnostics.userAgent,
      };

      updateNodeData(newNodeId, {
        imageUrl: videoUrl,
        previewImageUrl: videoUrl,
        aspectRatio: selectedAspectRatio.value,
        isGenerating: false,
        generationStartedAt: null,
        generationJobId: null,
        generationProviderId: null,
        generationClientSessionId: null,
        generationDebugContext,
      });
    } catch (generationError) {
      const resolvedError = resolveErrorContent(generationError, t('ai.error'));
      const generationDebugContext: GenerationDebugContext = {
        sourceType: 'videoGen',
        providerId: selectedModel.providerId,
        requestModel: selectedModel.id,
        requestSize: selectedAspectRatio.value,
        requestAspectRatio: selectedAspectRatio.value,
        prompt,
        extraParams: { duration: selectedDuration },
        referenceImageCount: incomingImages.length,
        referenceImagePlaceholders: [],
        appVersion: runtimeDiagnostics.appVersion,
        osName: runtimeDiagnostics.osName,
        osVersion: runtimeDiagnostics.osVersion,
        osBuild: runtimeDiagnostics.osBuild,
        userAgent: runtimeDiagnostics.userAgent,
      };
      const reportText = buildGenerationErrorReport({
        errorMessage: resolvedError.message,
        errorDetails: resolvedError.details,
        context: generationDebugContext,
      });
      setError(resolvedError.message);
      void showErrorDialog(
        resolvedError.message,
        t('common.error'),
        resolvedError.details,
        reportText
      );
      updateNodeData(newNodeId, {
        isGenerating: false,
        generationStartedAt: null,
        generationJobId: null,
        generationProviderId: null,
        generationClientSessionId: null,
        generationError: resolvedError.message,
        generationErrorDetails: resolvedError.details ?? null,
        generationDebugContext,
      });
    }
  }, [
    addNode,
    addEdge,
    providerApiKey,
    findNodePosition,
    promptDraft,
    id,
    incomingImages,
    selectedModel,
    selectedAspectRatio.value,
    selectedDuration,
    t,
    updateNodeData,
  ]);

  return (
    <div
      ref={rootRef}
      className={`
        group relative flex h-full flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-colors duration-150
        ${selected
          ? 'border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.32)]'
          : 'border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)]'}
      `}
      style={{ width: `${resolvedWidth}px`, height: `${resolvedHeight}px` }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<Sparkles className="h-4 w-4" />}
        titleText={resolvedTitle}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      {/* Reference Image Section - compact */}
      {incomingImages.length > 0 && (
        <div className="mb-1.5 shrink-0 flex items-center gap-1.5">
          <span className="text-[11px] text-text-muted shrink-0">参考图</span>
          <div className="flex items-center gap-1 overflow-hidden">
            {incomingImages.slice(0, 3).map((imageUrl, index) => (
              <div key={index} className="h-8 w-8 shrink-0">
                <img
                  src={resolveImageDisplayUrl(imageUrl)}
                  alt={`Ref ${index + 1}`}
                  className="h-full w-full rounded object-cover"
                />
              </div>
            ))}
            {incomingImages.length > 3 && (
              <span className="text-[10px] text-text-muted">+{incomingImages.length - 3}</span>
            )}
          </div>
        </div>
      )}

      {/* Prompt Input */}
      <div className="relative min-h-[80px] flex-1 rounded-lg border border-[rgba(255,255,255,0.1)] bg-bg-dark/45 p-2">
        <div className="relative h-full min-h-0">
          <div
            ref={promptHighlightRef}
            aria-hidden="true"
            className="ui-scrollbar pointer-events-none absolute inset-0 overflow-y-auto overflow-x-hidden text-sm leading-6 text-text-dark"
            style={{ scrollbarGutter: 'stable' }}
          >
            <div className="min-h-full whitespace-pre-wrap break-words px-1 py-0.5">
              {renderPromptWithHighlights(promptDraft, incomingImages.length)}
            </div>
          </div>

          <textarea
            ref={promptRef}
            value={promptDraft}
            onChange={(event) => {
              const nextValue = event.target.value;
              setPromptDraft(nextValue);
              commitPromptDraft(nextValue);
            }}
            onKeyDown={handlePromptKeyDown}
            onCompositionEnd={handlePromptCompositionEnd}
            onScroll={syncPromptHighlightScroll}
            onMouseDown={(event) => event.stopPropagation()}
            placeholder={t('node.videoGen.promptPlaceholder')}
            className="ui-scrollbar nodrag nowheel relative z-10 h-full w-full resize-none overflow-y-auto overflow-x-hidden border-none bg-transparent px-1 py-0.5 text-sm leading-6 text-transparent caret-text-dark outline-none placeholder:text-text-muted/80 focus:border-transparent whitespace-pre-wrap break-words"
            style={{ scrollbarGutter: 'stable' }}
          />
        </div>

        {showImagePicker && incomingImageItems.length > 0 && (
          <div
            className="nowheel absolute z-30 w-[120px] overflow-hidden rounded-xl border border-[rgba(255,255,255,0.16)] bg-surface-dark shadow-xl"
            style={{ left: pickerAnchor.left, top: pickerAnchor.top }}
            onMouseDown={(event) => event.stopPropagation()}
            onWheelCapture={(event) => event.stopPropagation()}
          >
            <div
              className="ui-scrollbar nowheel max-h-[180px] overflow-y-auto"
              onWheelCapture={(event) => event.stopPropagation()}
            >
              {incomingImageItems.map((item, index) => (
                <button
                  key={`${item.imageUrl}-${index}`}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    insertImageReference(index);
                  }}
                  onMouseEnter={() => setPickerActiveIndex(index)}
                  className={`flex w-full items-center gap-2 border border-transparent bg-bg-dark/70 px-2 py-2 text-left text-sm text-text-dark transition-colors hover:border-[rgba(255,255,255,0.18)] ${pickerActiveIndex === index
                      ? 'border-[rgba(255,255,255,0.24)] bg-bg-dark'
                      : ''
                    }`}
                >
                  <CanvasNodeImage
                    src={item.displayUrl}
                    alt={item.label}
                    viewerSourceUrl={resolveImageDisplayUrl(item.imageUrl)}
                    viewerImageList={incomingImageViewerList}
                    className="h-8 w-8 rounded object-cover"
                    draggable={false}
                  />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="mt-2 flex shrink-0 flex-wrap items-center gap-2">
        {/* Provider Select */}
        <select
          value={selectedProviderId}
          onChange={(e) => {
            const providerId = e.target.value;
            const providerModels = videoModels.filter((m) => m.providerId === providerId);
            if (providerModels.length > 0) {
              updateNodeData(id, { model: providerModels[0].id });
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className={`shrink-0 rounded border border-[rgba(255,255,255,0.1)] bg-bg-dark px-2 py-1 text-xs text-text-dark ${NODE_CONTROL_CHIP_CLASS}`}
        >
          {videoProviders.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </select>

        {/* Model Select */}
        <select
          value={selectedModel.id}
          onChange={(e) => {
            updateNodeData(id, { model: e.target.value });
          }}
          onClick={(e) => e.stopPropagation()}
          className={`min-w-[100px] shrink-0 rounded border border-[rgba(255,255,255,0.1)] bg-bg-dark px-2 py-1 text-xs text-text-dark ${NODE_CONTROL_MODEL_CHIP_CLASS}`}
        >
          {filteredVideoModels.map((model) => (
            <option key={model.id} value={model.id}>
              {model.displayName}
            </option>
          ))}
        </select>

        {/* Aspect Ratio Select */}
        <select
          value={selectedAspectRatio.value}
          onChange={(e) => {
            updateNodeData(id, { aspectRatio: e.target.value });
          }}
          onClick={(e) => e.stopPropagation()}
          className={`shrink-0 rounded border border-[rgba(255,255,255,0.1)] bg-bg-dark px-2 py-1 text-xs text-text-dark ${NODE_CONTROL_PARAMS_CHIP_CLASS}`}
        >
          {aspectRatioOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {/* Resolution Select */}
        {resolutionOptions.length > 1 && (
          <select
            value={selectedResolution.value}
            onChange={(e) => {
              updateNodeData(id, { resolution: e.target.value });
            }}
            onClick={(e) => e.stopPropagation()}
            className={`shrink-0 rounded border border-[rgba(255,255,255,0.1)] bg-bg-dark px-2 py-1 text-xs text-text-dark ${NODE_CONTROL_PARAMS_CHIP_CLASS}`}
          >
            {resolutionOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )}

        {/* Duration Select */}
        {durationOptions.length > 1 && (
          <select
            value={selectedDuration}
            onChange={(e) => {
              updateNodeData(id, { duration: parseInt(e.target.value, 10) });
            }}
            onClick={(e) => e.stopPropagation()}
            className={`shrink-0 rounded border border-[rgba(255,255,255,0.1)] bg-bg-dark px-2 py-1 text-xs text-text-dark ${NODE_CONTROL_PARAMS_CHIP_CLASS}`}
          >
            {durationOptions.map((duration) => (
              <option key={duration} value={duration}>
                {duration}s
              </option>
            ))}
          </select>
        )}

        <div className="ml-auto" />

        <UiButton
          onClick={(event) => {
            event.stopPropagation();
            void handleGenerate();
          }}
          variant="primary"
          className={`shrink-0 ${NODE_CONTROL_PRIMARY_BUTTON_CLASS}`}
        >
          <Sparkles className={NODE_CONTROL_ICON_CLASS} strokeWidth={2.8} />
          {t('canvas.generate')}
        </UiButton>
      </div>

      {error && <div className="mt-1 shrink-0 text-xs text-red-400">{error}</div>}

      <Handle
        type="target"
        id="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-surface-dark !bg-accent"
      />
      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-surface-dark !bg-accent"
      />
      <NodeResizeHandle
        minWidth={VIDEO_GEN_NODE_MIN_WIDTH}
        minHeight={VIDEO_GEN_NODE_MIN_HEIGHT}
        maxWidth={VIDEO_GEN_NODE_MAX_WIDTH}
        maxHeight={VIDEO_GEN_NODE_MAX_HEIGHT}
      />
    </div>
  );
});

VideoGenNode.displayName = 'VideoGenNode';
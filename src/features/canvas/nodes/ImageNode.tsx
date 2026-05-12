import { memo, useEffect, useMemo, useState } from 'react';
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  useViewport,
  type NodeProps,
} from '@xyflow/react';
import { AlertTriangle, Image as ImageIcon, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  CANVAS_NODE_TYPES,
  DEFAULT_ASPECT_RATIO,
  EXPORT_RESULT_NODE_MIN_WIDTH,
  EXPORT_RESULT_NODE_MIN_HEIGHT,
  type CanvasNodeType,
  type ExportImageNodeData,
  type ImageEditNodeData,
} from '@/features/canvas/domain/canvasNodes';
import {
  resolveMinEdgeFittedSize,
  resolveResizeMinConstraintsByAspect,
} from '@/features/canvas/application/imageNodeSizing';
import {
  resolveImageDisplayUrl,
  shouldUseOriginalImageByZoom,
} from '@/features/canvas/application/imageData';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { useCanvasStore } from '@/stores/canvasStore';
import { getModelProvider, isVideoModel } from '@/features/canvas/models';

type ImageNodeProps = NodeProps & {
  id: string;
  data: ImageEditNodeData | ExportImageNodeData;
  selected?: boolean;
};

function resolveNodeDimension(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1) {
    return Math.round(value);
  }
  return fallback;
}

export const ImageNode = memo(({ id, data, selected, type, width, height }: ImageNodeProps) => {
  const { t } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const { zoom } = useViewport();
  const [now, setNow] = useState(() => Date.now());
  const isExportResultNode = type === CANVAS_NODE_TYPES.exportImage;
  const isGenerating = typeof data.isGenerating === 'boolean' ? data.isGenerating : false;
  const generationError =
    typeof (data as { generationError?: unknown }).generationError === 'string'
      ? ((data as { generationError?: string }).generationError ?? '').trim()
      : '';
  const hasGenerationError =
    isExportResultNode && !isGenerating && !data.imageUrl && generationError.length > 0;
  const generationStartedAt =
    typeof data.generationStartedAt === 'number' ? data.generationStartedAt : null;
  const generationDurationMs =
    typeof data.generationDurationMs === 'number' ? data.generationDurationMs : 60000;
  const resolvedAspectRatio = data.aspectRatio || DEFAULT_ASPECT_RATIO;
  const compactSize = resolveMinEdgeFittedSize(resolvedAspectRatio, {
    minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
    minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
  });
  const resizeConstraints = resolveResizeMinConstraintsByAspect(resolvedAspectRatio, {
    minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
    minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
  });
  const resizeMinWidth = resizeConstraints.minWidth;
  const resizeMinHeight = resizeConstraints.minHeight;
  const resolvedWidth = resolveNodeDimension(width, compactSize.width);
  const resolvedHeight = resolveNodeDimension(height, compactSize.height);
  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(type as CanvasNodeType, data),
    [data, type]
  );

  const modelSubtitle = useMemo(() => {
    if (!isExportResultNode) return undefined;
    const modelId = (data as ExportImageNodeData).model;
    if (!modelId) return undefined;
    const provider = getModelProvider(modelId.split('/')[0] ?? '');
    const slashIndex = modelId.lastIndexOf('/');
    const shortId = slashIndex >= 0 ? modelId.slice(slashIndex + 1) : modelId;
    return (
      <span className="text-[8px] font-medium text-blue-400 dark:text-blue-300 whitespace-nowrap truncate">
        {provider.label} · {shortId}
      </span>
    );
  }, [data, isExportResultNode]);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedHeight, resolvedWidth, updateNodeInternals]);

  useEffect(() => {
    if (!isGenerating) {
      return;
    }

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 120);

    return () => {
      window.clearInterval(timer);
    };
  }, [isGenerating]);

  const simulatedProgress = useMemo(() => {
    if (!isGenerating) {
      return 0;
    }

    const startedAt = generationStartedAt ?? Date.now();
    const duration = Math.max(1000, generationDurationMs);
    const elapsed = Math.max(0, now - startedAt);

    return Math.min(elapsed / duration, 0.96);
  }, [generationDurationMs, generationStartedAt, isGenerating, now]);

  const waitedMinutes = useMemo(() => {
    if (!isGenerating || generationStartedAt === null) {
      return 0;
    }

    const elapsed = Math.max(0, now - generationStartedAt);
    return Math.floor(elapsed / 60000);
  }, [generationStartedAt, isGenerating, now]);

  const waitingResultText = useMemo(() => {
    if (!isExportResultNode) {
      return t('node.imageNode.selectToEdit');
    }

    if (!isGenerating || waitedMinutes < 2) {
      return t('node.imageNode.waitingResult');
    }

    return t('node.imageNode.waitingResultDelayed', { minutes: waitedMinutes });
  }, [isExportResultNode, isGenerating, t, waitedMinutes]);

  const imageSource = useMemo(() => {
    const preferOriginal = shouldUseOriginalImageByZoom(zoom);
    const picked = preferOriginal
      ? data.imageUrl || data.previewImageUrl
      : data.previewImageUrl || data.imageUrl;
    return picked ? resolveImageDisplayUrl(picked) : null;
  }, [data.imageUrl, data.previewImageUrl, zoom]);

  // Check if the result is a video
  const isVideoResult = useMemo(() => {
    const modelId = (data as ExportImageNodeData).model;
    if (modelId && isVideoModel(modelId)) return true;
    if (data.imageUrl && /\.(mp4|webm|mov)(\?|$)/i.test(data.imageUrl)) return true;
    return false;
  }, [data]);

  // 获取原图 URL 用于查看器
  const originalImageUrl = useMemo(() => {
    if (!data.imageUrl) return null;
    return resolveImageDisplayUrl(data.imageUrl);
  }, [data.imageUrl]);

  return (
    <div
      className={`
        group relative flex flex-col overflow-hidden rounded-[var(--node-radius)] border bg-surface-dark/85 transition-colors duration-150
        ${hasGenerationError
          ? (selected
            ? 'border-red-400 shadow-[0_0_0_1px_rgba(248,113,113,0.42)]'
            : 'border-red-500/70 bg-[rgba(127,29,29,0.12)] hover:border-red-400/80 dark:border-red-500/70 dark:hover:border-red-400/80')
          : selected
          ? 'border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.32)]'
          : 'border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)]'}
      `}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      onClick={() => setSelectedNode(id)}
    >
      {/* 头部区域：标题和模型标签 */}
      <div className="shrink-0 flex items-center gap-2 px-3 pt-3 pb-2 bg-gradient-to-b from-surface-dark/95 to-surface-dark/70 backdrop-blur-sm">
        <NodeHeader
          icon={isExportResultNode
            ? <ImageIcon className="h-4 w-4" />
            : <Sparkles className="h-4 w-4" />}
          titleText={resolvedTitle}
          titleClassName="flex-1 inline-block max-w-[160px] truncate whitespace-nowrap align-bottom"
          editable
          onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
        />
        {modelSubtitle && (
          <span className="shrink-0 max-w-[100px]">
            {modelSubtitle}
          </span>
        )}
      </div>

      {/* 图片区域 */}
      <div
        className="flex-1 overflow-hidden bg-transparent"
      >
        {data.imageUrl ? (
          isVideoResult ? (
            <video
              src={imageSource ?? ''}
              controls
              className="h-full w-full object-contain"
            />
          ) : (
            <CanvasNodeImage
              src={imageSource ?? ''}
              alt={isExportResultNode ? t('node.imageNode.resultAlt') : t('node.imageNode.generatedAlt')}
              viewerSourceUrl={originalImageUrl}
              className="h-full w-full object-contain"
            />
          )
        ) : hasGenerationError ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 bg-[rgba(127,29,29,0.2)] text-red-300">
            <AlertTriangle className="h-7 w-7 opacity-90" />
            <span className="text-center text-[12px] font-medium leading-5 text-red-200">
              {t('node.imageNode.generationFailed')}
            </span>
            <span className="max-h-[88px] overflow-y-auto break-words text-center text-[11px] leading-5 text-red-200/90">
              {generationError}
            </span>
          </div>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-text-muted/85">
            {isExportResultNode ? (
              <ImageIcon className="h-7 w-7 opacity-60" />
            ) : (
              <Sparkles className="h-7 w-7 opacity-60" />
            )}
            <span className="px-4 text-center text-[12px] leading-6">
              {waitingResultText}
            </span>
          </div>
        )}

        {isGenerating && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute inset-0 bg-bg-dark/55" />
            <div
              className="absolute left-0 top-0 h-full bg-gradient-to-r from-[rgba(255,255,255,0.4)] to-[rgba(255,255,255,0.06)] transition-[width] duration-100 ease-linear"
              style={{ width: `${simulatedProgress * 100}%` }}
            />
          </div>
        )}
      </div>

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
        minWidth={resizeMinWidth}
        minHeight={resizeMinHeight}
        maxWidth={1600}
        maxHeight={1600}
      />
    </div>
  );
});

ImageNode.displayName = 'ImageNode';
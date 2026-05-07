import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { UiInput } from '@/components/ui';
import type { VisualToolEditorProps } from './types';

const MIN_GRID_SIZE = 1;
const MAX_GRID_SIZE = 8;
const DEFAULT_LINE_THICKNESS_PERCENT = 0.5;
const MAX_LINE_THICKNESS_PERCENT = 20;
const LEGACY_DEFAULT_LINE_THICKNESS_PX = 6;
const PREVIEW_VIEWPORT_HEIGHT = 'h-[min(560px,60vh)]';
const DRAG_HIT_AREA_PX = 12;

interface OverlayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CellRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SplitLayout {
  lineRects: OverlayRect[];
  cellRects: CellRect[];
  colSplitX: number[];
  rowSplitY: number[];
  colWidths: number[];
  rowHeights: number[];
  minCellWidth: number;
  maxCellWidth: number;
  minCellHeight: number;
  maxCellHeight: number;
}

function toFiniteNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return fallback;
}

function clampInteger(value: number, min: number, max: number, fallback = min): number {
  const safeValue = Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, Math.round(safeValue)));
}

function clampDecimal(value: number, min: number, max: number, fallback = min, precision = 2): number {
  const safeValue = Number.isFinite(value) ? value : fallback;
  const clamped = Math.max(min, Math.min(max, safeValue));
  const factor = 10 ** precision;
  return Math.round(clamped * factor) / factor;
}

function resolveMaxLineThicknessPx(rows: number, cols: number, width: number, height: number): number {
  const maxByWidth = cols > 1 ? Math.floor((width - cols) / (cols - 1)) : Number.MAX_SAFE_INTEGER;
  const maxByHeight = rows > 1 ? Math.floor((height - rows) / (rows - 1)) : Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.min(maxByWidth, maxByHeight));
}

function resolveLineThicknessPxFromPercent(
  lineThicknessPercent: number,
  rows: number,
  cols: number,
  width: number,
  height: number
): number {
  if (lineThicknessPercent <= 0) {
    return 0;
  }

  const basis = Math.max(1, Math.min(width, height));
  const rawPixelThickness = Math.max(1, Math.round((basis * lineThicknessPercent) / 100));
  const maxAllowed = resolveMaxLineThicknessPx(rows, cols, width, height);
  return clampInteger(rawPixelThickness, 0, maxAllowed);
}

function computeSplitLayout(
  imageWidth: number,
  imageHeight: number,
  rows: number,
  cols: number,
  lineThickness: number,
  colOffsets: number[],
  rowOffsets: number[]
): SplitLayout | null {
  const usableWidth = imageWidth - (cols - 1) * lineThickness;
  const usableHeight = imageHeight - (rows - 1) * lineThickness;

  if (usableWidth < cols || usableHeight < rows) {
    return null;
  }

  // 计算每列宽度（基于拖拽偏移）
  const colWidths: number[] = [];
  let totalColWidth = 0;
  for (let col = 0; col < cols; col++) {
    const offset = colOffsets[col] ?? 0;
    const width = Math.max(1, Math.floor((usableWidth / cols) + offset));
    colWidths.push(width);
    totalColWidth += width;
  }
  // 调整以确保总宽度正确
  const colWidthDiff = usableWidth - totalColWidth;
  if (colWidthDiff !== 0 && colWidths.length > 0) {
    colWidths[colWidths.length - 1] += colWidthDiff;
  }

  // 计算每行高度（基于拖拽偏移）
  const rowHeights: number[] = [];
  let totalRowHeight = 0;
  for (let row = 0; row < rows; row++) {
    const offset = rowOffsets[row] ?? 0;
    const height = Math.max(1, Math.floor((usableHeight / rows) + offset));
    rowHeights.push(height);
    totalRowHeight += height;
  }
  // 调整以确保总高度正确
  const rowHeightDiff = usableHeight - totalRowHeight;
  if (rowHeightDiff !== 0 && rowHeights.length > 0) {
    rowHeights[rowHeights.length - 1] += rowHeightDiff;
  }

  // 计算红色丢弃区域（lineRects）
  const lineRects: OverlayRect[] = [];
  const xOffsets: number[] = [];
  const yOffsets: number[] = [];

  let cursorX = 0;
  for (let col = 0; col < cols; col += 1) {
    xOffsets.push(cursorX);
    cursorX += colWidths[col];
    if (col < cols - 1 && lineThickness > 0) {
      lineRects.push({
        x: cursorX,
        y: 0,
        width: lineThickness,
        height: imageHeight,
      });
      cursorX += lineThickness;
    }
  }

  let cursorY = 0;
  for (let row = 0; row < rows; row += 1) {
    yOffsets.push(cursorY);
    cursorY += rowHeights[row];
    if (row < rows - 1 && lineThickness > 0) {
      lineRects.push({
        x: 0,
        y: cursorY,
        width: imageWidth,
        height: lineThickness,
      });
      cursorY += lineThickness;
    }
  }

  // 计算格子位置
  const cellRects: CellRect[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      cellRects.push({
        x: xOffsets[col],
        y: yOffsets[row],
        width: colWidths[col],
        height: rowHeights[row],
      });
    }
  }

  // 计算分割线位置（始终显示，用于拖拽）
  const colSplitX: number[] = [];
  let splitCursorX = 0;
  for (let col = 0; col < cols - 1; col += 1) {
    splitCursorX += colWidths[col];
    // 分割线位置在两列之间，如果有 lineThickness，线中心在当前位置
    if (lineThickness > 0) {
      colSplitX.push(splitCursorX + lineThickness / 2);
      splitCursorX += lineThickness;
    } else {
      colSplitX.push(splitCursorX);
    }
  }

  const rowSplitY: number[] = [];
  let splitCursorY = 0;
  for (let row = 0; row < rows - 1; row += 1) {
    splitCursorY += rowHeights[row];
    if (lineThickness > 0) {
      rowSplitY.push(splitCursorY + lineThickness / 2);
      splitCursorY += lineThickness;
    } else {
      rowSplitY.push(splitCursorY);
    }
  }

  return {
    lineRects,
    cellRects,
    colSplitX,
    rowSplitY,
    colWidths,
    rowHeights,
    minCellWidth: colWidths.length > 0 ? Math.min(...colWidths) : 0,
    maxCellWidth: colWidths.length > 0 ? Math.max(...colWidths) : 0,
    minCellHeight: rowHeights.length > 0 ? Math.min(...rowHeights) : 0,
    maxCellHeight: rowHeights.length > 0 ? Math.max(...rowHeights) : 0,
  };
}

function toPercent(value: number, total: number): string {
  if (total <= 0) {
    return '0%';
  }

  return `${(value / total) * 100}%`;
}

function splitSizeLabel(min: number, max: number): string {
  if (min === max) {
    return `${min}`;
  }
  return `${min} - ${max}`;
}

function formatPercent(value: number): string {
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`;
}

interface NumberStepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

function NumberStepper({ label, value, min, max, onChange }: NumberStepperProps) {
  const decreaseDisabled = value <= min;
  const increaseDisabled = value >= max;

  return (
    <div className="space-y-1.5">
      <div className="text-xs text-text-muted">{label}</div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="h-9 w-9 rounded-lg border border-[rgba(255,255,255,0.14)] bg-bg-dark/60 text-sm text-text-dark transition-colors hover:bg-bg-dark disabled:cursor-not-allowed disabled:opacity-45"
          onClick={() => onChange(value - 1)}
          disabled={decreaseDisabled}
        >
          -
        </button>
        <UiInput
          type="number"
          value={value}
          min={min}
          max={max}
          step={1}
          onChange={(event) => onChange(Number(event.target.value))}
          className="h-9 text-center"
        />
        <button
          type="button"
          className="h-9 w-9 rounded-lg border border-[rgba(255,255,255,0.14)] bg-bg-dark/60 text-sm text-text-dark transition-colors hover:bg-bg-dark disabled:cursor-not-allowed disabled:opacity-45"
          onClick={() => onChange(value + 1)}
          disabled={increaseDisabled}
        >
          +
        </button>
      </div>
    </div>
  );
}

type DragType = 'col' | 'row' | null;

interface DragState {
  type: DragType;
  index: number;
  startMouseX: number;
  startMouseY: number;
  startOffsetLeft: number;
  startOffsetRight: number;
}

export function SplitStoryboardToolEditor({ sourceImageUrl, options, onOptionsChange }: VisualToolEditorProps) {
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [colOffsets, setColOffsets] = useState<number[]>([]);
  const [rowOffsets, setRowOffsets] = useState<number[]>([]);
  const [dragState, setDragState] = useState<DragState>({ type: null, index: -1, startMouseX: 0, startMouseY: 0, startOffsetLeft: 0, startOffsetRight: 0 });
  const [hoveredLine, setHoveredLine] = useState<{ type: DragType; index: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const displaySourceImageUrl = useMemo(() => resolveImageDisplayUrl(sourceImageUrl), [sourceImageUrl]);

  useEffect(() => {
    setNaturalSize(null);
    setColOffsets([]);
    setRowOffsets([]);
  }, [displaySourceImageUrl]);

  const rows = clampInteger(toFiniteNumber(options.rows, 3), MIN_GRID_SIZE, MAX_GRID_SIZE);
  const cols = clampInteger(toFiniteNumber(options.cols, 3), MIN_GRID_SIZE, MAX_GRID_SIZE);

  const legacyLineThicknessPx = Math.max(0, toFiniteNumber(options.lineThickness, LEGACY_DEFAULT_LINE_THICKNESS_PX));
  const maxLineThicknessPercent = useMemo(() => {
    if (!naturalSize) {
      return MAX_LINE_THICKNESS_PERCENT;
    }

    const maxLinePx = resolveMaxLineThicknessPx(rows, cols, naturalSize.width, naturalSize.height);
    const basis = Math.max(1, Math.min(naturalSize.width, naturalSize.height));
    return clampDecimal((maxLinePx / basis) * 100, 0, MAX_LINE_THICKNESS_PERCENT);
  }, [cols, naturalSize, rows]);

  const fallbackLineThicknessPercent = useMemo(() => {
    if (!naturalSize) {
      return DEFAULT_LINE_THICKNESS_PERCENT;
    }

    const basis = Math.max(1, Math.min(naturalSize.width, naturalSize.height));
    return clampDecimal(
      (legacyLineThicknessPx / basis) * 100,
      0,
      maxLineThicknessPercent,
      DEFAULT_LINE_THICKNESS_PERCENT
    );
  }, [legacyLineThicknessPx, maxLineThicknessPercent, naturalSize]);

  const rawLineThicknessPercent = Math.max(
    0,
    toFiniteNumber(options.lineThicknessPercent, fallbackLineThicknessPercent)
  );
  const lineThicknessPercent = clampDecimal(
    rawLineThicknessPercent,
    0,
    maxLineThicknessPercent,
    fallbackLineThicknessPercent
  );

  const lineThicknessPx = useMemo(() => {
    if (!naturalSize) {
      return 0;
    }

    return resolveLineThicknessPxFromPercent(
      lineThicknessPercent,
      rows,
      cols,
      naturalSize.width,
      naturalSize.height
    );
  }, [cols, lineThicknessPercent, naturalSize, rows]);

  const layout = useMemo(() => {
    if (!naturalSize) {
      return null;
    }

    return computeSplitLayout(
      naturalSize.width,
      naturalSize.height,
      rows,
      cols,
      lineThicknessPx,
      colOffsets,
      rowOffsets
    );
  }, [cols, colOffsets, lineThicknessPx, naturalSize, rowOffsets, rows]);

  // 初始化偏移量数组
  useEffect(() => {
    if (cols > 0 && colOffsets.length !== cols) {
      setColOffsets(Array(cols).fill(0));
    }
  }, [cols, colOffsets.length]);

  useEffect(() => {
    if (rows > 0 && rowOffsets.length !== rows) {
      setRowOffsets(Array(rows).fill(0));
    }
  }, [rows, rowOffsets.length]);

  const updateOptions = useCallback(
    (patch: Partial<Record<'rows' | 'cols' | 'lineThicknessPercent', number>>, extraOffsets?: { colOffsets?: number[]; rowOffsets?: number[] }) => {
      const nextRows = clampInteger(
        patch.rows ?? rows,
        MIN_GRID_SIZE,
        MAX_GRID_SIZE
      );
      const nextCols = clampInteger(
        patch.cols ?? cols,
        MIN_GRID_SIZE,
        MAX_GRID_SIZE
      );

      const unresolvedLineThicknessPercent = Math.max(
        0,
        patch.lineThicknessPercent ?? lineThicknessPercent
      );

      const nextMaxLineThicknessPercent = naturalSize
        ? clampDecimal(
            (resolveMaxLineThicknessPx(nextRows, nextCols, naturalSize.width, naturalSize.height) /
              Math.max(1, Math.min(naturalSize.width, naturalSize.height))) *
              100,
            0,
            MAX_LINE_THICKNESS_PERCENT
          )
        : MAX_LINE_THICKNESS_PERCENT;

      const nextLineThicknessPercent = clampDecimal(
        unresolvedLineThicknessPercent,
        0,
        nextMaxLineThicknessPercent
      );

      // 重置偏移量当行列数改变时
      let nextColOffsets = extraOffsets?.colOffsets ?? colOffsets;
      let nextRowOffsets = extraOffsets?.rowOffsets ?? rowOffsets;
      if (patch.rows !== undefined && patch.rows !== rows) {
        nextRowOffsets = Array(patch.rows).fill(0);
        setRowOffsets(nextRowOffsets);
      }
      if (patch.cols !== undefined && patch.cols !== cols) {
        nextColOffsets = Array(patch.cols).fill(0);
        setColOffsets(nextColOffsets);
      }

      onOptionsChange({
        ...options,
        rows: nextRows,
        cols: nextCols,
        lineThicknessPercent: nextLineThicknessPercent,
        colOffsets: JSON.stringify(nextColOffsets),
        rowOffsets: JSON.stringify(nextRowOffsets),
      });
    },
    [cols, colOffsets, lineThicknessPercent, naturalSize, onOptionsChange, options, rowOffsets, rows]
  );

  const handleImageMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!layout || !naturalSize) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * naturalSize.width;
    const mouseY = ((e.clientY - rect.top) / rect.height) * naturalSize.height;

    // 检查是否点击在垂直分割线上
    for (let i = 0; i < layout.colSplitX.length; i++) {
      const splitX = layout.colSplitX[i];
      if (Math.abs(mouseX - splitX) <= DRAG_HIT_AREA_PX / 2) {
        e.preventDefault();
        e.stopPropagation();
        setDragState({
          type: 'col',
          index: i,
          startMouseX: mouseX,
          startMouseY: mouseY,
          startOffsetLeft: colOffsets[i] ?? 0,
          startOffsetRight: colOffsets[i + 1] ?? 0,
        });
        return;
      }
    }

    // 检查是否点击在水平分割线上
    for (let i = 0; i < layout.rowSplitY.length; i++) {
      const splitY = layout.rowSplitY[i];
      if (Math.abs(mouseY - splitY) <= DRAG_HIT_AREA_PX / 2) {
        e.preventDefault();
        e.stopPropagation();
        setDragState({
          type: 'row',
          index: i,
          startMouseX: mouseX,
          startMouseY: mouseY,
          startOffsetLeft: rowOffsets[i] ?? 0,
          startOffsetRight: rowOffsets[i + 1] ?? 0,
        });
        return;
      }
    }
  }, [colOffsets, layout, naturalSize, rowOffsets]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (dragState.type === null || !layout || !naturalSize) return;

    const container = containerRef.current;
    if (!container) return;

    const imgElement = container.querySelector('img');
    if (!imgElement) return;

    const rect = imgElement.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * naturalSize.width;
    const mouseY = ((e.clientY - rect.top) / rect.height) * naturalSize.height;

    if (dragState.type === 'col') {
      const deltaX = mouseX - dragState.startMouseX;
      const usableWidth = naturalSize.width - (cols - 1) * lineThicknessPx;
      const avgColWidth = Math.floor(usableWidth / cols);
      const minOffset = -avgColWidth * 0.8;
      const maxOffset = avgColWidth * 0.8;

      let newOffsetLeft = dragState.startOffsetLeft + deltaX;
      let newOffsetRight = dragState.startOffsetRight - deltaX;

      if (newOffsetLeft < minOffset) {
        newOffsetRight += (minOffset - newOffsetLeft);
        newOffsetLeft = minOffset;
      } else if (newOffsetLeft > maxOffset) {
        newOffsetRight -= (newOffsetLeft - maxOffset);
        newOffsetLeft = maxOffset;
      }
      if (newOffsetRight < minOffset) {
        newOffsetLeft -= (minOffset - newOffsetRight);
        newOffsetRight = minOffset;
      } else if (newOffsetRight > maxOffset) {
        newOffsetLeft += (newOffsetRight - maxOffset);
        newOffsetRight = maxOffset;
      }

      setColOffsets(prev => {
        const next = [...prev];
        next[dragState.index] = newOffsetLeft;
        next[dragState.index + 1] = newOffsetRight;
        return next;
      });
    } else if (dragState.type === 'row') {
      const deltaY = mouseY - dragState.startMouseY;
      const usableHeight = naturalSize.height - (rows - 1) * lineThicknessPx;
      const avgRowHeight = Math.floor(usableHeight / rows);
      const minOffset = -avgRowHeight * 0.8;
      const maxOffset = avgRowHeight * 0.8;

      let newOffsetLeft = dragState.startOffsetLeft + deltaY;
      let newOffsetRight = dragState.startOffsetRight - deltaY;

      if (newOffsetLeft < minOffset) {
        newOffsetRight += (minOffset - newOffsetLeft);
        newOffsetLeft = minOffset;
      } else if (newOffsetLeft > maxOffset) {
        newOffsetRight -= (newOffsetLeft - maxOffset);
        newOffsetLeft = maxOffset;
      }
      if (newOffsetRight < minOffset) {
        newOffsetLeft -= (minOffset - newOffsetRight);
        newOffsetRight = minOffset;
      } else if (newOffsetRight > maxOffset) {
        newOffsetLeft += (newOffsetRight - maxOffset);
        newOffsetRight = maxOffset;
      }

      setRowOffsets(prev => {
        const next = [...prev];
        next[dragState.index] = newOffsetLeft;
        next[dragState.index + 1] = newOffsetRight;
        return next;
      });
    }
  }, [cols, dragState, layout, lineThicknessPx, naturalSize, rows]);

  const handleMouseUp = useCallback(() => {
    if (dragState.type !== null) {
      // 将最终偏移量写回 options，确保切割时使用拖拽后的位置
      onOptionsChange({
        ...options,
        colOffsets: JSON.stringify(colOffsets),
        rowOffsets: JSON.stringify(rowOffsets),
      });
      setDragState({ type: null, index: -1, startMouseX: 0, startMouseY: 0, startOffsetLeft: 0, startOffsetRight: 0 });
    }
  }, [colOffsets, dragState.type, onOptionsChange, options, rowOffsets]);

  useEffect(() => {
    if (dragState.type !== null) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
    return undefined;
  }, [dragState.type, handleMouseMove, handleMouseUp]);

  const handleImageMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!layout || !naturalSize || dragState.type !== null) return;

    const imgElement = e.currentTarget;
    const rect = imgElement.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * naturalSize.width;
    const mouseY = ((e.clientY - rect.top) / rect.height) * naturalSize.height;

    // 检查是否悬停在分割线上
    let found: { type: DragType; index: number } | null = null;

    for (let i = 0; i < layout.colSplitX.length; i++) {
      const splitX = layout.colSplitX[i];
      if (Math.abs(mouseX - splitX) <= DRAG_HIT_AREA_PX / 2) {
        found = { type: 'col', index: i };
        break;
      }
    }

    if (!found) {
      for (let i = 0; i < layout.rowSplitY.length; i++) {
        const splitY = layout.rowSplitY[i];
        if (Math.abs(mouseY - splitY) <= DRAG_HIT_AREA_PX / 2) {
          found = { type: 'row', index: i };
          break;
        }
      }
    }

    setHoveredLine(found);
  }, [dragState.type, layout, naturalSize]);

  const handleImageMouseLeave = useCallback(() => {
    if (dragState.type === null) {
      setHoveredLine(null);
    }
  }, [dragState.type]);

  const hasLayoutError = Boolean(naturalSize && !layout);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>原图 + 切割预览</span>
          {naturalSize && (
            <span>
              {naturalSize.width} x {naturalSize.height}px
            </span>
          )}
        </div>

        <div
          className={`ui-scrollbar flex ${PREVIEW_VIEWPORT_HEIGHT} items-center justify-center overflow-auto rounded-xl border border-[rgba(255,255,255,0.12)] bg-bg-dark/70 p-3`}
        >
          <div className="relative inline-flex items-center justify-center" ref={containerRef}>
            <img
              src={displaySourceImageUrl}
              alt="split-preview"
              className="max-h-full w-auto max-w-full rounded-lg border border-[rgba(255,255,255,0.08)] object-contain"
              onLoad={(event) => {
                const target = event.currentTarget;
                setNaturalSize({
                  width: Math.max(1, target.naturalWidth),
                  height: Math.max(1, target.naturalHeight),
                });
              }}
              onMouseDown={handleImageMouseDown}
              onMouseMove={handleImageMouseMove}
              onMouseLeave={handleImageMouseLeave}
              draggable={false}
              style={{
                cursor: dragState.type === 'col' ? 'col-resize' 
                  : dragState.type === 'row' ? 'row-resize'
                  : hoveredLine?.type === 'col' ? 'col-resize' 
                  : hoveredLine?.type === 'row' ? 'row-resize' 
                  : undefined,
              }}
            />

            {naturalSize && layout && (
              <div className="absolute inset-0 rounded-lg">
                {/* Layer 1: 格子边框 - 始终显示 */}
                {layout.cellRects.map((cell, index) => (
                  <div
                    key={`cell-border-${index}`}
                    className="absolute border border-white/40 pointer-events-none"
                    style={{
                      left: toPercent(cell.x, naturalSize.width),
                      top: toPercent(cell.y, naturalSize.height),
                      width: toPercent(cell.width, naturalSize.width),
                      height: toPercent(cell.height, naturalSize.height),
                    }}
                  />
                ))}

                {/* Layer 2: 红色丢弃区域 - 仅 lineThickness > 0 时显示 */}
                {lineThicknessPx > 0 && layout.lineRects.map((rect, index) => (
                  <div
                    key={`line-rect-${index}`}
                    className="absolute bg-red-400/35 pointer-events-none"
                    style={{
                      left: toPercent(rect.x, naturalSize.width),
                      top: toPercent(rect.y, naturalSize.height),
                      width: toPercent(rect.width, naturalSize.width),
                      height: toPercent(rect.height, naturalSize.height),
                    }}
                  />
                ))}

                {/* Layer 3: 可拖拽分割线 - 始终显示 */}
                {layout.colSplitX.map((splitX, index) => {
                  const isHovered = hoveredLine?.type === 'col' && hoveredLine?.index === index;
                  const isDraggingThis = dragState.type === 'col' && dragState.index === index;
                  return (
                    <div
                      key={`col-split-${index}`}
                      className="absolute top-0"
                      style={{
                        left: `calc(${toPercent(splitX, naturalSize.width)} - ${DRAG_HIT_AREA_PX / 2}px)`,
                        width: `${DRAG_HIT_AREA_PX}px`,
                        height: '100%',
                        cursor: 'col-resize',
                        zIndex: 10,
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const imgElement = containerRef.current?.querySelector('img');
                        if (!imgElement) return;
                        const imgRect = imgElement.getBoundingClientRect();
                        const mouseX = ((e.clientX - imgRect.left) / imgRect.width) * naturalSize.width;

                        setDragState({
                          type: 'col',
                          index,
                          startMouseX: mouseX,
                          startMouseY: 0,
                          startOffsetLeft: colOffsets[index] ?? 0,
                          startOffsetRight: colOffsets[index + 1] ?? 0,
                        });
                      }}
                      onMouseEnter={() => setHoveredLine({ type: 'col', index })}
                      onMouseLeave={() => setHoveredLine(prev => prev?.type === 'col' && prev?.index === index ? null : prev)}
                    >
                      {/* 视觉分割线 */}
                      <div
                        className={`absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 transition-colors ${
                          isDraggingThis ? 'bg-blue-400' : isHovered ? 'bg-blue-300/80' : 'bg-white/50'
                        }`}
                      />
                      {/* 悬停手柄 */}
                      {(isHovered || isDraggingThis) && (
                        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                          <div className="flex -translate-y-1/2 flex-col gap-1 rounded-md bg-black/70 px-1 py-1">
                            <div className="h-1 w-3 rounded-sm bg-white/80" />
                            <div className="h-1 w-3 rounded-sm bg-white/80" />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {layout.rowSplitY.map((splitY, index) => {
                  const isHovered = hoveredLine?.type === 'row' && hoveredLine?.index === index;
                  const isDraggingThis = dragState.type === 'row' && dragState.index === index;
                  return (
                    <div
                      key={`row-split-${index}`}
                      className="absolute left-0"
                      style={{
                        top: `calc(${toPercent(splitY, naturalSize.height)} - ${DRAG_HIT_AREA_PX / 2}px)`,
                        width: '100%',
                        height: `${DRAG_HIT_AREA_PX}px`,
                        cursor: 'row-resize',
                        zIndex: 10,
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const imgElement = containerRef.current?.querySelector('img');
                        if (!imgElement) return;
                        const imgRect = imgElement.getBoundingClientRect();
                        const mouseY = ((e.clientY - imgRect.top) / imgRect.height) * naturalSize.height;

                        setDragState({
                          type: 'row',
                          index,
                          startMouseX: 0,
                          startMouseY: mouseY,
                          startOffsetLeft: rowOffsets[index] ?? 0,
                          startOffsetRight: rowOffsets[index + 1] ?? 0,
                        });
                      }}
                      onMouseEnter={() => setHoveredLine({ type: 'row', index })}
                      onMouseLeave={() => setHoveredLine(prev => prev?.type === 'row' && prev?.index === index ? null : prev)}
                    >
                      {/* 视觉分割线 */}
                      <div
                        className={`absolute left-0 top-1/2 h-0.5 w-full -translate-y-1/2 transition-colors ${
                          isDraggingThis ? 'bg-blue-400' : isHovered ? 'bg-blue-300/80' : 'bg-white/50'
                        }`}
                      />
                      {/* 悬停手柄 */}
                      {(isHovered || isDraggingThis) && (
                        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                          <div className="flex -translate-x-1/2 flex-row gap-1 rounded-md bg-black/70 px-1 py-1">
                            <div className="h-3 w-1 rounded-sm bg-white/80" />
                            <div className="h-3 w-1 rounded-sm bg-white/80" />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-text-muted">
          <div className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm bg-red-400/70" />
            红色区域为切割时会丢弃的分割线像素
          </div>
          <div className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm bg-white/50" />
            拖动分割线可调整格子大小
          </div>
        </div>
      </div>

      <div className="space-y-4 rounded-xl border border-[rgba(255,255,255,0.12)] bg-bg-dark/75 p-3.5">
        <div className="text-sm font-medium text-text-dark">切割参数</div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <NumberStepper
            label="行数"
            value={rows}
            min={MIN_GRID_SIZE}
            max={MAX_GRID_SIZE}
            onChange={(value) => updateOptions({ rows: value })}
          />
          <NumberStepper
            label="列数"
            value={cols}
            min={MIN_GRID_SIZE}
            max={MAX_GRID_SIZE}
            onChange={(value) => updateOptions({ cols: value })}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>分割线粗细</span>
            <span>
              {formatPercent(lineThicknessPercent)}
              {naturalSize ? ` (${lineThicknessPx}px)` : ''}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(0, maxLineThicknessPercent)}
            step={0.1}
            value={lineThicknessPercent}
            onChange={(event) => updateOptions({ lineThicknessPercent: Number(event.target.value)})}
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/15"
          />
          <UiInput
            type="number"
            value={lineThicknessPercent}
            min={0}
            max={Math.max(0, maxLineThicknessPercent)}
            step={0.1}
            onChange={(event) => updateOptions({ lineThicknessPercent: Number(event.target.value)})}
            className="h-9"
          />
        </div>

        <div className="rounded-lg border border-[rgba(255,255,255,0.12)] bg-bg-dark/80 px-3 py-2 text-xs text-text-muted">
          <div className="flex items-center justify-between">
            <span>输出小格数量</span>
            <span className="font-medium text-text-dark">{rows * cols}</span>
          </div>
          {layout && (
            <>
              <div className="mt-1 flex items-center justify-between">
                <span>单格宽度(px)</span>
                <span>{splitSizeLabel(layout.minCellWidth, layout.maxCellWidth)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span>单格高度(px)</span>
                <span>{splitSizeLabel(layout.minCellHeight, layout.maxCellHeight)}</span>
              </div>
            </>
          )}
        </div>

        {hasLayoutError && (
          <div className="rounded-lg border border-red-400/35 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            当前分割线过粗，导致可切割区域不足。请减少线宽或降低行列数。
          </div>
        )}
      </div>
    </div>
  );
}

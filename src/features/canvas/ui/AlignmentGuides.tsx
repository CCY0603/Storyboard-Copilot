import { memo, useMemo } from 'react';
import type { AlignmentGuide } from '../hooks/useSnapAlignment';

export interface AlignmentGuidesProps {
  guides: AlignmentGuide[];
  viewport: { x: number; y: number; zoom: number };
  visible: boolean;
}

export const AlignmentGuides = memo(function AlignmentGuides({
  guides,
  viewport,
  visible,
}: AlignmentGuidesProps) {
  const { x: vpX, y: vpY, zoom } = viewport;

  const toScreenX = (cx: number) => cx * zoom + vpX;
  const toScreenY = (cy: number) => cy * zoom + vpY;

  const lines = useMemo(() => {
    if (!visible || guides.length === 0) return [];

    return guides.map((guide, index) => {
      const { type, position, start, end } = guide;
      if (type === 'vertical') {
        return {
          key: `v-${index}-${position.toFixed(2)}`,
          x1: toScreenX(position), y1: toScreenY(start),
          x2: toScreenX(position), y2: toScreenY(end),
        };
      }
      return {
        key: `h-${index}-${position.toFixed(2)}`,
        x1: toScreenX(start), y1: toScreenY(position),
        x2: toScreenX(end), y2: toScreenY(position),
      };
    });
  }, [guides, visible, vpX, vpY, zoom]);

  if (!visible || lines.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 overflow-visible"
      style={{ zIndex: 9999, width: '1px', height: '1px' }}
    >
      {lines.map((line) => (
        <line
          key={line.key}
          x1={line.x1} y1={line.y1}
          x2={line.x2} y2={line.y2}
          stroke="#60a5fa"
          strokeWidth={1.5}
          strokeOpacity={0.9}
          strokeDasharray="6,4"
        />
      ))}
    </svg>
  );
});

AlignmentGuides.displayName = 'AlignmentGuides';

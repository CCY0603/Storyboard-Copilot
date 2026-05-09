import { useCallback, useMemo } from 'react';
import type { CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { DEFAULT_NODE_WIDTH } from '@/features/canvas/domain/canvasNodes';

/**
 * 获取节点尺寸
 */
function getNodeSize(node: CanvasNode): { width: number; height: number } {
  const styleWidth = typeof node.style?.width === 'number' ? node.style.width : null;
  const styleHeight = typeof node.style?.height === 'number' ? node.style.height : null;
  return {
    width: node.measured?.width ?? styleWidth ?? DEFAULT_NODE_WIDTH,
    height: node.measured?.height ?? styleHeight ?? 200,
  };
}

/** 对齐辅助线类型 */
export type AlignmentGuideType = 'vertical' | 'horizontal';

/** 对齐辅助线 */
export interface AlignmentGuide {
  type: AlignmentGuideType;
  /** 辅助线位置（画布坐标） */
  position: number;
  /** 辅助线起点/终点范围（画布坐标） */
  start: number;
  end: number;
}

/** 对齐吸附结果 */
export interface SnapAlignmentResult {
  /** 吸附后的位置偏移量（相对于当前位置） */
  snapOffset: { x: number; y: number };
  /** 对齐辅助线 */
  guides: AlignmentGuide[];
}

/** 对齐检测配置 */
interface SnapAlignmentConfig {
  /** 吸附阈值（像素） */
  threshold: number;
  /** 是否启用吸附 */
  enabled: boolean;
}

const DEFAULT_CONFIG: SnapAlignmentConfig = {
  threshold: 10,
  enabled: true,
};

/**
 * 计算节点在给定位置时的对齐边缘
 */
function getNodeEdgesAtPosition(
  node: CanvasNode,
  position: { x: number; y: number }
): {
  left: number;
  right: number;
  centerX: number;
  top: number;
  bottom: number;
  centerY: number;
} {
  const { width, height } = getNodeSize(node);
  return {
    left: position.x,
    right: position.x + width,
    centerX: position.x + width / 2,
    top: position.y,
    bottom: position.y + height,
    centerY: position.y + height / 2,
  };
}

/**
 * 计算静态节点的对齐边缘
 */
function getNodeEdges(node: CanvasNode): {
  left: number;
  right: number;
  centerX: number;
  top: number;
  bottom: number;
  centerY: number;
} {
  return getNodeEdgesAtPosition(node, node.position);
}

/**
 * 检测并返回对齐吸附结果
 * @param draggingNodePosition 被拖拽节点的当前位置
 * @param draggingNode 被拖拽节点
 * @param otherNodes 其他所有节点
 * @param config 配置
 */
function detectSnapAlignment(
  draggingNodePosition: { x: number; y: number },
  draggingNode: CanvasNode,
  otherNodes: CanvasNode[],
  config: SnapAlignmentConfig
): SnapAlignmentResult {
  if (!config.enabled) {
    return { snapOffset: { x: 0, y: 0 }, guides: [] };
  }

  const draggingEdges = getNodeEdgesAtPosition(draggingNode, draggingNodePosition);
  const guides: AlignmentGuide[] = [];
  let snapX = 0;
  let snapY = 0;
  let foundSnapX = false;
  let foundSnapY = false;

  // 遍历所有其他节点，寻找对齐边缘
  for (const otherNode of otherNodes) {
    const otherEdges = getNodeEdges(otherNode);

    // 垂直对齐检测 (x 轴方向)
    const verticalChecks: Array<{
      draggingValue: number;
      targetValue: number;
    }> = [
      { draggingValue: draggingEdges.left, targetValue: otherEdges.left },
      { draggingValue: draggingEdges.right, targetValue: otherEdges.right },
      { draggingValue: draggingEdges.centerX, targetValue: otherEdges.centerX },
      { draggingValue: draggingEdges.left, targetValue: otherEdges.right },
      { draggingValue: draggingEdges.right, targetValue: otherEdges.left },
    ];

    for (const check of verticalChecks) {
      const distance = Math.abs(check.draggingValue - check.targetValue);
      if (distance <= config.threshold && distance > 0) {
        const correction = check.targetValue - check.draggingValue;
        if (!foundSnapX || Math.abs(correction) < Math.abs(snapX)) {
          snapX = correction;
          foundSnapX = true;
        }
        // 添加垂直辅助线
        guides.push({
          type: 'vertical',
          position: check.targetValue,
          start: Math.min(draggingEdges.top, otherEdges.top) - 20,
          end: Math.max(draggingEdges.bottom, otherEdges.bottom) + 20,
        });
      }
    }

    // 水平对齐检测 (y 轴方向)
    const horizontalChecks: Array<{
      draggingValue: number;
      targetValue: number;
    }> = [
      { draggingValue: draggingEdges.top, targetValue: otherEdges.top },
      { draggingValue: draggingEdges.bottom, targetValue: otherEdges.bottom },
      { draggingValue: draggingEdges.centerY, targetValue: otherEdges.centerY },
      { draggingValue: draggingEdges.top, targetValue: otherEdges.bottom },
      { draggingValue: draggingEdges.bottom, targetValue: otherEdges.top },
    ];

    for (const check of horizontalChecks) {
      const distance = Math.abs(check.draggingValue - check.targetValue);
      if (distance <= config.threshold && distance > 0) {
        const correction = check.targetValue - check.draggingValue;
        if (!foundSnapY || Math.abs(correction) < Math.abs(snapY)) {
          snapY = correction;
          foundSnapY = true;
        }
        // 添加水平辅助线
        guides.push({
          type: 'horizontal',
          position: check.targetValue,
          start: Math.min(draggingEdges.left, otherEdges.left) - 20,
          end: Math.max(draggingEdges.right, otherEdges.right) + 20,
        });
      }
    }
  }

  // 去重辅助线
  const uniqueGuides = deduplicateGuides(guides);

  return {
    snapOffset: { x: snapX, y: snapY },
    guides: uniqueGuides,
  };
}

/**
 * 去重辅助线
 */
function deduplicateGuides(guides: AlignmentGuide[]): AlignmentGuide[] {
  const seen = new Set<string>();
  const result: AlignmentGuide[] = [];

  for (const guide of guides) {
    const key = `${guide.type}-${guide.position.toFixed(2)}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(guide);
    }
  }

  return result;
}

/**
 * 对齐吸附 Hook
 * 用于节点拖拽时的对齐辅助线和自动吸附
 */
export function useSnapAlignment() {
  /**
   * 计算对齐吸附
   * @param draggingNodeId 当前拖拽的节点ID
   * @param currentPosition 被拖拽节点的当前位置（ReactFlow 已更新）
   * @param nodes 所有节点（当前快照）
   * @param selectedNodeIds 选中的节点ID列表
   * @param config 配置
   * @returns 对齐吸附结果
   */
  const calculateSnapAlignment = useCallback(
    (
      draggingNodeId: string,
      currentPosition: { x: number; y: number },
      nodes: CanvasNode[],
      selectedNodeIds: string[],
      config: Partial<SnapAlignmentConfig> = {}
    ): SnapAlignmentResult => {
      const fullConfig = { ...DEFAULT_CONFIG, ...config };

      // 找到被拖拽的节点
      const draggingNode = nodes.find((n) => n.id === draggingNodeId);
      if (!draggingNode) {
        return { snapOffset: { x: 0, y: 0 }, guides: [] };
      }

      // 确定需要参与对齐的节点集合
      const selectedNodeIdSet = new Set(selectedNodeIds);
      const isMultiSelect = selectedNodeIdSet.size > 1;

      // 排除参与拖拽的节点（包括所有选中的节点）
      const otherNodes = nodes.filter((n) => !selectedNodeIdSet.has(n.id));

      if (isMultiSelect) {
        // 多选模式：计算选中节点组的边界框
        const selectedNodes = nodes.filter((n) => selectedNodeIdSet.has(n.id));
        const draggingNodeOffset = {
          x: currentPosition.x - draggingNode.position.x,
          y: currentPosition.y - draggingNode.position.y,
        };

        // 计算选中节点组的边界（所有选中节点都应用了相同的偏移）
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const node of selectedNodes) {
          const nodeSize = getNodeSize(node);
          const nodePos = {
            x: node.position.x + draggingNodeOffset.x,
            y: node.position.y + draggingNodeOffset.y,
          };
          minX = Math.min(minX, nodePos.x);
          minY = Math.min(minY, nodePos.y);
          maxX = Math.max(maxX, nodePos.x + nodeSize.width);
          maxY = Math.max(maxY, nodePos.y + nodeSize.height);
        }

        // 创建一个虚拟的"包围盒"节点用于对齐计算
        const virtualGroupNode = {
          id: '__virtual_group__',
          type: 'virtual' as const,
          position: { x: minX, y: minY },
          data: {} as CanvasNode['data'],
          style: {
            width: maxX - minX,
            height: maxY - minY,
          },
        } as unknown as CanvasNode;

        return detectSnapAlignment({ x: minX, y: minY }, virtualGroupNode, otherNodes, fullConfig);
      } else {
        // 单选模式：直接使用当前位置
        return detectSnapAlignment(currentPosition, draggingNode, otherNodes, fullConfig);
      }
    },
    []
  );

  return useMemo(
    () => ({
      calculateSnapAlignment,
    }),
    [calculateSnapAlignment]
  );
}

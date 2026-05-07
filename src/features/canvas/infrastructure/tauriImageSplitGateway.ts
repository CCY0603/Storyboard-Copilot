import { splitImageSource } from '@/commands/image';

import type { ImageSplitGateway } from '../application/ports';

// 假设根据常见图像分割逻辑，rows/cols/thickness/offsets 为 number，imageSource 为 string
// 请根据实际项目中的类型定义调整以下类型注解
export const tauriImageSplitGateway: ImageSplitGateway = {
  split: (
    imageSource: string,
    rows: number,
    cols: number,
    lineThickness: number,
    colOffsets: number[],
    rowOffsets: number[]
  ) =>
    splitImageSource(imageSource, rows, cols, lineThickness, colOffsets, rowOffsets),
};
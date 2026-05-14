# 图片生成BUG诊断指南

## 问题描述
生成图片后，放大画布会导致图片显示"结果图"字样，切割工具画面也不显示图片，退出项目重新进画布导致生成图片成为"结果图"字样。自从出现这个BUG后，`C:\Users\10840\AppData\Roaming\com.storyboard.copilot\images` 文件夹没有写入过新的图片文件。

## 已添加的诊断日志

### 1. Rust 后端日志 (src-tauri/src/commands/image.rs)
- `resolve_images_dir`: 记录应用数据目录路径和图片目录创建过程
- `persist_image_bytes`: 记录图片保存的详细过程，包括文件名、大小、扩展名等

### 2. 前端日志 (src/features/canvas/application/imageData.ts)
- `prepareNodeImage`: 记录图片处理的每个步骤
- 详细的错误信息，包括错误消息和堆栈跟踪

### 3. 生成任务日志 (src/features/canvas/Canvas.tsx)
- 生成任务成功后的处理流程
- 每个步骤的详细状态和结果

## 诊断步骤

### 1. 查看应用日志
重新编译并运行应用后，生成一张图片，然后查看控制台输出。寻找以下关键日志：

**Rust 后端日志：**
```
Resolved app data dir: <路径>
Target images dir: <路径>
Images dir created/verified: <路径>
Attempting to persist image: <文件名> (<字节数> bytes, extension: <扩展名>)
Image file does not exist, writing new file: <完整路径>
Successfully wrote image file: <完整路径>
Returning persisted image path: <路径>
```

**前端日志：**
```
[GenerationJob] Generation succeeded, processing result for node: <节点ID>
[GenerationJob] Result URL: <图片URL>
[GenerationJob] Starting prepareNodeImage...
[imageData] prepareNodeImage called with source: <图片URL>
[imageData] Attempting Tauri prepareNodeImageSource...
[upload-perf][imageData] prepareNodeImage tauri-source elapsed=<时间>ms total=<时间>ms result: <结果>
[GenerationJob] prepareNodeImage completed successfully: { imageUrl: <路径>, previewImageUrl: <路径>, aspectRatio: <比例> }
[GenerationJob] Updating node data with prepared image: { nodeId: <节点ID>, imageUrl: <路径>, previewImageUrl: <路径> }
[GenerationJob] Node data updated successfully for node: <节点ID>
```

### 2. 常见错误信息及解决方案

#### 错误 1: "Failed to resolve app data dir"
**原因**: Tauri 无法获取应用数据目录
**解决方案**: 
- 检查应用是否有足够的权限
- 确认 Tauri 配置正确

#### 错误 2: "Failed to create images dir at <路径>"
**原因**: 无法创建 images 文件夹
**解决方案**:
- 检查磁盘空间
- 检查文件夹权限
- 手动创建文件夹：`C:\Users\10840\AppData\Roaming\com.storyboard.copilot\images`

#### 错误 3: "Failed to persist generated image to <路径>"
**原因**: 无法写入图片文件
**解决方案**:
- 检查磁盘空间
- 检查文件写入权限
- 检查防病毒软件是否阻止写入

#### 错误 4: "Tauri 返回的图片路径不完整"
**原因**: prepareNodeImageSource 返回的数据不完整
**解决方案**:
- 检查 Rust 后端是否正常编译
- 查看后端日志中的错误信息

### 3. 手动检查

#### 检查 images 文件夹
1. 导航到 `C:\Users\10840\AppData\Roaming\com.storyboard.copilot\images`
2. 检查文件夹是否存在
3. 检查是否有写入权限
4. 生成图片后检查是否有新文件出现

#### 检查浏览器控制台
1. 打开开发者工具 (F12)
2. 切换到 Console 标签
3. 生成一张图片
4. 查看是否有错误信息

## 临时解决方案

如果问题持续存在，可以尝试以下临时解决方案：

### 方案 1: 手动创建 images 文件夹
```powershell
New-Item -ItemType Directory -Force -Path "C:\Users\10840\AppData\Roaming\com.storyboard.copilot\images"
icacls "C:\Users\10840\AppData\Roaming\com.storyboard.copilot\images" /grant Users:F
```

### 方案 2: 以管理员身份运行应用
右键点击应用，选择"以管理员身份运行"

### 方案 3: 检查防病毒软件设置
将应用添加到防病毒软件的排除列表中

## 下一步

1. 重新编译应用：`npm run tauri build`
2. 运行应用并生成一张图片
3. 收集所有日志信息
4. 根据日志信息确定具体问题
5. 应用相应的解决方案

## 联系支持

如果问题仍然存在，请提供以下信息：
- 完整的控制台日志
- 错误信息的截图
- 系统信息（操作系统版本、可用磁盘空间等）
- images 文件夹的权限设置
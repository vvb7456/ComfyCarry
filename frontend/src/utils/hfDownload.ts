import type { HuggingFaceFile, HuggingFaceModel, HuggingFaceVersion } from '@/config/huggingface-models'
import { fileDirectory } from '@/config/huggingface-models'
import { joinFilePath, normalizeFilePath } from '@/utils/filePath'

/** 恢复使用配置中的原路径；普通下载使用白名单默认位置。 */
export interface HuggingFaceDownloadOverrides {
  /** 落盘文件名 (缺省 = 白名单条目的文件名) */
  filename?: string
  /** 落盘目录与登记类别 (MODEL_DIRS key; 缺省 = 白名单条目的 modelType) */
  modelType?: HuggingFaceFile['modelType']
  targetPath?: string
}

/**
 * 两个入口共用, 保证同一文件无论从哪下载, 任务契约完全一致:
 * - 模型页 HF 标签页 (stores/downloads.ts downloadHuggingFaceVersion)
 * - 生成页运行组件依赖条 (useDependencyStatus, 文件带 hf 锚点时)
 *
 * meta 严格按 SPEC §6-E 契约, 后端完成回调直接据此登记 SQLite +
 * resource_registry (whitelist:<model_id>:<version_id>) 状态。
 */
export function buildHuggingFaceDownloadBody(
  model: HuggingFaceModel,
  version: HuggingFaceVersion,
  overrides?: HuggingFaceDownloadOverrides,
) {
  const modelType = overrides?.modelType ?? version.file.modelType
  const filename = overrides?.filename ?? version.file.filename
  const targetPath = overrides?.targetPath
    ? normalizeFilePath(overrides.targetPath)
    : joinFilePath(fileDirectory(version.file), filename)
  const meta = {
    source: 'whitelist',
    provider: version.file.source,
    model_id: String(model.id),
    version_id: String(version.id),
    model_name: model.name,
    version_name: version.name,
    model_type: model.type,
    // category 决定后端登记类别, 必须与顶层 model_type 同源 (后端按 model_type
    // 解析目录、按 meta.category 登记), 否则会落 A 目录却登记成 B 类。
    category: modelType,
    is_model: version.file.isModel !== false,
    base_model: version.baseModel,
    architecture: version.file.architecture,
    image_url: model.images[0]?.url || version.images[0]?.url || '',
    sha256: version.file.sha256,
    size_bytes: version.file.sizeBytes,
    trained_words: version.trainedWords,
    images: version.images,
    author: model.user.username,
    source_url: model.sourceUrl,
    completion_requires_callback: true,
  }
  return {
    source: 'whitelist' as const,
    url: version.file.url,
    model_type: modelType,
    filename,
    target_path: targetPath,
    ...(version.file.headers && { headers: version.file.headers }),
    meta,
  }
}

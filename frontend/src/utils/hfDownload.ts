import type { HuggingFaceModel, HuggingFaceVersion } from '@/config/huggingface-models'

/**
 * hfDownload.ts — HF 白名单下载请求体构造 (唯一实现)。
 *
 * 两个入口共用, 保证同一文件无论从哪下载, 任务契约完全一致:
 * - 模型页 HF 标签页 (stores/downloads.ts downloadHuggingFaceVersion)
 * - 生成页运行组件依赖条 (useDependencyStatus, 文件带 hf 锚点时)
 *
 * meta 严格按 SPEC §6-E 契约, 后端完成回调直接据此登记 SQLite +
 * resource_registry (huggingface:<model_id>:<version_id>) 状态。
 */
export function buildHuggingFaceDownloadBody(model: HuggingFaceModel, version: HuggingFaceVersion) {
  const meta = {
    source: 'huggingface',
    model_id: String(model.id),
    version_id: String(version.id),
    model_name: model.name,
    version_name: version.name,
    model_type: model.type,
    category: version.file.modelType,
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
    source: 'huggingface' as const,
    url: version.file.url,
    model_type: version.file.modelType,
    filename: version.file.filename,
    meta,
  }
}

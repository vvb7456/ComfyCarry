export interface ModelMetaImage {
  url: string
  type?: string
  seed?: number | string
  steps?: number
  cfg?: number
  sampler?: string
  model?: string
  positive?: string
  negative?: string
}

export interface ModelMetaVersion {
  id: string | number
  name: string
  baseModel?: string
  images?: ModelMetaImage[]
  trainedWords?: string[]
  hashes?: Record<string, string>
}

export interface ModelMeta {
  name: string
  type?: string
  baseModel?: string
  id?: string | number
  versionId?: string | number
  versionName?: string
  author?: string
  sha256?: string
  filename?: string
  civitaiUrl?: string
  stats?: { downloads?: number; likes?: number }
  trainedWords?: string[]
  images?: ModelMetaImage[]
  versions?: ModelMetaVersion[]
}

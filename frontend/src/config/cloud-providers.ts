/**
 * 云存储提供商共享常量 —— wizard step3 与 dashboard AddStorageFlow 共用。
 * descKey 指向 sync.providers.* 命名空间 (dashboard 弹窗文案, wizard 全局 scope 可直接取)。
 */
export interface CloudProvider {
  id: string
  name: string
  descKey: string
  defaultName: string
}

export const CLOUD_PROVIDERS: CloudProvider[] = [
  { id: 'drive', name: 'Google Drive', descKey: 'sync.providers.drive_desc', defaultName: 'gdrive' },
  { id: 'onedrive', name: 'OneDrive', descKey: 'sync.providers.onedrive_desc', defaultName: 'onedrive' },
  { id: 'dropbox', name: 'Dropbox', descKey: 'sync.providers.dropbox_desc', defaultName: 'dropbox' },
  { id: 's3', name: 'S3 / R2', descKey: 'sync.providers.s3_desc', defaultName: 'r2' },
  { id: 'webdav', name: 'WebDAV', descKey: 'sync.providers.webdav_desc', defaultName: 'webdav' },
  { id: 'sftp', name: 'SFTP', descKey: 'sync.providers.sftp_desc', defaultName: 'sftp' },
]

/** OAuth 授权型提供商 (remote_type_defs 后端定义之外的兜底判断) */
export const OAUTH_TYPES: string[] = ['drive', 'onedrive', 'dropbox']

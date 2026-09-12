/**
 * Remote 类型 → 品牌 logo。
 *
 * 素材来自 assets/brand/ (官方彩色 SVG), 两端与品牌图标目录共用同一套视觉。
 *
 * 没有品牌可言的走 MsIcon 后备:
 *  - sftp 是协议不是产品;
 *  - webdav 是协议不是产品, 与未知类型统一回退 cloud;
 *  - s3 只有 Cloudflare R2 / AWS 两个 provider 有素材, Minio / Wasabi /
 *    DigitalOcean 等挂 AWS 的立方体 logo 是错的品牌归属。
 */
import awsLogo from '@/assets/brand/aws-color.svg'
import cloudflareLogo from '@/assets/brand/cloudflare-color.svg'
import dropboxLogo from '@/assets/brand/dropbox-color.svg'
import googleDriveLogo from '@/assets/brand/googledrive-color.svg'
import oneDriveLogo from '@/assets/brand/onedrive-color.svg'
import type { IconName } from '@/config/icon-codepoints'

export interface RemoteBrand {
  /** 品牌 logo 资产 URL; 缺省时用 icon */
  logo?: string
  /** MsIcon 后备图标名 */
  icon: IconName
}

const S3_PROVIDER_LOGOS: Record<string, string> = {
  Cloudflare: cloudflareLogo,
  AWS: awsLogo,
}

const TYPE_LOGOS: Record<string, string> = {
  onedrive: oneDriveLogo,
  drive: googleDriveLogo,
  dropbox: dropboxLogo,
}

export function remoteBrand(type: string, provider?: string): RemoteBrand {
  if (type === 's3') {
    return { logo: provider ? S3_PROVIDER_LOGOS[provider] : undefined, icon: 'cloud' }
  }
  if (type === 'sftp') return { icon: 'dns' }
  return { logo: TYPE_LOGOS[type], icon: 'cloud' }
}

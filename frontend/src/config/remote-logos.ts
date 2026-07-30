/**
 * Remote 类型 → 品牌 logo。
 *
 * 素材取自桌面客户端 ComfyCarry-Companion (src/ComfyCarry/Assets/logos/),
 * 两端保持同一套品牌视觉。
 *
 * 没有品牌可言的走 MsIcon 后备:
 *  - sftp 是协议不是产品;
 *  - s3 只有 Cloudflare R2 / AWS 两个 provider 有素材, Minio / Wasabi /
 *    DigitalOcean 等挂 AWS 的立方体 logo 是错的品牌归属。
 */
import awsS3Logo from '@/assets/remote-logos/awss3.png'
import cloudflareLogo from '@/assets/remote-logos/cloudflare.png'
import dropboxLogo from '@/assets/remote-logos/dropbox.png'
import googleDriveLogo from '@/assets/remote-logos/googledrive.png'
import oneDriveLogo from '@/assets/remote-logos/onedrive.png'
import webdavLogo from '@/assets/remote-logos/webdav.png'

export interface RemoteBrand {
  /** 品牌 logo 资产 URL; 缺省时用 icon */
  logo?: string
  /** MsIcon 后备图标名 */
  icon: string
}

const S3_PROVIDER_LOGOS: Record<string, string> = {
  Cloudflare: cloudflareLogo,
  AWS: awsS3Logo,
}

const TYPE_LOGOS: Record<string, string> = {
  onedrive: oneDriveLogo,
  drive: googleDriveLogo,
  dropbox: dropboxLogo,
  webdav: webdavLogo,
}

export function remoteBrand(type: string, provider?: string): RemoteBrand {
  if (type === 's3') {
    return { logo: provider ? S3_PROVIDER_LOGOS[provider] : undefined, icon: 'cloud' }
  }
  if (type === 'sftp') return { icon: 'dns' }
  return { logo: TYPE_LOGOS[type], icon: 'cloud' }
}

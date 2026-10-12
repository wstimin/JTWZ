import type {
  BrandSettings,
  DomainRecord,
  PackageRecord,
  SiteRecord,
  SoftwareRecord,
} from './types'

// These values are only used while the API is unavailable. Business data must
// come from the server, so a fresh installation starts with an empty catalog.
export const defaultSettings: BrandSettings = {
  name: 'JTWZ',
  tagline: '统一管理数字入口、静态网站与软件分发。',
  supportEmail: '',
  footerText: '多域名跳转、静态网站发布与软件分发平台。',
}

export const defaultDomains: DomainRecord[] = []
export const defaultSites: SiteRecord[] = []
export const defaultSoftware: SoftwareRecord[] = []
export const defaultPackages: PackageRecord[] = []
export const chartData: number[] = []

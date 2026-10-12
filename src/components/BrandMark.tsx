export function BrandMark({ compact = false, logoUrl = '' }: { compact?: boolean; logoUrl?: string }) {
  return (
    <span className={compact ? 'brand-mark brand-mark--compact' : 'brand-mark'} aria-hidden="true">
      {logoUrl ? <img src={logoUrl} alt="" /> : <span />}
    </span>
  )
}

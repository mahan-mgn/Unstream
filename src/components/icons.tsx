interface P {
  className?: string
}

const base = 'w-4 h-4'

export const DownloadIcon = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className}>
    <path d="M12 3v12m0 0 4-4m-4 4-4-4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" />
  </svg>
)

export const PlayIcon = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className}>
    <path d="M8 5.5v13l11-6.5-11-6.5Z" strokeLinejoin="round" />
  </svg>
)

export const PauseIcon = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <rect x="7" y="5" width="3.5" height="14" rx="1" />
    <rect x="13.5" y="5" width="3.5" height="14" rx="1" />
  </svg>
)

export const SearchIcon = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" strokeLinecap="round" />
  </svg>
)

export const RetryIcon = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className}>
    <path d="M20 12a8 8 0 1 1-2.3-5.6" strokeLinecap="round" />
    <path d="M20 4v4h-4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const CloseIcon = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
    <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
  </svg>
)

export const CheckIcon = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <path d="m5 12.5 4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/**
 * شورونِ «ادامه» — در RTL به چپ و در LTR به راست اشاره می‌کند.
 * برای استفاده‌های چرخشی (مثل جمع‌کردن پنل) flip را خاموش کن.
 */
export const ChevronIcon = ({ className = base, flip = true }: P & { flip?: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    className={`${className} ${flip ? 'ltr:-scale-x-100' : ''}`}
  >
    <path d="m15 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const HeadphonesIcon = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className}>
    <path d="M4 15v-3a8 8 0 0 1 16 0v3" strokeLinecap="round" />
    <rect x="2.5" y="14" width="4.5" height="6.5" rx="2" />
    <rect x="17" y="14" width="4.5" height="6.5" rx="2" />
  </svg>
)

export const SunIcon = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" strokeLinecap="round" />
  </svg>
)

export const MoonIcon = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" strokeLinejoin="round" />
  </svg>
)

/** فلش «برو» — در RTL خودکار برمی‌گردد */
export const ArrowIcon = ({ className = base }: P) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    className={`${className} rtl:-scale-x-100`}
  >
    <path d="M5 12h13m0 0-5-5m5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const LinkIcon = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className}>
    <path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.54 3.54 0 0 0-5-5l-1.2 1.2" strokeLinecap="round" />
    <path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.54 3.54 0 0 0 5 5l1.2-1.2" strokeLinecap="round" />
  </svg>
)

export const ZipIcon = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
    <rect x="3" y="4" width="18" height="4" rx="1.2" />
    <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
    <path d="M11 12h2M11 15h2" strokeLinecap="round" />
  </svg>
)

export const LibraryIcon = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className}>
    <path d="M4 4v16M8.5 4v16" strokeLinecap="round" />
    <path d="m13 5.2 5 15.2" strokeLinecap="round" />
    <path d="M11.5 9.5h9M11.5 15h9" strokeLinecap="round" opacity="0.45" />
  </svg>
)

export const TrashIcon = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className}>
    <path d="M4 7h16M10 4h4M9 7v12M15 7v12" strokeLinecap="round" />
    <path d="M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7" strokeLinecap="round" />
  </svg>
)

export const LyricsIcon = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className}>
    <path d="M9 18V6l10-2v12" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="6.5" cy="18" r="2.5" />
    <circle cx="16.5" cy="16" r="2.5" />
  </svg>
)

export const WarnIcon = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className}>
    <path d="M12 4.5 21 20H3l9-15.5Z" strokeLinejoin="round" />
    <path d="M12 10v4.5" strokeLinecap="round" />
    <circle cx="12" cy="17.2" r="0.9" fill="currentColor" stroke="none" />
  </svg>
)

export const Spinner = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="none" className={`${className} animate-spin`}>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.2" opacity="0.25" />
    <path
      d="M21 12a9 9 0 0 0-9-9"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
  </svg>
)

import { SOURCE_LABEL, type Source } from '../lib/types'
import SourceLogo from './logos'

/**
 * نشان منبع — فقط لوگوی پلتفرم با رنگ برندش، بدون نام.
 *
 * نام پلتفرم به‌صورت `title` و متن پنهان (`sr-only`) نگه داشته می‌شود تا هم
 * با نگه‌داشتن اشاره‌گر دیده شود و هم صفحه‌خوان‌ها آن را بخوانند.
 */
export default function SourceBadge({
  source,
  /** اندازه/جلوه‌ی لوگو — پیش‌فرض همان حالتِ قبلی؛ آلبوم‌ویو بزرگ‌تر و واضح‌تر می‌فرستد */
  className = 'size-3.5',
}: {
  source: Source
  className?: string
}) {
  const label = SOURCE_LABEL[source]
  return (
    <span
      title={label}
      className="inline-grid size-5 shrink-0 place-items-center"
    >
      <SourceLogo source={source} className={className} />
      <span className="sr-only">{label}</span>
    </span>
  )
}

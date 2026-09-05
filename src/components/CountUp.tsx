import { useEffect, useRef, useState } from 'react'
import { reducedMotion } from '../lib/motion'

/**
 * عددی که تا مقدارِ نهایی بالا می‌رود — از reactbits.dev/text-animations/count-up.
 *
 * سه تفاوت با نسخه‌ی اصلی:
 *
 * ۱. `format` اجباری‌ست، نه `toLocaleString`ِ داخلی. در این اپ ارقام در فارسی
 *    فارسی‌اند و همه‌ی جاهای دیگر از `digits(n, lang)` می‌گذرند؛ اگر این‌جا
 *    فرمتِ خودش را داشت، تنها عددِ لاتینِ صفحه می‌شد.
 * ۲. از مقدارِ قبلی می‌شمارد نه همیشه از صفر. این عدد شمارنده‌ی کتابخانه است؛
 *    وقتی یک فایل پاک می‌شود، «۱۲۴ → ۱۲۳» درست است و «۰ → ۱۲۳» دروغ.
 * ۳. با `IntersectionObserver` منتظرِ دیده‌شدن نمی‌ماند — این عددها در هدرِ
 *    صفحه‌اند و همیشه از همان اول جلوی چشم‌اند؛ یک ناظر برایشان فقط هزینه بود.
 */
export default function CountUp({
  value,
  format,
  duration = 900,
  className,
}: {
  value: number
  format: (n: number) => string
  /** میلی‌ثانیه */
  duration?: number
  className?: string
}) {
  const [shown, setShown] = useState(0)
  // آخرین عددی که واقعاً روی صفحه است — نه مقصد. اگر وسطِ شمارش عدد عوض شود
  // (فایلی پاک شود) باید از همان‌جایی ادامه بدهد که چشم دارد می‌بیند، نه از
  // مبدأِ شمارشِ قبلی
  const current = useRef(0)
  const raf = useRef(0)

  useEffect(() => {
    if (current.current === value) return

    if (reducedMotion() || duration <= 0) {
      current.current = value
      setShown(value)
      return
    }

    const start = performance.now()
    const begin = current.current
    const delta = value - begin

    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration)
      // easeOutCubic: تندِ اول و آرامِ آخر — همان حسِ «رسیدن» به عدد، به‌جای
      // ایستادنِ ناگهانی
      const eased = 1 - Math.pow(1 - p, 3)
      const next = Math.round(begin + delta * eased)
      current.current = next
      setShown(next)
      if (p < 1) raf.current = requestAnimationFrame(step)
      else current.current = value
    }

    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [value, duration])

  return (
    // عددِ در حالِ تغییر برای صفحه‌خوان نویز است؛ مقدارِ نهایی یک بار و درست
    // خوانده می‌شود
    <span className={className}>
      <span aria-hidden>{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  )
}

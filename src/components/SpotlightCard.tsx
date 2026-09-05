import { useRef, type CSSProperties, type ElementType, type HTMLAttributes, type Ref } from 'react'

/**
 * کارتی که زیرِ نشانگرِ ماوس روشن می‌شود — از reactbits.dev/components/spotlight-card.
 *
 * موقعیتِ ماوس را داخلِ دو متغیرِ CSS می‌گذارد و یک لایه‌ی گرادیانِ شعاعی روی
 * همان نقطه می‌نشیند. کلِ کار در `mousemove` است و هیچ استیتی عوض نمی‌شود —
 * برای همین رندرِ دوباره‌ای هم در کار نیست.
 *
 * دو تفاوت با نسخه‌ی اصلی:
 *
 * ۱. `as` دارد. جاهایی که این‌جا لازم بود (کاشی‌های خانه) خودشان `button`ـاند و
 *    گذاشتنِ یک `div` دورشان یعنی یک لایه‌ی اضافه که فقط چیدمان را به‌هم می‌ریزد.
 * ۲. روی دستگاهِ لمسی اصلاً شنونده‌ای بسته نمی‌شود. آن‌جا «زیرِ ماوس» معنایی
 *    ندارد و افکت یا اصلاً دیده نمی‌شود یا بعد از ضربه سرِ جایش گیر می‌کند.
 */
export default function SpotlightCard<T extends ElementType = 'div'>({
  as,
  children,
  className = '',
  spotlightColor = 'color-mix(in srgb, var(--accent) 22%, transparent)',
  size = 220,
  ...rest
}: {
  as?: T
  spotlightColor?: string
  /** شعاعِ هاله به پیکسل */
  size?: number
} & HTMLAttributes<HTMLElement>) {
  const ref = useRef<HTMLElement>(null)
  const Tag = (as ?? 'div') as ElementType

  const track = (e: React.MouseEvent<HTMLElement>) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    el.style.setProperty('--spot-x', `${e.clientX - rect.left}px`)
    el.style.setProperty('--spot-y', `${e.clientY - rect.top}px`)
  }

  // بدونِ ماوس، کامپوننت فقط یک ظرفِ ساده است
  const pointer =
    typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches
      ? { onMouseMove: track, onMouseEnter: track }
      : {}

  return (
    <Tag
      ref={ref as Ref<HTMLElement>}
      className={`spotlight-card ${className}`}
      style={{ ['--spot-size']: `${size}px`, ['--spot-color']: spotlightColor } as CSSProperties}
      {...pointer}
      {...rest}
    >
      {children}
    </Tag>
  )
}

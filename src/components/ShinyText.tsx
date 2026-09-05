import type { CSSProperties, ReactNode } from 'react'

/**
 * متنی که یک باندِ نور آرام رویش رد می‌شود — از reactbits.dev/text-animations/shiny-text.
 *
 * تنها انیمیشنِ متنیِ آن مجموعه که با فارسی کار می‌کند: بقیه (Split Text،
 * Decrypted Text، Text Type و…) متن را حرف‌به‌حرف به `span` می‌شکنند و خطِ فارسی
 * را از هم باز می‌کنند — «کتابخانه» می‌شود «ک ت ا ب خ ا ن ه». این‌جا هیچ‌چیزی
 * شکسته نمی‌شود؛ یک گرادیانِ متحرک روی کلِ عنصر می‌افتد و با `background-clip`
 * فقط داخلِ خودِ حروف دیده می‌شود.
 *
 * دو تغییر نسبت به نسخه‌ی اصلی:
 * ۱. رنگِ پایه پارامتر است نه سفیدِ ثابت، چون این‌جا روی رنگِ اکسنت می‌نشیند و
 *    باید در تمِ روشن و تیره هر دو همان رنگ بماند.
 * ۲. جهتِ حرکت از `dir` صفحه می‌آید؛ در فارسی نور هم مثل خواندن از راست می‌آید.
 *
 * «حرکتِ کمتر» جدا هندل نشده: انیمیشن CSS است و قانونِ سراسریِ `index.css`
 * خودش خفه‌اش می‌کند.
 */
export default function ShinyText({
  children,
  className = '',
  /** ثانیه — یک دورِ کاملِ عبورِ نور */
  speed = 4,
  /** رنگِ خودِ متن؛ نور روی همین می‌نشیند */
  color = 'var(--accent)',
  /** رنگِ باندِ نور — پیش‌فرض همان متن است ولی روشن‌تر */
  shine = 'color-mix(in srgb, var(--accent) 35%, #ffffff)',
  disabled = false,
}: {
  children: ReactNode
  className?: string
  speed?: number
  color?: string
  shine?: string
  disabled?: boolean
}) {
  if (disabled) return <span className={className} style={{ color }}>{children}</span>

  return (
    <span
      className={`shiny-text ${className}`}
      style={
        {
          ['--shiny-base']: color,
          ['--shiny-glow']: shine,
          ['--shiny-speed']: `${speed}s`,
        } as CSSProperties
      }
    >
      {children}
    </span>
  )
}

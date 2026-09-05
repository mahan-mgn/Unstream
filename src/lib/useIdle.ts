import { useEffect, useRef, useState } from 'react'

/**
 * حالتِ «محیط» — بعد از بی‌کاری، کنترل‌ها محو می‌شوند و فقط کاور و رنگش
 * روی صفحه می‌ماند.
 *
 * چرا این‌قدر «پریمیوم» حس می‌شود: وقتی آهنگ دارد پخش می‌شود، کاربر معمولاً
 * به صفحه نگاه نمی‌کند — دکمه‌ها شلوغی‌اند. محو‌شدنشان صفحه را به یک پوسترِ
 * زنده تبدیل می‌کند و هر وقت دست رفت سمت گوشی، با یک لمس برمی‌گردند. اپل‌موزیک
 * در حالتِ تمام‌صفحه و خیلی از پلیرهای ماشین همین کار را می‌کنند.
 *
 * سه نکته که نسخه‌های ساده غلط دارند:
 *
 *  ۱. **شمارنده با هر تعامل ریست می‌شود، نه فقط با لمسِ صفحه.** هر رویدادِ
 *     pointer/کیبورد روی کلِ سند دوباره تایمر را بالا می‌آورد — وگرنه کاربری
 *     که دارد با کیبورد ترک عوض می‌کند، کنترل‌ها زیرِ دستش ناپدید می‌شوند.
 *  ۲. **موقعِ کشیدنِ شیت یا ژستِ کاور محو نمی‌شود.** تا انگشت روی صفحه است
 *     (`pointerdown` تا `pointerup`) تایمر متوقف می‌ماند؛ محو‌شدنِ وسطِ درگ
 *     فاجعه است.
 *  ۳. **حرکتِ کم = محوِ کامل.** با `prefers-reduced-motion` اصلاً محو نمی‌شود؛
 *     برای این کاربرها «ناپدید شدنِ کنترل‌ها» نه آرامش‌بخش است نه قابل‌پیش‌بینی.
 */
export function useIdle(delayMs = 6000, enabled = true): boolean {
  const [idle, setIdle] = useState(false)
  /** تا انگشت روی صفحه است، شمارنده نمی‌دود */
  const held = useRef(false)

  useEffect(() => {
    if (!enabled) {
      setIdle(false)
      return
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let timer = 0
    let isIdle = false
    /*
     * `pointermove` روی دسکتاپ ده‌ها بار در ثانیه می‌آید؛ اگر هر بار setIdle
     * صدا بزنیم (حتی با مقدارِ یکسان) و تایمر را از نو ببندیم، بی‌دوراه کار
     * می‌شود. پس فقط وقتی واقعاً از حالتِ محو برمی‌گردیم state عوض می‌شود.
     */
    const arm = () => {
      if (isIdle) {
        isIdle = false
        setIdle(false)
      }
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (held.current) return
        isIdle = true
        setIdle(true)
      }, delayMs)
    }

    const hold = () => {
      held.current = true
    }
    const release = () => {
      held.current = false
      arm()
    }

    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const
    events.forEach((e) => window.addEventListener(e, arm, { passive: true }))
    window.addEventListener('pointerdown', hold, { passive: true })
    window.addEventListener('pointerup', release, { passive: true })
    window.addEventListener('pointercancel', release, { passive: true })
    arm()

    return () => {
      window.clearTimeout(timer)
      events.forEach((e) => window.removeEventListener(e, arm))
      window.removeEventListener('pointerdown', hold)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
    }
  }, [delayMs, enabled])

  return idle
}

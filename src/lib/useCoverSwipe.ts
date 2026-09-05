import { useEffect, useRef, useState } from 'react'
import { haptic } from './native'

/**
 * کشیدنِ کاور به چپ/راست برای رفتن به ترک بعدی/قبلی.
 *
 * این ژست، امضای رفتاریِ اسپاتیفای است: کاربر بدون اینکه به دکمه‌ای دست بزند،
 * با همان انگشتی که کاور را گرفته، آهنگ را عوض می‌کند. روی موبایل، هیچ
 * کنترلِ دیگری به‌اندازه‌ی این «اپ‌بودن» را نشان نمی‌دهد.
 *
 * چهار تصمیمِ طراحی که این پیاده‌سازی را از نسخه‌های ساده جدا می‌کند:
 *
 *  ۱. **قفلِ محور.** شیت خودش کشیدنِ عمودی دارد و محتوا اسکرول. پس لمس باید
 *     اول تصمیم بگیرد افقی است یا عمودی؛ به‌محض اینکه حرکتِ عمودی غالب شد،
 *     ژست ول می‌شود و به اسکرول/کشیدنِ شیت واگذار می‌گردد.
 *  ۲. **Pointer Events به‌جای Touch.** با `touch-action: pan-y` مرورگر کارِ
 *     اسکرول را نگه می‌دارد و افقی را به ما می‌دهد — بدون `preventDefault` و
 *     بدون شنونده‌ی non-passive. نتیجه اینکه با ماوسِ دسکتاپ هم کار می‌کند.
 *  ۳. **ترکِ بعدی از زیر معلوم می‌شود.** حین کشیدن، کاوی که قرار است جایگزین
 *     شود پشتِ کاور فعلی با مقیاسِ کوچک‌تر منتظر است و کم‌کم ظاهر می‌شود.
 *     همین باعث می‌شود لحظه‌ی تحویل هیچ پرشی نداشته باشد: کاورِ جدید دقیقاً
 *     همان‌جا که هست می‌ایستد.
 *  ۴. **سرعت یا مسافت.** پرتابِ کوتاه باید ببندد و کشیدنِ آهسته‌ی بلند نه —
 *     همان قانونی که در `useSheetDrag` رعایت شده.
 */

/** از این فاصله به بعد معلوم می‌شود کشیدن است نه لمسِ ساده */
const SLOP = 8
/** آستانه‌ی جابه‌جایی (پیکسل) برای قطعی‌کردنِ تعویض */
const DISTANCE = 88
/** آستانه‌ی سرعت (پیکسل بر میلی‌ثانیه) برای پرتاب */
const VELOCITY = 0.45
/** مدتِ پروازِ کاور به بیرون (میلی‌ثانیه) */
const FLY_MS = 240

/**
 * تصمیمِ «رها شد — عوض شود یا برگردد؟». تنها قانونِ غیربديهیِ ژست که ارزشِ
 * تست‌کردن دارد: مسافت یا سرعت، هرکدام به‌تنهایی کافی است.
 */
export function shouldCommit(offset: number, velocity: number): boolean {
  return Math.abs(offset) > DISTANCE || Math.abs(velocity) > VELOCITY
}

export type SwipeDir = 'next' | 'prev'

interface Options {
  /** فقط وقتی نمای کاور باز است و صف بیش از یک ترک دارد */
  enabled: boolean
  onSwipe: (dir: SwipeDir) => void
}

export function useCoverSwipe({ enabled, onSwipe }: Options) {
  const cover = useRef<HTMLDivElement>(null)
  const peek = useRef<HTMLDivElement>(null)
  const cb = useRef(onSwipe)
  cb.current = onSwipe

  /** جهتِ ژستِ جاری؛ null یعنی چیزی روی صفحه نیست */
  const [dir, setDir] = useState<SwipeDir | null>(null)
  /** true یعنی کاور دارد می‌رود بیرون و تحویل در راه است */
  const [flying, setFlying] = useState(false)

  useEffect(() => {
    const el = cover.current
    if (!el || !enabled) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let startX = 0
    let startY = 0
    let lastX = 0
    let lastAt = 0
    let prevX = 0
    let prevAt = 0
    let offset = 0
    let pointerId = -1
    /** شمارنده‌ی نسل: تایم‌اوتِ settleِ قدیمی نباید ژستِ جدید را خراب کند */
    let generation = 0
    /** null یعنی هنوز محور مشخص نشده؛ false یعنی ول کردیم (اسکرول/کشیدنِ شیت) */
    let horizontal: boolean | null = null

    const sign = () => (offset < 0 ? 1 : -1)

    const clearStyles = () => {
      el.style.transition = ''
      el.style.transform = ''
      el.style.opacity = ''
      if (peek.current) {
        peek.current.style.transition = ''
        peek.current.style.transform = ''
        peek.current.style.opacity = ''
      }
    }

    const settle = () => {
      const gen = ++generation
      offset = 0
      el.style.transition = reduced
        ? 'none'
        : 'transform 0.4s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s ease'
      el.style.transform = 'translate3d(0, 0, 0) rotate(0deg)'
      el.style.opacity = '1'
      if (peek.current) {
        peek.current.style.transition = 'opacity 0.2s ease, transform 0.3s ease'
        peek.current.style.opacity = '0'
        peek.current.style.transform = 'scale(0.9)'
      }
      window.setTimeout(() => {
        if (gen === generation) {
          setDir(null)
          clearStyles()
        }
      }, 400)
    }

    const commit = (direction: SwipeDir) => {
      haptic.tap()
      const width = el.offsetWidth || 1
      pointerId = -1
      horizontal = null

      if (reduced) {
        setDir(null)
        clearStyles()
        cb.current(direction)
        return
      }

      setFlying(true)
      el.style.transition = `transform ${FLY_MS}ms cubic-bezier(0.4, 0, 0.2, 1), opacity ${FLY_MS}ms ease`
      el.style.transform = `translate3d(${direction === 'next' ? -width * 1.1 : width * 1.1}px, 0, 0) rotate(${sign() * 6}deg)`
      el.style.opacity = '0'
      if (peek.current) {
        peek.current.style.transition = `transform ${FLY_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${FLY_MS}ms ease`
        peek.current.style.transform = 'scale(1)'
        peek.current.style.opacity = '1'
      }

      /*
       * تحویل بعد از پایانِ پرواز: کاورِ جدید همان‌جا که کاورِ قدیمی ایستاده
       * بود ظاهر می‌شود، پس استایل‌ها در یک فریم پاک می‌شوند و state عوض —
       * هیچ فریمی با کاورِ وسطِ صفحه باقی نمی‌ماند.
       */
      window.setTimeout(() => {
        setFlying(false)
        setDir(null)
        clearStyles()
        cb.current(direction)
      }, FLY_MS)
    }

    const onDown = (e: PointerEvent) => {
      if (flying || e.pointerType === 'mouse' && e.button !== 0) return
      startX = lastX = prevX = e.clientX
      startY = e.clientY
      lastAt = prevAt = e.timeStamp
      offset = 0
      horizontal = null
      pointerId = e.pointerId
      el.style.transition = 'none'
    }

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId || horizontal === false) return
      const dx = e.clientX - startX
      const dy = e.clientY - startY

      if (horizontal === null) {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return
        // عمودی غالب است → اسکرول محتوا یا کشیدنِ شیت؛ دخالت نمی‌کنیم
        if (Math.abs(dy) > Math.abs(dx)) {
          horizontal = false
          return
        }
        horizontal = true
        el.setPointerCapture(e.pointerId)
        setDir(dx < 0 ? 'next' : 'prev')
      }

      prevX = lastX
      prevAt = lastAt
      lastX = e.clientX
      lastAt = e.timeStamp

      const width = el.offsetWidth || 1
      // بیرون از عرضِ کاور کش می‌آید نه اینکه گیر کند
      const overscroll = Math.max(0, Math.abs(dx) - width)
      offset = dx - Math.sign(dx) * overscroll * 0.5

      el.style.transform = `translate3d(${offset}px, 0, 0) rotate(${offset * 0.012}deg)`
      // ترکِ زیرِ کاور متناسب با پیشرفتِ کشیدن نمایان می‌شود
      if (peek.current) {
        peek.current.style.opacity = String(Math.min(1, Math.abs(offset) / 70))
        peek.current.style.transform = `scale(${0.9 + Math.min(0.1, Math.abs(offset) / 700)})`
      }
    }

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      pointerId = -1
      if (horizontal !== true) return
      const velocity = (lastX - prevX) / Math.max(1, lastAt - prevAt)
      const target: SwipeDir = offset < 0 ? 'next' : 'prev'
      if (shouldCommit(offset, velocity)) commit(target)
      else settle()
      horizontal = null
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)

    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
    }
  }, [enabled, flying])

  return { cover, peek, dir, flying }
}

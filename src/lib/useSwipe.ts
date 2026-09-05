import { useEffect, useRef } from 'react'
import { haptic } from './native'

/**
 * سوایپِ افقی روی مینی‌پلیر — ترکِ بعدی/قبلی.
 *
 * نوارِ پخشِ گوشی جا برای دکمه‌ی «قبلی» ندارد و نداشت؛ همان کاری که کاربر
 * روی هر پخش‌کننده‌ی موبایلی رفلکسی انجام می‌دهد اینجا هم جواب می‌دهد.
 *
 * جهت عمداً به راست‌به‌چپ بودنِ رابط گره نخورده و مثل `.seek` قفلِ LTR است:
 * قرارداد «چپ = جلو» در پخش‌کننده‌ها جهانی است و اگر در فارسی برعکس می‌شد،
 * با نوارِ جابه‌جایی که همان‌جا از چپ پر می‌شود خلافِ هم می‌شدند.
 *
 * دو نکته که پیاده‌سازیِ ساده‌ی این ژست معمولاً غلط دارد:
 *
 *  ۱. **کشیدنِ عمودی مالِ صفحه است.** تا وقتی معلوم نشده حرکت افقی است،
 *     هیچ‌کاری نمی‌کنیم؛ و اگر عمودی بود، تا آخرِ همان لمس کنار می‌کشیم.
 *  ۲. **کلیکِ بعد از سوایپ.** انگشت که بلند شود مرورگر یک `click` هم می‌دهد و
 *     بدون خفه‌کردنش، هر سوایپ نمای کامل را هم باز می‌کرد.
 */

/** از این فاصله به بعد معلوم است افقی است نه عمودی */
const SLOP = 10
/** با این مسافت (پیکسل) ترک عوض می‌شود… */
const DISTANCE = 64
/** …یا با این سرعت (پیکسل بر میلی‌ثانیه) */
const VELOCITY = 0.45
/** بیشترین جابه‌جاییِ دیداریِ محتوا زیر انگشت */
const MAX_SHIFT = 72

interface Options {
  /** انگشت به سمتِ چپ رفت */
  onLeft: () => void
  /** انگشت به سمتِ راست رفت */
  onRight: () => void
  enabled?: boolean
}

export function useSwipe<T extends HTMLElement, C extends HTMLElement = HTMLElement>({
  onLeft,
  onRight,
  enabled = true,
}: Options) {
  const ref = useRef<T>(null)
  /** محتوایی که زیر انگشت حرکت می‌کند — بازخوردِ دیداریِ همان کشیدن */
  const content = useRef<C>(null)
  const handlers = useRef({ onLeft, onRight })
  handlers.current = { onLeft, onRight }

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let startX = 0
    let startY = 0
    let lastX = 0
    let lastAt = 0
    let prevX = 0
    let prevAt = 0
    /** null یعنی هنوز معلوم نیست افقی است یا عمودی */
    let horizontal: boolean | null = null
    let active = false

    const paint = (dx: number) => {
      if (!content.current) return
      const shift = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, dx))
      content.current.style.transform = `translateX(${shift}px)`
      // کم‌رنگ‌شدن یعنی «داری این ترک را رها می‌کنی»، نه فقط «چیزی تکان خورد»
      content.current.style.opacity = String(1 - Math.abs(shift) / (MAX_SHIFT * 2.2))
    }

    const settle = () => {
      if (!content.current) return
      content.current.style.transition = reduced
        ? 'none'
        : 'transform 0.25s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.25s ease'
      content.current.style.transform = ''
      content.current.style.opacity = ''
    }

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const touch = e.touches[0]
      startX = lastX = prevX = touch.clientX
      startY = touch.clientY
      lastAt = prevAt = performance.now()
      horizontal = null
      active = true
      if (content.current) content.current.style.transition = 'none'
    }

    const onMove = (e: TouchEvent) => {
      if (!active || horizontal === false) return
      const touch = e.touches[0]
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY

      if (horizontal === null) {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return
        // عمودی یعنی کاربر می‌خواهد صفحه را اسکرول کند؛ دیگر کاری نداریم
        horizontal = Math.abs(dx) > Math.abs(dy)
        if (!horizontal) return
      }

      prevX = lastX
      prevAt = lastAt
      lastX = touch.clientX
      lastAt = performance.now()
      // جلوی اسکرولِ هم‌زمانِ مرورگر — بدون این، صفحه زیر انگشت می‌لغزد
      if (e.cancelable) e.preventDefault()
      paint(dx)
    }

    const onEnd = () => {
      if (!active) return
      const wasHorizontal = horizontal === true
      active = false
      horizontal = null
      if (!wasHorizontal) return

      const dx = lastX - startX
      const velocity = (lastX - prevX) / Math.max(1, lastAt - prevAt)
      const fired =
        Math.abs(dx) > DISTANCE || (Math.abs(velocity) > VELOCITY && Math.sign(velocity) === Math.sign(dx))

      settle()
      if (!fired) return

      haptic.select()
      if (dx < 0) handlers.current.onLeft()
      else handlers.current.onRight()

      /*
       * کلیکِ ناشی از همین لمس هنوز در راه است. یک‌بار می‌گیریمش و دور
       * می‌اندازیم؛ `capture` لازم است تا پیش از دکمه‌ی زیرش برسد.
       */
      const swallow = (click: Event) => {
        click.preventDefault()
        click.stopPropagation()
      }
      el.addEventListener('click', swallow, { capture: true, once: true })
      window.setTimeout(() => el.removeEventListener('click', swallow, { capture: true }), 400)
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)

    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [enabled])

  return { ref, content }
}

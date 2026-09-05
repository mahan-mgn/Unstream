import { useEffect, useRef } from 'react'
import { haptic } from './native'

/**
 * نگه‌داشتنِ طولانی روی یک ردیف — همان منویی که روی دسکتاپ با راست‌کلیک یا
 * دکمه‌ی «⋯» باز می‌شود.
 *
 * روی گوشی، «⋯» یک هدفِ ۲۸ پیکسلیِ ته ردیف است که کنارِ دکمه‌ی دانلود نشسته؛
 * انگشت مرتب اشتباهی می‌خورَد. نگه‌داشتنِ خودِ ردیف هدفش به‌اندازه‌ی کلِ ردیف
 * است — همان کاری که کاربر روی هر لیستِ موبایلی رفلکسی امتحان می‌کند.
 *
 * `contextmenu` هم به همین هوک وصل است: راست‌کلیکِ ماوس دقیقاً همین منظور را
 * دارد و منویِ خودِ مرورگر روی یک ردیفِ اپ چیزی برای گفتن ندارد.
 */

/** مکثِ لازم؛ کمتر از این با یک لمسِ معمولیِ کمی کند اشتباه گرفته می‌شود */
const HOLD_MS = 450
/** تکانِ بیشتر از این یعنی کاربر داشته اسکرول می‌کرده */
const MOVE_TOLERANCE = 10

export function useLongPress<T extends HTMLElement>(onTrigger: () => void, enabled = true) {
  const ref = useRef<T>(null)
  const latest = useRef(onTrigger)
  latest.current = onTrigger

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return

    let timer: number | undefined
    let startX = 0
    let startY = 0
    /** بعد از شلیک، `click`ِ همان لمس نباید ردیف را هم پخش کند */
    let fired = false

    const clear = () => {
      window.clearTimeout(timer)
      timer = undefined
    }

    const fire = () => {
      clear()
      fired = true
      haptic.select()
      latest.current()
    }

    /*
     * لایه‌های رویی از این ژست مصون‌اند.
     *
     * مودالِ «انتخاب نسخه» و خودِ منو، هر دو *داخلِ* همین ردیف رندر می‌شوند
     * (یکی `fixed` و یکی `absolute`)، پس رویدادهایشان تا اینجا بالا می‌آیند.
     * بدون این شرط، نگه‌داشتن یا راست‌کلیک داخلِ آن‌ها ردیفِ زیرشان را
     * می‌خواباند و منویی را باز می‌کرد که همان لحظه باز است.
     */
    const inOverlay = (target: EventTarget | null) =>
      Boolean((target as HTMLElement | null)?.closest?.('[role="dialog"],[role="menu"]'))

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || inOverlay(e.target)) return
      fired = false
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
      timer = window.setTimeout(fire, HOLD_MS)
    }

    const onMove = (e: TouchEvent) => {
      if (timer === undefined) return
      const touch = e.touches[0]
      if (
        Math.abs(touch.clientX - startX) > MOVE_TOLERANCE ||
        Math.abs(touch.clientY - startY) > MOVE_TOLERANCE
      ) {
        clear()
      }
    }

    const onClick = (e: Event) => {
      if (!fired) return
      fired = false
      e.preventDefault()
      e.stopPropagation()
    }

    const onContextMenu = (e: Event) => {
      if (inOverlay(e.target)) return
      e.preventDefault()
      latest.current()
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: true })
    el.addEventListener('touchend', clear)
    el.addEventListener('touchcancel', clear)
    el.addEventListener('click', onClick, true)
    el.addEventListener('contextmenu', onContextMenu)

    return () => {
      clear()
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', clear)
      el.removeEventListener('touchcancel', clear)
      el.removeEventListener('click', onClick, true)
      el.removeEventListener('contextmenu', onContextMenu)
    }
  }, [enabled])

  return ref
}

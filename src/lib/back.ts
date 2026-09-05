import { useEffect, useRef } from 'react'

/**
 * پشته‌ی «چیزی که دکمه‌ی برگشت باید ببندد».
 *
 * روی اندروید یک دکمه‌ی برگشت بیشتر نیست و همه‌ی لایه‌ها سرِ آن دعوا دارند:
 * شیتِ پخش، مودالِ شناسایی، منویِ کیفیت، پنلِ دانلود. بدونِ یک پشته‌ی مشترک،
 * هر کدام یا `history.back` را صدا می‌زدند (که کاربر را از صفحه بیرون می‌برد
 * درحالی‌که فقط می‌خواست شیت را ببندد) یا هیچ‌کاری نمی‌کردند و دکمه‌ی برگشت
 * وسطِ یک مودالِ باز کلِ اپ را می‌بست.
 *
 * قاعده ساده است: هر لایه‌ی رویی وقتی باز می‌شود خودش را اینجا ثبت می‌کند و
 * برگشت همیشه بالاترینِ پشته را می‌بندد. تا پشته خالی نشود، ناوبریِ صفحه
 * اصلاً نوبتش نمی‌رسد.
 */

interface Layer {
  token: symbol
  close: () => void
}

const stack: Layer[] = []

/** یک لایه‌ی رویی را ثبت می‌کند؛ برگردانده‌شده آن را برمی‌دارد */
export function pushLayer(close: () => void): () => void {
  const token = Symbol('layer')
  stack.push({ token, close })
  return () => {
    const at = stack.findIndex((layer) => layer.token === token)
    if (at >= 0) stack.splice(at, 1)
  }
}

/**
 * بالاترین لایه را می‌بندد. `false` یعنی چیزی برای بستن نبود و تصمیم با
 * ناوبریِ صفحه است.
 */
export function closeTopLayer(): boolean {
  const layer = stack.pop()
  if (!layer) return false
  layer.close()
  return true
}

/*
 * Escape دقیقاً همان کارِ دکمه‌ی برگشت را می‌کند، پس از همان پشته می‌آید.
 *
 * قبلاً هر لایه شنونده‌ی Escapeِ خودش را داشت و همه‌شان با هم شلیک می‌شدند:
 * باز کردنِ تنظیماتِ صدا داخلِ نمای پخش و زدنِ Escape، هر دو را می‌بست. حالا
 * فقط بالاترین لایه بسته می‌شود.
 *
 * `capture` عمدی است: شنونده‌ی روی window در فازِ گرفتن، پیش از هر شنونده‌ی
 * دیگری روی document و پیش از رویدادهای خودِ ری‌اکت اجرا می‌شود — و
 * `stopPropagation` جلوی رسیدنِ رویداد به بقیه را می‌گیرد.
 */
if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (!closeTopLayer()) return
      e.preventDefault()
      e.stopPropagation()
    },
    true,
  )
}

/**
 * نسخه‌ی ری‌اکتیِ همان — تا وقتی `open` درست است، این لایه روی پشته می‌ماند.
 *
 * `close` عمداً از وابستگی‌ها بیرون است و از یک ref خوانده می‌شود: تقریباً
 * همه‌ی صداکننده‌ها یک تابعِ درجا (`() => setOpen(false)`) می‌دهند که هر رندر
 * تازه است، و با بودنش لایه هر رندر یک‌بار برداشته و دوباره گذاشته می‌شد —
 * یعنی ترتیبِ پشته با هر رندرِ نامربوطی به‌هم می‌ریخت.
 */
export function useBackDismiss(open: boolean, close: () => void): void {
  const latest = useRef(close)
  latest.current = close

  useEffect(() => {
    if (!open) return
    return pushLayer(() => latest.current())
  }, [open])
}

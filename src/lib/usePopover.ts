import { useEffect, useRef } from 'react'
import { useBackDismiss } from './back'

/**
 * منوها و پاپ‌اورهای کوچک — همان الگویی که تا امروز در شش جای این اپ
 * کپی شده بود: کلیکِ بیرون می‌بندد، Escape می‌بندد.
 *
 * دو چیز نسبت به آن کپی‌ها فرق دارد:
 *
 *  ۱. Escape از پشته‌ی مشترکِ لایه‌ها می‌آید، پس وقتی یک منو *داخلِ* یک مودال
 *     باز است (تنظیمات صدا داخل نمای پخش)، Escape فقط منو را می‌بندد نه هر
 *     دو را با هم.
 *  ۲. دکمه‌ی برگشتِ اندروید هم همین‌طور. قبلاً منویِ باز اصلاً روی پشته نبود
 *     و برگشت، به‌جای بستنِ منو، کاربر را از صفحه بیرون می‌برد.
 *
 * `pointerdown` نه `mousedown`: روی لمس، `mousedown` شبیه‌سازی‌شده است و
 * چند صد میلی‌ثانیه بعدِ انگشت می‌آید — منو یک لحظه باز می‌ماند.
 */
export function usePopover<T extends HTMLElement>(open: boolean, close: () => void) {
  const box = useRef<T>(null)
  const latest = useRef(close)
  latest.current = close

  useBackDismiss(open, close)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) latest.current()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  return box
}

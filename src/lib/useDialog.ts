import { useEffect, useRef } from 'react'
import { useBackDismiss } from './back'

/**
 * مودالِ واقعی، نه فقط یک جعبه‌ی روی صفحه.
 *
 * چهار کاری که هر مودال باید بکند و هیچ‌کدام از دیالوگ‌های این اپ همه‌شان را
 * با هم نداشتند، اینجا یک‌جا جمع شده‌اند:
 *
 *  ۱. **قفلِ اسکرول.** بدونش صفحه‌ی پشتِ مودال زیر انگشت/چرخ‌ماوس می‌لغزد و
 *     وقتی مودال بسته می‌شود کاربر جای دیگری از لیست است.
 *  ۲. **تله‌ی فوکوس.** با Tab می‌شد از مودال بیرون رفت و روی دکمه‌هایی نشست که
 *     نه دیده می‌شوند نه قابل کلیک‌اند — برای کاربرِ کیبورد یعنی گم‌شدن.
 *  ۳. **برگرداندنِ فوکوس.** بعد از بستن، فوکوس باید به همان دکمه‌ای برگردد که
 *     مودال را باز کرده بود، نه به ابتدای سند.
 *  ۴. **Escape و دکمه‌ی برگشت.** هر دو از پشته‌ی مشترکِ لایه‌ها می‌آیند
 *     (`back.ts`)، پس همیشه *بالاترین* لایه بسته می‌شود نه همه‌شان با هم.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/*
 * قفلِ اسکرول شمارشی است نه بولی: `SourcePicker` از داخلِ ردیفِ کتابخانه باز
 * می‌شود و گاهی روی یک مودالِ دیگر می‌نشیند. با یک پرچمِ ساده، بستنِ رویی
 * قفلِ زیرین را هم برمی‌داشت.
 */
let locks = 0
let savedOverflow = ''

/** المان‌هایی که واقعاً روی صفحه‌اند — مخفی‌ها نباید نوبتِ Tab بگیرند */
function focusables(node: HTMLElement): HTMLElement[] {
  return [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement,
  )
}

/**
 * رفرنسِ برگشتی را روی خودِ جعبه‌ی دیالوگ بگذار (همان چیزی که
 * `role="dialog"` دارد) و `tabIndex={-1}` هم بهش بده تا بشود فوکوسش کرد.
 */
export function useDialog<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null)

  // Escape و دکمه‌ی برگشتِ اندروید، هر دو از همین یک جا
  useBackDismiss(open, onClose)

  useEffect(() => {
    if (!open) return
    const node = ref.current
    /*
     * `activeElement` را *قبل* از هر کاری برمی‌داریم: از این لحظه به بعد خودِ
     * ما فوکوس را جابه‌جا می‌کنیم و دیگر معلوم نیست کاربر از کجا آمده بود.
     */
    const opener = document.activeElement as HTMLElement | null

    if (locks++ === 0) {
      savedOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }

    // فوکوس روی خودِ جعبه، نه اولین دکمه‌اش: صفحه‌خوان عنوانِ دیالوگ را
    // می‌خواند، و انگشتِ کاربر روی یک دکمه‌ی مخرب (مثلاً «حذف») نمی‌نشیند
    node?.focus({ preventScroll: true })

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !node) return
      const items = focusables(node)
      if (!items.length) {
        e.preventDefault()
        node.focus({ preventScroll: true })
        return
      }

      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement

      // فوکوس بیرونِ مودال (مثلاً بعد از کلیک روی پس‌زمینه) — برگردانش داخل
      if (!node.contains(active)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
        return
      }
      // چرخشِ دو سرِ لیست؛ خودِ جعبه سرِ اول حساب می‌شود چون تنها چیزی است
      // که با باز شدن فوکوس گرفته
      if (e.shiftKey ? active === first || active === node : active === last) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      }
    }

    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (--locks === 0) document.body.style.overflow = savedOverflow
      // ممکن است دکمه‌ی بازکننده خودش هم رفته باشد (ردیفی که پاک شد) —
      // فوکوس روی یک نودِ جدا افتاده بی‌اثر است، نه خطا
      opener?.focus?.({ preventScroll: true })
    }
  }, [open])

  return ref
}

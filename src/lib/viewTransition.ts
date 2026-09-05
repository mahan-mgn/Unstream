import { flushSync } from 'react-dom'

/**
 * گذارِ عنصرِ مشترک بین مینی‌پلیر و نمای کامل.
 *
 * تفاوتِ «یک پنجره باز شد» و «همان کاور بزرگ شد» تمامِ حسِ بازکردنِ
 * پخش‌کننده است. با View Transitions مرورگر خودش از هر دو حالت عکس می‌گیرد و
 * عنصرهای هم‌نام را به هم تبدیل می‌کند — بدون کتابخانه و بدون محاسبه‌ی دستیِ
 * مختصات.
 *
 * `flushSync` لازم است: مرورگر همان لحظه از حالتِ *بعد* عکس می‌گیرد، و
 * به‌روزرسانیِ عادیِ ری‌اکت هنوز رندر نشده — بدونش عکسِ دوم با عکسِ اول یکی
 * می‌شود و هیچ حرکتی دیده نمی‌شود.
 *
 * جایی که پشتیبانی نیست (یا کاربر حرکتِ کم خواسته) همان `update` مستقیم اجرا
 * می‌شود؛ نتیجه دقیقاً رفتارِ قبلی است، نه یک حالتِ نصفه.
 */

type WithVT = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> }
}

/** نامِ مشترکِ کاور — روی مینی‌پلیر و نمای کامل، هرگز هم‌زمان روی هر دو */
export const COVER_VT = 'np-cover'

export function withViewTransition(update: () => void): void {
  const doc = document as WithVT
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (typeof doc.startViewTransition !== 'function' || reduced) {
    update()
    return
  }

  /*
   * انیمیشن‌های ورودِ خودِ شیت (`sheet-in`/`backdrop-in`) موقع گذار خاموش
   * می‌شوند: کاور دارد از جای مینی‌پلیر به جای خودش می‌رود، و اگر هم‌زمان
   * قابِ زیرش هم از پایین بالا بیاید، دو حرکتِ ناهماهنگ روی هم می‌افتند.
   */
  const root = document.documentElement
  root.dataset.vt = ''
  doc
    .startViewTransition(() => flushSync(update))
    .finished.finally(() => delete root.dataset.vt)
}

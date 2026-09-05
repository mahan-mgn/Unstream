import { useEffect, useRef, useState, type CSSProperties } from 'react'

/**
 * آیکنِ پخش/توقف که واقعاً بینِ دو حالت «مورف» می‌شود، نه اینکه یکی برود و
 * دومی بیاید.
 *
 * مثلثِ پخش از دو ذوزنقه ساخته می‌شود (نصفِ چپ و نوکِ راست) و هرکدام با
 * انیمیشنِ `d` به میله‌ی توقف تبدیل می‌شود. چون هر دو حالت دقیقاً چهار نقطه
 * دارند، مرورگر می‌تواند بینشان درون‌یابی کند — همان حرکتِ نرمی که اپل‌موزیک
 * دارد. `d: path()` در Chrome/Edge/Safari ۱۶ و Firefox ۹۷ به بالا پشتیبانی
 * می‌شود؛ مرورگرِ بدونِ پشتیبانی، آیکن را بدونِ انیمیشن عوض می‌کند (نه خراب).
 *
 * روی هر بار فشار، یک پرشِ فنری هم می‌خورد — بازخوردِ لمسیِ بصری که فشار
 * دادنِ دکمه را «حس» می‌کند.
 */

/*
 * دو حالتِ هر مسیر — چهار نقطه در هر دو تا درون‌یابی ممکن بماند. مثلثِ پخش
 * عمداً به دو ذوزنقه شکسته شده (نصفِ چپ و نوکِ راست) تا تعدادِ نقاطش با
 * دو میله‌ی توقف برابر باشد؛ بی‌این شکست، `d` انیمیت نمی‌شود.
 */
export const MORPH_PATHS = {
  left: {
    play: 'M8 5 L8 19 L13 15.82 L13 8.18 Z',
    pause: 'M7 5 L7 19 L10.5 19 L10.5 5 Z',
  },
  right: {
    play: 'M13 8.18 L13 15.82 L19 12 L19 12 Z',
    pause: 'M13.5 5 L13.5 19 L17 19 L17 5 Z',
  },
}

export default function PlayPauseIcon({ playing, className = '' }: { playing: boolean; className?: string }) {
  const [bounce, setBounce] = useState(false)
  const first = useRef(true)

  // پرش فقط موقعِ عوض‌شدنِ حالت، نه در رندرِ اول
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    setBounce(true)
    const id = window.setTimeout(() => setBounce(false), 340)
    return () => window.clearTimeout(id)
  }, [playing])

  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={`pp-morph ${className} ${bounce ? 'pp-bounce' : ''}`}
      aria-hidden
    >
      <path style={{ d: `path('${playing ? MORPH_PATHS.left.pause : MORPH_PATHS.left.play}')` } as CSSProperties} />
      <path style={{ d: `path('${playing ? MORPH_PATHS.right.pause : MORPH_PATHS.right.play}')` } as CSSProperties} />
    </svg>
  )
}

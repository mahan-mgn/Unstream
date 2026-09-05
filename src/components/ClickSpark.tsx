import { useEffect, useRef, type ReactNode } from 'react'
import { reducedMotion } from '../lib/motion'

/**
 * جرقه‌ای که از نقطه‌ی کلیک بیرون می‌زند — از reactbits.dev/animations/click-spark.
 *
 * روی یک `canvas`ِ نازکِ روی خودِ عنصر کشیده می‌شود؛ هشت خطِ کوتاه که از مرکزِ
 * کلیک بیرون می‌روند و همان‌جا محو می‌شوند.
 *
 * سه تفاوت با نسخه‌ی اصلی:
 *
 * ۱. حلقه‌ی رسم فقط وقتی زنده است که جرقه‌ای در کار باشد. نسخه‌ی اصلی یک
 *    `requestAnimationFrame`ِ همیشگی دارد که روی صفحه‌ی خالی هم می‌چرخد — روی
 *    گوشی یعنی باتری، بی‌آنکه چیزی رسم شود.
 * ۲. اندازه‌ی canvas با `devicePixelRatio` تنظیم می‌شود، وگرنه روی صفحه‌ی
 *    رتینا خطوط پله‌پله دیده می‌شوند.
 * ۳. با «حرکتِ کمتر» اصلاً canvasی ساخته نمی‌شود.
 *
 * عمداً فقط دورِ دکمه‌ی اصلیِ دانلود می‌نشیند، نه دورِ کلِ اپ: جرقه باید معنیِ
 * «شد» بدهد؛ اگر هر کلیکِ صفحه جرقه بزند، دیگر هیچ‌چیز نمی‌گوید.
 */
export default function ClickSpark({
  children,
  color = 'var(--accent)',
  count = 8,
  radius = 26,
  duration = 420,
  className = '',
}: {
  children: ReactNode
  color?: string
  count?: number
  /** تا کجا برود — پیکسل */
  radius?: number
  /** میلی‌ثانیه */
  duration?: number
  className?: string
}) {
  const hostRef = useRef<HTMLSpanElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sparks = useRef<{ x: number; y: number; angle: number; born: number }[]>([])
  const raf = useRef(0)

  // رنگ ممکن است متغیرِ CSS باشد؛ canvas متغیرِ CSS نمی‌فهمد و باید مقدارِ
  // محاسبه‌شده‌اش را از خودِ عنصر پرسید
  const resolveColor = () => {
    const el = hostRef.current
    if (!el || !color.startsWith('var(')) return color
    const name = color.slice(4, -1).split(',')[0].trim()
    return getComputedStyle(el).getPropertyValue(name).trim() || '#fff'
  }

  useEffect(() => {
    const canvas = canvasRef.current
    const host = hostRef.current
    if (!canvas || !host) return

    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const { width, height } = host.getBoundingClientRect()
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(host)
    return () => ro.disconnect()
  }, [])

  const draw = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const now = performance.now()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr)

    sparks.current = sparks.current.filter((s) => now - s.born < duration)

    ctx.strokeStyle = resolveColor()
    ctx.lineCap = 'round'
    ctx.lineWidth = 2

    for (const s of sparks.current) {
      const p = (now - s.born) / duration
      const eased = 1 - Math.pow(1 - p, 3)
      const start = radius * eased
      const end = start + 8 * (1 - p)
      ctx.globalAlpha = 1 - p
      ctx.beginPath()
      ctx.moveTo(s.x + Math.cos(s.angle) * start, s.y + Math.sin(s.angle) * start)
      ctx.lineTo(s.x + Math.cos(s.angle) * end, s.y + Math.sin(s.angle) * end)
      ctx.stroke()
    }
    ctx.globalAlpha = 1

    // حلقه فقط تا وقتی زنده است که چیزی برای رسم باشد
    if (sparks.current.length) raf.current = requestAnimationFrame(draw)
    else raf.current = 0
  }

  const spark = (e: React.MouseEvent<HTMLElement>) => {
    const host = hostRef.current
    if (!host || reducedMotion()) return

    const rect = host.getBoundingClientRect()
    // کلیک با صفحه‌کلید مختصات ندارد؛ آن‌وقت از وسطِ دکمه می‌زند
    const x = e.clientX ? e.clientX - rect.left : rect.width / 2
    const y = e.clientY ? e.clientY - rect.top : rect.height / 2
    const born = performance.now()

    for (let i = 0; i < count; i++) {
      sparks.current.push({ x, y, angle: (i / count) * Math.PI * 2, born })
    }
    if (!raf.current) raf.current = requestAnimationFrame(draw)
  }

  // صفر کردن هم لازم است نه فقط لغو کردن: `spark` از روی همین عدد می‌فهمد
  // حلقه‌ای در کار هست یا نه، و یک شناسه‌ی مرده‌ی جامانده یعنی جرقه‌ی بعدی
  // هیچ‌وقت شروع نمی‌شود
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current)
      raf.current = 0
    },
    [],
  )

  if (reducedMotion()) return <span className={className}>{children}</span>

  return (
    <span ref={hostRef} className={`relative inline-flex ${className}`} onClickCapture={spark}>
      {children}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10"
      />
    </span>
  )
}

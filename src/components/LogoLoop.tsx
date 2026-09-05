import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { dirSign, reducedMotion } from '../lib/motion'

/**
 * نوارِ بی‌پایانِ لوگوها — از reactbits.dev/components/logo-loop.
 *
 * دنباله‌ی بچه‌ها آن‌قدر تکرار می‌شود که عرضِ ظرف پر شود، بعد کلِ ریل با
 * `translateX` می‌لغزد و هر بار که یک دنباله‌ی کامل رد شد، افست به عقب پیچانده
 * می‌شود. چون همیشه دستِ‌کم یک دنباله‌ی اضافه جلوتر رندر شده، پیچاندن دیده
 * نمی‌شود.
 *
 * چهار تفاوت با نسخه‌ی اصلی، هر چهار به‌خاطرِ همین اپ:
 *
 * ۱. جهت از `dir` صفحه می‌آید. در فارسی نوار باید به همان سمتی برود که چشم
 *    می‌خواند، وگرنه حس می‌کنی محتوا دارد عقب‌عقب می‌رود.
 * ۲. محوشدنِ لبه‌ها با `mask` است نه با گرادیانی هم‌رنگِ پس‌زمینه. هیرو زیرِ
 *    این نوار هاله‌ی رنگی و بلور دارد؛ یک نوارِ توپُرِ هم‌رنگ آن‌جا مثل وصله
 *    دیده می‌شد.
 * ۳. وقتی تب پنهان است یا انیمیشن از دیدِ کاربر بیرون رفته، حلقه می‌ایستد.
 *    این نوار روی صفحه‌ی خانه‌ی یک اپِ موبایل زندگی می‌کند؛ یک `rAF` دائمی
 *    یعنی باتری.
 * ۴. با «حرکتِ کمتر» اصلاً حلقه‌ای در کار نیست — همان یک دنباله، ثابت.
 */
export default function LogoLoop({
  children,
  /** پیکسل بر ثانیه */
  speed = 34,
  gap = 8,
  pauseOnHover = true,
  fade = true,
  ariaLabel,
  className = '',
}: {
  children: ReactNode
  speed?: number
  gap?: number
  pauseOnHover?: boolean
  fade?: boolean
  ariaLabel?: string
  className?: string
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const seqRef = useRef<HTMLUListElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [copies, setCopies] = useState(1)
  const paused = useRef(false)
  // بیرونِ افکت زندگی می‌کند تا با هر بار سوارشدنِ دوباره‌ی حلقه (مثلاً تغییرِ
  // عرضِ پنجره و در نتیجه تعدادِ کپی‌ها) نوار از اول نپرد
  const offsetRef = useRef(0)
  const still = reducedMotion()

  /*
   * چند تا کپی لازم است.
   *
   * `useLayoutEffect` چون بینِ اندازه‌گیری و نقاشی نباید فریمی فاصله بیفتد؛
   * وگرنه اولین فریم یک نوارِ نصفه‌خالی است.
   */
  useLayoutEffect(() => {
    const measure = () => {
      const seq = seqRef.current?.getBoundingClientRect().width ?? 0
      const view = viewportRef.current?.getBoundingClientRect().width ?? 0
      if (!seq) return
      // یکی برای پرکردنِ قاب، یکی برای این‌که لحظه‌ی پیچاندن جای خالی نماند
      setCopies(still ? 1 : Math.ceil(view / seq) + 1)
    }

    measure()
    const ro = new ResizeObserver(measure)
    if (viewportRef.current) ro.observe(viewportRef.current)
    if (seqRef.current) ro.observe(seqRef.current)
    document.fonts?.ready.then(measure).catch(() => {})
    // عوض‌شدنِ خودِ بچه‌ها لازم نیست وابستگی باشد: `ResizeObserver` روی دنباله
    // نشسته و هر تغییرِ عرضی را خودش می‌گیرد
    return () => ro.disconnect()
  }, [still])

  useEffect(() => {
    if (still) return

    const track = trackRef.current
    const viewport = viewportRef.current
    if (!track || !viewport) return

    let raf = 0
    let last = 0
    let visible = true

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
    })
    io.observe(viewport)

    const step = (now: number) => {
      raf = requestAnimationFrame(step)
      const dt = last ? Math.min(now - last, 64) : 0
      last = now

      if (paused.current || !visible || document.hidden) return

      const seq = seqRef.current?.getBoundingClientRect().width ?? 0
      if (!seq) return

      offsetRef.current = (offsetRef.current + (speed * dt) / 1000) % seq
      // در راست‌به‌چپ نوار به سمتِ مثبت می‌رود؛ محتوای تازه از چپ می‌آید و به
      // راست می‌رود، یعنی همان‌جهتی که چشم می‌خواند
      track.style.transform = `translate3d(${-dirSign() * offsetRef.current}px, 0, 0)`
    }

    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
    }
  }, [speed, still, copies])

  const sequence = (ref?: React.Ref<HTMLUListElement>, key?: number) => (
    <ul
      key={key}
      ref={ref}
      aria-hidden={key !== undefined && key > 0}
      className="flex shrink-0 list-none items-center"
      style={{ gap, paddingInlineEnd: gap }}
    >
      {children}
    </ul>
  )

  return (
    <div
      ref={viewportRef}
      className={`relative overflow-hidden ${className}`}
      aria-label={ariaLabel}
      role={ariaLabel ? 'group' : undefined}
      onMouseEnter={() => (paused.current = pauseOnHover)}
      onMouseLeave={() => (paused.current = false)}
      style={
        fade
          ? {
              maskImage:
                'linear-gradient(to right, transparent, #000 24px, #000 calc(100% - 24px), transparent)',
              WebkitMaskImage:
                'linear-gradient(to right, transparent, #000 24px, #000 calc(100% - 24px), transparent)',
            }
          : undefined
      }
    >
      <div ref={trackRef} className="flex w-max items-center will-change-transform">
        {sequence(seqRef, 0)}
        {Array.from({ length: Math.max(0, copies - 1) }, (_, i) => sequence(undefined, i + 1))}
      </div>
    </div>
  )
}

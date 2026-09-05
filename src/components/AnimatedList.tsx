import { useLayoutEffect, useRef, type ElementType, type ReactNode } from 'react'
import { gsap } from 'gsap'
import { reducedMotion } from '../lib/motion'

/**
 * ردیف‌هایی که یکی‌یکی می‌آیند — الهام از reactbits.dev/components/animated-list.
 *
 * نسخه‌ی اصلی یک لیستِ کاملِ آماده است: ظرفِ اسکرول، انتخابِ آیتم، ناوبری با
 * صفحه‌کلید و محوشدنِ لبه‌ها. هیچ‌کدام این‌جا به کار نمی‌آید — ردیف‌های جستجو و
 * کتابخانه خودشان `TrackRow`ـاند با معناشناسی و کنش‌های خودشان — و جایگزین
 * کردنشان یعنی دور ریختنِ چیزی که کار می‌کند. پس فقط همان چیزی برداشته شده که
 * واقعاً ارزش داشت: ورودِ پلکانی.
 *
 * سه تصمیم که نسخه‌ی اصلی ندارد و این‌جا لازم بود:
 *
 * ۱. هر ردیف با `data-anim` علامت می‌خورد و فقط یک بار ظاهر می‌شود. این لیست
 *    داخلِ کامپوننتی است که با هر پخش/توقف دوباره رندر می‌شود؛ بدونِ آن علامت،
 *    زدنِ دکمه‌ی پخش کلِ لیست را از صفر محو و ظاهر می‌کرد.
 * ۲. ردیف‌های پایین‌تر با `IntersectionObserver` منتظر می‌مانند. لیستِ صدتاییِ
 *    کتابخانه وگرنه صد تویینِ هم‌زمان می‌ساخت که ۹۰تایش را کسی نمی‌بیند.
 * ۳. علامت دو حالت دارد نه یکی: `pending` (پنهان، منتظرِ نوبت) و `shown`.
 *
 * حالتِ `pending` جدا شمرده می‌شود چون ناظر ممکن است دوباره ساخته شود، و
 * ردیف‌هایی که هنوز نوبتشان نرسیده باید به ناظرِ تازه سپرده شوند. در حالتِ
 * توسعه `StrictMode` دقیقاً همین کار را می‌کند — افکت را برمی‌چیند و دوباره
 * سوار می‌کند — و بارِ اول همین از قلم افتاد: ردیف‌ها پنهان می‌شدند و ناظرِ
 * برچیده‌شده دیگر هیچ‌وقت نشانشان نمی‌داد. یعنی یک لیستِ خالی.
 *
 * با «حرکتِ کمتر» هیچ‌چیز مخفی نمی‌شود؛ لیست همان‌طور که هست رندر می‌شود.
 */

const PENDING = 'pending'
const SHOWN = 'shown'

export default function AnimatedList({
  children,
  as,
  className = '',
  /** فاصله‌ی ورودِ دو ردیفِ پشتِ‌هم — ثانیه */
  stagger = 0.045,
  duration = 0.4,
  /** چند پیکسل از پایین بالا بیاید */
  y = 10,
}: {
  children: ReactNode
  as?: ElementType
  className?: string
  stagger?: number
  duration?: number
  y?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const io = useRef<IntersectionObserver | null>(null)
  const fallback = useRef<number | null>(null)
  const Tag = (as ?? 'div') as ElementType

  // تنظیمات داخلِ ref می‌نشینند تا ناظر یک بار ساخته شود و با عوض شدنِ یک عددِ
  // انیمیشن، وسطِ کار برچیده نشود
  const opts = useRef({ stagger, duration, y })
  opts.current = { stagger, duration, y }

  useLayoutEffect(() => {
    if (reducedMotion()) return

    const observer = new IntersectionObserver(
      (entries) => {
        const batch = entries.filter((e) => e.isIntersecting).map((e) => e.target as HTMLElement)
        if (!batch.length) return
        batch.forEach((el) => {
          observer.unobserve(el)
          el.dataset.anim = SHOWN
        })
        gsap.to(batch, {
          opacity: 1,
          y: 0,
          duration: opts.current.duration,
          stagger: opts.current.stagger,
          ease: 'power2.out',
          // استایلِ درون‌خطی باید بعدِ کار برود: یک `transform`ِ باقی‌مانده روی
          // ردیف، هر `position: fixed`ِ داخلش (منو، شیت) را به خودش میخ می‌کند
          clearProps: 'opacity,transform',
        })
      },
      // کمی زودتر از رسیدنِ کاربر، تا ردیف در حالِ ظاهر شدن وارد کادر شود نه
      // بعد از این‌که رسیده‌ایم به آن
      { rootMargin: '0px 0px 15% 0px' },
    )

    io.current = observer

    /*
     * ردیف‌هایی که از ناظرِ قبلی جا مانده‌اند.
     *
     * بدونِ این، هر بار که این افکت دوباره سوار شود یک لیستِ کاملِ نامرئی باقی
     * می‌ماند: ردیف‌ها پنهان شده‌اند ولی ناظری که قرار بود نشانشان بدهد دیگر
     * وصل نیست.
     */
    const root = ref.current
    if (root) {
      for (const child of root.children) {
        if (child instanceof HTMLElement && child.dataset.anim === PENDING) observer.observe(child)
      }
    }

    return () => {
      if (fallback.current !== null) window.clearTimeout(fallback.current)
      observer.disconnect()
      io.current = null
    }
  }, [])

  /*
   * بدونِ آرایه‌ی وابستگی: هر رندر ممکن است ردیفِ تازه‌ای آورده باشد.
   *
   * `useLayoutEffect` است نه `useEffect` چون پنهان‌کردن باید پیش از نقاشی
   * انجام شود؛ وگرنه ردیف یک فریم با اندازه‌ی کامل دیده می‌شود و بعد می‌پرد
   * به حالتِ پنهان — همان پرشی که قرار بود نباشد.
   */
  const seen = useRef(0)
  useLayoutEffect(() => {
    const root = ref.current
    const observer = io.current
    if (!root || !observer) return

    /*
     * تایمرِ امانی — باگِ «ردیف‌های شبح».
     *
     * ناظر همیشه فایر نمی‌شود: در هدلس (اسکرین‌شات/تست E2E) با زمانِ مجازی، و
     * گاهی وسطِ تعویضِ ناظر، ردیفِ درِ دید پنهان می‌ماند و هیچ‌وقت نشان داده
     * نمی‌شود. دو ثانیه بعد، هر ردیفِ pending که واقعاً در کادر است اجباری
     * ظاهر می‌شود؛ ردیف‌های دورترِ فولد حقِ انتظار برای انیمیشنِ اسکرول را
     * نگه می‌دارند.
     *
     * قبلاً این بلوک پایین‌تر و «پیش از راهِ فرارِ ارزان» بود. آن جای‌گذاری
     * خودش باگ داشت: در `StrictMode` پاک‌سازیِ دورِ اول، تایمرِ دورِ دوم را
     * می‌کشت و راهِ فرارِ ارزان (لیستِ بدونِ تغییر) هرگز دوباره‌اش نمی‌ساخت —
     * یعنی تایمرِ نجات در حالتِ توسعه عملاً مرده بود. حالا شرطِ «ردیفِ
     * pending وجود دارد» راهِ فرار را باز می‌کند و تایمر در هر دو حالت
     * (اولین رندر و رندرهای بعدی) همیشه دوباره armed می‌شود.
     */
    const hasPending = () =>
      [...root.children].some(
        (c) => c instanceof HTMLElement && c.dataset.anim === PENDING,
      )

    const armFallback = () => {
      window.clearTimeout(fallback.current ?? undefined)
      fallback.current = window.setTimeout(() => {
        const vh = window.innerHeight
        const stuck: HTMLElement[] = []
        for (const child of root.children) {
          if (!(child instanceof HTMLElement) || child.dataset.anim !== PENDING) continue
          const r = child.getBoundingClientRect()
          if (r.top < vh * 1.15 && r.bottom > -vh * 0.15) stuck.push(child)
        }
        if (!stuck.length) return
        stuck.forEach((el) => (el.dataset.anim = SHOWN))
        // ستِ هم‌زمان، نه tween: تایمرِ امانی با `setTimeout` می‌آید و در محیط
        // تست (تایمرِ مجازی) rAFِ gsap ممکن است هرگز تیک نخورد — آن‌وقت
        // ردیف‌ها علامتِ shown می‌گیرند ولی opacity صفر می‌ماند. اینجا نجات
        // باید قطعی باشد؛ انیمیشنِ نرمِ ناظر سرِ جایش باقی است.
        gsap.set(stuck, { opacity: 1, y: 0, clearProps: 'opacity,transform' })
      }, 2000)
    }

    armFallback()

    /*
     * راهِ فرارِ ارزان.
     *
     * لیستِ کتابخانه صدها ردیف دارد و این کامپوننت با هر انتخاب/لغوِ انتخاب
     * دوباره رندر می‌شود. تا وقتی نه تعداد عوض شده، نه سر و تهِ لیست، و نه
     * ردیفِ pendingی باقی مانده، هیچ کارِ تازه‌ای در کار نیست و پیمایشِ کلِ
     * لیست فقط هزینه است.
     *
     * سر و ته هم چک می‌شوند چون فیلترِ درونِ کتابخانه می‌تواند لیست را با همان
     * تعداد ولی محتوای دیگر عوض کند؛ آن‌وقت گره‌های تازه هیچ علامتی ندارند و
     * همین دو تا لو می‌دهند که باید کلِ لیست را دید.
     */
    const head = root.firstElementChild as HTMLElement | null
    const tail = root.lastElementChild as HTMLElement | null
    if (root.children.length === seen.current && head?.dataset.anim && tail?.dataset.anim && !hasPending())
      return
    seen.current = root.children.length

    for (const child of root.children) {
      if (!(child instanceof HTMLElement) || child.dataset.anim) continue
      child.dataset.anim = PENDING
      gsap.set(child, { opacity: 0, y: opts.current.y })
      observer.observe(child)
    }

    // ردیف‌های تازه‌ی pending هم مستحقِ تایمرِ نجات‌اند؛ دوباره armed می‌شود
    if (hasPending()) armFallback()
  })

  return (
    <Tag ref={ref} className={className}>
      {children}
    </Tag>
  )
}

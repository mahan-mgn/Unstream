import { useCallback, useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { useI18n } from '../lib/i18n'
import { reducedMotion } from '../lib/motion'
import { haptic } from '../lib/native'
import { HomeIcon, LibraryIcon, SearchIcon, StatsIcon } from './icons'

/**
 * ناوبریِ پایینِ صفحه — فقط روی گوشی.
 *
 * روی دسکتاپ همین چهار مقصد در هدر کنارِ هم‌اند و تب‌بار فقط فضا می‌گرفت. روی
 * گوشی برعکس: بالای صفحه از همه‌جا دورتر است و کاربر با یک دست نمی‌رسد بهش،
 * برای همین هر اپ موبایلیِ جدی مقصدهای اصلی‌اش را پایین می‌گذارد.
 *
 * «جستجو» عمداً صفحه‌ی جدا نیست: خودِ سرچ‌بارِ هدر با فوکوس‌شدن تاریخچه و
 * پیشنهادها را باز می‌کند، و ساختنِ یک صفحه‌ی دومِ جستجو یعنی دو مسیرِ موازی
 * که باید هم‌زمان نگه داشته شوند.
 */

export type Tab = 'home' | 'search' | 'library' | 'stats'

interface Props {
  active: Tab
  onHome: () => void
  onLibrary: () => void
  onStats: () => void
  onSearch: () => void
}

/**
 * فاصله‌ی لنز از لبه‌ی خانه‌ی تب. تلگرام لنزِ انتخاب را چند پیکسل داخل‌تر از
 * خودِ تب می‌کشد (liftedInset/inset در LiquidLensView) تا لبه‌ی کپسول دیده شود.
 */
const LENS_PAD = 3

/** حالتِ فنرِ لنز — x موقعیتِ فعلی، v سرعت، target مقصد، origin نقطه‌ی شروعِ پرش */
export interface SpringState {
  x: number
  v: number
  target: number
  origin: number
}

/**
 * یک گامِ فنرِ جرم-فنر-میراگر با عددِ رسمیِ مسابقه‌ی تلگرام:
 * سختی k=150، میرایی c=12، جرم m=1 → نسبتِ میرایی ~۰٫۴۹، یعنی فنری که حدودِ
 * دو بار نوسان می‌کند و می‌نشیند (Telegram-iOS-Contest «Spring Dynamics»).
 *
 * a = (-k·(x−target) − c·v) / m   →   v += a·dt   →   x += v·dt
 *
 * خروجی `true` یعنی نشست (همگرایی)؛ آن‌گاه دقیقاً روی target قفل می‌شود تا
 * لرزشِ باقی‌مانده جا نماند. تابع خالص است — بدون DOM — تا قابلِ تست باشد.
 */
export function integrateSpring(s: SpringState, dt: number, k = 150, c = 12): boolean {
  const a = -k * (s.x - s.target) - c * s.v
  s.v += a * dt
  s.x += s.v * dt
  if (Math.abs(s.target - s.x) < 0.4 && Math.abs(s.v) < 2) {
    s.x = s.target
    s.v = 0
    return true
  }
  return false
}

export default function TabBar({ active, onHome, onLibrary, onStats, onSearch }: Props) {
  const { t } = useI18n()
  const ulRef = useRef<HTMLUListElement>(null)
  const lensRef = useRef<HTMLLIElement>(null)
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([])
  const rafRef = useRef(0)
  const springRef = useRef<SpringState>({ x: 0, v: 0, target: 0, origin: 0 })
  // اولین جای‌گذاری بدونِ انیمیشن است؛ بعد از آن تعویضِ تب فنر می‌خورد
  const didInit = useRef(false)

  const tabs = [
    { key: 'home' as const, label: t.home, Icon: HomeIcon, run: onHome },
    { key: 'search' as const, label: t.search, Icon: SearchIcon, run: onSearch },
    { key: 'library' as const, label: t.library, Icon: LibraryIcon, run: onLibrary },
    { key: 'stats' as const, label: t.stats, Icon: StatsIcon, run: onStats },
  ]
  const activeIndex = Math.max(0, tabs.findIndex((tb) => tb.key === active))

  /**
   * لنز را اندازه می‌گیرد و به خانه‌ی تبِ فعال می‌برد.
   *
   * موقعیت از `getBoundingClientRect` می‌آید، پس پیکسلِ *فیزیکی* است و در RTL
   * خود‌به‌خود درست است — برخلافِ translateXِ منطقی که در فارسی وارونه می‌شد.
   * اندازه‌ی لنز آنی ست می‌شود (تب‌ها همه هم‌عرض‌اند)؛ فقط x فنر می‌خورد.
   */
  const place = useCallback(
    (animate: boolean) => {
      const ul = ulRef.current
      const lens = lensRef.current
      const btn = btnRefs.current[activeIndex]
      if (!ul || !lens || !btn) return
      const u = ul.getBoundingClientRect()
      const b = btn.getBoundingClientRect()
      if (!b.width) return // هنوز چیده نشده (jsdom / قبلِ layout)

      const w = b.width - LENS_PAD * 2
      const h = b.height - LENS_PAD * 2
      const x = b.left - u.left + LENS_PAD
      gsap.set(lens, { width: w, height: h })

      const s = springRef.current
      if (!animate || reducedMotion()) {
        cancelAnimationFrame(rafRef.current)
        s.x = x
        s.v = 0
        s.target = x
        s.origin = x
        gsap.set(lens, { x, y: 0, scaleX: 1, scaleY: 1 })
        return
      }

      s.origin = s.x
      s.target = x
      cancelAnimationFrame(rafRef.current)
      let last = performance.now()
      const tick = (now: number) => {
        // dt سقف دارد: تعویضِ تب یا بازگشت از پس‌زمینه یک جهشِ بزرگِ زمان می‌دهد
        // و بدونِ سقف، فنر منفجر می‌شود (x به بی‌نهایت پرتاب می‌شود)
        const dt = Math.min((now - last) / 1000, 1 / 30)
        last = now
        const settled = integrateSpring(s, dt)

        if (settled) {
          gsap.set(lens, { x: s.x, y: 0, scaleX: 1, scaleY: 1 })
          return
        }

        // کشسانیِ حجم‌پای: هرچه سریع‌تر، کشیده‌تر (تلگرام: stretch=1+|v|·ضریب).
        // v پیکسل/ثانیه است؛ تقسیم بر ۶۰ آن را به پیکسل/فریمِ تلگرام می‌برد.
        const vel = Math.abs(s.v) / 60
        const stretch = 1 + Math.min(vel * 0.01, 0.12)
        // قوسِ سهمیِ پرش: در میانه‌ی مسیر اوج می‌گیرد (sin(prog·π))، در دو سر صفر.
        // سقفِ 3px چون overflow-hiddenِ کپسول بیشتر را می‌بُرد.
        const span = Math.abs(s.target - s.origin) || 1
        const prog = Math.min(Math.max((s.x - s.origin) / (s.target - s.origin || 1), 0), 1)
        const lift = Math.min(span * 0.06, 3) * Math.sin(prog * Math.PI)
        gsap.set(lens, { x: s.x, y: -lift, scaleX: stretch, scaleY: 1 / stretch })
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    },
    [activeIndex],
  )

  // با هر تعویضِ تب: اولین بار آنی، بعد فنری
  useEffect(() => {
    place(didInit.current)
    didInit.current = true
  }, [place])

  // تغییرِ عرضِ پنجره و رسیدنِ فونت: اندازه‌ها عوض می‌شوند، بی‌انیمیشن از نو
  useEffect(() => {
    const onResize = () => place(false)
    window.addEventListener('resize', onResize)
    document.fonts?.ready.then(onResize).catch(() => {})
    return () => window.removeEventListener('resize', onResize)
  }, [place])

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  return (
    <nav
      aria-label={t.brand}
      // شناور مثلِ تلگرام: خودِ nav فقط یک لایه‌ی موقعیتِ شفاف است و کپسولِ
      // شیشه‌ای داخلش با فاصله از لبه‌ها و از نوارِ خانه معلق است — محتوا از
      // زیرش رد می‌شود و بلور زنده دیده می‌شود. max(0.75rem, safe-b) یعنی روی
      // آیفونِ ناچ‌دار کپسول بالای خطِ خانه می‌نشیند، نه زیرش.
      className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,var(--safe-b))] sm:hidden"
    >
      {/*
        کپسولِ شیشه‌یِ «ساکن». داخلش یک لنزِ جداگانه (li.tabbar-lens) با فنر
        بینِ تب‌ها سُر می‌خورد. overflow-hidden لنز را به گوشه‌های گردِ کپسول
        می‌بُرد؛ relative لنگرِ مطلقِ لنز است. tabbar-shell سایه‌ی معلقِ نرمِ
        تلگرام را می‌دهد.
      */}
      <ul
        ref={ulRef}
        className="glass tabbar-shell relative mx-auto flex h-14 max-w-md items-stretch overflow-hidden rounded-full"
      >
        <li
          ref={lensRef}
          aria-hidden="true"
          className="tabbar-lens pointer-events-none absolute top-[3px] left-0 z-0 block rounded-full"
        />
        {tabs.map(({ key, label, Icon, run }, i) => {
          const on = active === key
          return (
            <li key={key} className="relative z-10 flex-1">
              <button
                ref={(el) => {
                  btnRefs.current[i] = el
                }}
                onClick={() => {
                  // فقط وقتی واقعاً جایی عوض می‌شود؛ لرزشِ بی‌دلیل روی تبِ فعلی
                  // بعد از چند بار آزاردهنده می‌شود
                  if (!on) haptic.select()
                  run()
                }}
                aria-current={on ? 'page' : undefined}
                className="flex size-full flex-col items-center justify-center gap-1"
              >
                {/*
                  برخلافِ نسخه‌ی قدیم دیگر قرصِ رنگیِ جداگانه زیرِ هر تب نیست —
                  انتخاب را همان لنزِ سُر‌خور نشان می‌دهد (امضایِ تلگرام). تبِ
                  فعال فقط رنگِ اکسنت و کمی بزرگ‌نماییِ آیکون می‌گیرد تا «بلند
                  شده» به‌نظر برسد (lift در سورسِ تلگرام).
                */}
                <span
                  className={`grid h-7 w-12 place-items-center rounded-full transition-transform duration-200 ${
                    on ? 'scale-[1.07] text-accent' : 'text-muted'
                  }`}
                >
                  <Icon className="size-5" />
                </span>
                <span
                  className={`text-[10px] leading-none transition-colors ${
                    on ? 'font-semibold text-accent' : 'text-muted'
                  }`}
                >
                  {label}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

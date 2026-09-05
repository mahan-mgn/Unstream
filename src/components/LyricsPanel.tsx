import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { engine } from '../lib/audioEngine'
import { useI18n } from '../lib/i18n'
import {
  activeLyricIndex,
  activeWordIndex,
  lineEndTime,
  lineProgress,
  wordProgress,
  type LyricLine,
} from '../lib/lrc'
import { haptic } from '../lib/native'

/**
 * نمای کارائوکه‌ی متن آهنگ.
 *
 * چهار چیز این را از «متنِ هایلایت‌شده‌ی» قبلی جدا می‌کند:
 *
 *  ۱. **متنِ کامل، پیوسته.** همه‌ی خط‌ها یک‌جا رندر می‌شوند؛ هیچ پنجره‌ی
 *     برشی وسط متن نیست و کاربر می‌تواند بالا و پایینِ آهنگ را ببیند و
 *     اسکرول کند.
 *
 *  ۲. **پیشرویِ کلمه‌به‌کلمه.** LRC استاندارد فقط زمانِ *شروعِ خط* را دارد،
 *     پس پیشرفتِ داخلِ خط را از خودِ آهنگ می‌گیریم: خطِ فعلی تا خطِ بعدی
 *     فرصت دارد و رنگ روی کلمه‌ها به همان اندازه کشیده می‌شود. اگر فایل،
 *     LRC تقویت‌شده با تگ‌های ‎<mm:ss.xx>‎ باشد، هر کلمه‌ی خطِ فعال گرادیانِ
 *     خودش را دارد و دقیقاً سرِ لحظه‌ی خودش پر می‌شود — مثلِ اپل‌موزیک.
 *     جهتِ کشیدن هم با جهتِ متن می‌آید — فارسی از راست، انگلیسی از چپ.
 *
 *  ۳. **عمق.** خط‌های بیرون از تمرکز محو (blur) و تیره‌اند؛ خطِ فعال با یک
 *     گذارِ نرم تیز و درشت می‌شود. چشم بدونِ جستجو می‌فهمد کجاست.
 *
 *  ۴. **۶۰ فریم بدونِ ۶۰ رندرِ ری‌اکت.** موقعیتِ پخش از `timeupdate` فقط
 *     چهار بار در ثانیه می‌آید — برای کشیدنِ رنگ خیلی درشت است. پس حلقه‌ی
 *     rAF زمانِ *واقعیِ* صوت را از خودِ `<audio>` می‌خواند و فقط *یک* متغیرِ
 *     CSS روی *همان یک* نودِ فعال می‌نویسد. state ری‌اکت تنها وقتی عوض می‌شود
 *     که خودِ خط عوض شده باشد.
 *
 * ژست: کلیک/انگشت روی هر خط = پرش به همان لحظه — همان کاری که اسپاتیفای
 * و اپل‌موزیک می‌کنند.
 */

/**
 * متنِ فارسی/عربی از راست خوانده می‌شود و رنگ هم باید از همان‌جا بیاید.
 * تشخیص با بازه‌ی یونیکدِ خودِ خط است نه زبانِ رابط — یک آهنگِ فارسی ممکن
 * است یک خطِ انگلیسی وسطش داشته باشد و برعکس.
 */
function isRtl(text: string): boolean {
  return /[؀-ۿݐ-ݿ]/.test(text)
}

interface Props {
  lines: LyricLine[]
  /** ثانیه — position استور؛ برای مقدارِ اولیه‌ی رنگ قبلِ اولین فریم */
  position: number
  /** ثانیه‌ی پایانِ ترک — برای کشیدنِ خطِ آخر */
  trackEnd: number
  onSeek: (seconds: number) => void
}

export default function LyricsPanel({ lines, position, trackEnd, onSeek }: Props) {
  const { t } = useI18n()
  const scrollRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([])
  /** خطِ فعالِ رندرشده؛ حلقه‌ی rAF این را با زمانِ واقعیِ صوت به‌روز می‌کند */
  const [active, setActive] = useState(() => activeLyricIndex(lines, engine.currentTime()))

  // با تعویض ترک (آرایه‌ی جدید) ایندکس از سر حساب می‌شود
  useEffect(() => {
    setActive(activeLyricIndex(lines, engine.currentTime()))
  }, [lines])

  /*
   * حلقه‌ی زمانِ واقعی.
   *
   * در حالتِ خط‌به‌خط: متغیرِ `--p` روی نودِ خطِ فعال. در حالتِ کلمه‌به‌کلمه:
   * متغیرِ `--wp` روی نودِ *کلمه‌ی* فعال (خطِ فعال را هم که `--p` می‌گیرد
   * تا گذارِ blur→sharp فارغ از حالت کار کند). نوشتنِ مستقیمِ DOM عمدی است:
   * شصت setState در ثانیه کلِ شیت را رندر می‌کرد و روی گوشی‌های میان‌رده
   * همان باعثِ لگِ محسوس می‌شد.
   */
  useEffect(() => {
    if (lines.length === 0) return
    let raf = 0
    let last = -2
    /** ایندکسِ کلمه‌ی فعالِ فریمِ قبل — تا نوشتنِ spanها فقط با تعویضِ کلمه */
    let lastWord = -2

    const tick = () => {
      const now = engine.currentTime()
      const idx = activeLyricIndex(lines, now)
      const line = lineRefs.current[idx]
      if (line) {
        const words = idx >= 0 && idx < lines.length ? lines[idx].words : undefined
        if (!words) {
          line.style.setProperty('--p', String(lineProgress(lines, idx, now, trackEnd)))
        } else {
          // خطِ کلمه‌ای: `--p` خط کامل می‌ماند تا گرادیانِ پشتیبانِ خط همیشه
          // سرِ جایش باشد؛ پرشدنِ واقعی کارِ `--wp` روی هر span است
          line.style.setProperty('--p', '1')
          const w = activeWordIndex(words, now)
          if (w !== lastWord) {
            // با تعویضِ کلمه (یا پرش به عقب/جلو) همه‌ی spanها را یکجا
            // منظم کن: قبل از w پر، بعد از w خالی — صفحه‌قلمِ هر فریم فقط
            // همین لحظه است، پس این حلقه چند بار در خط رخ می‌دهد نه هر فریم
            const spans = line.querySelectorAll<HTMLElement>('[data-word]')
            for (let i = 0; i < spans.length; i++) {
              spans[i].style.setProperty('--wp', i < w ? '1' : '0')
            }
            lastWord = w
          }
          if (w >= 0) {
            const node = line.querySelectorAll<HTMLElement>('[data-word]')[w]
            node?.style.setProperty(
              '--wp',
              String(wordProgress(words, w, now, lineEndTime(lines, idx, trackEnd))),
            )
          }
        }
      }
      if (idx !== last) {
        lastWord = -2
        last = idx
        setActive(idx)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [lines, trackEnd])

  /*
   * خطِ فعال وسطِ پنل بماند — فقط با تعویضِ خط، وگرنه اسکرولِ دستی هر لحظه ریست می‌شد.
   *
   * `scrollIntoView` عمداً اینجا نیست: آن روش *همه* جدرهای اسکرول‌پذیر را
   * جابه‌جا می‌کند، از جمله خودِ شیتِ مودال (که `overflow-hidden` است ولی باز
   * هم از نظر برنامه‌ای ظرفیتِ اسکرول دارد). نتیجه‌اش این بود که با هر خطِ
   * تازه، کلِ شیت بالا می‌رفت و هدر/اسمِ هنرمند روی متن و کنترل‌ها زیرِ متن
   * می‌افتاد. این‌جا فقط و فقط ظرفِ خودش اسکرول می‌شود.
   */
  useEffect(() => {
    const pane = scrollRef.current
    const line = lineRefs.current[active]
    if (!pane || !line) return
    const target = line.offsetTop + line.offsetHeight / 2 - pane.clientHeight / 2
    pane.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
  }, [active])

  return (
    <div
      ref={scrollRef}
      /*
       * `absolute inset-0` نه `h-full`: والدِ flex ارتفاعش از max-heightِ
       * شیت می‌آید و برای مرورگر «نامعین» است — درصدِ ارتفاع در آن حالت به
       * auto برمی‌گردد و پنل به ارتفاعِ محتوا رشد می‌کرد و روی عنوان و
       * کنترل‌ها می‌افتاد. جای‌گذاریِ مطلق در والدِ relative از درصد بی‌نیاز است.
       *
       * همه‌ی خط‌ها یک‌جا رندر می‌شوند (بدونِ پنجره‌ی اطرافِ خطِ فعال) تا
       * متنِ کامل پیوسته دیده و اسکرول شود؛ خط‌های غیرِ فعال فقط متنِ ساده‌اند
       * پس DOM سبک می‌ماند. `no-scrollbar` هم نوارِ اسکرول را می‌پوشاند —
       * خودِ خطِ فعال راهنمای «کجا هستیم» است.
       */
      className="lyrics-scroll scroll-pane no-scrollbar absolute inset-0 overflow-y-auto rounded-2xl border border-line-soft bg-panel-2/40 px-4 py-3"
    >
      <div className="space-y-4 py-8">
        {lines.map((line, index) => {
          const isActive = index === active
          return (
            <p
              key={index}
              ref={(el) => {
                lineRefs.current[index] = el
              }}
              dir={isRtl(line.text) ? 'rtl' : 'ltr'}
              role="button"
              tabIndex={0}
              aria-label={t.lyricSeekTo}
              aria-current={isActive ? 'true' : undefined}
              onClick={() => {
                haptic.tap()
                onSeek(line.time)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSeek(line.time)
                }
              }}
              /*
               * `--p` را حلقه‌ی rAF می‌نویسد؛ این‌جا فقط مقدارِ اولیه‌اش از
               * positionِ استور است تا قبلِ اولین فریم هم رنگ درست باشد.
               */
              style={
                isActive
                  ? ({ '--p': lineProgress(lines, index, position, trackEnd) } as CSSProperties)
                  : undefined
              }
              className={`karaoke-line cursor-pointer text-lg leading-8 outline-none transition-[opacity,color,filter,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:ring-2 focus-visible:ring-accent sm:text-xl ${
                isActive
                  ? 'karaoke-active font-bold'
                  : 'text-muted-2 opacity-70'
              }`}
            >
              {renderContent(line, isActive)}
            </p>
          )
        })}
      </div>
    </div>
  )
}

/**
 * محتوای خط: در حالتِ کلمه‌ای، هر کلمه یک `span` با گرادیانِ خودش؛ در حالتِ
 * عادی کلِ متن یک‌جا. `isActive=false` یعنی خطِ محو — کلمه‌ها بدونِ span
 * رندر می‌شوند تا DOM سبک بماند.
 */
function renderContent(line: LyricLine, isActive: boolean): ReactNode {
  if (!line.words || !isActive) return line.text || '♪'
  return line.words.map((w, i) => (
    <span key={i} data-word className="karaoke-word" style={{ '--wp': 0 } as CSSProperties}>
      {w.text}
    </span>
  ))
}

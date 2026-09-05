import { useEffect, useRef, useState } from 'react'
import { dominantColor } from '../lib/artColor'
import { engine } from '../lib/audioEngine'
import { duration as fmtDuration } from '../lib/format'
import { useDialog } from '../lib/useDialog'
import { useSheetDrag } from '../lib/useSheetDrag'
import { useCoverSwipe, type SwipeDir } from '../lib/useCoverSwipe'
import { useIdle } from '../lib/useIdle'
import { COVER_VT, withViewTransition } from '../lib/viewTransition'
import { useI18n } from '../lib/i18n'
import { parseLrc, type LyricLine } from '../lib/lrc'
import { haptic } from '../lib/native'
import { useFavorites } from '../store/favorites'
import { jobIdOf, usePlayer, type PlayItem } from '../store/player'
import AudioSettings from './AudioSettings'
import Artwork, { artBlurUrl } from './Artwork'
import LikeHeart from './LikeHeart'
import LyricsPanel from './LyricsPanel'
import PlayPauseIcon from './PlayPauseIcon'
import Range from './Range'
import SeekBar from './SeekBar'
import SourceBadge from './SourceBadge'
import {
  ChevronIcon,
  CloseIcon,
  LyricsIcon,
  MuteIcon,
  NextIcon,
  PrevIcon,
  QueueIcon,
  RadioIcon,
  RepeatIcon,
  ShuffleIcon,
  SparkleIcon,
  Spinner,
  VolumeIcon,
  WarnIcon,
} from './icons'

type PanelView = 'cover' | 'lyrics' | 'queue'

/**
 * سه حالت متن آهنگ: هنوز نیامده، هیچی پیدا نشده، هم‌زمان‌شده (خط‌به‌خط دنبال
 * می‌شود)، یا ساده — مثلاً از Genius که هیچ‌وقت تایم‌استمپ نمی‌دهد، فقط یک
 * بلوک متن که کامل نشان داده می‌شود.
 */
type LyricsState =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'synced'; lines: LyricLine[] }
  | { kind: 'plain'; text: string }

/** یک ردیف از صف پخش داخل نمای بزرگ — کلیک می‌برد رویش، دکمه‌ی کنار حذفش می‌کند */
function QueueRow({
  item,
  active,
  onPlay,
  onRemove,
}: {
  item: PlayItem
  active: boolean
  onPlay: () => void
  onRemove: () => void
}) {
  const { t } = useI18n()
  return (
    <div
      className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 transition ${
        active ? 'bg-accent-dim' : 'hover:bg-panel'
      }`}
    >
      <button onClick={onPlay} className="flex min-w-0 flex-1 items-center gap-2.5 text-start">
        <div className="relative shrink-0">
          <Artwork
            src={item.track.artworkUrl}
            alt={item.track.album ?? item.track.title}
            seed={item.track.albumId ?? item.track.id}
            className={`size-9 ${active ? 'opacity-40' : ''}`}
          />
          {/*
           * ترکِ فعال به‌جای رنگی‌شدنِ ساده، میله‌های اکولایزرِ متحرک دارد —
           * همان نشانه‌ی «این یکی الان پخش است» که اسپاتیفای می‌زند. کاور زیرش
           * کم‌نور می‌شود تا میله‌ها روی هر رنگی خوانا بمانند.
           */}
          {active && (
            <span
              aria-hidden
              className="absolute inset-0 grid place-items-center"
            >
              <span className="flex h-3.5 items-end gap-[2px]">
                <span className="eq-bar w-[3px] rounded-sm bg-accent" style={{ height: '100%' }} />
                <span className="eq-bar w-[3px] rounded-sm bg-accent" style={{ height: '100%' }} />
                <span className="eq-bar w-[3px] rounded-sm bg-accent" style={{ height: '100%' }} />
              </span>
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className={`bidi truncate text-xs ${active ? 'font-semibold text-accent' : ''}`}>
            {item.track.title}
          </p>
          <p className="bidi truncate text-[11px] text-muted">
            <bdi>{item.track.artist}</bdi>
          </p>
        </div>
      </button>
      <button
        onClick={onRemove}
        aria-label={t.removeFromQueue}
        title={t.removeFromQueue}
        className="hover-reveal grid size-7 shrink-0 place-items-center rounded-md text-muted-2 opacity-0 transition hover:text-fg group-hover:opacity-100"
      >
        <CloseIcon className="size-3" />
      </button>
    </div>
  )
}

/**
 * نمای بزرگِ «در حال پخش» — همان استیت پلیر بار را نشان می‌دهد، فقط با
 * آرت‌ورک درشت و کنترل‌های راحت‌تر برای گوش‌دادن، نه صرفاً کنترل سریع.
 * دو پنل جایگزین هم دارد: متن هم‌زمان‌شده و صف پخش، هردو پشت دکمه‌های سربرگ.
 */
export default function NowPlaying({ onClose }: { onClose: () => void }) {
  const {
    queue,
    index,
    playing,
    position,
    duration,
    volume,
    muted,
    repeat,
    shuffle,
    smartShuffle,
    failed,
    radio,
    radioLoading,
    toggle,
    next,
    prev,
    seek,
    setVolume,
    toggleMute,
    cycleRepeat,
    toggleShuffle,
    toggleSmartShuffle,
    toggleRadio,
    play,
    drop,
  } = usePlayer()
  const { t, lang } = useI18n()
  const [panel, setPanel] = useState<PanelView>('cover')
  const [lyrics, setLyrics] = useState<LyricsState>({ kind: 'loading' })

  /** همان بازخوردِ لمسیِ نوارِ پخش — دلیلش آنجا توضیح داده شده */
  const withTap = (run: () => void) => () => {
    haptic.tap()
    run()
  }

  /*
   * بستن با دکمه یا پس‌زمینه، گذارِ معکوسِ همان بازشدن است: کاور به جای
   * مینی‌پلیر برمی‌گردد. کشیدنِ شیت با انگشت اما از این مسیر نمی‌رود —
   * آن‌جا خودِ شیت با انگشت پایین رفته و یک گذارِ دومِ هم‌زمان فقط دو حرکتِ
   * ناهماهنگ می‌شود.
   */
  const dismiss = () => withViewTransition(onClose)

  // روی دسکتاپ شیت وسطِ صفحه است و کشیدنش به پایین هیچ معنایی ندارد
  const onPhone = typeof window !== 'undefined' && !window.matchMedia('(min-width: 640px)').matches
  const drag = useSheetDrag({ onClose, enabled: onPhone })

  /*
   * قفلِ اسکرول + تله‌ی فوکوس + برگرداندنِ فوکوس + Escape + دکمه‌ی برگشت.
   * قبلاً فقط دوتای اولش این‌جا دستی نوشته شده بود.
   */
  const dialog = useDialog<HTMLDivElement>(true, dismiss)

  const item = queue[index]

  /*
   * کشیدنِ کاور به چپ/راست = ترک بعدی/قبلی — امضای رفتاریِ اسپاتیفای.
   *
   * جهتِ پیش‌نمایش از همین‌جا حساب می‌شود نه از منطقِ `next()` داخل استور:
   * آن‌جا شافل و رادیو ایندکسِ بعدی را نامعلوم می‌کنند، و ما فقط می‌خواهیم
   * «چه چیزی دارد می‌آید» را زیرِ انگشت نشان بدهیم. در حالتِ شافل، کاورِ
   * پیش‌نمایش ممکن است با تحویلِ واقعی فرق کند — قیمتِ ساده‌نگه‌داشتنِ کد است
   * و کاربر هیچ‌وقت متوجه‌اش نمی‌شود چون بینِ دو حرکت یک پروازِ ۲۴۰ms فاصله
   * هست.
   */
  const swipeEnabled = panel === 'cover' && queue.length > 1
  const swipe = useCoverSwipe({
    enabled: swipeEnabled,
    /*
     * `prev()` عمداً اینجا نیست: وسطِ ترک یعنی «از اول همین» و کشیدنِ راست
     * روی همان ترکِ در‌حال‌پخش فرار می‌کند — کاربر انتظارِ «قبلی» دارد نه
     * «از نو». پس ایندکسِ قبلی مستقیم پخش می‌شود (با چرخش به آخرِ صف).
     */
    onSwipe: (dir: SwipeDir) => {
      if (dir === 'next') next()
      else play(queue, (index - 1 + queue.length) % queue.length)
    },
  })
  const peekItem = item
    ? swipe.dir === 'prev'
      ? queue[index - 1] ?? queue[queue.length - 1]
      : queue[index + 1] ?? queue[0]
    : null

  /*
   * حالتِ محیط: بعد از شش ثانیه بی‌کاری، کنترل‌ها محو می‌شوند و فقط کاور و
   * رنگش می‌ماند. فقط روی نمای کاور معنا دارد — توی متن یا صف که کاربر دارد
   * می‌خواند/انتخاب می‌کند، محو‌کردنِ کنترل‌ها مزاحمت است نه زیبایی.
   */
  const idle = useIdle(6000, panel === 'cover')

  /*
   * هاله‌ی هم‌رhythm با صدا.
   *
   * یک لایه‌ی پشتِ کاور که با انرژیِ بمِ لحظه بزرگ و پرنورتر می‌شود. زمانِ
   * واقعیِ صوت از `engine.bassLevel()` خوانده می‌شود و فقط دو متغیرِ CSS روی
   * همان یک نود نوشته می‌شود — دقیقاً همان الگویی که در `LyricsPanel` برای
   * رنگِ کارائوکه رفت: شصت فریم بدونِ شصت رندرِ ری‌اکت.
   *
   * وقتی پخش متوقف است حلقه دو فریمِ آخر را به صفر می‌رساند و می‌خوابد؛
   * نگه‌داشتنِ rAF روی صفحه‌ی ساکت، باتریِ گوشی را بی‌دلیل می‌خورد.
   */
  const glowRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    // هاله فقط در نمای کاور روی صفحه است؛ در پنل متن/صف حلقه را نگردان
    if (!playing || panel !== 'cover') {
      const node = glowRef.current
      if (node) {
        node.style.setProperty('--glow', '0')
      }
      return
    }
    let raf = 0
    let level = 0
    const tick = () => {
      // میانگین‌گیریِ ساده روی خروجیِ analyser که خودش هم smoothing دارد،
      // تا هاله «لرزشِ» فرکانسی نگیرد و ضرب را نرم برساند
      level += (engine.bassLevel() - level) * 0.35
      const node = glowRef.current
      if (node) node.style.setProperty('--glow', level.toFixed(3))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    }, [playing, panel])

  // قلبِ علاقه‌مندی — فقط برای ترک‌هایی که jobId واقعیِ سرور دارند (رادیو
  // بیرون از کتابخانه است و لایک‌کردنش معنایی ندارد)
  const jobId = item ? jobIdOf(item) : null
  const favorite = useFavorites((s) => (jobId ? Boolean(s.items[jobId]) : false))
  const toggleFavorite = useFavorites((s) => s.toggle)

  /*
   * تینتِ پس‌زمینه از رنگِ غالبِ کاور.
   *
   * با هر تغییرِ ترک دوباره گرفته می‌شود؛ `dominantColor` خودش کش دارد پس
   * برگشتن به یک ترکِ قبلی هزینه‌ی دوباره ندارد. null یعنی کاور نبود یا
   * tainted شد — در آن صورت هاله‌های پیش‌فرضِ accent سرِ جایشان می‌مانند.
   */
  const [tint, setTint] = useState<[number, number, number] | null>(null)
  useEffect(() => {
    let cancelled = false
    // رنگِ قبلی می‌ماند تا رنگِ تازه (معمولاً کش‌شده، در یک میکروتسک) برسد —
    // `setTint(null)` یک فریم هاله را به accent برمی‌گرداند و چشمک می‌زند.
    // همان قاعده‌ی PlayerBar/GroupHero.
    void dominantColor(item?.track.artworkUrl ?? null).then((c) => {
      if (!cancelled) setTint(c)
    })
    return () => {
      cancelled = true
    }
  }, [item?.track.artworkUrl])

  // متن آهنگ فقط وقتی fetch می‌شود که کاربر واقعاً پنل را باز کند — نه هر بار
  // که ترک عوض می‌شود، چون اکثر آهنگ‌ها هیچ‌وقت این پنل را نمی‌بینند
  useEffect(() => {
    setLyrics({ kind: 'loading' })
    if (panel !== 'lyrics' || !item?.lyricsUrl) return
    let cancelled = false
    fetch(item.lyricsUrl)
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((raw) => {
        if (cancelled) return
        const lines = parseLrc(raw)
        // بدون تایم‌استمپ (مثلاً متنِ Genius) یعنی هیچ خطی استخراج نشد — ولی
        // خودِ متن که هست، پس به‌جای «پیدا نشد» به‌صورت یک بلوک ساده نشانش بده
        if (lines.length > 0) setLyrics({ kind: 'synced', lines })
        else if (raw.trim()) setLyrics({ kind: 'plain', text: raw.trim() })
        else setLyrics({ kind: 'none' })
      })
      .catch(() => {
        if (!cancelled) setLyrics({ kind: 'none' })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, item?.lyricsUrl])

  // اگر صف به یک ترک برسد (یا کمتر) دیگر «صف»ی برای نشان‌دادن نیست
  useEffect(() => {
    if (panel === 'queue' && queue.length <= 1) setPanel('cover')
  }, [panel, queue.length])

  // صف ممکن است حین باز بودن نما خالی شود (مثلاً از کتابخانه پاک شد) — بستنِ
  // نما یعنی setState روی والد، پس باید در افکت باشد نه حین رندر
  useEffect(() => {
    if (!item) onClose()
  }, [item, onClose])

  if (!item) return null

  const { track } = item
  const total = duration || track.durationMs / 1000
  // پس‌زمینه‌ی تمام‌صفحه از نسخه‌ی بلورشده‌ی سمتِ سرور — نه blur زنده‌ی CSS روی
  // یک لایه‌ی به‌بزرگیِ ویوپورت (که هم هر فریم گران است هم موقع عکسِ گذارِ
  // ورود دوباره رَستِر می‌شود). کاورِ غیرمحلی (CDN) به همان CSS blur برمی‌گردد.
  const bgBlur = artBlurUrl(track.artworkUrl)
  /*
   * اگر مسیرِ بلورِ سرور ۴۰۴ داد (کاور آینه نشده، ساختِ ffmpeg شکست خورد) پس‌زمینه
   * نباید سیاهِ خالی بماند — به خودِ کاور برمی‌گردیم و بلور را با CSS می‌زنیم،
   * یعنی دقیقاً رفتارِ پیش از این بهینه‌سازی. پرچم به آدرسِ کاور گره خورده تا با
   * تعویضِ ترک دوباره شانسِ بلورِ سرور را داشته باشد.
   */
  const [bgBlurFailed, setBgBlurFailed] = useState<string | null>(null)
  const bgSrc = bgBlur && bgBlurFailed !== track.artworkUrl ? bgBlur : track.artworkUrl
  const bgNeedsCssBlur = bgSrc === track.artworkUrl
  const repeatLabel =
    repeat === 'one' ? t.repeatOne : repeat === 'all' ? t.repeatAll : t.repeatOff
  const headerLabel =
    panel === 'lyrics' ? t.lyrics : panel === 'queue' ? t.upNext : t.nowPlayingView

  return (
    <div className="fixed inset-0 z-50">
      {/* لایه‌ی زیرِ شیت: دیگر دیده نمی‌شود (شیت تمام‌صفحه است) ولی ژستِ کشیدن
          محو‌شدنش را می‌نویسد، پس نودش می‌ماند. بلورِ پس‌زمینه حذف شد — لایه‌ی
          تمام‌صفحه‌ای است که حینِ درگ هر فریم باید نمونه بگیرد و اصلاً دیده
          نمی‌شود؛ `bg-black/70` به‌تنهایی تیرگی لازم را می‌دهد. */}
      <div
        aria-hidden
        ref={drag.backdrop}
        className="backdrop-in absolute inset-0 bg-black/70"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.nowPlayingView}
        tabIndex={-1}
        // دو مصرف‌کننده برای یک نود: ژستِ کشیدن و منطقِ مودال. تابعِ ref
        // هر دو ref را با هم پر می‌کند
        ref={(node) => {
          drag.sheet.current = node
          dialog.current = node
        }}
        onClick={(e) => e.stopPropagation()}
        // تمام‌صفحه: هیچ پس‌زمینه‌ای بیرون نمی‌ماند. ارتفاعِ قطعی همیشه لازم است
        // تا ناحیه‌ی میانیِ flex-1/min-h-0 (کاور، متن، صف) معین بماند و هرچه جا
        // کم آمد از همان صحنه کم شود، نه از کنترل‌ها.
        //
        // دیگر `.glass` نیست: شیت تمام‌صفحه است و پس‌زمینه‌ی ماتِ خودش را دارد،
        // پس بلورِ شیشه چیزی برای نشان‌دادن نداشت — فقط یک `backdrop-filter`ِ
        // به‌اندازه‌ی ویوپورت بود که در انیمیشنِ ورود و حینِ درگ، هر فریم کلِ
        // صفحه را دوباره نمونه می‌گرفت. `bg-bg` کفِ مات است تا پیش از نشستنِ
        // تصویرِ پس‌زمینه هیچ چیزی از صفحه‌ی پشت دیده نشود.
        className="np-in absolute inset-0 flex flex-col overflow-hidden bg-bg p-5 pb-[calc(1.25rem+var(--safe-b))] pt-[calc(1.25rem+var(--safe-t))]"
      >
        {/*
          هاله‌ها داخل یک لایه‌ی برش‌خورده می‌نشینند، نه مستقیم روی خودِ شیت.
          شیت حالا اسکرول دارد و این دوتا از لبه‌اش بیرون می‌زنند؛ بدون این
          پوشش، همان بیرون‌زدگی به ارتفاعِ اسکرول اضافه می‌شد و ته شیت یک
          نوارِ خالیِ ۶۴ پیکسلی می‌ماند که هیچی توش نیست ولی اسکرول می‌خورد.
        */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden"
        >
          {/*
            پس‌زمینه‌ی تمام‌صفحه از خودِ کاور — همان امضای بصریِ اپل‌موزیک.
            بلورِ سنگین (۷۲px) به‌علاوه‌ی تیره‌کردن: متن و کنترل‌ها رویش خوانا
            می‌مانند و فقط «رنگ و حال‌وهوای» کاور می‌ماند. مقیاس ۱.۱۵ لبه‌های
            بلورشده را بیرون می‌برد تا هاله‌ی روشن دورِ تصویر نیفتد.
            `key` روی آدرس است تا با تعویض ترک، crossfade ساده با transition
            رخ دهد — نه پرش.
          */}
          {track.artworkUrl ? (
            <img
              key={bgSrc ?? undefined}
              src={bgSrc ?? undefined}
              alt=""
              aria-hidden
              onError={() => setBgBlurFailed(track.artworkUrl)}
              className={`absolute inset-0 size-full scale-[1.15] object-cover opacity-60 saturate-150 transition-opacity duration-700 ${
                bgNeedsCssBlur ? 'blur-[72px]' : ''
              }`}
            />
          ) : null}
          {/* لایه‌ی تیره‌کننده — خواناییِ متن روی هر کاوری، روشن یا تیره */}
          <span className="absolute inset-0 bg-black/55" />
          {/* گرادیانِ پایین تا کنترل‌ها جایی که چشم می‌رود تمیزتر بنشینند */}
          <span className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/50 to-transparent" />
          {/*
            اگر کاوری نبود، همان هاله‌های accent قبلی جایگزین می‌شوند تا شیت
            خالی و بی‌روح نماند.
          */}
          {!track.artworkUrl && (
            <>
              <span
                className={`absolute -start-16 -top-16 size-56 rounded-full blur-[80px] transition-colors duration-700 ${
                  tint ? '' : 'bg-accent/25'
                }`}
                style={
                  tint ? { background: `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, 0.35)` } : undefined
                }
              />
              <span
                className={`absolute -end-16 -bottom-16 size-56 rounded-full blur-[80px] transition-colors duration-700 ${
                  tint ? '' : 'bg-accent-2/25'
                }`}
                style={
                  tint ? { background: `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, 0.22)` } : undefined
                }
              />
            </>
          )}
        </span>

        {/*
          دستگیره‌ی کشیدن.
          ناحیه‌ی لمسی‌اش عمداً از خودِ میله خیلی بزرگ‌تر است (کلِ نوارِ بالای
          شیت): میله‌ی چهارپیکسلی نشانه است، نه هدفِ انگشت. `touch-none` هم
          لازم است وگرنه مرورگر هم‌زمان با کشیدن، محتوای شیت را اسکرول می‌کند.
        */}
        <div
          ref={drag.handle}
          aria-hidden
          className="-mt-2 mb-1 flex shrink-0 touch-none cursor-grab justify-center py-2 active:cursor-grabbing sm:hidden"
        >
          <span className="h-1 w-10 rounded-full bg-muted-2/50" />
        </div>

        <div className="relative flex shrink-0 items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">
            {headerLabel}
          </span>

          <div className="flex items-center gap-1">
            {jobId && (
              <LikeHeart
                liked={favorite}
                onToggle={() => void toggleFavorite(jobId)}
                ariaLabel={favorite ? t.favoriteRemove : t.favoriteAdd}
                title={favorite ? t.favoriteRemove : t.favoriteAdd}
                className={`size-9 rounded-md transition hover:bg-panel-2 sm:size-7 ${
                  favorite ? '' : 'text-muted-2 hover:text-fg'
                }`}
                iconClassName="size-4"
              />
            )}

            <button
              onClick={toggleRadio}
              aria-label={t.radio}
              aria-pressed={radio}
              title={t.radio}
              className={`grid size-9 place-items-center rounded-md transition hover:bg-panel-2 sm:size-7 ${
                radio ? 'text-accent' : 'text-muted-2 hover:text-fg'
              }`}
            >
              <RadioIcon className="size-4" />
            </button>

            {item.lyricsUrl && (
              <button
                onClick={() => setPanel((v) => (v === 'lyrics' ? 'cover' : 'lyrics'))}
                aria-label={t.lyrics}
                aria-pressed={panel === 'lyrics'}
                title={t.lyrics}
                className={`grid size-9 place-items-center rounded-md transition hover:bg-panel-2 sm:size-7 ${
                  panel === 'lyrics' ? 'text-accent' : 'text-muted-2 hover:text-fg'
                }`}
              >
                <LyricsIcon className="size-4" />
              </button>
            )}

            {queue.length > 1 && (
              <button
                onClick={() => setPanel((v) => (v === 'queue' ? 'cover' : 'queue'))}
                aria-label={t.upNext}
                aria-pressed={panel === 'queue'}
                title={t.upNext}
                className={`grid size-9 place-items-center rounded-md transition hover:bg-panel-2 sm:size-7 ${
                  panel === 'queue' ? 'text-accent' : 'text-muted-2 hover:text-fg'
                }`}
              >
                <QueueIcon className="size-4" />
              </button>
            )}

            <button
              onClick={dismiss}
              aria-label={t.minimizePlayer}
              title={t.minimizePlayer}
              className="grid size-9 place-items-center rounded-md text-muted-2 transition hover:bg-panel-2 hover:text-fg sm:size-7"
            >
              <ChevronIcon className="size-4 -rotate-90" flip={false} />
            </button>
          </div>
        </div>

        <div className="relative mt-4 flex min-h-0 flex-1 items-center justify-center sm:mt-6">
          {panel === 'cover' && (
            /*
             * صحنه‌ی کاور: یک قابِ نسبت‌مربع که داخلش دو کاور روی هم نشسته‌اند.
             * لایه‌ی زیری «ترکِ بعدی» است که حین کشیدن از پشت بیرون می‌آید،
             * لایه‌ی رویی کاورِ فعلی که با انگشت جابه‌جا می‌شود.
             *
             * `touch-action: pan-y` کلیدِ ماجراست: اسکرولِ عمودی را به مرورگر
             * می‌دهد و افقی را به ژستِ ما — بدون preventDefault، بدون دعوا با
             * کشیدنِ شیت.
             *
             * فیزیکِ پخش/توقف (امضای اپل‌موزیک): کاور وقتی پخش متوقف است کمی
             * کوچک‌تر و کم‌نورتر می‌نشیند و با ادامه‌ی پخش فنروار برمی‌گردد.
             * فقط با transition روی transform انجام می‌شود — هیچ حلقه‌ی JS
             * لازم نیست. حالتِ کشیده‌شده (`swipe.dir`) این مقیاس را بی‌اثر
             * می‌کند تا دستِ کاربر روی کاور، کاور زیرِ انگشت بماند.
             */
            <div
              ref={swipe.cover}
              /*
               * `max-h-full` مهم است: کاور با `aspect-square w-full` از عرض
               * اندازه می‌گیرد، و روی صفحه‌ی کوتاه (گوشی افقی) آن ارتفاع از
               * صحنه بیشتر می‌شد. سقفِ ارتفاع، aspect-ratio را وادار می‌کند
               * عرض را هم کم کند — کاور کوچک می‌شود، شیت اسکرول نمی‌کند.
               */
              className={`relative aspect-square max-h-full w-full max-w-64 select-none sm:max-w-72 ${
                swipeEnabled ? 'cursor-grab touch-pan-y active:cursor-grabbing' : ''
              }`}
            >
              {/*
               * هاله‌ی هم‌رhythm با صدا — پشتِ کاور، با رنگِ غالبِ همان کاور.
               * `--glow` را حلقه‌ی rAF از انرژیِ بمِ صوت می‌نویسد؛ اینجا فقط
               * مقدارِ اولیه‌ی صفر است تا قبلِ اولین فریم هاله‌ای نباشد.
               * مقیاس و شفافیت از همین متغیر حساب می‌شوند (CSS `.audio-glow`).
               */}
              <span
                ref={glowRef}
                aria-hidden
                className="audio-glow pointer-events-none absolute inset-0 rounded-2xl bg-accent/40 blur-2xl"
                style={
                  tint
                    ? ({ '--glow': 0, background: `rgb(${tint[0]}, ${tint[1]}, ${tint[2]})` } as React.CSSProperties)
                    : ({ '--glow': 0 } as React.CSSProperties)
                }
              />

              {/* کاورِ پیش‌نمایش — پشت، کوچک‌تر، محو. فقط وقتی ژست فعال است */}
              {swipe.dir && peekItem && (
                <div
                  ref={swipe.peek}
                  aria-hidden
                  className="absolute inset-0 scale-90 opacity-0"
                >
                  <Artwork
                    src={peekItem.track.artworkUrl}
                    alt=""
                    seed={peekItem.track.albumId ?? peekItem.track.id}
                    rounded="rounded-2xl"
                    className="size-full shadow-2xl shadow-black/50 ring-1 ring-white/10"
                  />
                </div>
              )}

              <Artwork
                src={track.artworkUrl}
                alt={track.album ?? track.title}
                seed={track.albumId ?? track.id}
                // جفتِ همان نامی که مینی‌پلیر دارد — فقط وقتی پنلِ کاور باز
                // است، چون در پنلِ متن/صف اصلاً کاوری روی صفحه نیست
                transitionName={COVER_VT}
                rounded="rounded-2xl"
                // اندازه‌ی ثابتِ ۲۵۶ پیکسلی روی گوشیِ ۳۲۰ پیکسلی از قاب می‌زد بیرون
                className={`size-full shadow-2xl shadow-black/50 ring-1 ring-white/10 transition-[transform,opacity] duration-500 ${
                  playing || swipe.dir || swipe.flying
                    ? 'scale-100 opacity-100'
                    : 'scale-[0.92] opacity-90'
                }`}
              />
            </div>
          )}

          {panel === 'lyrics' &&
            (lyrics.kind === 'synced' ? (
              // نمای کارائوکه ظرفیتِ اسکرولِ خودش را دارد — پس اینجا دیگر
              // قابِ بیرونی نمی‌خواهد وگرنه دو اسکرولِ تودرتو روی هم می‌افتد
              <LyricsPanel
                lines={lyrics.lines}
                position={position}
                trackEnd={total}
                onSeek={seek}
              />
            ) : (
              <div className="scroll-pane no-scrollbar h-full w-full overflow-y-auto rounded-2xl border border-line-soft bg-panel-2/50 px-4 py-3">
                {lyrics.kind === 'loading' ? (
                  <div className="grid h-full place-items-center text-xs text-muted-2">…</div>
                ) : lyrics.kind === 'none' ? (
                  <div className="grid h-full place-items-center px-4 text-center text-sm text-muted">
                    {t.lyricsUnavailable}
                  </div>
                ) : (
                  // بدون تایم‌استمپ چیزی برای دنبال‌کردن نیست — کل متن یک‌جا،
                  // بدون هایلایتِ خط‌به‌خط
                  <p className="bidi whitespace-pre-line text-sm leading-7 text-muted">
                    {lyrics.text}
                  </p>
                )}
              </div>
            ))}

          {panel === 'queue' && (
            <div className="scroll-pane no-scrollbar h-full w-full overflow-y-auto rounded-2xl border border-line-soft bg-panel-2/50 p-1.5">
              {queue.map((qItem, i) => (
                <QueueRow
                  key={qItem.id}
                  item={qItem}
                  active={i === index}
                  onPlay={() => play(queue, i)}
                  onRemove={() => drop(qItem.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/*
         * همه‌ی کنترل‌ها زیرِ یک والد تا در حالتِ محیط یک‌جا محو شوند.
         * `inert` عمداً کنارِ opacity می‌آید: دکمه‌ی شفاف ولی «زنده» هم
         * کلیک می‌گیرد هم با کیبورد قابل‌دسترس است؛ بی‌inert بودنش یعنی
         * کاربرِ نابینا روی دکمه‌ای می‌افتد که نمی‌بیند.
         */}
        <div className={`relative shrink-0 ${idle ? 'idle-fade' : 'idle-fade-in'}`} inert={idle}>
          <div className="mt-4 space-y-1 text-center sm:mt-6">
            <div className="flex items-center justify-center gap-2">
              <p className="bidi-center truncate text-lg font-bold" title={track.title}>
                {track.title}
              </p>
              <SourceBadge source={track.source} />
            </div>
            {failed ? (
              <p className="inline-flex items-center gap-1 text-sm text-danger">
                <WarnIcon className="size-3.5" />
                {t.playFailed}
              </p>
            ) : (
              <p className="bidi-center truncate text-sm text-muted">
                <bdi>{track.artist}</bdi>
              </p>
            )}
            {radioLoading && (
              <p className="inline-flex items-center gap-1.5 text-xs text-muted-2">
                <Spinner className="size-3" />
                {t.radioFinding}
              </p>
            )}
          </div>

          <div className="mt-4 sm:mt-6" dir="ltr">
            <SeekBar value={Math.min(position, total)} max={total} onSeek={seek} className="w-full" />
            <div className="mt-1 flex justify-between text-[11px] tabular-nums text-muted-2">
              <span>{fmtDuration(position * 1000, lang)}</span>
              <span>{fmtDuration(total * 1000, lang)}</span>
            </div>
          </div>

          {/*
           * ردیفِ پخش — شافل و شافلِ هوشمند یک گروه‌اند (دومی بدونِ اولی
           * معنا ندارد و تا شافل روشن نشده غیرفعال می‌ماند)، تکرار سرِ دیگر،
           * سه کنترلِ هسته‌ای وسط. همه همیشه دیده می‌شوند.
           *
           * عرضِ کل روی گوشیِ ۳۲۰ پیکسلی: ۴۰+۴۰+۴۸+۶۴+۴۸+۴۰ = ۲۸۰ پیکسل
           * دکمه + فاصله‌ها — جا می‌شود، ولی فاصله‌ها عمداً کوچک‌اند.
           */}
          <div className="mt-5 flex items-center justify-between gap-1 sm:mt-6">
            <div className="flex items-center">
              <button
                onClick={toggleShuffle}
                aria-label={t.shuffle}
                aria-pressed={shuffle}
                title={t.shuffle}
                className={`grid size-10 place-items-center rounded-full transition hover:bg-panel-2 ${
                  shuffle ? 'text-accent' : 'text-muted-2 hover:text-fg'
                }`}
              >
                <ShuffleIcon className="size-5" />
              </button>

              <button
                onClick={toggleSmartShuffle}
                disabled={!shuffle}
                aria-label={t.smartShuffle}
                aria-pressed={smartShuffle}
                title={shuffle ? t.smartShuffle : t.smartShuffleHint}
                className={`grid size-10 place-items-center rounded-full transition ${
                  !shuffle
                    ? 'cursor-not-allowed text-muted-2/40'
                    : smartShuffle
                      ? 'text-accent hover:bg-panel-2'
                      : 'text-muted-2 hover:bg-panel-2 hover:text-fg'
                }`}
              >
                <SparkleIcon className="size-5" />
              </button>
            </div>

            <div className="flex items-center gap-3 sm:gap-6">
              <button
                onClick={withTap(prev)}
                aria-label={t.prevTrack}
                title={t.prevTrack}
                className="grid size-12 place-items-center rounded-full text-fg transition hover:bg-panel-2 active:scale-90"
              >
                <PrevIcon className="size-7" />
              </button>

              <button
                onClick={withTap(toggle)}
                aria-label={playing ? t.pause : t.play}
                title={playing ? t.pause : t.play}
                className="grid size-16 place-items-center rounded-full bg-accent text-accent-fg shadow-xl shadow-accent/30 transition hover:brightness-110 active:scale-95"
              >
                <PlayPauseIcon playing={playing} className="size-7" />
              </button>

              <button
                onClick={withTap(next)}
                aria-label={t.nextTrack}
                title={t.nextTrack}
                className="grid size-12 place-items-center rounded-full text-fg transition hover:bg-panel-2 active:scale-90"
              >
                <NextIcon className="size-7" />
              </button>
            </div>

            <button
              onClick={cycleRepeat}
              aria-label={repeatLabel}
              title={repeatLabel}
              className={`grid size-10 place-items-center rounded-full transition hover:bg-panel-2 ${
                repeat === 'off' ? 'text-muted-2 hover:text-fg' : 'text-accent'
              }`}
            >
              <RepeatIcon className="size-5" one={repeat === 'one'} />
            </button>
          </div>

          <div className="mt-5 flex items-center gap-2 sm:mt-6" dir="ltr">
            <button
              onClick={toggleMute}
              aria-label={muted ? t.unmute : t.mute}
              title={muted ? t.unmute : t.mute}
              className="grid size-7 shrink-0 place-items-center rounded-md text-muted-2 transition hover:text-fg"
            >
              {muted || volume === 0 ? (
                <MuteIcon className="size-4" />
              ) : (
                <VolumeIcon className="size-4" />
              )}
            </button>
            <Range value={muted ? 0 : volume} max={1} onChange={setVolume} label={t.volume} />
            {/* روی موبایل نوارِ کوچکِ پایین این دکمه را جا نمی‌دهد، و پخش‌کننده‌ی
                باز تنها جایی است که همه‌ی کنترل‌ها را دارد */}
            <AudioSettings />
          </div>
        </div>
      </div>
    </div>
  )
}

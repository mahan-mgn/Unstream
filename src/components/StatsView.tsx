import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { clock, digits, shortDate } from '../lib/format'
import { useI18n } from '../lib/i18n'
import type { Stats } from '../lib/types'
import Artwork from './Artwork'
import EmptyState from './EmptyState'
import { Spinner, StatsIcon } from './icons'

/** بازه‌های قابل انتخاب — همان‌هایی که آمار برایشان حساب می‌شود */
const PERIODS = [7, 30, 365]

/**
 * طولِ نسبیِ میله‌ها نسبت به بیشترین مقدار — برای مقایسه‌ی چشمیِ بیشترین‌ها.
 * حداقلِ ۸٪ تا ردیف‌های کم‌پخش اصلاً میله داشته باشند، نه صفرِ نامرئی.
 */
function barWidth(value: number, max: number): number {
  if (max <= 0) return 0
  return Math.max(8, Math.round((value / max) * 100))
}

/**
 * صفحه‌ی آمار — «تو چقدر و چه گوش داده‌ای».
 *
 * داده‌اش از `/api/stats` می‌آید که روی جدولِ پخش ساخته شده؛ یعنی این صفحه
 * دقیقاً همان چیزی است که اپ را از «دانلودر» به «جایی که موسیقی‌ات زندگی
 * می‌کند» تبدیل می‌کند. ترک‌های اینجا شاید دیگر در کتابخانه نباشند (پاک
 * شده‌اند)، پس دکمه‌ی پخش ندارند — فقط یادبودند.
 */
export default function StatsView() {
  const { t, lang } = useI18n()
  const [days, setDays] = useState(7)
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [supported, setSupported] = useState(true)

  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    api
      .stats(days, ctrl.signal)
      .then((s) => {
        setSupported(s !== null)
        setStats(s)
      })
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) setStats(null)
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })
    return () => ctrl.abort()
  }, [days])

  if (!supported) {
    return <EmptyState icon={<StatsIcon className="size-5" />} text={t.libraryUnavailable} />
  }

  const minutes = stats ? Math.round(stats.seconds / 60) : 0
  const maxTrackPlays = Math.max(0, ...(stats?.topTracks.map((x) => x.plays) ?? []))
  const maxArtistPlays = Math.max(0, ...(stats?.topArtists.map((x) => x.plays) ?? []))

  return (
    <div className="rise space-y-4 pb-4">
      {/* ---------- سرصفحه و بازه ---------- */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black sm:text-3xl">{t.stats}</h1>
          <p className="mt-1 text-xs text-muted">{t.statsSubtitle}</p>
        </div>

        <div className="flex items-center gap-1 rounded-full border border-line bg-panel p-0.5">
          {PERIODS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              aria-pressed={days === d}
              title={t.statsDays(d)}
              className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                days === d ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg'
              }`}
            >
              {digits(d, lang)}
            </button>
          ))}
        </div>
      </div>

      {loading && !stats ? (
        <div className="flex justify-center rounded-2xl border border-line-soft bg-panel/50 py-16">
          <Spinner className="size-5 text-muted-2" />
        </div>
      ) : !stats || stats.plays === 0 ? (
        <EmptyState bordered={false} icon={<StatsIcon className="size-5" />} text={t.statsEmpty} />
      ) : (
        <>
          {/* ---------- کاشی‌های شمارنده ---------- */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {[
              { value: stats.plays, label: t.statsPlays },
              { value: minutes, label: t.statsMinutes },
              { value: stats.uniqueTracks, label: t.statsTracks },
            ].map(({ value, label }) => (
              <div
                key={label}
                className="rounded-2xl border border-line-soft bg-panel/50 px-3 py-4 text-center sm:py-5"
              >
                <p className="text-2xl font-black tabular-nums text-accent sm:text-3xl">
                  {digits(value, lang)}
                </p>
                <p className="mt-1 text-[10px] text-muted-2 sm:text-[11px]">{label}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* ---------- بیشترین ترک‌ها ---------- */}
            <section className="rounded-2xl border border-line-soft bg-panel/50 p-3 sm:p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold sm:text-base">
                <span aria-hidden className="h-4 w-1 shrink-0 rounded-full bg-accent" />
                {t.statsTopTracks}
              </h2>
              <ol className="space-y-1">
                {stats.topTracks.slice(0, 10).map((track, i) => (
                  <li
                    key={track.trackId}
                    className="group flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition hover:bg-panel-2 sm:gap-3 sm:px-2"
                  >
                    <span className="w-5 shrink-0 text-center text-[11px] tabular-nums text-muted-2">
                      {digits(i + 1, lang)}
                    </span>
                    <Artwork
                      src={track.artworkUrl ?? null}
                      alt={track.title}
                      seed={track.trackId}
                      className="size-9 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="bidi truncate text-xs font-medium">{track.title}</p>
                      <p className="bidi truncate text-[11px] text-muted">
                        <bdi>{track.artist}</bdi>
                      </p>
                    </div>
                    {/* میله‌ی مقایسه پشتِ عدد؛ عرضش نسبی به بیشترین است.
                        ظرفِ عرضِ ثابت مثلِ ردیفِ هنرمندان — وگرنه یکی درصدِ
                        کانتینر و دیگری پیکسلِ محاسبه‌شود می‌شود و دو میله‌ی
                        هم‌مقدار، دو طولِ متفاوت می‌گیرند */}
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        aria-hidden
                        className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-panel-2 sm:block"
                      >
                        <span
                          className="block h-full rounded-full bg-accent/40"
                          style={{ width: `${barWidth(track.plays, maxTrackPlays)}%` }}
                        />
                      </span>
                      <span className="text-[11px] tabular-nums text-muted-2">
                        {digits(track.plays, lang)}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            {/* ---------- هنرمندهای برتر ---------- */}
            <section className="rounded-2xl border border-line-soft bg-panel/50 p-3 sm:p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold sm:text-base">
                <span aria-hidden className="h-4 w-1 shrink-0 rounded-full bg-accent-2" />
                {t.statsTopArtists}
              </h2>
              <ol className="space-y-2">
                {stats.topArtists.slice(0, 8).map((artist, i) => (
                  <li key={artist.artist} className="px-1.5 sm:px-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="bidi min-w-0 truncate text-xs font-medium">
                        <span className="me-2 text-[11px] tabular-nums text-muted-2">
                          {digits(i + 1, lang)}
                        </span>
                        {artist.artist}
                      </p>
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-2">
                        {digits(artist.plays, lang)}
                      </span>
                    </div>
                    <div aria-hidden className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel-2">
                      <div
                        className="h-full rounded-full bg-accent-2/70"
                        style={{ width: `${barWidth(artist.plays, maxArtistPlays)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          {/* ---------- آخرین پخش‌ها ---------- */}
          <section className="rounded-2xl border border-line-soft bg-panel/50 p-3 sm:p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold sm:text-base">
              <span aria-hidden className="h-4 w-1 shrink-0 rounded-full bg-muted-2" />
              {t.statsRecent}
            </h2>
            <ul className="space-y-0.5">
              {stats.recent.slice(0, 12).map((play, i) => (
                <li
                  key={`${play.trackId}-${play.playedAt}-${i}`}
                  className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 transition sm:gap-3 sm:px-2"
                >
                  <Artwork
                    src={play.artworkUrl ?? null}
                    alt={play.title}
                    seed={play.trackId}
                    className="size-8 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="bidi truncate text-xs">{play.title}</p>
                    <p className="bidi truncate text-[11px] text-muted">
                      <bdi>{play.artist}</bdi>
                    </p>
                  </div>
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-2">
                    {shortDate(play.playedAt, lang)} · {clock(play.playedAt, lang)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}

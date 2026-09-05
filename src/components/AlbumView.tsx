import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { digits, safeFilename } from '../lib/format'
import { useI18n } from '../lib/i18n'
import { dominantColor } from '../lib/artColor'
import type { AlbumDetail, Track } from '../lib/types'
import { isActive, isDone, useDownloads } from '../store/downloads'
import { usePlayer } from '../store/player'
import { useSettings } from '../store/settings'
import { useToasts } from '../store/toasts'
import AlbumTrackRow from './AlbumTrackRow'
import Artwork, { HeroBackdrop } from './Artwork'
import ClickSpark from './ClickSpark'
import SendToTelegram from './SendToTelegram'
import SplitPanel from './SplitPanel'
import {
  ArrowIcon,
  CheckIcon,
  DownloadIcon,
  LinkIcon,
  PlayIcon,
  Spinner,
  ZipIcon,
} from './icons'

interface Props {
  album: AlbumDetail
  playingId: string | null
  onTogglePlay: (track: Track) => void
  /** کلیک روی نامِ آرتیست — به صفحه‌ی آرتیستِ همان پلتفرم می‌رود */
  onOpenArtist?: (ref: string) => void
  onBack: () => void
}

function longDuration(ms: number, t: ReturnType<typeof useI18n.getState>['t']): string {
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return t.minutes(minutes)
  return t.hoursMinutes(Math.floor(minutes / 60), minutes % 60)
}

/*
 * صفحه‌ی آلبوم/تک‌آهنگ/پلی‌لیست — الگوی جدولِ اسپاتیفای با هوای خودِ موزیک‌بازی:
 *
 * - هیرو با تینتِ رنگِ غالبِ کاور (همان `dominantColor` پخش‌کننده) شروع
 *   می‌شود و به رنگِ صفحه محو می‌شود — نه گرادیانِ تصادفی، رنگِ خودِ جلد.
 * - عنوانِ بزرگِ چندخطی، نه یک خطِ بریده‌شده.
 * - دکمه‌ی گردِ بزرگِ پخش + دانلودِ برجسته کنار هم؛ بقیه‌ی کنترل‌ها آیکون‌اند.
 * - نوارِ انتخاب/کنترل بعد از اسکرول می‌چسبد تا تیک‌ها و دکمه‌های دانلود
 *   همیشه زیرِ دست بمانند.
 */
export default function AlbumView({ album, playingId, onTogglePlay, onOpenArtist, onBack }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [zipping, setZipping] = useState(false)
  const [tint, setTint] = useState<[number, number, number] | null>(null)
  const quality = useSettings((s) => s.quality)
  const { enqueueMany, jobs } = useDownloads()
  const { t, lang } = useI18n()
  const pushToast = useToasts((s) => s.push)
  const play = usePlayer((s) => s.play)

  const albumTrackIds = useMemo(() => new Set(album.tracks.map((x) => x.id)), [album])
  const own = jobs.filter((j) => albumTrackIds.has(j.track.id))
  const activeCount = own.filter((j) => isActive(j.status)).length
  const readyJobs = own.filter((j) => isDone(j.status))

  const allSelected = selected.size === album.tracks.length && album.tracks.length > 0
  const targets = selected.size ? album.tracks.filter((x) => selected.has(x.id)) : album.tracks

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(album.tracks.map((x) => x.id)))

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  // رنگِ غالبِ کاور — همان لایه‌ای که پخش‌کننده استفاده می‌کند، پس کشِ مشترک
  useEffect(() => {
    let cancelled = false
    void dominantColor(album.artworkUrl).then((c) => {
      if (!cancelled) setTint(c)
    })
    return () => {
      cancelled = true
    }
  }, [album.artworkUrl])

  const anyTint = tint ? tint.join(',') : '107,107,107'

  // پلی‌لیست و تک‌آهنگ هم در همین قالب می‌آیند — بج باید واقعیت را بگوید
  const typeLabel =
    album.id.includes(':playlist:') ? t.typePlaylist : album.tracks.length === 1 ? t.typeSong : t.typeAlbum

  /** ترک‌هایی که فایل آماده دارند — تنها چیزهایی که در صفِ پخش معنا پیدا می‌کنند */
  const playable = useMemo(
    () =>
      album.tracks
        .map((track) => {
          const job = readyJobs.find((j) => j.track.id === track.id)
          return job?.streamUrl ? { id: track.id, track, streamUrl: job.streamUrl } : null
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    [album.tracks, readyJobs],
  )

  async function downloadZip() {
    setZipping(true)
    try {
      const url = await api.zip(
        readyJobs.map((j) => ({ trackId: j.track.id, quality: j.quality })),
        safeFilename(`${album.artist} - ${album.title}`),
      )
      if (!url) {
        pushToast(t.mockNoFile, 'info')
        return
      }
      // ناوبری به URL، نه fetch: دانلود بومی و بدون نگه‌داشتن آرشیو در حافظه
      location.href = url
    } catch {
      pushToast(t.toastZipFailed, 'error')
    } finally {
      setZipping(false)
    }
  }

  const actions = (
    <>
      <SendToTelegram
        target={{ kind: 'album', ref: album.sourceUrl || album.id, title: album.title }}
        className="size-9 rounded-full border border-line hover:border-muted-2"
      />
      {album.sourceUrl && (
        <a
          href={album.sourceUrl}
          target="_blank"
          rel="noreferrer"
          title={t.openSource}
          aria-label={t.openSource}
          className="grid size-9 place-items-center rounded-full border border-line text-muted transition hover:border-muted-2 hover:text-fg"
        >
          <LinkIcon className="size-4" />
        </a>
      )}
      {readyJobs.length > 0 && (
        <button
          onClick={downloadZip}
          disabled={zipping}
          title={t.zipTitle}
          className="inline-flex items-center gap-2 rounded-full border border-line px-3.5 py-2 text-sm text-fg transition hover:border-muted-2 disabled:opacity-45"
        >
          {zipping ? <Spinner className="size-4" /> : <ZipIcon className="size-4" />}
          {t.zip(readyJobs.length)}
        </button>
      )}
    </>
  )

  return (
    <div className="rise pb-4">
      {/* بیرونِ هیرو — روی زمینه‌ی ساده، نه لابه‌لای بلور و تینت */}
      <div className="px-1 pt-1 sm:px-3">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 py-1 text-xs text-muted transition hover:text-fg"
        >
          <ArrowIcon className="size-3.5 -scale-x-100 rtl:scale-x-100" />
          {t.backToResults}
        </button>
      </div>

      {/* ─── هیرو: بلورِ کاور پشتِ همه + تینتِ رنگِ کاور از بالا.
              تینت از چپِ کارت شروع می‌شود: به‌جای mx، فقط از سمتِ متن
              منفی می‌گیرد تا هیچ لایه‌ای از چپِ کارت دیده نشود ─── */}
      <div
        className="-mr-4 -mt-[4.25rem] overflow-hidden pb-5 pl-4 pr-4 pt-[5.75rem] sm:-mr-6 sm:pl-6 sm:pr-6"
        style={{
          background: `radial-gradient(120% 110% at 85% 0%, rgb(${anyTint} / 0.26), transparent 60%)`,
        }}
      >
        <div className="relative">
          {/* باندِ بلور هم‌قدِ کارتِ کاور: لبه‌های بالا/پایینش موازیِ خودِ کارت؛
              چون کارت از چپ شروع می‌شود، باند فقط به سمت راست بیرون می‌زند */}
          <div className="relative -mr-4 sm:-mr-6">
          <HeroBackdrop src={album.artworkUrl} seed={album.id} />

          {/* متن‌ها وسطِ ارتفاعِ کاور می‌نشینند — نه چسبیده به پایین */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
            {/* هاله‌ی نرمِ پشتِ کاور — همان رنگ؛ کلیپ داخلِ خودِ کارت */}
            <div className="relative shrink-0 overflow-hidden rounded-2xl">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-2 rounded-3xl opacity-45 blur-2xl"
                style={{ background: `rgb(${anyTint} / 0.5)` }}
              />
              <Artwork
                src={album.artworkUrl}
                alt={album.title}
                seed={album.id}
                className="relative size-40 shadow-2xl shadow-black/50 sm:size-48 md:size-56"
                rounded="rounded-2xl"
              />
            </div>

            <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-2">
              {/* سفیدِ کامل و سایه‌ی محکم — لیبل باید از دور هم خوانا باشد */}
              <span className="text-xs font-bold uppercase tracking-widest text-white drop-shadow-[0_1px_6px_rgb(0_0_0/0.9)]">
                {typeLabel}
              </span>
            </div>
            <h1 className="bidi relative z-10 text-3xl font-black leading-[1.15] [word-break:break-word] [text-wrap:balance] drop-shadow-[0_2px_12px_rgb(0_0_0/0.55)] sm:text-4xl md:text-5xl">
              {album.title}
            </h1>
            <p className="relative z-10 mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm [text-shadow:0_1px_8px_rgb(0_0_0/0.5)] text-muted">
              {onOpenArtist && album.artistId ? (
                // آواتار + نام، کلیک‌پذیر — به صفحه‌ی آرتیستِ همین پلتفرم
                <button
                  onClick={() => onOpenArtist(album.artistId!)}
                  className="group/artist inline-flex items-center gap-1.5 rounded-full font-semibold text-fg/90 transition hover:text-accent"
                  title={album.artist}
                >
                  <Artwork
                    src={album.artistArtworkUrl ?? null}
                    alt=""
                    seed={album.artistId}
                    rounded="rounded-full"
                    className="size-5 ring-1 ring-line"
                  />
                  <bdi className="underline-offset-2 group-hover/artist:underline">{album.artist}</bdi>
                </button>
              ) : (
                <bdi className="font-semibold text-fg/90">{album.artist}</bdi>
              )}
              <span aria-hidden>·</span>
              {t.trackCount(album.trackCount)}
              <span aria-hidden>·</span>
              {longDuration(album.durationMs, t)}
              {album.year ? (
                <>
                  <span aria-hidden>·</span>
                  {digits(album.year, lang)}
                </>
              ) : null}
            </p>
          </div>
          </div>
        </div>

        {/* ردیفِ کنش: پخشِ گردِ بزرگ + دانلودِ برجسته */}
        <div className="mt-5 flex items-center gap-3">
          {playable.length > 0 ? (
            <ClickSpark>
              <button
                onClick={() =>
                  play(
                    playable,
                    Math.max(0, playable.findIndex((x) => x.id === playingId)),
                  )
                }
                aria-label={t.playAll}
                title={t.playAll}
                className="grid size-14 place-items-center rounded-full bg-accent text-accent-fg shadow-lg shadow-accent/25 transition enabled:hover:scale-105 enabled:active:scale-95"
              >
                <PlayIcon className="size-6" />
              </button>
            </ClickSpark>
          ) : null}
          {(activeCount > 0 || readyJobs.length < album.tracks.length) && (
            // جرقه فقط دورِ همین یکی: تنها کنشی که کلِ اپ برای آن ساخته شده
            <ClickSpark className="flex-1 md:flex-none">
              <button
                onClick={() =>
                  enqueueMany(targets, quality, {
                    title: album.title,
                    artworkUrl: album.artworkUrl,
                  })
                }
                disabled={targets.length === 0 || activeCount > 0}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg transition enabled:hover:brightness-110 disabled:opacity-60"
              >
                {activeCount > 0 ? (
                  <>
                    <Spinner className="size-4" />
                    {t.ofTotal(readyJobs.length, readyJobs.length + activeCount)}
                  </>
                ) : (
                  <>
                    <DownloadIcon className="size-4" />
                    {selected.size ? t.downloadN(selected.size) : t.downloadAll}
                  </>
                )}
              </button>
            </ClickSpark>
          )}
        </div>
        </div>
      </div>

      {/* یک لینکِ یوتیوب که فقط «یک ترک» است ممکن است در واقع یک میکسِ
          دوساعته باشد؛ اگر چپتر داشته باشد، همان‌جا می‌شود تکه‌اش کرد */}
      {album.tracks.length === 1 && album.source === 'youtube' && album.sourceUrl && (
        <div className="border-b border-line-soft py-3">
          <SplitPanel url={album.sourceUrl} />
        </div>
      )}

      {/* نوارِ چسبانِ انتخاب — بعد از اسکرول زیرِ هدر می‌ماند */}
      <div className="glass-bar sticky top-[calc(3.5rem+env(safe-area-inset-top,0px))] z-20 mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft px-2 py-2 sm:px-4">
        <button
          onClick={toggleAll}
          className="inline-flex items-center gap-1.5 text-xs text-accent transition hover:brightness-125"
        >
          <span
            className={`grid size-5 place-items-center rounded border transition ${
              allSelected ? 'border-accent bg-accent text-accent-fg' : 'border-muted-2'
            }`}
          >
            {allSelected && <CheckIcon className="size-2.5" />}
          </span>
          {allSelected ? t.clearSelection : t.selectAll}
        </button>
        <span className="truncate text-[11px] text-muted-2">{t.tickHint(album.trackCount)}</span>
        <div className="ms-auto flex items-center gap-2">{actions}</div>
      </div>

      <div className="space-y-0.5 px-1 sm:px-3">
        {album.tracks.map((track, i) => (
          <AlbumTrackRow
            key={track.id}
            track={track}
            index={i + 1}
            selectable
            selected={selected.has(track.id)}
            onToggleSelect={() => toggleOne(track.id)}
            playingId={playingId}
            onTogglePlay={onTogglePlay}
            onOpenArtist={onOpenArtist}
          />
        ))}
      </div>
    </div>
  )
}

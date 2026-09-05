import {
  digits,
  duration as fmtDuration,
  fileExt,
  formatLabel,
  percent as fmtPercent,
  safeFilename,
} from '../lib/format'
import { useI18n } from '../lib/i18n'
import type { Track } from '../lib/types'
import { isActive, useDownloads, useTrackJob } from '../store/downloads'
import { useSettings } from '../store/settings'
import SendToTelegram from './SendToTelegram'
import {
  CheckIcon,
  DownloadIcon,
  EqualizerIcon,
  LyricsIcon,
  PlayIcon,
  RetryIcon,
  Spinner,
  WarnIcon,
} from './icons'

interface Props {
  track: Track
  /** شماره‌ی ترک در آلبوم */
  index: number
  playingId: string | null
  onTogglePlay: (track: Track) => void
  /** کلیک روی نامِ آرتیستِ ردیف — صفحه‌ی آرتیستِ همان پلتفرم */
  onOpenArtist?: (ref: string) => void
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: () => void
}

/*
 * ردیفِ ترکِ صفحه‌ی آلبوم — الگوی جدولیِ اسپاتیفای.
 *
 * با `TrackRow` یکی نیست عمداً: آنجا ردیف همه‌جا (نتایج، هنرمند، شناسایی)
 * یک شکل است؛ اینجا ترک‌های یک آلبوم‌اند که شماره دارند و هویتِ صفحه از
 * هیرو می‌آید — پس ردیف سبک‌تر می‌شود و کاور ندارد.
 *
 * شماره‌ی ردیف خودش دکمه‌ی پخش است: روی دسکتاپ با هاور آیکونِ پخش جایش را
 * می‌گیرد و روی لمس هم بدون هاور کلیک‌پذیر می‌ماند. ترکِ در حال پخش به‌جای
 * شماره اکولایزرِ متحرک می‌گیرد و عنوانش accent می‌شود.
 */
export default function AlbumTrackRow({
  track,
  index,
  playingId,
  onTogglePlay,
  onOpenArtist,
  selectable = false,
  selected = false,
  onToggleSelect,
}: Props) {
  const quality = useSettings((s) => s.quality)
  // با همان کیفیتی که دکمه‌ی این ردیف دانلود را ثبت می‌کند — وگرنه ردیف
  // وضعیتِ یک دانلودِ دیگر (کیفیتِ دیگر) را نشان می‌دهد
  const job = useTrackJob(track.id, quality)
  const { enqueue, cancel, retry } = useDownloads()
  const { t, lang } = useI18n()
  const playing = playingId === track.id

  const busy = job ? isActive(job.status) : false
  const fill = job?.status === 'downloading' ? job.percent : 0

  const statusText = (() => {
    if (!job) return null
    switch (job.status) {
      case 'queued':
        return t.stQueued
      case 'searching':
        return t.stSearching
      case 'downloading':
        return t.stDownloading(fmtPercent(job.percent, lang))
      case 'tagging':
        return t.stTagging
      default:
        return null
    }
  })()

  const filename = `${safeFilename(`${track.artist} - ${track.title}`)}.${fileExt(job?.format)}`

  return (
    <div
      className={`group relative flex items-center gap-2 overflow-hidden rounded-xl px-2 py-2 transition sm:gap-3 ${
        selected ? 'bg-accent-dim' : 'hover:bg-panel-2'
      }`}
    >
      {/* پروگرس به‌صورت پُرشدنِ پس‌زمینه‌ی خودِ ردیف */}
      {busy && (
        <>
          <div
            className="pointer-events-none absolute inset-0 origin-left rtl:origin-right bg-accent/8 transition-transform duration-200 ease-linear"
            style={{ transform: `scaleX(${fill / 100})` }}
          />
          <div
            className="pointer-events-none absolute bottom-0 inset-x-0 h-[2px] origin-left rtl:origin-right bg-accent transition-transform duration-200 ease-linear"
            style={{ transform: `scaleX(${fill / 100})` }}
          />
        </>
      )}

      {selectable && (
        <button
          onClick={onToggleSelect}
          role="checkbox"
          aria-checked={selected}
          aria-label={t.selectTrack(track.title)}
          className={`relative grid size-5 shrink-0 place-items-center rounded border transition ${
            selected ? 'border-accent bg-accent text-accent-fg' : 'border-muted-2 hover:border-fg'
          }`}
        >
          {selected && <CheckIcon className="size-2.5" />}
        </button>
      )}

      <button
        onClick={() => onTogglePlay(track)}
        aria-label={playing ? t.stopPreview : t.preview}
        title={playing ? t.stopPreview : t.preview}
        className="relative grid size-6 shrink-0 place-items-center text-muted-2 transition hover:text-fg"
      >
        {playing ? (
          <EqualizerIcon className="size-4 text-accent" />
        ) : (
          <>
            <span className="text-[13px] tabular-nums group-hover:opacity-0">
              {digits(index, lang)}
            </span>
            <PlayIcon className="absolute size-4 text-fg opacity-0 group-hover:opacity-100" />
          </>
        )}
      </button>

      <div className="relative min-w-0 flex-1">
        <p className={`bidi truncate text-sm font-medium ${playing ? 'text-accent' : ''}`}>
          {track.title}
        </p>
        {onOpenArtist && track.artistId ? (
          // دکمه‌ی داخل ردیف — stopPropagation لازم نیست چون ردیف خودش دکمه نیست
          <button
            onClick={(e) => {
              e.stopPropagation()
              onOpenArtist(track.artistId!)
            }}
            className="bidi block max-w-full truncate text-xs text-muted transition hover:text-accent hover:underline"
          >
            {track.artist}
          </button>
        ) : (
          <p className="bidi truncate text-xs text-muted">{track.artist}</p>
        )}
      </div>

      <div className="relative flex shrink-0 items-center gap-0.5 sm:gap-1">
        {/* روی موبایل، پیشرفت را همان پرشدنِ پس‌زمینه‌ی ردیف می‌گوید */}
        {statusText && (
          <span className="me-1 hidden text-[11px] text-muted sm:inline">{statusText}</span>
        )}

        {job?.status === 'error' && (
          <button
            onClick={() => retry(job.id)}
            title={job.error}
            className="me-1 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-danger hover:bg-panel-2"
          >
            <RetryIcon className="size-3" />
            {t.retry}
          </button>
        )}

        <SendToTelegram target={{ kind: 'track', track }} />

        {job?.lyricsUrl && (
          <a
            href={job.lyricsUrl}
            download
            title={t.lyrics}
            aria-label={t.lyrics}
            className="grid size-7 place-items-center rounded-md text-muted transition hover:bg-panel-2 hover:text-fg"
          >
            <LyricsIcon className="size-4" />
          </a>
        )}

        <span className="hidden w-9 text-center text-[11px] tabular-nums text-muted-2 sm:inline">
          {fmtDuration(track.durationMs, lang)}
        </span>

        {job?.warning && (
          <span
            title={job.warning}
            aria-label={job.warning}
            className="grid size-7 place-items-center text-warn"
          >
            <WarnIcon className="size-4" />
          </span>
        )}

        {job?.status === 'ready' ? (
          <a
            href={job.fileUrl ?? '#'}
            download={job.fileUrl ? filename : undefined}
            onClick={(e) => {
              if (!job.fileUrl) e.preventDefault()
            }}
            title={job.fileUrl ? t.save : t.mockNoFile}
            className="inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent-dim px-2 py-1 text-[11px] font-semibold text-accent"
          >
            <CheckIcon className="size-3" />
            {formatLabel(job.format, lang)}
            <DownloadIcon className="size-3" />
          </a>
        ) : busy ? (
          <button
            onClick={() => cancel(job!.id)}
            aria-label={t.cancelDownload}
            className="grid size-8 place-items-center rounded-md text-accent transition hover:bg-panel-2 sm:size-7"
          >
            <Spinner className="size-4" />
          </button>
        ) : (
          <button
            onClick={() => enqueue(track, quality, { title: track.album ?? track.title })}
            aria-label={t.downloadTrack(track.title)}
            className="grid size-8 place-items-center rounded-md text-muted transition hover:bg-panel-2 hover:text-fg sm:size-7"
          >
            <DownloadIcon className="size-4" />
          </button>
        )}
      </div>
    </div>
  )
}

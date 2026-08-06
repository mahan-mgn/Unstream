import {
  duration as fmtDuration,
  percent as fmtPercent,
  digits,
  fileExt,
  formatLabel,
  safeFilename,
} from '../lib/format'
import { useI18n } from '../lib/i18n'
import type { Track } from '../lib/types'
import { isActive, useDownloads, useTrackJob } from '../store/downloads'
import { useSettings } from '../store/settings'
import Artwork from './Artwork'
import SourceBadge from './SourceBadge'
import {
  CheckIcon,
  DownloadIcon,
  LyricsIcon,
  PauseIcon,
  PlayIcon,
  RetryIcon,
  Spinner,
  WarnIcon,
} from './icons'

interface Props {
  track: Track
  /** شماره‌ی ترک در آلبوم؛ در نتایج جستجو معنا ندارد */
  index?: number
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: () => void
  playingId: string | null
  onTogglePlay: (track: Track) => void
  showSource?: boolean
}

export default function TrackRow({
  track,
  index,
  selectable = false,
  selected = false,
  onToggleSelect,
  playingId,
  onTogglePlay,
  showSource = false,
}: Props) {
  const job = useTrackJob(track.id)
  const quality = useSettings((s) => s.quality)
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
      className={`group relative flex items-center gap-3 overflow-hidden rounded-lg px-2 py-2 transition ${
        selected ? 'bg-accent-dim' : 'hover:bg-panel-2'
      }`}
    >
      {/* پروگرس به‌صورت پُرشدنِ پس‌زمینه‌ی خودِ ردیف */}
      {busy && (
        <>
          <div
            className="pointer-events-none absolute inset-y-0 start-0 bg-accent/8 transition-[width] duration-200 ease-linear"
            style={{ width: `${fill}%` }}
          />
          <div
            className="pointer-events-none absolute bottom-0 start-0 h-[2px] bg-accent transition-[width] duration-200 ease-linear"
            style={{ width: `${fill}%` }}
          />
        </>
      )}

      {selectable && (
        <button
          onClick={onToggleSelect}
          role="checkbox"
          aria-checked={selected}
          aria-label={t.selectTrack(track.title)}
          className={`relative grid size-4 shrink-0 place-items-center rounded border transition ${
            selected ? 'border-accent bg-accent text-accent-fg' : 'border-muted-2 hover:border-fg'
          }`}
        >
          {selected && <CheckIcon className="size-2.5" />}
        </button>
      )}

      {index !== undefined && (
        <span className="relative w-4 shrink-0 text-center text-[11px] tabular-nums text-muted-2">
          {digits(index, lang)}
        </span>
      )}

      <Artwork
        src={track.artworkUrl}
        alt={track.album ?? track.title}
        seed={track.albumId ?? track.id}
        className="relative size-10 shrink-0"
      />

      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="bidi truncate text-sm">{track.title}</p>
          {showSource && <SourceBadge source={track.source} />}
        </div>
        <p className="bidi truncate text-xs text-muted">{track.artist}</p>
      </div>

      <div className="relative flex shrink-0 items-center gap-1">
        {statusText && <span className="me-1 text-[11px] text-muted">{statusText}</span>}

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

        <button
          onClick={() => onTogglePlay(track)}
          aria-label={playing ? t.stopPreview : t.preview}
          className={`grid size-7 place-items-center rounded-md transition hover:bg-panel-2 ${
            playing ? 'text-accent' : 'text-muted hover:text-fg'
          }`}
        >
          {playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
        </button>

        <span className="w-9 text-center text-[11px] tabular-nums text-muted-2">
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
            className="grid size-7 place-items-center rounded-md text-accent transition hover:bg-panel-2"
          >
            <Spinner className="size-4" />
          </button>
        ) : (
          <button
            onClick={() =>
              enqueue(track, quality, { title: track.album ?? track.title })
            }
            aria-label={t.downloadTrack(track.title)}
            className="grid size-7 place-items-center rounded-md text-muted transition hover:bg-panel-2 hover:text-fg"
          >
            <DownloadIcon className="size-4" />
          </button>
        )}
      </div>
    </div>
  )
}

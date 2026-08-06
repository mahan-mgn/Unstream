import { useMemo, useState } from 'react'
import { api } from '../lib/api'
import { digits, safeFilename } from '../lib/format'
import { useI18n } from '../lib/i18n'
import type { AlbumDetail, Track } from '../lib/types'
import { isActive, isDone, useDownloads } from '../store/downloads'
import { useSettings } from '../store/settings'
import { useToasts } from '../store/toasts'
import Artwork from './Artwork'
import SourceBadge from './SourceBadge'
import TrackRow from './TrackRow'
import { ArrowIcon, CheckIcon, DownloadIcon, LinkIcon, Spinner, ZipIcon } from './icons'

interface Props {
  album: AlbumDetail
  playingId: string | null
  onTogglePlay: (track: Track) => void
  onBack: () => void
}

function longDuration(ms: number, t: ReturnType<typeof useI18n.getState>['t']): string {
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return t.minutes(minutes)
  return t.hoursMinutes(Math.floor(minutes / 60), minutes % 60)
}

export default function AlbumView({ album, playingId, onTogglePlay, onBack }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [zipping, setZipping] = useState(false)
  const quality = useSettings((s) => s.quality)
  const { enqueueMany, jobs } = useDownloads()
  const { t, lang } = useI18n()
  const pushToast = useToasts((s) => s.push)

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

  // پلی‌لیست و تک‌آهنگ هم در همین قالب می‌آیند — بج باید واقعیت را بگوید
  const typeLabel =
    album.id.includes(':playlist:')
      ? t.typePlaylist
      : album.tracks.length === 1
        ? t.typeSong
        : t.typeAlbum

  async function downloadZip() {
    setZipping(true)
    try {
      const url = await api.zip(
        readyJobs.map((j) => j.track.id),
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

  return (
    <div className="rise space-y-4">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs text-muted transition hover:text-fg"
      >
        <ArrowIcon className="size-3.5 -scale-x-100 rtl:scale-x-100" />
        {t.backToResults}
      </button>

      <div className="overflow-hidden rounded-2xl border border-line-soft bg-panel/50">
        <div className="flex items-center gap-4 border-b border-line-soft p-4">
          <Artwork
            src={album.artworkUrl}
            alt={album.title}
            seed={album.id}
            className="size-20 shrink-0"
            rounded="rounded-xl"
          />

          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-2">
                {typeLabel}
              </span>
              <SourceBadge source={album.source} />
            </div>
            <h1 className="bidi truncate text-xl font-bold">{album.title}</h1>
            <p className="mt-0.5 truncate text-xs text-muted">
              <bdi>{album.artist}</bdi> · {t.trackCount(album.trackCount)} ·{' '}
              {longDuration(album.durationMs, t)}
              {album.year ? ` · ${digits(album.year, lang)}` : ''}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {album.sourceUrl && (
              <a
                href={album.sourceUrl}
                target="_blank"
                rel="noreferrer"
                title={t.openSource}
                aria-label={t.openSource}
                className="grid size-10 place-items-center rounded-full border border-line text-muted transition hover:border-muted-2 hover:text-fg"
              >
                <LinkIcon className="size-4" />
              </a>
            )}

            {readyJobs.length > 0 && (
              <button
                onClick={downloadZip}
                disabled={zipping}
                title={t.zipTitle}
                className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2.5 text-sm text-fg transition hover:border-muted-2 disabled:opacity-45"
              >
                {zipping ? <Spinner className="size-4" /> : <ZipIcon className="size-4" />}
                {t.zip(readyJobs.length)}
              </button>
            )}

            {(activeCount > 0 || readyJobs.length < album.tracks.length) && (
              <button
                onClick={() => enqueueMany(targets, quality, {
                  title: album.title,
                  artworkUrl: album.artworkUrl,
                })}
                disabled={targets.length === 0 || activeCount > 0}
                className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg transition enabled:hover:brightness-110 disabled:opacity-60"
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
            )}
          </div>
        </div>

        <div className="flex items-center justify-between px-4 py-2.5 text-[11px] text-muted-2">
          <button
            onClick={toggleAll}
            className="inline-flex items-center gap-1.5 text-accent transition hover:brightness-125"
          >
            <span
              className={`grid size-4 place-items-center rounded border transition ${
                allSelected ? 'border-accent bg-accent text-accent-fg' : 'border-muted-2'
              }`}
            >
              {allSelected && <CheckIcon className="size-2.5" />}
            </span>
            {allSelected ? t.clearSelection : t.selectAll}
          </button>
          <span>{t.tickHint(album.trackCount)}</span>
        </div>

        <div className="space-y-0.5 p-2 pt-0">
          {album.tracks.map((track, i) => (
            <TrackRow
              key={track.id}
              track={track}
              index={i + 1}
              selectable
              selected={selected.has(track.id)}
              onToggleSelect={() => toggleOne(track.id)}
              playingId={playingId}
              onTogglePlay={onTogglePlay}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

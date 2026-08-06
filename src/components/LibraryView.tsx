import { useCallback, useEffect, useRef, useState } from 'react'
import { api, API_MODE } from '../lib/api'
import {
  bytes as fmtBytes,
  duration as fmtDuration,
  fileExt,
  formatLabel,
  safeFilename,
  shortDate,
} from '../lib/format'
import { useI18n } from '../lib/i18n'
import type { LibraryItem, LibraryPage } from '../lib/types'
import { useToasts } from '../store/toasts'
import Artwork from './Artwork'
import SourceBadge from './SourceBadge'
import { DownloadIcon, LyricsIcon, SearchIcon, Spinner, TrashIcon } from './icons'

function Row({ item, onRemove }: { item: LibraryItem; onRemove: () => void }) {
  const { t, lang } = useI18n()
  const { track } = item
  const filename = `${safeFilename(`${track.artist} - ${track.title}`)}.${fileExt(item.format)}`

  return (
    <div className="group flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-panel-2">
      <Artwork
        src={track.artworkUrl}
        alt={track.album ?? track.title}
        seed={track.albumId ?? track.id}
        className="size-10 shrink-0"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="bidi truncate text-sm">{track.title}</p>
          <SourceBadge source={track.source} />
        </div>
        <p className="bidi truncate text-xs text-muted">
          <bdi>{track.artist}</bdi>
          {track.album ? ` · ${track.album}` : ''}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <span className="hidden text-[11px] text-muted-2 sm:inline">
          {shortDate(item.createdAt, lang)}
        </span>
        <span className="w-16 text-center text-[11px] text-muted-2">
          {fmtBytes(item.bytes, lang)}
        </span>
        <span className="w-9 text-center text-[11px] tabular-nums text-muted-2">
          {fmtDuration(track.durationMs, lang)}
        </span>

        {item.lyricsUrl && (
          <a
            href={item.lyricsUrl}
            download
            title={t.lyrics}
            aria-label={t.lyrics}
            className="grid size-7 place-items-center rounded-md text-muted transition hover:bg-panel-2 hover:text-fg"
          >
            <LyricsIcon className="size-4" />
          </a>
        )}

        <a
          href={item.fileUrl}
          download={filename}
          title={t.save}
          className="inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent-dim px-2 py-1 text-[11px] font-semibold text-accent"
        >
          {formatLabel(item.format, lang)}
          <DownloadIcon className="size-3" />
        </a>

        <button
          onClick={onRemove}
          aria-label={t.libraryRemove}
          title={t.libraryRemove}
          className="grid size-7 place-items-center rounded-md text-muted-2 opacity-0 transition hover:bg-panel-2 hover:text-danger group-hover:opacity-100"
        >
          <TrashIcon className="size-4" />
        </button>
      </div>
    </div>
  )
}

export default function LibraryView() {
  const [page, setPage] = useState<LibraryPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [supported, setSupported] = useState(true)
  const inflight = useRef<AbortController | null>(null)
  const { t, lang } = useI18n()
  const pushToast = useToasts((s) => s.push)

  const load = useCallback(
    async (q: string) => {
      inflight.current?.abort()
      const ctrl = new AbortController()
      inflight.current = ctrl
      setLoading(true)
      try {
        const result = await api.library(q, ctrl.signal)
        if (ctrl.signal.aborted) return
        setSupported(result !== null)
        setPage(result)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        pushToast(t.fetchError, 'error')
      } finally {
        if (!ctrl.signal.aborted) setLoading(false)
      }
    },
    [pushToast, t],
  )

  // تایپ کردن نباید به ازای هر حرف یک درخواست بزند
  useEffect(() => {
    const timer = setTimeout(() => void load(query), query ? 300 : 0)
    return () => clearTimeout(timer)
  }, [query, load])

  useEffect(() => () => inflight.current?.abort(), [])

  async function remove(item: LibraryItem) {
    try {
      await api.removeFromLibrary(item.jobId)
      setPage((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.filter((x) => x.jobId !== item.jobId),
              total: Math.max(0, prev.total - 1),
              totalBytes: Math.max(0, prev.totalBytes - item.bytes),
            }
          : prev,
      )
      pushToast(t.libraryRemoved(item.track.title), 'info')
    } catch {
      pushToast(t.libraryRemoveFailed, 'error')
    }
  }

  if (!supported || API_MODE !== 'http') {
    return (
      <div className="rise rounded-2xl border border-line-soft bg-panel/50 p-10 text-center">
        <p className="text-sm text-muted">{t.libraryUnavailable}</p>
      </div>
    )
  }

  const items = page?.items ?? []

  return (
    <div className="rise overflow-hidden rounded-2xl border border-line-soft bg-panel/50">
      <div className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
        <h1 className="text-sm font-semibold">{t.library}</h1>
        {page && (
          <span className="shrink-0 text-[11px] text-muted-2">
            {t.librarySummary(page.total, fmtBytes(page.totalBytes, lang))}
          </span>
        )}
      </div>

      <div className="border-b border-line-soft px-4 py-2.5">
        <div className="flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5">
          <SearchIcon className="size-3.5 shrink-0 text-muted-2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.librarySearch}
            aria-label={t.librarySearch}
            className="w-full bg-transparent text-xs outline-none placeholder:text-muted-2"
          />
          {loading && <Spinner className="size-3.5 shrink-0 text-muted-2" />}
        </div>
      </div>

      <div className="space-y-0.5 p-2">
        {items.length === 0 && !loading && (
          <p className="p-8 text-center text-sm text-muted">
            {query ? t.libraryNoMatch : t.libraryEmpty}
          </p>
        )}
        {items.map((item) => (
          <Row key={item.jobId} item={item} onRemove={() => void remove(item)} />
        ))}
      </div>
    </div>
  )
}

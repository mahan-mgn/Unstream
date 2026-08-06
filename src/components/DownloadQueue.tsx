import { useState } from 'react'
import { api } from '../lib/api'
import { digits, fileExt, formatLabel, percent as fmtPercent, safeFilename } from '../lib/format'
import { useI18n, type Dict } from '../lib/i18n'
import {
  isActive,
  isDone,
  useBatchViews,
  useDownloads,
  type BatchView,
  type Job,
} from '../store/downloads'
import { useToasts } from '../store/toasts'
import Artwork from './Artwork'
import {
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  DownloadIcon,
  RetryIcon,
  Spinner,
  ZipIcon,
} from './icons'

function etaLabel(seconds: number, t: Dict): string {
  return t.timeLeft(seconds < 60 ? t.secondsShort(seconds) : t.minutesShort(Math.ceil(seconds / 60)))
}

/** یک ترک داخل بچ */
function TrackLine({ job }: { job: Job }) {
  const { retry, cancel } = useDownloads()
  const { t, lang } = useI18n()
  const active = isActive(job.status)
  const done = isDone(job.status)

  const status = (() => {
    switch (job.status) {
      case 'queued':
        return t.stQueued
      case 'searching':
        return t.stSearching
      case 'downloading':
        return t.stDownloading(fmtPercent(job.percent, lang))
      case 'tagging':
        return t.stTagging
      case 'canceled':
        return t.stCanceled
      case 'error':
        return job.error ?? t.stError
      default:
        return ''
    }
  })()

  return (
    <li className="relative flex items-center gap-2 px-3 py-1.5">
      <span className="grid size-4 shrink-0 place-items-center">
        {done ? (
          <CheckIcon className="size-3.5 text-accent" />
        ) : active ? (
          <Spinner className="size-3.5 text-accent" />
        ) : (
          <span className="size-1.5 rounded-full bg-muted-2" />
        )}
      </span>

      <p className="bidi min-w-0 flex-1 truncate text-xs" title={job.track.title}>
        {job.track.title}
      </p>

      {done ? (
        <a
          href={job.fileUrl ?? '#'}
          download={
            job.fileUrl
              ? `${safeFilename(`${job.track.artist} - ${job.track.title}`)}.${fileExt(job.format)}`
              : undefined
          }
          onClick={(e) => {
            if (!job.fileUrl) e.preventDefault()
          }}
          title={job.fileUrl ? t.save : t.mockNoFile}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-accent/40 bg-accent-dim px-1.5 py-0.5 text-[10px] font-semibold text-accent"
        >
          <DownloadIcon className="size-3" />
          {formatLabel(job.format, lang)}
        </a>
      ) : job.status === 'error' ? (
        <button
          onClick={() => retry(job.id)}
          title={job.error}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[10px] text-danger transition hover:border-danger"
        >
          <RetryIcon className="size-3" />
          {t.retry}
        </button>
      ) : (
        <button
          onClick={() => active && cancel(job.id)}
          title={active ? t.cancel : undefined}
          className="shrink-0 truncate text-[10px] text-muted-2 transition hover:text-fg"
        >
          {status}
        </button>
      )}
    </li>
  )
}

/** بچ = چیزی که کاربر ثبت کرده؛ ترک‌هایش زیرش می‌آیند */
function BatchBlock({ view }: { view: BatchView }) {
  const { batch, jobs, done, total, percent, etaSeconds, finished } = view
  const { dismissBatch } = useDownloads()
  const { t } = useI18n()
  const pushToast = useToasts((s) => s.push)
  const [zipping, setZipping] = useState(false)

  const readyJobs = jobs.filter((j) => isDone(j.status))

  async function downloadZip() {
    setZipping(true)
    try {
      const url = await api.zip(
        readyJobs.map((j) => j.track.id),
        safeFilename(batch.title),
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
    <li className="border-b border-line-soft last:border-b-0">
      <div className="relative flex items-center gap-2.5 px-3 py-2.5">
        <Artwork
          src={batch.artworkUrl}
          alt={batch.title}
          seed={batch.id}
          className="size-10 shrink-0"
        />

        <div className="min-w-0 flex-1">
          <p className="bidi truncate text-xs font-medium" title={batch.title}>
            {batch.title}
          </p>
          <p className="truncate text-[11px] text-muted">
            {finished
              ? t.downloadedOf(done, total)
              : `${t.ofTotal(done, total)}${etaSeconds ? ` · ${etaLabel(etaSeconds, t)}` : ''}`}
          </p>
        </div>

        {readyJobs.length > 1 && (
          <button
            onClick={downloadZip}
            disabled={zipping}
            title={t.zipTitle}
            aria-label={t.zip(readyJobs.length)}
            className="grid size-7 shrink-0 place-items-center rounded-md border border-line text-muted transition hover:border-muted-2 hover:text-fg disabled:opacity-45"
          >
            {zipping ? <Spinner className="size-3.5" /> : <ZipIcon className="size-3.5" />}
          </button>
        )}

        {finished && (
          <button
            onClick={() => dismissBatch(batch.id)}
            aria-label={t.close}
            className="grid size-6 shrink-0 place-items-center rounded-md text-muted-2 transition hover:bg-panel hover:text-fg"
          >
            <CloseIcon className="size-3.5" />
          </button>
        )}
      </div>

      {/* نوار پیشرفت کل بچ */}
      <div className="relative mx-3 h-[2px] overflow-hidden rounded-full bg-line-soft">
        <div
          className="h-full bg-accent transition-[width] duration-300 ease-linear"
          style={{ width: `${percent}%` }}
        />
      </div>

      <ul className="py-1">
        {jobs.map((job) => (
          <TrackLine key={job.id} job={job} />
        ))}
      </ul>
    </li>
  )
}

export default function DownloadQueue() {
  const batches = useBatchViews()
  const { collapsed, setCollapsed, clearFinished } = useDownloads()
  const { t, lang } = useI18n()

  if (!batches.length) return null

  const inProgress = batches.filter((b) => !b.finished).length
  const finishedCount = batches.filter((b) => b.finished).length

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        aria-label={t.expandPanel}
        className="fixed bottom-4 end-4 z-40 grid size-12 place-items-center rounded-full bg-accent text-accent-fg shadow-lg shadow-black/40 transition hover:brightness-110"
      >
        {inProgress ? <DownloadIcon className="size-5" /> : <ZipIcon className="size-5" />}
        <span className="absolute -top-1 -end-1 grid min-w-5 place-items-center rounded-full bg-fg px-1 text-[10px] font-bold text-bg">
          {digits(inProgress || batches.length, lang)}
        </span>
      </button>
    )
  }

  return (
    <aside className="toast-in fixed bottom-4 end-4 z-40 w-[21rem] overflow-hidden rounded-xl border border-line bg-panel/95 shadow-2xl shadow-black/50 backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-line-soft px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          {t.downloads}
        </span>

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-2">
            {inProgress ? t.inProgress(inProgress) : t.finished(finishedCount)}
          </span>
          {finishedCount > 0 && (
            <button
              onClick={clearFinished}
              className="rounded-md px-1.5 py-1 text-[10px] text-muted-2 transition hover:text-fg"
            >
              {t.clearDone}
            </button>
          )}
          <button
            onClick={() => setCollapsed(true)}
            aria-label={t.collapsePanel}
            className="grid size-6 place-items-center rounded-md text-muted-2 transition hover:bg-panel-2 hover:text-fg"
          >
            <ChevronIcon className="size-3.5 -rotate-90" flip={false} />
          </button>
        </div>
      </div>

      <ul className="max-h-[26rem] overflow-y-auto">
        {batches.map((view) => (
          <BatchBlock key={view.batch.id} view={view} />
        ))}
      </ul>
    </aside>
  )
}

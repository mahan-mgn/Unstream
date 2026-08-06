import { create } from 'zustand'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import type { DownloadProgress, JobStatus, Quality, Track } from '../lib/types'
import { useToasts } from './toasts'

export interface Job {
  id: string
  batchId: string
  track: Track
  quality: Quality
  status: JobStatus
  percent: number
  error?: string
  fileUrl?: string
  format?: string
  /** فایل سالم است ولی AcoustID ترک دیگری را شناخته */
  warning?: string
  /** فایل .lrc اگر متن هم‌زمان‌شده پیدا شده باشد */
  lyricsUrl?: string
  createdAt: number
  /** زمان شروع دانلود واقعی */
  startedAt?: number
  /** زمان رسیدن به وضعیت نهایی — پایه‌ی محاسبه‌ی ETA */
  finishedAt?: number
}

/**
 * یک بچ = یک چیزی که کاربر ثبت کرده (آلبوم، پلی‌لیست، یا یک ترک تکی).
 * صف بر همین اساس گروه‌بندی می‌شود، نه ترک‌به‌ترک.
 */
export interface Batch {
  id: string
  title: string
  artworkUrl: string | null
  quality: Quality
  createdAt: number
}

export const isActive = (s: JobStatus) =>
  s === 'queued' || s === 'searching' || s === 'downloading' || s === 'tagging'

export const isDone = (s: JobStatus) => s === 'ready'

/** کنسل‌کننده‌ی هر کار، بیرون از state نگه داشته می‌شود */
const cancelers = new Map<string, () => void>()

let batchSeq = 0

export interface BatchView {
  batch: Batch
  jobs: Job[]
  total: number
  done: number
  active: number
  failed: number
  /** ۰ تا ۱۰۰ روی کل بچ */
  percent: number
  /** ثانیه‌ی باقی‌مانده، یا null اگر هنوز قابل تخمین نیست */
  etaSeconds: number | null
  finished: boolean
}

interface DownloadState {
  jobs: Job[]
  batches: Batch[]
  collapsed: boolean
  enqueue: (track: Track, quality: Quality, batch?: Partial<Batch>) => void
  enqueueMany: (tracks: Track[], quality: Quality, batch: Partial<Batch>) => void
  cancel: (jobId: string) => void
  retry: (jobId: string) => void
  remove: (jobId: string) => void
  dismissBatch: (batchId: string) => void
  clearFinished: () => void
  setCollapsed: (v: boolean) => void
}

export const useDownloads = create<DownloadState>((set, get) => {
  function start(job: Job) {
    const stop = api.download({ track: job.track, quality: job.quality }, (p: DownloadProgress) => {
      set({
        jobs: get().jobs.map((j) =>
          j.id === job.id
            ? {
                ...j,
                status: p.status,
                percent: p.percent,
                error: p.error,
                fileUrl: p.fileUrl,
                format: p.format ?? j.format,
                warning: p.warning ?? j.warning,
                lyricsUrl: p.lyricsUrl ?? j.lyricsUrl,
                startedAt:
                  p.status === 'downloading' && !j.startedAt ? Date.now() : j.startedAt,
                finishedAt: p.status === 'ready' ? Date.now() : j.finishedAt,
              }
            : j,
        ),
      })
      const { t } = useI18n.getState()
      if (p.status === 'ready') {
        cancelers.delete(job.id)
        useToasts.getState().push(t.toastReady(job.track.title), 'success')
      } else if (p.status === 'error') {
        cancelers.delete(job.id)
        useToasts.getState().push(t.toastFailed(job.track.title), 'error')
      }
    })
    cancelers.set(job.id, stop)
  }

  function makeBatch(seed: Partial<Batch>, quality: Quality, fallbackTitle: string): Batch {
    return {
      id: seed.id ?? `batch-${++batchSeq}-${Date.now()}`,
      title: seed.title ?? fallbackTitle,
      artworkUrl: seed.artworkUrl ?? null,
      quality,
      createdAt: Date.now(),
    }
  }

  function add(track: Track, quality: Quality, batch: Batch, quiet = false): boolean {
    const existing = get().jobs.find((j) => j.track.id === track.id && isActive(j.status))
    if (existing) {
      if (!quiet) {
        useToasts.getState().push(useI18n.getState().t.toastAlready(track.title), 'info')
      }
      return false
    }
    const job: Job = {
      id: `job-${track.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      batchId: batch.id,
      track,
      quality,
      status: 'queued',
      percent: 0,
      createdAt: Date.now(),
    }
    set({ jobs: [...get().jobs, job] })
    start(job)
    return true
  }

  return {
    jobs: [],
    batches: [],
    collapsed: false,

    enqueue: (track, quality, seed = {}) => {
      const batch = makeBatch(
        { artworkUrl: track.artworkUrl, ...seed },
        quality,
        track.album ?? track.title,
      )
      if (!add(track, quality, batch)) return
      set({ batches: [batch, ...get().batches], collapsed: false })
      useToasts.getState().push(useI18n.getState().t.toastQueued(track.title), 'info')
    },

    enqueueMany: (tracks, quality, seed) => {
      if (!tracks.length) return
      const batch = makeBatch(seed, quality, tracks[0].album ?? tracks[0].title)
      const added = tracks.filter((t) => add(t, quality, batch, true)).length
      if (!added) return
      set({ batches: [batch, ...get().batches], collapsed: false })
      useToasts.getState().push(useI18n.getState().t.toastQueued(batch.title), 'info')
    },

    cancel: (jobId) => {
      cancelers.get(jobId)?.()
      cancelers.delete(jobId)
      set({
        jobs: get().jobs.map((j) =>
          j.id === jobId ? { ...j, status: 'canceled', percent: 0 } : j,
        ),
      })
    },

    retry: (jobId) => {
      const job = get().jobs.find((j) => j.id === jobId)
      if (!job) return
      const fresh: Job = { ...job, status: 'queued', percent: 0, error: undefined, startedAt: undefined }
      set({ jobs: get().jobs.map((j) => (j.id === jobId ? fresh : j)) })
      start(fresh)
    },

    remove: (jobId) => {
      cancelers.get(jobId)?.()
      cancelers.delete(jobId)
      set({ jobs: get().jobs.filter((j) => j.id !== jobId) })
    },

    dismissBatch: (batchId) => {
      get()
        .jobs.filter((j) => j.batchId === batchId)
        .forEach((j) => {
          cancelers.get(j.id)?.()
          cancelers.delete(j.id)
        })
      set({
        jobs: get().jobs.filter((j) => j.batchId !== batchId),
        batches: get().batches.filter((b) => b.id !== batchId),
      })
    },

    clearFinished: () => {
      const jobs = get().jobs.filter((j) => isActive(j.status))
      const liveBatches = new Set(jobs.map((j) => j.batchId))
      set({ jobs, batches: get().batches.filter((b) => liveBatches.has(b.id)) })
    },

    setCollapsed: (collapsed) => set({ collapsed }),
  }
})

/** وضعیت دانلود یک ترک مشخص (برای رندر ردیف‌ها) */
export function useTrackJob(trackId: string): Job | undefined {
  return useDownloads((s) => s.jobs.find((j) => j.track.id === trackId))
}

/** بک‌اند چند ترک را همزمان می‌برد؛ ETA بدون این ضریب چند برابر بیش‌برآورد می‌شود */
const ASSUMED_CONCURRENCY = 3

/**
 * ETA بر اساس میانگین زمان واقعیِ ترک‌های تمام‌شده‌ی همین بچ.
 * تا وقتی حداقل یکی تمام نشده تخمینی نمی‌دهیم — عدد ساختگی بدتر از نبودنش است.
 */
function estimateEta(jobs: Job[]): number | null {
  const completed = jobs.filter((j) => j.finishedAt)
  if (!completed.length) return null

  const avgMs =
    completed.reduce((sum, j) => sum + (j.finishedAt! - j.createdAt), 0) / completed.length

  const remaining = jobs.filter((j) => isActive(j.status))
  if (!remaining.length) return null

  // ترکی که نیمه‌دانلود شده، نصف کار برایش مانده
  const work = remaining.reduce((sum, j) => sum + (1 - j.percent / 100), 0)
  const lanes = Math.min(ASSUMED_CONCURRENCY, remaining.length)
  const seconds = Math.round((work / lanes) * (avgMs / 1000))
  return seconds > 0 ? seconds : null
}

/** بچ‌ها به‌همراه آمار محاسبه‌شده، تازه‌ترین اول */
export function useBatchViews(): BatchView[] {
  const jobs = useDownloads((s) => s.jobs)
  const batches = useDownloads((s) => s.batches)

  return batches.map((batch) => {
    const own = jobs.filter((j) => j.batchId === batch.id)
    const done = own.filter((j) => isDone(j.status)).length
    const active = own.filter((j) => isActive(j.status)).length
    const failed = own.filter((j) => j.status === 'error').length
    const percent = own.length
      ? own.reduce((sum, j) => sum + (isDone(j.status) ? 100 : j.percent), 0) / own.length
      : 0

    return {
      batch,
      jobs: own,
      total: own.length,
      done,
      active,
      failed,
      percent,
      etaSeconds: active ? estimateEta(own) : null,
      finished: own.length > 0 && active === 0,
    }
  })
}

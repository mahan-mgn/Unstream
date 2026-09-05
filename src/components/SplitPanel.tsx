import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { duration as fmtDuration, digits } from '../lib/format'
import { useI18n } from '../lib/i18n'
import type { ChaptersInfo, SplitStatus } from '../lib/types'
import { useSettings } from '../store/settings'
import { useToasts } from '../store/toasts'
import { CheckIcon, ScissorsIcon, Spinner } from './icons'

/** فاصله‌ی پرسیدنِ وضعیت — بریدنِ هر تکه چند ثانیه است، تندتر از این فقط نویز */
const POLL_MS = 1500

interface Props {
  /** لینکِ همان ویدیو/میکسی که صفحه‌ی آلبوم دارد نشانش می‌دهد */
  url: string
}

/**
 * تکه‌کردنِ یک میکسِ بلند به ترک‌های جدا.
 *
 * فقط وقتی خودش را نشان می‌دهد که لینک واقعاً چپتر داشته باشد — پرسیدنش از
 * سرور یک استخراجِ کاملِ yt-dlp است، پس با یک کلیک شروع می‌شود نه خودکار با
 * باز شدنِ هر صفحه‌ی آلبوم.
 *
 * پیشرفت با polling خوانده می‌شود نه SSE: رویدادهای معنادار به تعدادِ
 * چپترهاست، نه ثانیه‌به‌ثانیه.
 */
export default function SplitPanel({ url }: Props) {
  const { t, lang } = useI18n()
  const quality = useSettings((s) => s.quality)
  const pushToast = useToasts((s) => s.push)
  const [checking, setChecking] = useState(false)
  const [info, setInfo] = useState<ChaptersInfo | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [task, setTask] = useState<SplitStatus | null>(null)
  const poll = useRef<ReturnType<typeof setInterval>>(undefined)

  useEffect(() => () => clearInterval(poll.current), [])

  // لینکِ تازه یعنی همه‌چیزِ قبلی بی‌ربط است
  useEffect(() => {
    clearInterval(poll.current)
    setInfo(null)
    setPicked(new Set())
    setTask(null)
  }, [url])

  async function check() {
    setChecking(true)
    try {
      const found = await api.chapters(url)
      if (!found || !found.chapters.length) {
        pushToast(t.splitNoChapters, 'info')
        return
      }
      setInfo(found)
      setPicked(new Set(found.chapters.map((c) => c.index)))
    } catch {
      pushToast(t.splitFailed, 'error')
    } finally {
      setChecking(false)
    }
  }

  function toggle(index: number) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  async function start() {
    if (!info) return
    try {
      const started = await api.split(url, quality, [...picked])
      if (!started) {
        pushToast(t.mockNoFile, 'info')
        return
      }
      setTask(started)
      poll.current = setInterval(async () => {
        const next = await api.splitStatus(started.taskId)
        if (!next) return
        setTask(next)
        if (next.status === 'done' || next.status === 'error') {
          clearInterval(poll.current)
          if (next.status === 'done') pushToast(t.splitDone(next.items.length), 'success')
          else pushToast(next.error || t.splitFailed, 'error')
        }
      }, POLL_MS)
    } catch (err) {
      pushToast(err instanceof Error ? err.message : t.splitFailed, 'error')
    }
  }

  if (!info) {
    return (
      <button
        onClick={() => void check()}
        disabled={checking}
        className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-xs text-muted transition hover:text-fg disabled:opacity-50"
      >
        {checking ? <Spinner className="size-3.5" /> : <ScissorsIcon className="size-3.5" />}
        {checking ? t.splitChecking : t.splitOpen}
      </button>
    )
  }

  const running = task !== null && task.status !== 'done' && task.status !== 'error'

  return (
    <div className="rounded-xl border border-line-soft bg-panel-2/40 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold">{t.splitTitle}</p>
          <p className="text-[11px] text-muted-2">{t.splitHint(info.chapters.length)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() =>
              setPicked(
                picked.size === info.chapters.length
                  ? new Set()
                  : new Set(info.chapters.map((c) => c.index)),
              )
            }
            className="text-[11px] text-accent transition hover:brightness-125"
          >
            {picked.size === info.chapters.length ? t.splitNone : t.splitAll}
          </button>
          <button
            onClick={() => void start()}
            disabled={!picked.size || running}
            className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-[11px] font-semibold text-accent-fg transition enabled:hover:brightness-110 disabled:opacity-50"
          >
            {running ? <Spinner className="size-3" /> : <ScissorsIcon className="size-3" />}
            {t.splitStart(picked.size)}
          </button>
        </div>
      </div>

      {task && (
        <div className="mb-2 rounded-lg border border-line-soft bg-panel px-3 py-2">
          <div className="flex items-center justify-between text-[11px] text-muted">
            <span>
              {task.status === 'downloading'
                ? t.splitWorking
                : task.status === 'done'
                  ? t.splitDone(task.items.length)
                  : task.status === 'error'
                    ? task.error || t.splitFailed
                    : t.splitCutting(task.done, task.total)}
            </span>
            <span className="tabular-nums">{digits(Math.round(task.percent), lang)}٪</span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
            <div
              className="h-full w-full origin-left rtl:origin-right rounded-full bg-accent transition-transform duration-500"
              style={{ transform: `scaleX(${task.percent / 100})` }}
            />
          </div>
        </div>
      )}

      <ul className="scroll-pane max-h-64 space-y-0.5 overflow-y-auto">
        {info.chapters.map((chapter) => (
          <li key={chapter.index}>
            <button
              onClick={() => toggle(chapter.index)}
              disabled={running}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start transition hover:bg-panel-2 disabled:opacity-60"
            >
              <span
                className={`grid size-5 shrink-0 place-items-center rounded border transition sm:size-4 ${
                  picked.has(chapter.index)
                    ? 'border-accent bg-accent text-accent-fg'
                    : 'border-muted-2'
                }`}
              >
                {picked.has(chapter.index) && <CheckIcon className="size-2.5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="bidi block truncate text-xs">{chapter.songTitle}</span>
                {chapter.artist && (
                  <span className="bidi block truncate text-[11px] text-muted-2">
                    <bdi>{chapter.artist}</bdi>
                  </span>
                )}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-2">
                {fmtDuration(chapter.endMs - chapter.startMs, lang)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

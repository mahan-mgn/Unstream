import { useEffect, useRef, useState } from 'react'
import { useDialog } from '../lib/useDialog'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { IdentifyUnavailable, type IdentifyResult, type Track } from '../lib/types'
import { useToasts } from '../store/toasts'
import EmptyState from './EmptyState'
import TrackRow from './TrackRow'
import { CloseIcon, MicIcon, SearchIcon, Spinner } from './icons'

/** بیشتر از این برای فینگرپرینت چیزی اضافه نمی‌کند، فقط آپلود را سنگین می‌کند */
const MAX_SECONDS = 30

const MIME_EXT: Record<string, string> = {
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3',
}

function extensionFor(mime: string): string {
  const base = mime.split(';')[0].trim().toLowerCase()
  return MIME_EXT[base] ?? '.webm'
}

interface Props {
  onClose: () => void
  playingId: string | null
  onTogglePlay: (track: Track) => void
}

/**
 * «این چه آهنگی بود؟» — شناسایی از روی خودِ صدا.
 *
 * همان فینگرپرینتِ آکوستیکی که سرور بعد از هر دانلود برای *تأیید* می‌گیرد،
 * اینجا برعکس استفاده می‌شود. نتیجه‌اش عمداً همان `TrackRow`ِ همیشگی است، نه
 * یک لیستِ مخصوص: از آنجا به بعد دیگر هیچ فرقی با نتیجه‌ی یک جستجوی معمولی
 * ندارد و همه‌ی رفتارهای دانلود بدون کدِ تازه کار می‌کنند.
 */
export default function Identify({ onClose, playingId, onTogglePlay }: Props) {
  // قفلِ اسکرول، تله‌ی فوکوس، برگرداندنِ فوکوس، Escape و دکمه‌ی برگشتِ
  // اندروید — همه از یک جا
  const dialog = useDialog<HTMLDivElement>(true, onClose)

  const { t } = useI18n()
  const pushToast = useToasts((s) => s.push)
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<IdentifyResult | null>(null)
  // پیامِ خودِ سرور، نه یک جمله‌ی ثابت — فقط سرور می‌داند کدام تکه کم است
  const [unavailable, setUnavailable] = useState<string | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const filePicker = useRef<HTMLInputElement>(null)

  // میکروفون باید در هر حالتِ خروج آزاد شود — بستنِ مودال وسطِ ضبط هم
  useEffect(
    () => () => {
      recorder.current?.stream.getTracks().forEach((track) => track.stop())
    },
    [],
  )

  useEffect(() => {
    if (!recording) return
    const id = setInterval(() => setSeconds((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [recording])

  // سقفِ خودکار: کاربری که «تمام» را نزند نباید یک فایلِ چنددقیقه‌ای بفرستد
  useEffect(() => {
    if (recording && seconds >= MAX_SECONDS) stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, seconds])

  async function send(blob: Blob, filename: string) {
    setBusy(true)
    setResult(null)
    setUnavailable(null)
    try {
      setResult(await api.identify(blob, filename))
    } catch (err) {
      if (err instanceof IdentifyUnavailable) {
        setUnavailable(err.message)
        return
      }
      pushToast(err instanceof Error ? err.message : t.identifyFailed, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function start() {
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices) {
      pushToast(t.identifyMicDenied, 'error')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const media = new MediaRecorder(stream)
      const chunks: BlobPart[] = []
      media.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      media.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        const type = media.mimeType || 'audio/webm'
        void send(new Blob(chunks, { type }), `clip${extensionFor(type)}`)
      }
      recorder.current = media
      setSeconds(0)
      setRecording(true)
      media.start()
    } catch {
      pushToast(t.identifyMicDenied, 'error')
    }
  }

  function stop() {
    recorder.current?.stop()
    recorder.current = null
    setRecording(false)
  }

  const matches = result?.matches ?? []
  const best = matches[0]

  return (
    <div
      className="scroll-pane fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-3 pb-[calc(1rem+var(--safe-b))] pt-[calc(1rem+var(--safe-t))] backdrop-blur-sm sm:p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t.identifyTitle}
        className="glass rise w-full max-w-lg overflow-hidden rounded-2xl shadow-2xl sm:mt-16"
      >
        <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <MicIcon className="size-4 text-accent" />
            {t.identifyTitle}
          </h2>
          <button
            onClick={onClose}
            aria-label={t.close}
            className="grid size-9 place-items-center rounded-md text-muted-2 transition hover:bg-panel-2 hover:text-fg sm:size-7"
          >
            <CloseIcon className="size-3.5" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <p className="text-xs leading-relaxed text-muted">{t.identifyHint}</p>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => (recording ? stop() : void start())}
              disabled={busy}
              className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-semibold transition disabled:opacity-50 ${
                recording
                  ? 'bg-danger text-white'
                  : 'bg-accent text-accent-fg hover:brightness-110'
              }`}
            >
              <MicIcon className="size-3.5" />
              {recording ? t.identifyStop : t.identifyRecord}
            </button>

            <button
              onClick={() => filePicker.current?.click()}
              disabled={busy || recording}
              className="inline-flex items-center gap-2 rounded-full border border-line px-3.5 py-2 text-xs text-muted transition hover:text-fg disabled:opacity-50"
            >
              {t.identifyPick}
            </button>
            <input
              ref={filePicker}
              type="file"
              accept="audio/*,video/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                // ورودی باید ریست شود وگرنه انتخابِ دوباره‌ی همان فایل رویداد نمی‌دهد
                e.target.value = ''
                if (file) void send(file, file.name)
              }}
            />
          </div>

          {recording && (
            <p className="text-xs text-accent">{t.identifyRecording(seconds)}</p>
          )}

          {busy && (
            <p className="flex items-center gap-2 text-xs text-muted">
              <Spinner className="size-3.5" />
              {t.identifyWorking}
            </p>
          )}

          {unavailable && (
            <EmptyState icon={<MicIcon className="size-5" />} text={unavailable} bordered={false} />
          )}

          {result && !busy && !best && (
            <EmptyState
              icon={<SearchIcon className="size-5" />}
              text={t.identifyNoMatch}
              bordered={false}
            />
          )}

          {best && (
            <div className="rounded-xl border border-line-soft bg-panel-2/60 p-3">
              <p className="bidi text-sm font-semibold">{best.title}</p>
              <p className="bidi text-xs text-muted">
                <bdi>{best.artist}</bdi>
                {/* بعضی سرویس‌ها عددِ اطمینان نمی‌دهند؛ ساختنِ یک «۱۰۰٪» الکی
                    فقط اعتمادِ بی‌جا می‌سازد */}
                {best.score !== null && (
                  <>
                    <span className="mx-1.5 text-muted-2">·</span>
                    {t.identifyConfidence(Math.round(best.score * 100))}
                  </>
                )}
              </p>

              {matches.length > 1 && (
                <div className="mt-2 border-t border-line-soft pt-2">
                  <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-2">
                    {t.identifyMatches}
                  </p>
                  <ul className="space-y-0.5">
                    {matches.slice(1).map((match) => (
                      <li key={`${match.artist}-${match.title}`} className="bidi text-[11px] text-muted-2">
                        <bdi>{match.artist}</bdi> — {match.title}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {result && result.tracks.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-2">
                {t.identifyResults}
              </p>
              <div className="space-y-0.5">
                {result.tracks.map((track) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    playingId={playingId}
                    onTogglePlay={onTogglePlay}
                    showSource
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useBackDismiss } from '../lib/back'
import { api, API_MODE } from '../lib/api'
import { useI18n } from '../lib/i18n'
import type { Track } from '../lib/types'
import { downloadForQueue } from '../lib/vibePlayback'
import { VIBE_KEYS, vibeLabel } from '../lib/vibes'
import { useMoodChat } from '../store/moodChat'
import { usePlayer, type PlayItem } from '../store/player'
import { useSettings } from '../store/settings'
import { useToasts } from '../store/toasts'
import Artwork from './Artwork'
import {
  ChatIcon,
  CheckDrawIcon,
  CloseIcon,
  PlayIcon,
  QueueIcon,
  RetryIcon,
  SparkleIcon,
  Spinner,
  TrashIcon,
  WarnIcon,
} from './icons'
import PlayButton from './PlayButton'

/** هر پیشنهاد حداکثر ۸ ترک — بیشتر از این فقط دانلودهای موازیِ اضافه است */
const MAX_TRACKS = 8

interface Query {
  vibe?: string
  message?: string
}

interface TrackState {
  track: Track
  status: 'pending' | 'ready' | 'failed'
  /** دلیلِ شکست (وقتی سرور پیامی داده باشد) — برای متنِ زیرِ ردیف و تولتیپِ آیکون */
  error?: string
  /** فقط وقتی status ready است — بدونش دکمه‌ی پخش/افزودن به صف چیزی برای دادن به پلیر ندارد */
  item?: PlayItem
}

type Message =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'bot'; status: 'thinking' }
  | { id: number; role: 'bot'; status: 'error'; query: Query; label: string }
  | { id: number; role: 'bot'; status: 'done'; reply: string; tracks: TrackState[]; query: Query; label: string }

let nextId = 1

const HISTORY_KEY = 'moodchat:history'
// بیشتر از این فقط localStorage را پر می‌کند بدون فایده‌ی واقعی برای گفتگو
const MAX_HISTORY = 60

/** پیامِ «در حالِ فکر کردن» موقتی است — اگر وسطِ یک درخواست رفرش شود، معنایی برای ماندن ندارد */
function readHistory(): Message[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return (parsed as Message[]).filter(
      (m) => typeof m?.id === 'number' && (m.role === 'user' || m.role === 'bot'),
    )
  } catch {
    return []
  }
}

function writeHistory(messages: Message[]) {
  try {
    const persistable = messages.filter((m) => !(m.role === 'bot' && m.status === 'thinking'))
    localStorage.setItem(HISTORY_KEY, JSON.stringify(persistable.slice(-MAX_HISTORY)))
  } catch {
    // سهمیه‌ی localStorage پر است — تاریخچه صرفاً یک راحتی است، نه چیز حیاتی
  }
}

export default function MoodChat() {
  const open = useMoodChat((s) => s.open)
  // دکمه‌ی برگشتِ اندروید پنل را می‌بندد، نه اینکه از صفحه بیرون برود
  useBackDismiss(open, () => useMoodChat.getState().toggle())
  const setOpen = useMoodChat((s) => s.setOpen)
  const toggleOpen = useMoodChat((s) => s.toggle)
  const pendingVibe = useMoodChat((s) => s.pendingVibe)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>(() => {
    const restored = readHistory()
    const maxId = restored.reduce((max, m) => Math.max(max, m.id), 0)
    if (maxId >= nextId) nextId = maxId + 1
    return restored
  })
  const [busy, setBusy] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  // ترک‌هایی که همین گفتگو قبلاً دیده — با هر درخواست فرستاده می‌شود تا
  // پیشنهادِ بعدی همان‌ها را دوباره نیاورد؛ ref است چون خودش رندر نمی‌خواهد.
  // از تاریخچه‌ی بازیابی‌شده هم پر می‌شود، وگرنه بعد از رفرش دوباره تکراری می‌آمد
  const seenIds = useRef<Set<string>>(
    new Set(messages.flatMap((m) => (m.role === 'bot' && m.status === 'done' ? m.tracks.map((ts) => ts.track.id) : []))),
  )
  const { t } = useI18n()

  useEffect(() => {
    writeHistory(messages)
  }, [messages])
  const pushToast = useToasts((s) => s.push)
  const quality = useSettings((s) => s.quality)

  const scrollToEnd = () => {
    requestAnimationFrame(() => {
      const el = listRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }

  const setTrackStatus = (
    botId: number,
    trackId: string,
    status: TrackState['status'],
    error?: string,
    item?: PlayItem,
  ) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === botId && m.role === 'bot' && m.status === 'done'
          ? {
              ...m,
              tracks: m.tracks.map((ts) => (ts.track.id === trackId ? { ...ts, status, error, item } : ts)),
            }
          : m,
      ),
    )
  }

  async function send(query: Query, label: string) {
    if (busy) return
    setBusy(true)

    const userId = nextId++
    const botId = nextId++
    setMessages((prev) => [
      ...prev,
      { id: userId, role: 'user', text: label },
      { id: botId, role: 'bot', status: 'thinking' },
    ])
    setInput('')
    scrollToEnd()

    try {
      // آخرین ۲۰۰ تا کافی است — گفتگو هر چقدر طول بکشد، بدنه‌ی درخواست کوچک می‌ماند
      const excludeIds = Array.from(seenIds.current).slice(-200)
      const result = await api.vibeSuggest({ ...query, excludeIds })
      const tracks = result.tracks.slice(0, MAX_TRACKS)
      tracks.forEach((track) => seenIds.current.add(track.id))
      setMessages((prev) =>
        prev.map((m) =>
          m.id === botId
            ? {
                id: botId,
                role: 'bot',
                status: 'done',
                reply: result.reply,
                tracks: tracks.map((track) => ({ track, status: 'pending' as const })),
                query,
                label,
              }
            : m,
        ),
      )
      scrollToEnd()

      if (!tracks.length) return

      if (API_MODE !== 'http') {
        pushToast(t.moodChatPlaybackUnavailable, 'info')
        return
      }

      // دانلود همه در پس‌زمینه شروع می‌شود تا دکمه‌ی پخش/افزودن به صف زودتر
      // فعال شود — ولی خودِ صفِ پخش را کاربر باید دستی دست بزند، نه اینجا؛
      // باز کردنِ چت و گفتنِ یک حال نباید بی‌اجازه پخشِ فعلی را قطع کند
      await Promise.allSettled(
        tracks.map(async (track) => {
          const { item, error } = await downloadForQueue(track, quality)
          if (!item) {
            setTrackStatus(botId, track.id, 'failed', error)
            return
          }
          setTrackStatus(botId, track.id, 'ready', undefined, item)
        }),
      )
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.id === botId ? { id: botId, role: 'bot', status: 'error', query, label } : m)),
      )
      pushToast(t.moodChatFetchFailed, 'error')
    } finally {
      setBusy(false)
    }
  }

  const sendVibe = (key: string) => void send({ vibe: key }, vibeLabel(t, key))

  // درخواستِ آمده از کاشی‌های خانه. اگر همین حالا درخواستی در جریان باشد
  // نگه داشته می‌شود تا تمام شود — send خودش درخواستِ هم‌زمان را دور می‌ریزد و
  // آن‌وقت کلیکِ کاربر بی‌صدا گم می‌شد.
  useEffect(() => {
    if (!pendingVibe || busy) return
    useMoodChat.getState().consume()
    sendVibe(pendingVibe)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingVibe, busy])

  const sendMessage = () => {
    const text = input.trim()
    if (!text) return
    void send({ message: text }, text)
  }

  const repeat = (query: Query, label: string) => void send(query, label)

  const clearChat = () => {
    setMessages([])
    seenIds.current.clear()
  }

  return (
    <>
      <button
        onClick={toggleOpen}
        aria-label={t.moodChatOpen}
        title={t.moodChatOpen}
        className="bottom-safe fixed start-4 z-40 grid size-14 place-items-center rounded-full bg-accent text-accent-fg shadow-lg shadow-black/40 transition hover:brightness-110 sm:size-12"
      >
        {open ? <CloseIcon className="size-5" /> : <ChatIcon className="size-5" />}
      </button>

      {open && (
        <div
          // ارتفاع هم سقفِ نسبی می‌گیرد: ۲۸rem روی گوشیِ کوتاه (و هر گوشیِ
          // افقی) از بالای صفحه می‌زد بیرون
          className="glass bottom-safe-2 fixed start-3 z-40 flex h-[min(28rem,60dvh)] w-[min(22rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl shadow-2xl shadow-black/40 sm:start-4"
        >
          <div className="flex items-center justify-between gap-2 border-b border-line-soft px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">{t.moodChatTitle}</h2>
              <p className="truncate text-[11px] text-muted-2">{t.moodChatSubtitle}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {messages.length > 0 && (
                <button
                  onClick={clearChat}
                  aria-label={t.moodChatClear}
                  title={t.moodChatClear}
                  className="grid size-7 place-items-center rounded-md text-muted-2 transition hover:bg-panel-2 hover:text-fg"
                >
                  <TrashIcon className="size-4" />
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                aria-label={t.close}
                className="grid size-7 place-items-center rounded-md text-muted-2 transition hover:bg-panel-2 hover:text-fg"
              >
                <CloseIcon className="size-4" />
              </button>
            </div>
          </div>

          <div ref={listRef} className="scroll-pane flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {messages.length === 0 && <IntroBubble text={t.moodChatIntro} />}
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} onRepeat={repeat} />
            ))}
          </div>

          <div className="no-scrollbar flex gap-1.5 overflow-x-auto border-t border-line-soft px-3 py-2">
            {VIBE_KEYS.map((key) => (
              <button
                key={key}
                disabled={busy}
                onClick={() => sendVibe(key)}
                className="shrink-0 rounded-full border border-line bg-panel-2 px-2.5 py-1 text-[11px] text-muted transition hover:border-accent/40 hover:text-fg active:scale-95 disabled:opacity-50"
              >
                {vibeLabel(t, key)}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              sendMessage()
            }}
            className="flex items-center gap-2 border-t border-line-soft p-2.5"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t.moodChatPlaceholder}
              disabled={busy}
              className="w-full rounded-full border border-line bg-panel-2 px-3 py-1.5 text-xs outline-none placeholder:text-muted-2 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              aria-label={t.moodChatSend}
              title={t.moodChatSend}
              className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-accent-fg transition hover:brightness-110 disabled:opacity-50"
            >
              <ChatIcon className="size-4" />
            </button>
          </form>
        </div>
      )}
    </>
  )
}

/** آواتارِ کوچکِ بات — کنارِ هر حبابِ بات، برای هویتِ بصری در برابرِ حباب‌های خنثیِ کاربر */
function BotAvatar() {
  return (
    <div className="grid size-6 shrink-0 place-items-center self-end rounded-full bg-accent/15 text-accent">
      <SparkleIcon className="size-3.5" />
    </div>
  )
}

/**
 * سه نقطه‌ی «در حالِ فکر کردن» — قراردادِ بصریِ چت‌ها. اسپینرِ قبلی «دارد
 * می‌چرخد» می‌گفت، نقطه‌ها «داره فکر می‌کنه» می‌گویند؛ برای یک گفتگو دومی
 * درست‌تر است.
 */
function ThinkingDots() {
  return (
    <span className="flex items-center gap-1" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="think-dot size-1.5 rounded-full bg-muted"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  )
}

function IntroBubble({ text }: { text: string }) {
  return (
    <div className="rise flex justify-start gap-1.5">
      <BotAvatar />
      <p className="max-w-[85%] rounded-2xl rounded-ss-sm bg-panel-2 px-3 py-2 text-xs text-muted">{text}</p>
    </div>
  )
}

function MessageBubble({ message, onRepeat }: { message: Message; onRepeat: (query: Query, label: string) => void }) {
  const { t } = useI18n()

  if (message.role === 'user') {
    return (
      <div className="rise flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-ee-sm bg-accent px-3 py-1.5 text-xs text-accent-fg">
          {message.text}
        </p>
      </div>
    )
  }

  return (
    <div className="rise flex justify-start gap-1.5">
      <BotAvatar />
      <div className="max-w-[85%] rounded-2xl rounded-ss-sm bg-panel-2 px-3 py-2 text-xs">
        {message.status === 'thinking' && (
          <span className="flex items-center gap-2 text-muted">
            <ThinkingDots />
            {t.moodChatThinking}
          </span>
        )}
        {message.status === 'error' && (
          <div className="space-y-1.5">
            <p className="text-danger">{t.moodChatFetchFailed}</p>
            <button
              onClick={() => onRepeat(message.query, message.label)}
              className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[11px] text-fg transition hover:bg-panel"
            >
              <RetryIcon className="size-3" />
              {t.moodChatRetry}
            </button>
          </div>
        )}
        {message.status === 'done' && (
          <MessageDone message={message} onRepeat={onRepeat} />
        )}
      </div>
    </div>
  )
}

function MessageDone({
  message,
  onRepeat,
}: {
  message: Extract<Message, { status: 'done' }>
  onRepeat: (query: Query, label: string) => void
}) {
  const { t } = useI18n()
  const readyItems = message.tracks.filter((ts) => ts.status === 'ready' && ts.item).map((ts) => ts.item!)

  return (
    <div className="space-y-2">
      <p>{message.reply}</p>
      {message.tracks.length === 0 ? (
        <p className="text-muted-2">{t.moodChatNoResults}</p>
      ) : (
        <ul className="space-y-1.5">
          {message.tracks.map(({ track, status, error, item }) => (
            <li key={track.id}>
              <div className="flex items-center gap-2">
                <Artwork
                  src={track.artworkUrl}
                  alt={track.title}
                  seed={track.albumId ?? track.id}
                  className="size-7 shrink-0"
                />
                <span className="min-w-0 flex-1 truncate">
                  <bdi>{track.title}</bdi> — <bdi className="text-muted-2">{track.artist}</bdi>
                </span>
                {status === 'pending' && <Spinner className="size-3.5 shrink-0 text-muted-2" />}
                {status === 'ready' && item && (
                  <span className="flex shrink-0 items-center gap-1.5">
                    {/* تیکِ کشیده‌شده: لحظه‌ی «آماده شد» دیده شود، نه اینکه بی‌صدا رد شود */}
                    <CheckDrawIcon className="size-3.5 text-accent" />
                    <PlayButton items={readyItems} index={readyItems.indexOf(item)} />
                  </span>
                )}
                {status === 'failed' && (
                  <span title={error || t.moodChatTrackFailed} className="shake shrink-0">
                    <WarnIcon className="size-3.5 text-danger" />
                  </span>
                )}
              </div>
              {status === 'failed' && (
                <p className="ps-9 text-[10px] text-danger">{error || t.moodChatTrackFailed}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        {readyItems.length > 0 && (
          <>
            <button
              onClick={() => usePlayer.getState().play(readyItems)}
              className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-fg transition hover:brightness-110"
            >
              <PlayIcon className="size-3" />
              {t.moodChatPlay}
            </button>
            <button
              onClick={() => usePlayer.getState().enqueue(readyItems)}
              className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[11px] text-muted transition hover:text-fg"
            >
              <QueueIcon className="size-3" />
              {t.moodChatAddQueue}
            </button>
          </>
        )}
        <button
          onClick={() => onRepeat(message.query, message.label)}
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-muted-2 transition hover:text-fg"
        >
          <SparkleIcon className="size-3" />
          {t.moodChatMore}
        </button>
      </div>
    </div>
  )
}

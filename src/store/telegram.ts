import { create } from 'zustand'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import type { TelegramPairing, TelegramSendRequest, TelegramSendStatus, TelegramStatus } from '../lib/types'
import { useToasts } from './toasts'

/**
 * دکمه‌ی «فرستادن به تلگرام».
 *
 * وب توکنِ تلگرام ندارد و نمی‌داند چتِ کاربر کدام است، پس کلیک فقط یک ردیف در
 * صفِ سرور می‌گذارد و پروسه‌ی بات آن را برمی‌دارد. یعنی «فرستاده شد» فوری
 * نیست: باید تا وقتی بات جواب بدهد پیگیری شود، وگرنه کاربر نمی‌فهمد آهنگش
 * واقعاً رسیده یا وسطِ راه شکسته.
 */

/** کلیدِ یکتا برای هر دکمه — دو دکمه‌ی یک ترک در دو صفحه باید یک حال داشته باشند */
export const trackKey = (trackId: string) => `track:${trackId}`
export const albumKey = (ref: string) => `album:${ref}`

export const sendKey = (req: TelegramSendRequest) =>
  req.kind === 'track' ? trackKey(req.track.id) : albumKey(req.ref)

const sendTitle = (req: TelegramSendRequest) =>
  req.kind === 'track' ? req.track.title : req.title

const toast = (text: string, tone: 'info' | 'success' | 'error') =>
  useToasts.getState().push(text, tone)

/** فاصله‌ی پیگیریِ وضعیتِ یک ارسال */
const POLL_MS = 1500

/**
 * سقفِ پیگیری. یک آلبومِ سی‌تایی روی اتصالِ کند واقعاً می‌تواند نیم‌ساعت طول
 * بکشد؛ بعد از این، دکمه از حالتِ «در حال ارسال» درمی‌آید ولی خودِ صف سرِ جایش
 * است و بات کارش را تمام می‌کند.
 */
const POLL_TIMEOUT_MS = 30 * 60 * 1000

/** فاصله‌ی چک‌کردنِ «وصل شد؟» وقتی پنجره‌ی کد باز است */
const PAIR_POLL_MS = 2000

interface TelegramState {
  /** null یعنی هنوز نپرسیده‌ایم یا این سرور اصلاً بات ندارد */
  status: TelegramStatus | null
  /** این نصب اصلاً قابلیتِ تلگرام دارد؟ (سرورِ قدیمی یا مود دمو ندارد) */
  supported: boolean
  checked: boolean
  /** حالِ هر دکمه، بر اساس کلیدش */
  sends: Record<string, TelegramSendStatus>
  /**
   * دلیلِ شکست، به همان کلید.
   *
   * بدونش دکمه فقط یک مثلثِ قرمز بود و کاربر هیچ راهی نداشت بفهمد چه شده —
   * حتی وقتی سرور دقیقاً گفته بود («باز کردنِ آلبوم ناموفق بود: …»).
   */
  errors: Record<string, string>
  pairing: TelegramPairing | null
  pairingBusy: boolean
  pairingError: string | null
  /** کاری که کاربر خواسته بود ولی هنوز وصل نبود — بعدِ وصل‌شدن خودش می‌رود */
  pending: TelegramSendRequest | null

  refresh: () => Promise<TelegramStatus | null>
  /**
   * true یعنی در صف نشست؛ false یعنی پنجره‌ی وصل‌شدن باز شد یا خطا خورد.
   *
   * خودش toast می‌زند و پرت نمی‌کند — مثل `store/downloads`؛ سه جای مختلف که
   * این دکمه را دارند نباید هرکدام خطای یکسان را جدا مدیریت کنند.
   */
  send: (req: TelegramSendRequest) => Promise<boolean>
  openPairing: (pending?: TelegramSendRequest | null) => Promise<void>
  closePairing: () => void
  unlink: () => Promise<void>
}

/**
 * دکمه‌ها را فقط وقتی نشان بده که واقعاً کار می‌کنند.
 *
 * سرویسِ بات اختیاری است و ممکن است اصلاً بالا نباشد؛ دکمه‌ای که کلیکش حتماً
 * به خطا می‌خورد بدتر از نبودنش است. وضعیتِ خودِ اتصال همچنان در فوتر دیده
 * می‌شود، پس چیزی پنهان نمی‌ماند.
 */
export const usable = (s: TelegramState) => s.status !== null && s.status.connected

/** یک پیگیریِ فعال به‌ازای هر کلید — کلیکِ دوباره نباید دو حلقه بسازد */
const polls = new Map<string, number>()
let pairTimer: ReturnType<typeof setInterval> | undefined

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const useTelegram = create<TelegramState>((set, get) => ({
  status: null,
  supported: false,
  checked: false,
  sends: {},
  errors: {},
  pairing: null,
  pairingBusy: false,
  pairingError: null,
  pending: null,

  refresh: async () => {
    try {
      const status = await api.telegramStatus()
      set({ status, supported: status !== null, checked: true })
      return status
    } catch {
      // سرورِ قدیمی یا قطعیِ لحظه‌ای — دکمه فقط پنهان می‌ماند، خطایی به کاربر نه
      set({ status: null, supported: false, checked: true })
      return null
    }
  },

  send: async (req) => {
    const key = sendKey(req)
    if (get().sends[key] === 'pending' || get().sends[key] === 'sending') return true

    // وضعیت ممکن است کهنه باشد (بات تازه بالا آمده یا اتصال قطع شده)
    const status = await get().refresh()
    if (!status?.linked) {
      await get().openPairing(req)
      return false
    }

    set({ sends: { ...get().sends, [key]: 'pending' } })
    let sendId: string
    try {
      sendId = (await api.telegramSend(req)).id
    } catch (err) {
      fail(key, sendTitle(req), err instanceof Error ? err.message : String(err), set, get)
      return false
    }

    toast(useI18n.getState().t.telegramQueued, 'info')
    void track(key, sendTitle(req), sendId, set, get)
    return true
  },

  openPairing: async (pending = null) => {
    set({ pairingBusy: true, pairingError: null, pending, pairing: null })
    try {
      const pairing = await api.telegramPair()
      set({ pairing, pairingBusy: false })
      watchPairing(get)
    } catch (err) {
      set({
        pairingBusy: false,
        pairingError: err instanceof Error ? err.message : String(err),
      })
    }
  },

  closePairing: () => {
    if (pairTimer !== undefined) clearInterval(pairTimer)
    pairTimer = undefined
    set({ pairing: null, pairingBusy: false, pairingError: null, pending: null })
  },

  unlink: async () => {
    await api.telegramUnlink()
    await get().refresh()
  },
}))

type Set = (partial: Partial<TelegramState>) => void
type Get = () => TelegramState

/**
 * تا وقتی بات جواب بدهد وضعیت را می‌پرسد.
 *
 * خطای شبکه پایان کار نیست — سرور ممکن است لحظه‌ای در دسترس نباشد در حالی که
 * فایل دارد می‌رود؛ فقط تلاشِ بعدی.
 */
function fail(key: string, title: string, why: string, set: Set, get: Get): void {
  set({
    sends: { ...get().sends, [key]: 'error' },
    errors: { ...get().errors, [key]: why },
  })
  toast(useI18n.getState().t.telegramSendFailed(title, why), 'error')
}

async function track(
  key: string,
  title: string,
  sendId: string,
  set: Set,
  get: Get,
): Promise<void> {
  const started = Date.now()
  const token = (polls.get(key) ?? 0) + 1
  polls.set(key, token)

  while (Date.now() - started < POLL_TIMEOUT_MS) {
    await sleep(POLL_MS)
    // دکمه دوباره زده شده و پیگیریِ تازه‌تری جایش را گرفته
    if (polls.get(key) !== token) return

    let send: { status: TelegramSendStatus; error: string | null }
    try {
      send = await api.telegramSendStatus(sendId)
    } catch {
      continue
    }

    if (send.status === 'error') {
      polls.delete(key)
      // دلیل از خودِ بات می‌آید، نه یک جمله‌ی عمومیِ ما
      fail(key, title, send.error ?? useI18n.getState().t.telegramFailed, set, get)
      return
    }

    set({ sends: { ...get().sends, [key]: send.status } })
    if (send.status === 'done') {
      polls.delete(key)
      toast(useI18n.getState().t.telegramSent(title), 'success')
      return
    }
  }
  polls.delete(key)
}

/** تا وقتی کاربر کد را در تلگرام خرج کند صبر می‌کند، بعد کارِ معطل‌مانده را می‌فرستد. */
function watchPairing(get: Get): void {
  if (pairTimer !== undefined) clearInterval(pairTimer)
  pairTimer = setInterval(() => {
    void (async () => {
      const status = await get().refresh()
      if (!status?.linked) return

      const pending = get().pending
      get().closePairing()
      if (pending) await get().send(pending)
    })()
  }, PAIR_POLL_MS)
}

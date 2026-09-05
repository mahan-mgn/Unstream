import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { App } from '@capacitor/app'
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'
import { Network } from '@capacitor/network'
import { SplashScreen } from '@capacitor/splash-screen'
import { Share } from '@capacitor/share'
import { StatusBar, Style } from '@capacitor/status-bar'
import { isNativeApp } from './server'

/**
 * تنها دروازه‌ی اپ به قابلیت‌های اندروید.
 *
 * هر تابعِ اینجا روی وب یک no-op است، پس بقیه‌ی کد هیچ‌جا `if (native)`
 * نمی‌نویسد. دلیلش تجربه‌ی همین پروژه است: اولین باری که یک شرطِ نیتیو وسطِ
 * کامپوننت رفت، بعدش هر کامپوننتِ جدید هم یکی برای خودش گذاشت و هیچ‌کدام هم
 * روی وب تست نشدند.
 */

/* ---------- پلاگین‌های سفارشی (کدشان در android/app/src/main/java) ---------- */

export interface PlaybackMeta {
  title: string
  artist: string
  album: string
  artworkUrl: string
  playing: boolean
  /** ثانیه */
  position: number
  duration: number
}

export type TransportAction = 'play' | 'pause' | 'next' | 'prev' | 'stop' | 'seek'

interface PlaybackPlugin {
  sync(options: PlaybackMeta): Promise<void>
  stop(): Promise<void>
  ensurePermission(): Promise<{ granted: boolean }>
  addListener(
    event: 'transport',
    handler: (data: { action: TransportAction; value: number }) => void,
  ): Promise<PluginListenerHandle>
}

interface SafeInsets {
  ready: boolean
  top?: number
  bottom?: number
  left?: number
  right?: number
}

interface ShellPlugin {
  insets(): Promise<SafeInsets>
  takeSharedText(): Promise<{ text: string }>
  addListener(event: 'insets', handler: (data: SafeInsets) => void): Promise<PluginListenerHandle>
  addListener(
    event: 'shared',
    handler: (data: { text: string }) => void,
  ): Promise<PluginListenerHandle>
}

interface DownloadsPlugin {
  save(options: {
    url: string
    title: string
    artist: string
    album: string
    ext: string
  }): Promise<{ uri: string; name: string }>
  addListener(
    event: 'progress',
    handler: (data: { url: string; received: number; total: number }) => void,
  ): Promise<PluginListenerHandle>
}

const Playback = registerPlugin<PlaybackPlugin>('Playback')
const Shell = registerPlugin<ShellPlugin>('Shell')
const Downloads = registerPlugin<DownloadsPlugin>('Downloads')

/* ---------- نوتیفیکیشن و کنترل پخش ---------- */

/**
 * وضعیتِ پخش را روی نوتیفیکیشنِ سیستم می‌نشاند.
 *
 * پرتاب‌شدنِ استثنا اینجا عمداً بی‌صدا بلعیده می‌شود: نوتیفیکیشن یک راحتی است،
 * و شکستنِ پخش به‌خاطرِ شکستِ نوتیفیکیشن معامله‌ی بدی است.
 */
export function syncPlayback(meta: PlaybackMeta): void {
  if (!isNativeApp()) return
  void Playback.sync(meta).catch(() => {})
}

export function stopPlaybackNotification(): void {
  if (!isNativeApp()) return
  void Playback.stop().catch(() => {})
}

/** دکمه‌های نوتیفیکیشن/صفحه‌ی قفل/هدفون → پخش‌کننده‌ی جاوااسکریپتی */
export function onTransport(
  handler: (action: TransportAction, value: number) => void,
): () => void {
  if (!isNativeApp()) return () => {}
  let handle: PluginListenerHandle | undefined
  void Playback.addListener('transport', ({ action, value }) => handler(action, value)).then(
    (h) => {
      handle = h
    },
  )
  return () => void handle?.remove()
}

/**
 * اجازه‌ی نوتیفیکیشن (اندروید ۱۳ به بعد).
 *
 * وقتی پرسیده می‌شود که کاربر اولین بار چیزی را پخش می‌کند، نه موقعِ باز شدنِ
 * اپ: پنجره‌ی اجازه‌ای که پیش از دیدنِ هر چیزی می‌پرد، معمولاً «نه» می‌گیرد.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!isNativeApp()) return false
  try {
    const { granted } = await Playback.ensurePermission()
    return granted
  } catch {
    return false
  }
}

/* ---------- ذخیره در حافظه‌ی گوشی ---------- */

/** آیا این دستگاه اصلاً می‌تواند در کتابخانه‌ی موسیقیِ سیستم بنویسد؟ */
export const canSaveToDevice = (): boolean => isNativeApp()

/**
 * فایل را در `Music/Unstream` گوشی می‌نشاند تا هر موزیک‌پلیرِ دیگری هم ببیندش.
 *
 * آدرس باید *مطلق* باشد؛ مسیرهای `/api/...` داخل اپ یعنی «خودِ اپ» و اینجا
 * دانلودشان به ۴۰۴ می‌خورد — صداکننده باید از `absolute()` ردشان کند.
 */
export async function saveToDevice(options: {
  url: string
  title: string
  artist?: string
  album?: string
  ext?: string
}): Promise<string | null> {
  if (!isNativeApp()) return null
  const { uri } = await Downloads.save({
    url: options.url,
    title: options.title,
    artist: options.artist ?? '',
    album: options.album ?? '',
    ext: options.ext ?? 'mp3',
  })
  return uri
}

/** پیشرفتِ ذخیره‌سازی — برای فایل‌های چندده‌مگابایتی روی وای‌فایِ کند */
export function onSaveProgress(
  handler: (data: { url: string; received: number; total: number }) => void,
): () => void {
  if (!isNativeApp()) return () => {}
  let handle: PluginListenerHandle | undefined
  void Downloads.addListener('progress', handler).then((h) => {
    handle = h
  })
  return () => void handle?.remove()
}

/* ---------- بازخورد لمسی ---------- */

/**
 * لرزشِ ریز.
 *
 * سه شدت بیشتر نداریم و عمداً هم بیشتر نمی‌شود: هپتیکِ زیاد از هپتیکِ نبود
 * بدتر است — گوشی توی جیب می‌لرزد و کاربر خاموشش می‌کند.
 *
 *  - `tap`: هر دکمه‌ی معمولی
 *  - `select`: عوض شدنِ تب یا انتخاب از لیست
 *  - `success` / `warn`: پایانِ یک کارِ بلند (دانلود تمام شد / شکست خورد)
 */
export const haptic = {
  tap: () => fire(() => Haptics.impact({ style: ImpactStyle.Light })),
  medium: () => fire(() => Haptics.impact({ style: ImpactStyle.Medium })),
  select: () => fire(() => Haptics.selectionChanged()),
  success: () => fire(() => Haptics.notification({ type: NotificationType.Success })),
  warn: () => fire(() => Haptics.notification({ type: NotificationType.Warning })),
}

function fire(run: () => Promise<unknown>): void {
  if (!isNativeApp()) return
  void run().catch(() => {})
}

/* ---------- شبکه ---------- */

/**
 * قطع و وصل شدنِ شبکه.
 *
 * روی وب `navigator.onLine` جوابِ درستی می‌دهد، ولی داخل WebViewِ اندروید
 * قابل‌اعتماد نیست: بعد از خوابیدن و بیدار شدنِ گوشی گاهی روی مقدارِ قبلی
 * می‌ماند. پس آنجا از خودِ سیستم پرسیده می‌شود.
 *
 * توجه: «آنلاین» اینجا یعنی گوشی به شبکه‌ای وصل است — نه این‌که سرورِ آنستریم
 * در دسترس است. آن یکی فقط با شکستِ خودِ درخواست معلوم می‌شود و جای دیگری
 * (توستِ خطا) گزارش می‌شود.
 */
export function onNetworkChange(handler: (online: boolean) => void): () => void {
  if (!isNativeApp()) {
    const update = () => handler(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }

  let handle: PluginListenerHandle | undefined
  void Network.getStatus().then(({ connected }) => handler(connected))
  void Network.addListener('networkStatusChange', ({ connected }) => handler(connected)).then(
    (h) => {
      handle = h
    },
  )
  return () => void handle?.remove()
}

/* ---------- اشتراک‌گذاری ---------- */

/** شیتِ اشتراک‌گذاریِ اندروید؛ روی وب به Web Share یا کپی می‌افتد */
export async function share(options: {
  title: string
  text?: string
  url?: string
}): Promise<boolean> {
  try {
    if (isNativeApp()) {
      await Share.share({ title: options.title, text: options.text, url: options.url })
      return true
    }
    if (navigator.share) {
      await navigator.share(options)
      return true
    }
    await navigator.clipboard.writeText(options.url ?? options.text ?? options.title)
    return true
  } catch {
    // کاربر شیت را بست — این خطا نیست
    return false
  }
}

/* ---------- دکمه‌ی برگشتِ سخت‌افزاری ---------- */

/**
 * دکمه‌ی برگشتِ اندروید.
 *
 * پیش‌فرضِ Capacitor «خروج از اپ» است — یعنی از داخلِ یک آلبوم، یک ضربه‌ی
 * برگشت کلِ اپ را می‌بست. اینجا هندلر خودش تصمیم می‌گیرد؛ اگر `false` برگرداند
 * یعنی «چیزی برای بستن نداشتم» و آن‌وقت اپ به پس‌زمینه می‌رود (نه بسته شود، تا
 * پخش ادامه داشته باشد).
 */
export function onBackButton(handler: () => boolean): () => void {
  if (!isNativeApp()) return () => {}
  let handle: PluginListenerHandle | undefined
  void App.addListener('backButton', () => {
    if (handler()) return
    // `exitApp` پروسه را می‌کشد و پخش را با خودش می‌برد؛ این یکی فقط
    // اپ را می‌فرستد پس‌زمینه، مثل دکمه‌ی خانه
    void App.minimizeApp()
  }).then((h) => {
    handle = h
  })
  return () => void handle?.remove()
}

/**
 * متنی که از «اشتراک‌گذاری»ِ اپِ دیگری آمده — معمولاً لینکِ یک آلبوم یا ترک.
 *
 * دو راه دارد و هر دو لازم‌اند: اگر اپ بسته بوده، اینتنت پیش از سوارشدنِ رابط
 * رسیده و باید *کشیده* شود (`takeSharedText`)؛ اگر باز بوده، به‌شکلِ رویداد
 * می‌آید. بدونِ اولی، اشتراک‌گذاری روی اپِ بسته هیچ اتفاقی نمی‌افتاد.
 */
export function onSharedText(handler: (text: string) => void): () => void {
  if (!isNativeApp()) return () => {}

  void Shell.takeSharedText()
    .then(({ text }) => text && handler(text))
    .catch(() => {})

  let handle: PluginListenerHandle | undefined
  void Shell.addListener('shared', ({ text }) => text && handler(text)).then((h) => {
    handle = h
  })
  return () => void handle?.remove()
}

/* ---------- راه‌اندازیِ پوسته ---------- */

/**
 * حاشیه‌های امن را روی متغیرهای CSS می‌نشاند.
 *
 * همان متغیرهایی که `index.css` از `env()` پر می‌کند؛ اینجا فقط با مقدارِ
 * دقیق‌ترِ سیستم بازنویسی می‌شوند. ترتیب مهم است: چون روی `documentElement`
 * به‌شکلِ inline ست می‌شوند، از تعریفِ داخل استایل‌شیت جلو می‌زنند.
 */
function applyInsets(value: SafeInsets): void {
  if (!value.ready) return
  const root = document.documentElement.style
  root.setProperty('--safe-t', `${value.top ?? 0}px`)
  root.setProperty('--safe-b', `${value.bottom ?? 0}px`)
  root.setProperty('--safe-l', `${value.left ?? 0}px`)
  root.setProperty('--safe-r', `${value.right ?? 0}px`)
}

/** رنگِ آیکون‌های نوار وضعیت با تمِ اپ هماهنگ می‌شود */
export function syncStatusBar(theme: 'dark' | 'light'): void {
  if (!isNativeApp()) return
  // تمِ تیره = پس‌زمینه‌ی تیره = آیکون‌های روشن. نامِ `Style.Dark` در Capacitor
  // یعنی «محتوای تیره پشتِ نوار»، پس همین درست است.
  void StatusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light }).catch(() => {})
}

/**
 * یک‌بار در بالا آمدنِ اپ صدا زده می‌شود.
 *
 * ترتیبش عمدی است: اول حاشیه‌ها و نوارها درست می‌شوند، *بعد* اسپلش می‌رود.
 * برعکسش یعنی کاربر یک فریم چیدمانِ جابه‌جاشده می‌بیند و همان یک فریم است که
 * حس «وب‌سایت داخل اپ» می‌دهد.
 */
export async function setupNative(): Promise<void> {
  if (!isNativeApp()) return

  try {
    await StatusBar.setOverlaysWebView({ overlay: true })
    // ست‌کردنش لازم است حتی با overlay: بعضی پوسته‌ها وگرنه یک نوارِ خاکستری
    // پشتِ نوار وضعیت می‌گذارند
    await StatusBar.setBackgroundColor({ color: '#00000000' })
  } catch {
    // نوار وضعیت روی این دستگاه دست‌نیافتنی است؛ چیدمان همچنان کار می‌کند
  }

  try {
    const insets = await Shell.insets()
    applyInsets(insets)
    void Shell.addListener('insets', applyInsets)
  } catch {
    // `env()` جای خالی را می‌گیرد
  }

  try {
    /*
     * محوشدنِ اسپلش از `launchFadeOutDuration` در `capacitor.config.ts` می‌آید،
     * نه از پارامترِ اینجا: پلاگین برای *اولین* اسپلش پارامتر را نادیده
     * می‌گیرد و فقط یک هشدار در لاگ می‌گذارد.
     */
    await SplashScreen.hide()
  } catch {
    // اسپلش خودش با تایم‌اوت می‌رود
  }
}

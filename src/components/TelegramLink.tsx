import { useDialog } from '../lib/useDialog'
import { useI18n } from '../lib/i18n'
import { useTelegram } from '../store/telegram'
import { CheckIcon, CloseIcon, LinkIcon, Spinner, TelegramIcon } from './icons'

/**
 * پنجره‌ی وصل‌کردنِ تلگرام.
 *
 * سرور نمی‌داند کاربر کدام چت است و نباید هم بداند — پس یک کدِ یک‌بارمصرف
 * می‌سازد و هر چتی که آن را خرج کند مقصد می‌شود. لینکِ عمیق حالتِ معمول است
 * (یک کلیک، بدون تایپ)؛ خودِ کد برای وقتی است که لینک باز نشود — مثلاً وقتی
 * تلگرام روی همین دستگاه نصب نیست و کاربر از موبایلش می‌فرستد.
 *
 * بسته‌شدنش خودکار است: به‌محضِ اینکه سرور بگوید وصل شد، همان کاری که کاربر
 * اول خواسته بود می‌رود.
 */
export default function TelegramLink() {
  const { t } = useI18n()
  // سلکتورهای باریک، نه کلِ استور: وضعیتِ هر ارسال هر ثانیه‌ونیم عوض می‌شود و
  // این پنجره (که همیشه مانت است) نباید با هر تیک دوباره رندر شود
  const pairing = useTelegram((s) => s.pairing)
  const pairingBusy = useTelegram((s) => s.pairingBusy)
  const pairingError = useTelegram((s) => s.pairingError)
  const closePairing = useTelegram((s) => s.closePairing)
  const botUsername = useTelegram((s) => s.status?.botUsername ?? null)

  const open = pairingBusy || pairing !== null || pairingError !== null

  // `open` پارامترِ خودِ هوک است، پس ترتیبِ هوک‌ها با باز و بسته شدنِ پنجره
  // به‌هم نمی‌ریزد — و همین اجازه می‌دهد `return null`ِ زیر سرِ جایش بماند
  const dialog = useDialog<HTMLDivElement>(open, closePairing)

  if (!open) return null

  return (
    <div
      className="scroll-pane fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-3 pb-[calc(1rem+var(--safe-b))] pt-[calc(1rem+var(--safe-t))] backdrop-blur-sm sm:p-4"
      onClick={(e) => e.target === e.currentTarget && closePairing()}
    >
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t.telegramLinkTitle}
        className="glass rise w-full max-w-md overflow-hidden rounded-2xl shadow-2xl sm:mt-24"
      >
        <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <TelegramIcon className="size-4 text-accent" />
            {t.telegramLinkTitle}
          </h2>
          <button
            onClick={closePairing}
            aria-label={t.close}
            className="grid size-9 place-items-center rounded-md text-muted-2 transition hover:bg-panel-2 hover:text-fg sm:size-7"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          {pairingError ? (
            <p className="bidi text-xs text-danger">{pairingError}</p>
          ) : pairingBusy || !pairing ? (
            <div className="flex items-center gap-2 py-6 text-xs text-muted">
              <Spinner className="size-4" />
              {t.telegramLinkLoading}
            </div>
          ) : (
            <>
              <p className="bidi text-xs leading-6 text-muted">{t.telegramLinkHint}</p>

              {pairing.deepLink && (
                <a
                  href={pairing.deepLink}
                  target="_blank"
                  rel="noreferrer"
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg transition hover:brightness-110"
                >
                  <LinkIcon className="size-4" />
                  {botUsername ? t.telegramOpenBot(botUsername) : t.telegramOpen}
                </a>
              )}

              <div className="rounded-xl border border-line-soft bg-panel-2/40 p-3 text-center">
                <p className="text-[11px] text-muted-2">{t.telegramCodeHint}</p>
                <p className="mt-1.5 select-all break-all font-mono text-xl font-bold tracking-[0.2em] text-fg sm:text-2xl sm:tracking-[0.3em]">
                  {pairing.code}
                </p>
              </div>

              <p className="flex items-center gap-2 text-[11px] text-muted-2">
                <Spinner className="size-3.5" />
                {t.telegramWaiting}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * سطرِ اتصال در فوتر — تنها جایی که می‌شود دید فایل‌ها به کدام چت می‌روند و
 * قطعش کرد. اینجا برخلافِ خودِ دکمه‌ها وقتی بات پایین است هم چیزی نشان می‌دهد،
 * وگرنه قابلیت بی‌صدا ناپدید می‌شد و کاربر نمی‌فهمید چرا.
 */
export function TelegramConnection() {
  const { t } = useI18n()
  const status = useTelegram((s) => s.status)
  const supported = useTelegram((s) => s.supported)
  const unlink = useTelegram((s) => s.unlink)
  const openPairing = useTelegram((s) => s.openPairing)

  if (!supported || !status) return null

  if (!status.connected) {
    return <p className="bidi text-[11px] text-muted-2">{t.telegramBotDown}</p>
  }

  if (!status.linked) {
    return (
      <button
        onClick={() => void openPairing()}
        className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition hover:border-muted-2 hover:text-fg"
      >
        <TelegramIcon className="size-3.5" />
        {t.telegramConnect}
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <CheckIcon className="size-3.5 shrink-0 text-accent" />
      <span className="bidi min-w-0 flex-1 truncate text-muted">
        {t.telegramLinkedTo(status.chatTitle ?? '')}
      </span>
      <button
        onClick={() => void unlink()}
        className="shrink-0 rounded-lg px-2 py-1 text-[11px] text-muted-2 transition hover:bg-panel-2 hover:text-danger"
      >
        {t.telegramDisconnect}
      </button>
    </div>
  )
}

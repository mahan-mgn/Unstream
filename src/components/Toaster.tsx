import { useI18n } from '../lib/i18n'
import { useToasts } from '../store/toasts'
import { CheckIcon, CloseIcon } from './icons'

const TONE = {
  info: 'text-muted',
  success: 'text-accent',
  error: 'text-danger',
} as const

export default function Toaster() {
  const { toasts, dismiss } = useToasts()
  const { t } = useI18n()

  return (
    // پنل دانلود گوشه‌ی end است، پس توست‌ها گوشه‌ی مقابل می‌نشینند — و یک
    // ردیف بالاتر از دکمه‌های شناور، وگرنه روی گوشی دقیقاً رویشان می‌افتادند
    <div className="bottom-safe-2 pointer-events-none fixed start-3 z-50 flex w-[min(19rem,calc(100vw-1.5rem))] flex-col gap-2 sm:start-4">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={`${toast.leaving ? 'toast-out' : 'toast-in'} glass pointer-events-auto flex items-center gap-2 rounded-xl px-3 py-2.5 shadow-xl shadow-black/40`}
        >
          <span className={`shrink-0 ${TONE[toast.tone]}`}>
            {toast.tone === 'success' ? (
              <CheckIcon className="size-4" />
            ) : (
              <span className="block size-1.5 rounded-full bg-current" />
            )}
          </span>
          <p className="bidi min-w-0 flex-1 truncate text-xs" title={toast.text}>
            {toast.text}
          </p>

          {/* زدنِ کنش خودش یعنی «دیدمش» — توست باید همان‌جا برود، نه اینکه
              چند ثانیه‌ی دیگر با دکمه‌ای که دیگر کاری نمی‌کند بماند */}
          {toast.action && (
            <button
              onClick={() => {
                toast.action?.run()
                dismiss(toast.id)
              }}
              className="shrink-0 rounded-full border border-accent/40 bg-accent-dim px-2.5 py-1 text-[11px] font-semibold text-accent transition hover:brightness-110"
            >
              {toast.action.label}
            </button>
          )}

          <button
            onClick={() => dismiss(toast.id)}
            aria-label={t.close}
            className="grid size-5 shrink-0 place-items-center rounded text-muted-2 transition hover:text-fg"
          >
            <CloseIcon className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}

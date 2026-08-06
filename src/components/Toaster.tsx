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
    // پنل دانلود گوشه‌ی end است، پس توست‌ها گوشه‌ی مقابل می‌نشینند
    <div className="pointer-events-none fixed bottom-4 start-4 z-50 flex w-[19rem] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className="toast-in pointer-events-auto flex items-center gap-2 rounded-xl border border-line bg-panel/95 px-3 py-2.5 shadow-xl shadow-black/40 backdrop-blur-xl"
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

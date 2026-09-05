import { create } from 'zustand'

/**
 * کنشِ کنارِ متنِ توست — «واگرد»، «برو به کتابخانه»، …
 *
 * یک توستِ خالی فقط خبر می‌دهد که چیزی *شد*؛ همین یک دکمه آن را به جایی
 * تبدیل می‌کند که می‌شود کاری هم کرد. جای درستش هم همین‌جاست نه یک مودالِ
 * «مطمئنی؟»: پرسیدن پیش از هر حذف، کاربری را که مطمئن است هم کند می‌کند.
 */
export interface ToastAction {
  label: string
  run: () => void
}

export interface Toast {
  id: number
  text: string
  tone: 'info' | 'success' | 'error'
  action?: ToastAction
  /**
   * «در حالِ رفتن» — dismiss اول این پرچم را می‌گذارد تا `Toaster` انیمیشنِ
   * خروج را اجرا کند، و حذفِ واقعی بعد از `TOAST_OUT_MS` اتفاق می‌افتد.
   */
  leaving?: boolean
}

interface ToastState {
  toasts: Toast[]
  push: (text: string, tone?: Toast['tone'], action?: ToastAction) => void
  dismiss: (id: number) => void
}

/** توستِ ساده فقط خبر است و زود می‌رود… */
const PLAIN_MS = 4_200
/** …ولی توستی که دکمه دارد باید فرصتِ خواندن و زدنش را بدهد */
const ACTION_MS = 7_000
/**
 * مدتِ انیمیشنِ خروج — باید با مدتِ `toast-out` در `index.css` یکی بماند.
 * حذفِ واقعی این‌قدر بعد از `leaving` شدن اتفاق می‌افتد.
 */
export const TOAST_OUT_MS = 220

/**
 * پنجره‌ی امنِ واگرد.
 *
 * عملیاتی که پشتِ یک توستِ «واگرد» به تعویق افتاده باید *بعد* از ناپدید
 * شدنِ آن توست اجرا شود، نه قبلش — وگرنه چند صد میلی‌ثانیه دکمه‌ای روی صفحه
 * می‌ماند که کارش تمام شده و زدنش هیچ اثری ندارد.
 *
 * برای همین اینجا و کنارِ خودِ عمرِ توست تعریف شده، نه در فایلی که حذف را
 * زمان‌بندی می‌کند: این دو عدد فقط با هم معنا دارند.
 */
export const UNDO_WINDOW_MS = ACTION_MS + 500

let nextId = 1

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (text, tone = 'info', action) => {
    const id = nextId++
    set({ toasts: [...get().toasts, { id, text, tone, action }].slice(-4) })
    setTimeout(() => get().dismiss(id), action ? ACTION_MS : PLAIN_MS)
  },
  dismiss: (id) => {
    const toast = get().toasts.find((t) => t.id === id)
    // توستی که نیست یا از قبل در حالِ رفتن است — dismissِ دوباره نباید
    // تایمرِ حذفِ دوم را بسازد
    if (!toast || toast.leaving) return
    set({ toasts: get().toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) })
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), TOAST_OUT_MS)
  },
}))

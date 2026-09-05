import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TOAST_OUT_MS, UNDO_WINDOW_MS, useToasts } from './toasts'

const reset = () => useToasts.setState({ toasts: [] })

describe('توست‌ها', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    reset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('توستِ ساده بعد از مهلتِ خودش می‌رود', () => {
    useToasts.getState().push('سلام')
    expect(useToasts.getState().toasts).toHaveLength(1)

    vi.advanceTimersByTime(4_200)
    // اول انیمیشنِ خروج شروع می‌شود…
    expect(useToasts.getState().toasts[0].leaving).toBe(true)
    // …و بعد از مدتِ انیمیشن، حذفِ واقعی
    vi.advanceTimersByTime(TOAST_OUT_MS)
    expect(useToasts.getState().toasts).toHaveLength(0)
  })

  it('توستِ دکمه‌دار بیشتر می‌ماند', () => {
    useToasts.getState().push('پاک شد', 'info', { label: 'واگرد', run: () => {} })

    vi.advanceTimersByTime(4_200)
    expect(useToasts.getState().toasts).toHaveLength(1)
    expect(useToasts.getState().toasts[0].leaving).toBeUndefined()

    vi.advanceTimersByTime(2_800)
    expect(useToasts.getState().toasts[0].leaving).toBe(true)
    vi.advanceTimersByTime(TOAST_OUT_MS)
    expect(useToasts.getState().toasts).toHaveLength(0)
  })

  /*
   * دلیلِ وجودِ این تست: حذفِ قابلِ واگردِ کتابخانه دقیقاً روی همین رابطه
   * بنا شده. اگر روزی عمرِ توست از پنجره‌ی واگرد بیشتر شود، دکمه‌ای روی
   * صفحه می‌ماند که عملیات پشتش از قبل انجام شده — و کاربر فکر می‌کند
   * جلویش را گرفته.
   */
  it('پنجره‌ی واگرد از عمرِ خودِ توست بیشتر است', () => {
    useToasts.getState().push('پاک شد', 'info', { label: 'واگرد', run: () => {} })

    // عمرِ کل = مهلتِ توستِ دکمه‌دار (UNDO_WINDOW_MS - 500) + انیمیشنِ خروج؛
    // مجموعشان باید همچنان از پنجره‌ی واگرد کمتر بماند
    vi.advanceTimersByTime(UNDO_WINDOW_MS - 500 + TOAST_OUT_MS)
    expect(useToasts.getState().toasts).toHaveLength(0)
  })

  it('کنش را همان‌طور که داده شده نگه می‌دارد', () => {
    const run = vi.fn()
    useToasts.getState().push('پاک شد', 'info', { label: 'واگرد', run })

    useToasts.getState().toasts[0].action?.run()
    expect(run).toHaveBeenCalledOnce()
  })

  it('بیشتر از چهارتا روی هم جمع نمی‌شود', () => {
    for (let i = 0; i < 7; i++) useToasts.getState().push(`پیام ${i}`)
    const { toasts } = useToasts.getState()
    expect(toasts).toHaveLength(4)
    expect(toasts[0].text).toBe('پیام 3')
  })

  it('بستنِ دستی فقط همان یکی را می‌برد', () => {
    useToasts.getState().push('اول')
    useToasts.getState().push('دوم')
    const [first] = useToasts.getState().toasts

    useToasts.getState().dismiss(first.id)
    // اول فقط پرچمِ رفتن می‌گیرد و بقیه دست‌نخورده می‌مانند
    expect(useToasts.getState().toasts.map((x) => x.leaving)).toEqual([true, undefined])
    vi.advanceTimersByTime(TOAST_OUT_MS)
    expect(useToasts.getState().toasts.map((x) => x.text)).toEqual(['دوم'])
  })

  it('بستنِ دوباره‌ی یک توست تایمرِ حذفِ دوم نمی‌سازد', () => {
    useToasts.getState().push('تنها')
    const [only] = useToasts.getState().toasts

    useToasts.getState().dismiss(only.id)
    useToasts.getState().dismiss(only.id)
    vi.advanceTimersByTime(TOAST_OUT_MS)
    expect(useToasts.getState().toasts).toHaveLength(0)
  })
})

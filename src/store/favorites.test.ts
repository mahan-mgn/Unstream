// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import { useFavorites } from './favorites'

/**
 * منطقِ حساسِ این استور «به‌روزرسانی خوش‌بینانه» است: قلب بلافاصله عوض
 * می‌شود و اگر سرور نپذیرفت باید برگردد. بدونِ برگشت، قلبِ پُر نشان می‌دهد
 * چیزی را که روی سرور هرگز ذخیره نشده — و بعد از رفرش، دروغش آشکار می‌شود.
 */
describe('استور علاقه‌مندی‌ها', () => {
  afterEach(() => {
    useFavorites.setState({ items: {}, version: 0 })
    vi.restoreAllMocks()
  })

  it('لایکِ موفق: قلب همین حالا پر می‌شود', async () => {
    // بدون ماک، .env.local ممکن است لایه‌ی HTTP واقعی را وصل کند و درخواست به
    // سروری که در تست بالا نیست برود — تست باید نسبت به محیطِ اجرا بی‌تفاوت باشد
    vi.spyOn(api, 'toggleFavorite').mockResolvedValueOnce(undefined)
    await useFavorites.getState().toggle('j1')
    expect(useFavorites.getState().items['j1']).toBe(true)
  })

  it('لایکِ ناموفق: قلب به حالتِ قبلی برمی‌گردد', async () => {
    vi.spyOn(api, 'toggleFavorite').mockRejectedValueOnce(new Error('سرور قطع است'))
    await useFavorites.getState().toggle('j1')
    expect(useFavorites.getState().items['j1']).toBe(false)
  })

  it('برداشتنِ لایکِ ناموفق: قلبِ پُر می‌ماند', async () => {
    useFavorites.setState({ items: { j1: true } })
    vi.spyOn(api, 'toggleFavorite').mockRejectedValueOnce(new Error('سرور قطع است'))
    await useFavorites.getState().toggle('j1')
    expect(useFavorites.getState().items['j1']).toBe(true)
  })

  it('hydrate فقط لایک‌های واقعی را از کتابخانه می‌گیرد', () => {
    useFavorites.getState().hydrate(['a', 'b', 'c'], [true, false, true])
    expect(useFavorites.getState().items).toEqual({ a: true, c: true })
  })

  it('version فقط با تغییرِ واقعی بالا می‌رود، نه با هیدریت', async () => {
    /*
     * فهرستِ «فقط لایک‌شده‌ها» به نسخه وصل است تا بداند کی دوباره واکشی کند؛
     * اگر هیدریتِ کتابخانه هم نسخه را بالا می‌برد، هر بار باز کردنِ کتابخانه
     * یک درخواستِ اضافه به سرور می‌زد.
     */
    const before = useFavorites.getState().version
    useFavorites.getState().hydrate(['a'], [true])
    expect(useFavorites.getState().version).toBe(before)

    vi.spyOn(api, 'toggleFavorite').mockResolvedValue(undefined)
    await useFavorites.getState().toggle('a')
    expect(useFavorites.getState().version).toBe(before + 1)
  })
})

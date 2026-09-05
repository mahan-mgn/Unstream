// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { nextMuteState } from './player'

/**
 * دلیلِ وجودِ این تست: «بی‌صدا» دو چیزِ متفاوت بود که به هم چسبیده بودند —
 * پرچمِ `muted`ِ المنتِ صوتی، و بلندیِ صفر.
 *
 * کشیدنِ نوارِ بلندی تا ته، `muted` را در state روشن می‌کرد ولی هیچ‌وقت
 * `engine.setMuted` را صدا نمی‌زد. بعد دکمه‌ی بی‌صدا پرچمی را «برمی‌داشت» که
 * اصلاً بالا نرفته بود و بلندی صفر می‌ماند: آیکون می‌گفت صدا وصل است، کاربر
 * هیچ نمی‌شنید، و تنها راهِ نجات دستکاریِ دوباره‌ی خودِ نوار بود.
 */
describe('دکمه‌ی بی‌صدا', () => {
  it('برگشت از بی‌صدا وقتی بلندی صفر مانده، واقعاً صدا را برمی‌گرداند', () => {
    // نوار تا ته پایین کشیده شده: muted روشن، ولی بلندی هم صفر است
    expect(nextMuteState(0, true, 0.8)).toEqual({ muted: false, volume: 0.8 })
  })

  it('اگر بلندیِ قبلی هم صفر بود، به تهِ نوار برمی‌گردد نه به سکوت', () => {
    // وگرنه دکمه دوباره بی‌اثر می‌شد — همان بن‌بستِ اول
    expect(nextMuteState(0, true, 0)).toEqual({ muted: false, volume: 1 })
  })

  it('بی‌صدا کردن به بلندی دست نمی‌زند — نوار سرِ جایش می‌ماند', () => {
    expect(nextMuteState(0.6, false, 0.6)).toEqual({ muted: true, volume: 0.6 })
  })

  it('برگشت از بی‌صدا با بلندیِ سالم، همان بلندی را نگه می‌دارد', () => {
    expect(nextMuteState(0.6, true, 0.2)).toEqual({ muted: false, volume: 0.6 })
  })

  it('رفت‌وبرگشت همیشه به وضعیتِ شنیدنی ختم می‌شود', () => {
    for (const volume of [0, 0.01, 0.5, 1]) {
      const off = nextMuteState(volume, false, volume || 1)
      const on = nextMuteState(off.volume, off.muted, volume || 1)
      expect(on.muted).toBe(false)
      expect(on.volume).toBeGreaterThan(0)
    }
  })
})

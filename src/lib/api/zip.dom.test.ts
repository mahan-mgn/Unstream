// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ZipItem } from '../types'

/**
 * دلیلِ وجودِ این تست: دکمه‌ی ZIPِ کتابخانه بعد از هر رفرش بی‌صدا از کار
 * می‌افتاد.
 *
 * لایه‌ی HTTP شناسه‌ی جابِ سرور را از یک نگاشتِ درون‌حافظه‌ای درمی‌آورد که فقط
 * وقتی پر می‌شود که همان ترک در *همین بازدید* دانلود شده باشد. کتابخانه ولی
 * سمتِ سرور ماندگار است: کاربر صفحه را باز می‌کرد، چند ترکِ هفته‌ی پیش را
 * انتخاب می‌کرد، و به‌جای آرشیو یک توستِ «فایلی نیست» می‌گرفت — پیامی که
 * اصلاً برای مودِ دمو نوشته شده بود.
 *
 * خودِ `LibraryItem` از اول `jobId` را دارد؛ فقط دور ریخته می‌شد.
 */

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function zipWith(items: ZipItem[]) {
  const { httpApi } = await import('./http')
  return httpApi.zip(items, 'my-archive')
}

/** بدنه‌ای که سرور برای یک ZIPِ ساخته‌شده برمی‌گرداند */
function zipResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ url: '/api/downloads/zip/abc123', bytes: 10, files: 2 }),
  } as unknown as Response
}

describe('ZIP و شناسه‌ی جابِ سرور', () => {
  it('شناسه‌ی همراهِ ردیفِ کتابخانه مستقیم به سرور می‌رود', async () => {
    fetchMock.mockResolvedValue(zipResponse())

    const url = await zipWith([
      { trackId: 'itunes:track:1', quality: '320', jobId: 'srv-1' },
      { trackId: 'itunes:track:2', quality: '320', jobId: 'srv-2' },
    ])

    expect(url).toBe('/api/downloads/zip/abc123')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.jobIds).toEqual(['srv-1', 'srv-2'])
  })

  it('بدون شناسه و بدون دانلود در این بازدید، چیزی برای بسته‌بندی نیست', async () => {
    // همان حالتِ قدیمی — حالا فقط وقتی پیش می‌آید که واقعاً شناسه‌ای در کار نباشد
    const url = await zipWith([{ trackId: 'itunes:track:1', quality: '320' }])

    expect(url).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ردیف‌های بی‌شناسه کنار می‌روند، بقیه می‌مانند', async () => {
    fetchMock.mockResolvedValue(zipResponse())

    await zipWith([
      { trackId: 'itunes:track:1', quality: '320' },
      { trackId: 'itunes:track:2', quality: '320', jobId: 'srv-2' },
    ])

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.jobIds).toEqual(['srv-2'])
  })
})

import { describe, expect, it } from 'vitest'
// خودِ سرویس‌ورکر یک اسکریپتِ کلاسیک است و ایمپورت‌شدنی نیست؛ متنش را
// می‌گیریم تا فقط توابعِ خالصش را در تست اجرا کنیم
import swSource from '../../public/sw-offline.js?raw'
import { pinnedBytes } from './offline'
import type { LibraryItem } from './types'

const item = (jobId: string, bytes: number): LibraryItem => ({
  jobId,
  bytes,
  quality: '320',
  fileUrl: `/api/downloads/${jobId}/file`,
  streamUrl: `/api/downloads/${jobId}/stream`,
  createdAt: 0,
  track: {
    id: jobId,
    title: 'T',
    artist: 'A',
    durationMs: 1000,
    artworkUrl: null,
    source: 'youtube',
    sourceUrl: 'https://youtu.be/x',
    previewUrl: null,
  },
})

describe('pinnedBytes', () => {
  it('حجمِ چیزی که واقعاً سنجاق شده را جمع می‌زند', () => {
    expect(pinnedBytes([item('a', 100), item('b', 250)])).toBe(350)
  })

  it('فهرست خالی یعنی صفر، نه NaN', () => {
    expect(pinnedBytes([])).toBe(0)
  })
})

/**
 * سرویس‌ورکر یک اسکریپتِ ساده است و نمی‌شود ایمپورتش کرد؛ ولی منطقِ برشِ
 * Range همان جایی است که یک خطای یکی‌کم‌وزیاد، جابه‌جایی روی نوار پخش را
 * خراب می‌کند. پس فایل را همین‌جا در یک اسکوپِ کنترل‌شده اجرا می‌کنیم و فقط
 * همان تابع را بیرون می‌کشیم.
 */
function loadSliceResponse() {
  const factory = new Function(
    'self',
    'caches',
    `${swSource}\nreturn sliceResponse`,
  ) as (self: unknown, caches: unknown) => (
    response: Response,
    range: string,
    buffer: ArrayBuffer,
  ) => Response

  return factory({ addEventListener: () => {}, location: { origin: 'http://localhost' } }, undefined)
}

describe('برشِ Range در سرویس‌ورکر', () => {
  const sliceResponse = loadSliceResponse()
  const buffer = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).buffer
  const full = () => new Response(buffer, { headers: { 'content-type': 'audio/mpeg' } })

  it('«bytes=0-» یعنی کلِ فایل، ولی به‌شکلِ ۲۰۶', async () => {
    const res = sliceResponse(full(), 'bytes=0-', buffer)
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 0-9/10')
    expect(res.headers.get('content-length')).toBe('10')
  })

  it('بازه‌ی وسط، شاملِ هر دو سر است', async () => {
    const res = sliceResponse(full(), 'bytes=2-4', buffer)
    expect(res.headers.get('content-range')).toBe('bytes 2-4/10')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([2, 3, 4]))
  })

  it('انتهایی که از فایل بیرون بزند تا آخرِ فایل کوتاه می‌شود', () => {
    const res = sliceResponse(full(), 'bytes=8-99', buffer)
    expect(res.headers.get('content-range')).toBe('bytes 8-9/10')
  })

  it('شروعِ بیرون از فایل ۴۱۶ می‌گیرد، نه پاسخِ خالیِ ۲۰۶', () => {
    const res = sliceResponse(full(), 'bytes=50-', buffer)
    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe('bytes */10')
  })

  it('هدرِ نامفهوم، همان پاسخِ کاملِ اصلی را برمی‌گرداند', () => {
    const original = full()
    expect(sliceResponse(original, 'nonsense', buffer)).toBe(original)
  })

  it('نوعِ محتوا حفظ می‌شود — بدونش فایرفاکس اصلاً دیکد نمی‌کند', () => {
    expect(sliceResponse(full(), 'bytes=0-1', buffer).headers.get('content-type')).toBe('audio/mpeg')
  })
})

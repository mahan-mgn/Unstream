// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { jobIdOf, type PlayItem } from './player'

/**
 * `jobIdOf` پلِ بینِ صفِ پخش و ثبتِ پخش/لایک سمتِ سرور است.
 *
 * ردیف‌های کتابخانه خودشان jobId هستند، ولی ترک‌های رادیو شناسه‌ی `radio-…`
 * دارند و jobId واقعی فقط از streamUrl قابلِ استخراج است. اگر این استخراج
 * اشتباه کند، یا پخش ثبت نمی‌شود (null) یا بدتر، برای شناسه‌ی اشتباه ثبت
 * می‌شود.
 */
const item = (id: string, streamUrl: string): PlayItem => ({
  id,
  track: {
    id: 'deezer:track:1',
    title: 'T',
    artist: 'A',
    durationMs: 1000,
    artworkUrl: null,
    source: 'deezer',
    sourceUrl: 'u',
    previewUrl: null,
  },
  streamUrl,
})

describe('jobIdOf', () => {
  it('ردیفِ کتابخانه همان jobId خودش است', () => {
    expect(jobIdOf(item('abc123', '/api/downloads/abc123/stream'))).toBe('abc123')
  })

  it('ترکِ رادیو jobId را از streamUrl می‌گیرد', () => {
    expect(
      jobIdOf(item('radio-deezer:track:1-1700000000', '/api/downloads/xyz789/stream')),
    ).toBe('xyz789')
  })

  it('ترکِ رادیو با streamUrl نامعتبر null می‌دهد — نه شناسه‌ی اشتباه', () => {
    expect(jobIdOf(item('radio-x', 'not-a-stream-url'))).toBeNull()
  })

  it('آدرسِ مطلق هم کار می‌کند (اپ اندروید آدرس را مطلق می‌کند)', () => {
    expect(
      jobIdOf(item('radio-x', 'http://192.168.1.2:8080/api/downloads/q42/stream')),
    ).toBe('q42')
  })
})

import { describe, expect, it } from 'vitest'
import {
  bytes,
  digits,
  duration,
  fa,
  fileExt,
  formatLabel,
  isUrl,
  percent,
  safeFilename,
  shortDate,
} from './format'

describe('fa', () => {
  it('converts latin digits', () => {
    expect(fa(1234567890)).toBe('۱۲۳۴۵۶۷۸۹۰')
  })

  it('converts every digit it finds, including inside words', () => {
    // به همین دلیل formatLabel نمی‌تواند مستقیم از fa استفاده کند
    expect(fa('mp3 320')).toBe('mp۳ ۳۲۰')
  })
})

describe('digits', () => {
  it('only converts in persian', () => {
    expect(digits(42, 'fa')).toBe('۴۲')
    expect(digits(42, 'en')).toBe('42')
  })
})

describe('duration', () => {
  it('pads seconds', () => {
    expect(duration(65_000, 'en')).toBe('1:05')
  })

  it('rounds to the nearest second', () => {
    expect(duration(59_600, 'en')).toBe('1:00')
  })

  it('handles durations over an hour without breaking', () => {
    // ساعت جدا نمی‌شود — برای یک ترک هیچ‌وقت لازم نبوده
    expect(duration(3_720_000, 'en')).toBe('62:00')
  })

  it('uses persian digits by default', () => {
    expect(duration(185_000)).toBe('۳:۰۵')
  })
})

describe('percent', () => {
  it('rounds and uses the persian sign', () => {
    expect(percent(42.6)).toBe('۴۳٪')
    expect(percent(42.6, 'en')).toBe('43%')
  })
})

describe('isUrl', () => {
  it.each([
    'https://open.spotify.com/album/1',
    'HTTP://example.com',
    '  https://deezer.com/album/2  ',
  ])('accepts %s', (value) => {
    expect(isUrl(value)).toBe(true)
  })

  it.each(['فرهاد مهراد', 'spotify.com/album/1', 'ftp://x.com'])(
    'rejects %s',
    (value) => {
      expect(isUrl(value)).toBe(false)
    },
  )
})

describe('safeFilename', () => {
  it('replaces characters windows refuses', () => {
    expect(safeFilename('AC/DC: Live?')).toBe('AC-DC- Live-')
  })

  it('keeps persian intact', () => {
    expect(safeFilename('فرهاد مهراد - برف')).toBe('فرهاد مهراد - برف')
  })
})

describe('fileExt', () => {
  it('takes only the container from the server format', () => {
    expect(fileExt('mp3 320')).toBe('mp3')
    expect(fileExt('flac 16/44')).toBe('flac')
    expect(fileExt('opus 160')).toBe('opus')
  })

  it('falls back to mp3 when the format is unknown', () => {
    expect(fileExt(undefined)).toBe('mp3')
  })
})

describe('formatLabel', () => {
  it('localizes the numbers but not the codec', () => {
    expect(formatLabel('mp3 128', 'fa')).toBe('mp3 ۱۲۸')
    expect(formatLabel('mp3 128', 'en')).toBe('mp3 128')
  })

  it('handles formats with no bitrate part', () => {
    expect(formatLabel('opus', 'fa')).toBe('opus')
    expect(formatLabel(undefined, 'fa')).toBe('mp3')
  })

  it('localizes the whole tail, not just the first number', () => {
    expect(formatLabel('flac 16/44', 'fa')).toBe('flac ۱۶/۴۴')
  })
})

describe('bytes', () => {
  it.each([
    [0, '۰ بایت'],
    [512, '۵۱۲ بایت'],
    [1024, '۱ کیلوبایت'],
    [1536, '۱٫۵ کیلوبایت'],
    [5 * 1024 * 1024, '۵ مگابایت'],
  ])('formats %i', (input, expected) => {
    expect(bytes(input)).toBe(expected)
  })

  it('drops the decimal above ten', () => {
    expect(bytes(12.7 * 1024 * 1024, 'en')).toBe('13 MB')
  })

  it('stops at gigabytes', () => {
    expect(bytes(5 * 1024 ** 4, 'en')).toContain('GB')
  })

  it('never renders a negative size', () => {
    expect(bytes(-10, 'en')).toBe('0 B')
  })
})

describe('shortDate', () => {
  it('renders something for a valid timestamp', () => {
    expect(shortDate(1_700_000_000, 'en')).toMatch(/2023/)
  })

  it('does not throw on nonsense input', () => {
    expect(() => shortDate(Number.NaN, 'en')).not.toThrow()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { readStored, readStoredAs, readStoredNumber, removeStored, writeStored } from './storage'

/**
 * دلیلِ وجودِ این فایل: `i18n` و `settings` در *سطحِ ماژول* از localStorage
 * می‌خواندند و تقریباً هر فایلِ دیگری آن دو را ایمپورت می‌کند. روی مرورگری که
 * ذخیره‌سازیِ سایت را بسته (حالتِ خصوصی، iframeِ سندباکس‌شده، بلاک‌کردنِ
 * داده‌ی سایت) خواندن استثنا پرت می‌کند — و آن استثنا قبل از اولین رندر کلِ
 * اپ را می‌خواباند و کاربر صفحه‌ی سفید می‌دید.
 *
 * پس آزمونِ اصلیِ این ماژول این نیست که «مقدار را برمی‌گرداند»، بلکه این است
 * که «هیچ‌وقت پرت نمی‌کند».
 */

const original = globalThis.localStorage

afterEach(() => {
  if (original) {
    Object.defineProperty(globalThis, 'localStorage', {
      value: original,
      configurable: true,
      writable: true,
    })
  } else {
    Reflect.deleteProperty(globalThis as object, 'localStorage')
  }
})

/** مرورگری که ذخیره‌سازی را بسته: هر دسترسی پرت می‌کند */
function hostileStorage() {
  const boom = () => {
    throw new DOMException('SecurityError')
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: boom, setItem: boom, removeItem: boom },
    configurable: true,
    writable: true,
  })
}

/** حافظه‌ی ساده به‌جای localStorage — برای بررسیِ مسیرِ موفق */
function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed))
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
    configurable: true,
    writable: true,
  })
  return map
}

describe('ذخیره‌سازیِ امن', () => {
  it('نبودنِ localStorage یعنی «چیزی ذخیره نشده»، نه استثنا', () => {
    Reflect.deleteProperty(globalThis as object, 'localStorage')
    expect(readStored('x')).toBeNull()
    expect(readStoredAs('x', 'fa')).toBe('fa')
    expect(readStoredNumber('x', 7)).toBe(7)
    expect(writeStored('x', '1')).toBe(false)
    expect(() => removeStored('x')).not.toThrow()
  })

  it('ذخیره‌سازیِ بسته هم نباید چیزی را بترکاند', () => {
    hostileStorage()
    expect(readStored('x')).toBeNull()
    expect(readStoredAs<'dark' | 'light'>('theme', 'dark')).toBe('dark')
    expect(readStoredNumber('vol', 1, { min: 0, max: 1 })).toBe(1)
    expect(writeStored('x', '1')).toBe(false)
    expect(() => removeStored('x')).not.toThrow()
  })

  it('وقتی ذخیره‌سازی هست، واقعاً می‌خواند و می‌نویسد', () => {
    const map = memoryStorage({ lang: 'en' })
    expect(readStoredAs('lang', 'fa')).toBe('en')
    expect(writeStored('lang', 'fa')).toBe(true)
    expect(map.get('lang')).toBe('fa')
    removeStored('lang')
    expect(readStored('lang')).toBeNull()
  })

  it('عددِ خراب یا خارجِ بازه به پیش‌فرض برمی‌گردد، نه به صفرِ بی‌صدا', () => {
    memoryStorage({ empty: '', junk: 'x', high: '5', low: '-1', ok: '0.4' })
    // `Number('')` صفر است — بدونِ این بررسی، یک کلیدِ خالی بلندی را صفر می‌کرد
    expect(readStoredNumber('empty', 1, { min: 0, max: 1 })).toBe(1)
    expect(readStoredNumber('junk', 1, { min: 0, max: 1 })).toBe(1)
    expect(readStoredNumber('high', 1, { min: 0, max: 1 })).toBe(1)
    expect(readStoredNumber('low', 1, { min: 0, max: 1 })).toBe(1)
    expect(readStoredNumber('ok', 1, { min: 0, max: 1 })).toBe(0.4)
    expect(readStoredNumber('missing', 1, { min: 0, max: 1 })).toBe(1)
  })

  it('صفرِ معتبر باید بماند — نه اینکه با پیش‌فرض اشتباه گرفته شود', () => {
    memoryStorage({ vol: '0' })
    expect(readStoredNumber('vol', 1, { min: 0, max: 1 })).toBe(0)
  })
})

describe('بارگذاریِ ماژول‌هایی که در سطحِ ماژول می‌خوانند', () => {
  it('`i18n` و `settings` روی ذخیره‌سازیِ بسته هم ایمپورت می‌شوند', async () => {
    hostileStorage()
    // `settings` به DOM هم نیاز دارد (تمِ روی <html>)؛ اینجا فقط ثابت می‌کنیم
    // که خودِ *خواندن* دیگر مسیرِ ایمپورت را نمی‌بندد
    vi.stubGlobal('document', { documentElement: { dataset: {}, lang: '', dir: '' } })
    const i18n = await import('./i18n')
    expect(i18n.useI18n.getState().lang).toBe('fa')
    vi.unstubAllGlobals()
  })
})

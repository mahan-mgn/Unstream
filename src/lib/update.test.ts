// @vitest-environment jsdom
//
// `i18n` در سطحِ ماژول `<html>` را دست می‌زند (زبان و جهت)، پس حتی تستِ
// توابعِ خالصِ آن هم به DOM نیاز دارد.
import { describe, expect, it } from 'vitest'
import { isNewer } from './update'
import { systemLang } from './i18n'

/**
 * دو تصمیمِ کوچک که اگر غلط باشند، آزارشان دائمی است:
 * کدام زبان را «پیش‌فرض» می‌گیریم و کدام نسخه را «تازه‌تر».
 */

describe('systemLang', () => {
  it('فارسی و انگلیسی را از هر لهجه‌ای بیرون می‌کشد', () => {
    expect(systemLang('fa-IR')).toBe('fa')
    expect(systemLang('en-US')).toBe('en')
    expect(systemLang('fa_AF')).toBe('fa')
  })

  it('زبانِ ناشناخته null می‌دهد — نه حدس', () => {
    // «حدسِ نزدیک» اینجا بد است: کاربرِ ترکی‌زبان را با فارسی اشتباه می‌گیرد و
    // او دیگر هیچ‌وقت زبانِ درست نمی‌بیند (چون انتخابش ذخیره می‌شود)
    expect(systemLang('tr-TR')).toBeNull()
    expect(systemLang('ar')).toBeNull()
    expect(systemLang(undefined)).toBeNull()
    expect(systemLang('')).toBeNull()
  })

  it('بزرگ/کوچکِ حروف و برچسبِ کامل بی‌تأثیرند', () => {
    expect(systemLang('FA')).toBe('fa')
    expect(systemLang('en-GB')).toBe('en')
  })
})

describe('isNewer', () => {
  it('فقط عددِ بزرگ‌تر را تازه می‌شمارد', () => {
    expect(isNewer(2, 3)).toBe(true)
    expect(isNewer(3, 3)).toBe(false)
    expect(isNewer(4, 3)).toBe(false)
  })

  it('NaN و undefined هرگز «بروزرسانی» نمی‌سازند', () => {
    // اگر این‌ها رد شوند، بنر برای همیشه روی صفحه می‌ماند و کاربر هیچ‌وقت
    // نمی‌فهمد نسخه‌ی تازه‌ای نیست
    expect(isNewer(2, NaN)).toBe(false)
    expect(isNewer(2, undefined as unknown as number)).toBe(false)
    expect(isNewer(NaN, 5)).toBe(false)
  })
})

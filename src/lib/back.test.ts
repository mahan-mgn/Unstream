import { describe, expect, it } from 'vitest'
import { closeTopLayer, pushLayer } from './back'

/**
 * پشته‌ی لایه‌ها حالا دو مصرف‌کننده دارد — دکمه‌ی برگشتِ اندروید و کلیدِ
 * Escape — و هر دو به یک قرارداد تکیه می‌کنند: «همیشه بالاترین، فقط یکی».
 */
describe('پشته‌ی لایه‌ها', () => {
  it('بالاترین لایه را می‌بندد، نه همه را', () => {
    const closed: string[] = []
    pushLayer(() => closed.push('sheet'))
    pushLayer(() => closed.push('menu'))

    expect(closeTopLayer()).toBe(true)
    expect(closed).toEqual(['menu'])

    expect(closeTopLayer()).toBe(true)
    expect(closed).toEqual(['menu', 'sheet'])
  })

  it('پشته‌ی خالی یعنی تصمیم با ناوبریِ صفحه است', () => {
    expect(closeTopLayer()).toBe(false)
  })

  it('لایه‌ای که خودش برداشته شده دیگر نوبت نمی‌گیرد', () => {
    const closed: string[] = []
    const removeSheet = pushLayer(() => closed.push('sheet'))
    pushLayer(() => closed.push('menu'))

    // منو با کلیکِ بیرون بسته شد، نه با برگشت
    removeSheet()

    expect(closeTopLayer()).toBe(true)
    expect(closed).toEqual(['menu'])
    expect(closeTopLayer()).toBe(false)
  })

  it('برداشتنِ یک لایه ترتیبِ بقیه را به‌هم نمی‌ریزد', () => {
    const closed: string[] = []
    pushLayer(() => closed.push('a'))
    const removeB = pushLayer(() => closed.push('b'))
    pushLayer(() => closed.push('c'))

    removeB()

    closeTopLayer()
    closeTopLayer()
    expect(closed).toEqual(['c', 'a'])
  })
})

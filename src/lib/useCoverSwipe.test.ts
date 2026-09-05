import { describe, expect, it } from 'vitest'
import { shouldCommit } from './useCoverSwipe'

/**
 * قانونِ رهاکردن: مسافت یا سرعت، هرکدام کافی است.
 * این دوتا دقیقاً همان حالت‌هایی هستند که نسخه‌های ساده غلط درمی‌آورند:
 * پرتابِ کوتاه باید ببندد، کشیدنِ آهسته‌ی متوقف‌شده نه.
 */
describe('shouldCommit', () => {
  it('commits on long slow drag', () => {
    expect(shouldCommit(150, 0)).toBe(true)
    expect(shouldCommit(-150, 0)).toBe(true)
  })

  it('commits on short fast flick', () => {
    expect(shouldCommit(30, 0.9)).toBe(true)
    expect(shouldCommit(-30, -0.9)).toBe(true)
  })

  it('rejects short slow drags', () => {
    expect(shouldCommit(30, 0.1)).toBe(false)
    expect(shouldCommit(-30, -0.1)).toBe(false)
    expect(shouldCommit(0, 0)).toBe(false)
  })

  it('is symmetric in both directions', () => {
    expect(shouldCommit(89, 0)).toBe(shouldCommit(-89, 0))
    expect(shouldCommit(0, 0.46)).toBe(shouldCommit(0, -0.46))
  })
})

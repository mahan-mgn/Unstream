import type { PlaylistRule } from './types'

/**
 * انتخاب‌های سرراستِ UI برای پلی‌لیستِ هوشمند.
 *
 * کاربر «شاد» و «آرام» را می‌فهمد، `valenceMin = 0.6` را نه. این نگاشت جدا
 * ماند تا هم تست شود و هم اگر روزی آستانه‌ها عوض شدند، یک جا عوض شوند.
 */
export type MoodChoice = 'any' | 'happy' | 'sad'
export type EnergyChoice = 'any' | 'calm' | 'loud'

/**
 * آستانه‌ها عمداً از وسط فاصله دارند (۰.۴ و ۰.۶، نه ۰.۵): ترکی که حس‌وحالش
 * مبهم است نباید به‌زور در یکی از دو سر بیفتد.
 */
const HIGH = 0.6
const LOW = 0.4

export function buildRule(mood: MoodChoice, energy: EnergyChoice): PlaylistRule {
  const rule: PlaylistRule = { limit: 100, sort: 'recent' }
  if (mood === 'happy') rule.valenceMin = HIGH
  if (mood === 'sad') rule.valenceMax = LOW
  if (energy === 'loud') rule.energyMin = HIGH
  if (energy === 'calm') rule.energyMax = LOW
  return rule
}

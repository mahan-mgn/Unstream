import type { Dict } from './i18n'

/**
 * حس‌وحال‌های آماده — هم چیپ‌های پایین چت‌بات، هم کاشی‌های «برای تو» در خانه.
 * مشترک شدند چون هر دو باید دقیقاً یک فهرست را نشان بدهند؛ وگرنه کاشی‌ای در
 * خانه پیدا می‌شد که چت‌بات آن را نمی‌شناخت.
 */
export const VIBE_KEYS = [
  'sad',
  'happy',
  'energetic',
  'calm',
  'romantic',
  'angry',
  'nostalgic',
  'focus',
  'heartbreak',
] as const

export type VibeKey = (typeof VIBE_KEYS)[number]

export function vibeLabel(t: Dict, key: string): string {
  const dictKey = `vibe${key[0].toUpperCase()}${key.slice(1)}` as keyof Dict
  const value = t[dictKey]
  return typeof value === 'string' ? value : key
}

/**
 * برچسب‌ها به شکل «😢 غمگین» ذخیره شده‌اند: در چیپِ کوچکِ چت همان یک‌خط درست
 * است، ولی کاشی‌های خانه فقط متن را می‌خواهند — ایموجی روی کاورِ واقعی
 * اسباب‌بازی به‌نظر می‌رسد.
 */
export function splitVibeLabel(label: string): { emoji: string; text: string } {
  const [first, ...rest] = label.split(' ')
  // اگر روزی برچسبی بدون ایموجی اضافه شد، نباید حرف اولِ کلمه را قربانی کند
  return rest.length ? { emoji: first, text: rest.join(' ') } : { emoji: '♪', text: label }
}

/**
 * FNV-1a.
 *
 * hashِ ساده‌ی `h*31 + c` این‌جا کار نمی‌کند: پیشوندِ ثابت فقط یک عددِ ثابت به
 * نتیجه اضافه می‌کند، پس ترتیبِ مرتب‌شده برای همه‌ی حس‌وحال‌ها یک چرخشِ ساده از
 * هم درمی‌آید و چند کاشی عملاً یک ترکیب می‌گیرند. xorِ هر بایت این وابستگی را
 * می‌شکند.
 */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * کاورهای موزاییکِ یک کاشیِ حس‌وحال — از کاورهای واقعیِ کتابخانه.
 *
 * انتخاب قطعی است و به خودِ آدرسِ کاور گره خورده، نه به جایگاهش در لیست: با هر
 * دانلودِ تازه کلِ کاشی‌ها بازآرایی نمی‌شوند و چشم جای هرکدام را یاد می‌گیرد.
 *
 * با کمتر از `count` کاورِ یکتا خالی برمی‌گردد تا کاشی به گرادیانِ ساده برگردد؛
 * موزاییکِ ناقص یا تکراری بدتر از نداشتنش است.
 */
export function vibeCovers(pool: string[], vibe: string, count = 4): string[] {
  if (pool.length < count) return []
  return pool
    .map((url) => ({ url, rank: hash(`${vibe}:${url}`) }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, count)
    .map((x) => x.url)
}

/**
 * فقط یک منبع صدا در آنِ واحد.
 *
 * پیش‌نمایش ۳۰ ثانیه‌ای و پخش‌کننده‌ی کتابخانه دو `<audio>` کاملاً جدا دارند و
 * هیچ‌کدام دیگری را نمی‌شناسد. وصل کردنشان به هم ایمپورت حلقوی می‌ساخت
 * (پیش‌نمایش → پخش‌کننده → پیش‌نمایش)، پس هرکدام فقط راهِ خاموش‌شدن خودش را
 * اینجا ثبت می‌کند و این ماژول هیچ‌کدامشان را نمی‌شناسد.
 */
const stoppers = new Map<string, () => void>()

export function registerAudio(key: string, stop: () => void): void {
  stoppers.set(key, stop)
}

/** صدا را برای این کلید بگیر — بقیه ساکت می‌شوند */
export function claimAudio(key: string): void {
  for (const [other, stop] of stoppers) {
    if (other !== key) stop()
  }
}

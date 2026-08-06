const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹']

/** تبدیل ارقام لاتین به فارسی */
export function fa(input: string | number): string {
  return String(input).replace(/\d/g, (d) => FA_DIGITS[Number(d)])
}

/** ارقام را فقط وقتی فارسی کن که زبان فارسی باشد */
export function digits(input: string | number, lang: string): string {
  return lang === 'fa' ? fa(input) : String(input)
}

/** ۳:۴۵ */
export function duration(ms: number, lang = 'fa'): string {
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return digits(`${m}:${String(s).padStart(2, '0')}`, lang)
}

export function percent(n: number, lang = 'fa'): string {
  return lang === 'fa' ? `${fa(Math.round(n))}٪` : `${Math.round(n)}%`
}

/** تشخیص اینکه ورودی کاربر لینک است یا عبارت جستجو */
export function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim())
}

/** نام فایل امن برای ذخیره‌سازی */
export function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '-').trim()
}

/**
 * سرور فرمت را به شکل «mp3 128» می‌دهد (فرمت واقعی، نه کیفیت درخواستی).
 * برای پسوند فایل فقط بخش اول لازم است.
 */
export function fileExt(format: string | undefined): string {
  return (format ?? 'mp3').split(' ')[0]
}

/**
 * برچسب فرمت با ارقام زبانِ فعلی، مثل «mp3 ۱۲۸».
 *
 * فقط بخش عددی فارسی می‌شود: «mp3» یک نامِ لاتین است و «mp۳» غلط است، نه ترجمه.
 */
export function formatLabel(format: string | undefined, lang = 'fa'): string {
  const [codec, ...rest] = (format ?? 'mp3').split(' ')
  return rest.length ? `${codec} ${digits(rest.join(' '), lang)}` : codec
}

const UNITS_FA = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت']
const UNITS_EN = ['B', 'KB', 'MB', 'GB']

/** حجم خوانا — «۴٫۲ مگابایت» */
export function bytes(n: number, lang = 'fa'): string {
  const units = lang === 'fa' ? UNITS_FA : UNITS_EN
  let value = Math.max(0, n)
  let step = 0
  while (value >= 1024 && step < units.length - 1) {
    value /= 1024
    step++
  }
  // زیر ۱۰ یک رقم اعشار می‌خواهد، بالاترش نویز است. «۱٫۰» هم نویز است.
  const text =
    value >= 10 || step === 0
      ? String(Math.round(value))
      : value.toFixed(1).replace(/\.0$/, '')
  return `${digits(text.replace('.', lang === 'fa' ? '٫' : '.'), lang)} ${units[step]}`
}

/** تاریخ کوتاه محلی از ثانیه‌ی یونیکس */
export function shortDate(seconds: number, lang = 'fa'): string {
  const locale = lang === 'fa' ? 'fa-IR' : 'en-US'
  try {
    return new Date(seconds * 1000).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return ''
  }
}

export interface LyricWord {
  /** ثانیه از ابتدای آهنگ — لحظه‌ای که این کلمه خواندنش شروع می‌شود */
  time: number
  text: string
}

export interface LyricLine {
  /** ثانیه از ابتدای آهنگ */
  time: number
  text: string
  /**
   * زمان‌بندیِ کلمه‌به‌کلمه — فقط وقتی فایلِ LRC تقویت‌شده باشد. فاصله‌ها جزو
   * متنِ کلمه‌ی قبلی می‌مانند تا کشیدنِ رنگ از رویشان هم رد شود.
   */
  words?: LyricWord[]
}

const TAG_RE = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g
/** تگِ کلمه در LRC تقویت‌شده: ‎<mm:ss.xx>‎ — همان قالبِ تگِ خط ولی با <> */
const WORD_RE = /<(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?>/g

function tagTime(minutes: string, seconds: string, frac?: string): number {
  return Number(minutes) * 60 + Number(seconds) + (frac ? Number(frac.padEnd(3, '0')) / 1000 : 0)
}

/**
 * پارسر LRC ساده + پشتیبانی از قالبِ تقویت‌شده‌ی کلمه‌به‌کلمه:
 * ‎[00:12.50] <00:12.50>Hello <00:13.00>world‎
 * یک خط می‌تواند چند تگ زمانی داشته باشد (تکرار یک کلمه در چند لحظه)؛
 * خط‌های بدون تگ (متادیتای [ar:]/[ti:] یا خط خالی) نادیده گرفته می‌شوند.
 */
export function parseLrc(raw: string): LyricLine[] {
  const lines: LyricLine[] = []
  for (const row of raw.split(/\r?\n/)) {
    const tags = [...row.matchAll(TAG_RE)]
    if (!tags.length) continue
    const body = row.replace(TAG_RE, '').trim()

    // کلمه‌های زمان‌دار: هر تگِ <> کلمه‌ی بعد از خودش را زمان‌دار می‌کند.
    // متنِ بین دو تگ (فاصله‌ها) به کلمه‌ی قبلی می‌چسبد تا گرادیانِ رنگ از
    // روی فاصله هم طبیعی رد شود؛ متنِ قبل از اولین تگ کلمه نیست و می‌افتد.
    const wordTags = [...body.matchAll(WORD_RE)]
    let words: LyricWord[] | undefined
    if (wordTags.length) {
      words = []
      let cursor = 0
      for (const m of wordTags) {
        const gap = body.slice(cursor, m.index)
        if (words.length) words[words.length - 1].text += gap
        words.push({ time: tagTime(m[1], m[2], m[3]), text: '' })
        cursor = m.index + m[0].length
      }
      words[words.length - 1].text += body.slice(cursor)
      words[words.length - 1].text = words[words.length - 1].text.trimEnd()
      // خطِ «فقطِ تگِ خالی» کلمه‌ی واقعی ندارد — مثل خطِ بی‌کلام با آن رفتار کن
      if (!words.some((w) => w.text.trim())) words = undefined
    }

    const text = words ? words.map((w) => w.text).join('') : body
    for (const tag of tags) {
      lines.push({
        time: tagTime(tag[1], tag[2], tag[3]),
        text,
        // هر تگِ تکراریِ خط، نسخه‌ی *خودش* را از کلمه‌ها می‌خواهد
        ...(words ? { words: words.map((w) => ({ ...w })) } : {}),
      })
    }
  }
  return lines.sort((a, b) => a.time - b.time)
}

/** ایندکس آخرین خطی که زمانش از موقعیت فعلی رد شده — یا -۱ اگر هنوز نرسیده */
export function activeLyricIndex(lines: LyricLine[], position: number): number {
  let idx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time > position) break
    idx = i
  }
  return idx
}

/**
 * ثانیه‌ی پایانِ خطِ فعال: شروعِ خطِ بعدی، یا برای خطِ آخر تا پایانِ ترک.
 * هم پیشرفتِ خط و هم پیشرفتِ کلمه‌ی آخرِ خط تا همین نقطه کش می‌آید.
 */
export function lineEndTime(lines: LyricLine[], active: number, trackEnd: number): number {
  if (active < 0 || active >= lines.length) return 0
  const start = lines[active].time
  return active + 1 < lines.length ? lines[active + 1].time : Math.max(trackEnd, start + 1)
}

/**
 * پیشرفتِ داخلِ خطِ فعال، در بازه‌ی [۰،۱].
 *
 * LRC استاندارد فقط زمانِ *شروعِ هر خط* را دارد، پس پیشرفتِ کلمه‌به‌کلمه را
 * از خودِ آهنگ می‌سازیم: خطِ فعلی تا رسیدنِ خطِ بعدی فرصت دارد و رنگ روی
 * حروف به همان نسبت کشیده می‌شود. خطِ آخر تا پایانِ ترک کش می‌آید.
 * (وقتی فایل، زمان‌بندیِ کلمه‌ای دارد این دیگر استفاده نمی‌شود —
 * `activeWordIndex` + `wordProgress` جای آن را می‌گیرند.)
 */
export function lineProgress(
  lines: LyricLine[],
  active: number,
  now: number,
  trackEnd: number,
): number {
  if (active < 0 || active >= lines.length) return 0
  const start = lines[active].time
  const span = lineEndTime(lines, active, trackEnd) - start
  if (span <= 0) return 1
  return Math.min(1, Math.max(0, (now - start) / span))
}

/** ایندکسِ آخرین کلمه‌ای که خواندنش شروع شده — یا -۱ اگر هنوز نرسیده */
export function activeWordIndex(words: LyricWord[], now: number): number {
  let idx = -1
  for (let i = 0; i < words.length; i++) {
    if (words[i].time > now) break
    idx = i
  }
  return idx
}

/**
 * پیشرفتِ پرشدنِ کلمه‌ی idx در بازه‌ی [۰،۱]: از تگِ خودش تا تگِ کلمه‌ی بعدی؛
 * کلمه‌ی آخر تا پایانِ خط (پارامتر lineEnd از `lineEndTime` می‌آید).
 */
export function wordProgress(
  words: LyricWord[],
  idx: number,
  now: number,
  lineEnd: number,
): number {
  const start = words[idx].time
  const end = idx + 1 < words.length ? words[idx + 1].time : lineEnd
  const span = end - start
  if (span <= 0) return 1
  return Math.min(1, Math.max(0, (now - start) / span))
}

import type { Track } from './types'

/**
 * هرچه کمتر، شافل بیشتر به نزدیک‌ترین حس‌وحال می‌چسبد. مقدارِ فعلی طوری
 * انتخاب شده که ترکِ هم‌حس‌وحال چند ده برابر ترکِ دورترین ممکن شانس داشته
 * باشد، ولی هنوز شانسِ صفر برای بقیه نمی‌ماند — وگرنه شافل دیگر شافل نیست،
 * یک صفِ پخشِ ازپیش‌معلوم می‌شود.
 */
const MOOD_TEMPERATURE = 0.35

/** فاصله‌ی حس‌وحال دو ترک در فضای (والانس، انرژی) — هرچه کمتر، نزدیک‌تر */
function moodDistance(v1: number, e1: number, v2: number, e2: number): number {
  const dv = v1 - v2
  const de = e1 - e2
  return Math.sqrt(dv * dv + de * de)
}

/**
 * ایندکسِ بعدیِ شافل، با وزن‌دهی به نزدیکیِ حس‌وحال به ترکِ فعلی.
 *
 * تصادفیِ محض نیست — ترکی که والانس/انرژی‌اش به ترکِ فعلی نزدیک‌تر است شانسِ
 * بیشتری برای انتخاب دارد — ولی همچنان تصادفی است، وگرنه شافل قابل‌پیش‌بینی
 * و تکراری می‌شد (مثلاً همیشه پریدن به همان یک ترکِ نزدیک‌تر).
 *
 * وقتی حس‌وحالِ ترکِ فعلی معلوم نیست (هنوز تحلیل نشده — مثلاً از رادیو آمده،
 * نه کتابخانه)، نمی‌شود نزدیکی را بدون مبدأ سنجید، پس به شافلِ کاملاً
 * یکنواختِ قبلی برمی‌گردد. ترک‌های بی‌داده در جمعیتِ کاندیدها هم نه جریمه
 * می‌شوند نه امتیاز می‌گیرند — وزنِ خنثی می‌گیرند.
 */
export function pickShuffleIndex(queue: { track: Track }[], index: number): number {
  const others = queue.map((_, i) => i).filter((i) => i !== index)
  // صفِ تک‌ترکی جایی برای رفتن ندارد. بدون این، هر دو مسیرِ پایین از یک آرایه‌ی
  // خالی می‌خواندند و `undefined` برمی‌گشت — که تایپش می‌گوید عدد است، پس
  // صدازننده بی‌خبر آن را ایندکسِ صف می‌کرد.
  if (!others.length) return index
  const current = queue[index].track

  if (current.valence == null || current.energy == null) {
    return others[Math.floor(Math.random() * others.length)]
  }

  const weights = others.map((i) => {
    const { valence, energy } = queue[i].track
    if (valence == null || energy == null) return 1
    const distance = moodDistance(current.valence!, current.energy!, valence, energy)
    return Math.exp(-distance / MOOD_TEMPERATURE)
  })

  const total = weights.reduce((sum, w) => sum + w, 0)
  let roll = Math.random() * total
  for (let k = 0; k < others.length; k++) {
    roll -= weights[k]
    if (roll <= 0) return others[k]
  }
  return others[others.length - 1]
}

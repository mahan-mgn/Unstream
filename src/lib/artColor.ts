/**
 * رنگِ غالبِ یک کاور — برای تینتِ پس‌زمینه‌ی پخش‌کننده.
 *
 * تصویر روی یک بومِ کوچک کشیده می‌شود و پیکسل‌ها با کوانتیزه‌کردنِ ۴ بیتی
 * سطل‌بندی می‌شوند؛ سطلی که بیشترین امتیازِ (تعداد × اشباع) را دارد، رنگِ
 * غالب است. اشباع در امتیاز وزن دارد تا یک کاورِ خاکستری، رنگِ بی‌روح ندهد.
 *
 * اگر بوم tainted شود (کاورِ بیرونی بدونِ هدرِ CORS) یا تصویر لود نشود،
 * `null` برمی‌گردد و پخش‌کننده همان رنگِ پیش‌فرضِ خودش را نگه می‌دارد.
 */

const cache = new Map<string, [number, number, number] | null>()

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // کاورها معمولاٌ از `/api/art/…` هم‌مبدأ می‌آیند، ولی اگر آدرسِ CDN باشد
    // این اجازه می‌دهد بوم tainted نشود؛ نشد هم reject می‌خورد و null می‌دهیم
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

export async function dominantColor(
  src: string | null,
): Promise<[number, number, number] | null> {
  if (!src) return null
  if (cache.has(src)) return cache.get(src)!

  let result: [number, number, number] | null = null
  try {
    const img = await loadImage(src)
    const size = 24
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (ctx) {
      ctx.drawImage(img, 0, 0, size, size)
      const { data } = ctx.getImageData(0, 0, size, size)

      const buckets = new Map<
        number,
        { r: number; g: number; b: number; n: number; sat: number }
      >()
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        const max = Math.max(r, g, b)
        const min = Math.min(r, g, b)
        // سیاهِ مطلق و سفیدِ مطلق رنگِ غالبِ معناداری نیستند
        if (max < 24 || min > 235) continue
        const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
        const bucket = buckets.get(key)
        if (bucket) {
          bucket.r += r
          bucket.g += g
          bucket.b += b
          bucket.n++
          bucket.sat += max - min
        } else {
          buckets.set(key, { r, g, b, n: 1, sat: max - min })
        }
      }

      let best: { r: number; g: number; b: number; n: number; sat: number } | null = null
      let bestScore = -1
      for (const bucket of buckets.values()) {
        const score = bucket.n * (1 + bucket.sat / bucket.n / 255)
        if (score > bestScore) {
          bestScore = score
          best = bucket
        }
      }
      if (best) {
        result = [
          Math.round(best.r / best.n),
          Math.round(best.g / best.n),
          Math.round(best.b / best.n),
        ]
      }
    }
  } catch {
    result = null
  }

  cache.set(src, result)
  return result
}

/**
 * رنگِ غالب → جفتِ CSSِ نوار پخش.
 *
 * - `rgb`: سه‌تاییِ خام که در `rgb(var(--pb-rgb) / α)` استفاده می‌شود.
 * - `strong`: همان رنگِ روشن‌شده تا luminance ≈ 0.55. چرا لازم است:
 *   color-mix با درصدِ ثابت روشنایی را هدف نمی‌گیرد، و یک کاورِ تیره اکسنتی
 *   می‌دهد که متنِ مشکیِ روی دکمه‌ی پخش خوانا نیست. فرمولِ سفیدِ افزودنیِ
 *   خطی، luminance را دقیقاً به هدف می‌رساند (و برای رنگِ روشن‌تر از هدف،
 *   w=0 یعنی دست‌نخورده).
 */
export function tintVars(
  rgb: [number, number, number],
): { rgb: string; strong: string } {
  const [r, g, b] = rgb
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  const w = Math.round(Math.min(1, Math.max(0, (0.55 - lum) / (1 - lum))) * 100)
  const triad = `${r} ${g} ${b}`
  return {
    rgb: triad,
    strong: `color-mix(in srgb, rgb(${triad}) ${100 - w}%, white)`,
  }
}

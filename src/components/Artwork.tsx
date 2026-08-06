interface Props {
  src: string | null
  alt: string
  /** برای تولید رنگ پایدار وقتی کاور واقعی نداریم */
  seed: string
  className?: string
  rounded?: string
}

const PALETTES = [
  ['#5b4bd6', '#8f7bff'],
  ['#2f6f4e', '#7ec98f'],
  ['#8a3b2e', '#e0836b'],
  ['#2b5d7a', '#7fc0e0'],
  ['#6b4226', '#c99a6b'],
  ['#4a4a4a', '#9a9a9a'],
  ['#7a2f5d', '#d97bb0'],
  ['#3d5a2b', '#a3c96b'],
]

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

/** حرف اول عنوان — برای فارسی هم درست کار می‌کند */
function initial(text: string): string {
  const clean = text.trim().replace(/^[^\p{L}\p{N}]+/u, '')
  return clean.slice(0, 1).toUpperCase() || '♪'
}

export default function Artwork({ src, alt, seed, className = '', rounded = 'rounded-lg' }: Props) {
  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className={`${className} ${rounded} object-cover bg-panel-2`}
      />
    )
  }

  const [from, to] = PALETTES[hash(seed) % PALETTES.length]
  return (
    <div
      role="img"
      aria-label={alt}
      className={`${className} ${rounded} grid place-items-center select-none overflow-hidden`}
      style={{
        background: `linear-gradient(140deg, ${from}, ${to})`,
        containerType: 'inline-size',
      }}
    >
      <span
        className="font-black text-white/80"
        // cqw تا حرف همیشه نسبت به اندازه‌ی خودِ کاور مقیاس بخورد، نه فونت والد
        style={{ fontSize: '44cqw', lineHeight: 1 }}
      >
        {initial(alt)}
      </span>
    </div>
  )
}

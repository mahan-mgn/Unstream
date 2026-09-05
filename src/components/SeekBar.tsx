import { useRef, useState, type CSSProperties } from 'react'
import { duration as fmtDuration } from '../lib/format'
import { useI18n } from '../lib/i18n'
import { haptic } from '../lib/native'

/**
 * نوارِ جابه‌جایی با ذره‌بین.
 *
 * دو چیز که اسپاتیفای/اپل‌موزیک دارند و نوارِ خامِ HTML ندارد:
 *
 *  ۱. **حبابِ زمان.** موقع کشیدن، بالای دستگیره یک حبابِ کوچک ظاهر می‌شود که
 *     دقیقاً می‌گوید به کدام ثانیه داری می‌روی — بدون آن کاربر کورکورانه
 *     می‌کشد و ول‌کردنش حدس است.
 *  ۲. **تیکِ لمسی.** هر بار که از مرزِ یک ثانیه رد می‌شوی، گوشی یک لرزشِ ریز
 *     می‌دهد. همین باعث می‌شود بشود با چشمِ بسته هم (مثلاً توی ماشین) به
 *     یک جای تقریبی رسید — همان کاری که پیچِ صدا در ماشین می‌کند.
 *
 * حباب روی همان درصدِ نوار می‌نشیند؛ چون دستگیره عرض دارد، موقعیتش بین
 * «نیمِ دستگیره» تا «عرضِ منهای نیمِ دستگیره» محدود می‌شود تا از دو سر
 * بیرون نزند.
 */
export default function SeekBar({
  value,
  max,
  onSeek,
  className = '',
}: {
  value: number
  max: number
  onSeek: (seconds: number) => void
  className?: string
}) {
  const { t, lang } = useI18n()
  const track = useRef<HTMLDivElement>(null)
  const [scrubValue, setScrubValue] = useState<number | null>(null)
  /** آخرین ثانیه‌ای که تیک خورد — برای اینکه هر ثانیه فقط یک بار بلرزد */
  const lastTick = useRef(-1)

  const shown = scrubValue ?? value
  const pct = max > 0 ? Math.min(100, (shown / max) * 100) : 0

  const tick = (seconds: number) => {
    const whole = Math.floor(seconds)
    if (whole !== lastTick.current) {
      lastTick.current = whole
      haptic.select()
    }
  }

  const startScrub = () => {
    lastTick.current = Math.floor(value)
    setScrubValue(value)
  }

  const moveScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value)
    setScrubValue(v)
    tick(v)
  }

  /*
   * مقدارِ نهایی از خودِ input خوانده می‌شود (`currentTarget.value`)، نه از
   * state: `onPointerUp` قبل از commit شدنِ آخرین `onChange` نمی‌آید ولی
   * DOM همان لحظه مقدارِ درست را دارد — و این‌طور side effect داخلِ
   * state-updater (که StrictMode دو بار صدا می‌زند) هم نمی‌شود.
   */
  const endScrub = (e: React.PointerEvent<HTMLInputElement>) => {
    setScrubValue(null)
    onSeek(Number(e.currentTarget.value))
  }

  return (
    <div ref={track} className={`relative ${className}`}>
      {/*
       * حبابِ زمان. `pointer-events-none` تا هیچ‌وقت جلوی گرفتنِ نوار را نگیرد.
       * با `opacity` و کمی `translateY` باز و بسته می‌شود — پرشِ ناگهانی نداشته
       * باشد، آرام بالا بیاید.
       */}
      <div
        aria-hidden
        className={`pointer-events-none absolute bottom-full mb-2 -translate-x-1/2 rounded-md bg-fg px-2 py-1 text-[11px] font-semibold tabular-nums text-bg shadow-lg transition-[opacity,transform] duration-150 ${
          scrubValue === null ? 'translate-y-1 opacity-0' : 'translate-y-0 opacity-100'
        }`}
        style={{ left: `clamp(22px, ${pct}%, calc(100% - 22px))` } as CSSProperties}
      >
        {fmtDuration(shown * 1000, lang)}
        {/* دُمِ مثلثیِ حباب که به دستگیره اشاره می‌کند */}
        <span className="absolute -bottom-1 left-1/2 size-2 -translate-x-1/2 rotate-45 bg-fg" />
      </div>

      <input
        type="range"
        min={0}
        max={max || 1}
        step="any"
        value={shown}
        aria-label={t.seekBar}
        onPointerDown={startScrub}
        onChange={moveScrub}
        onPointerUp={endScrub}
        onPointerCancel={() => setScrubValue(null)}
        className={`seek w-full ${scrubValue !== null ? 'seek-scrubbing' : ''}`}
        style={{ '--pct': `${pct}%` } as CSSProperties}
      />
    </div>
  )
}

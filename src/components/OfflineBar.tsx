import { useEffect } from 'react'
import { useI18n } from '../lib/i18n'
import { isLocalServer } from '../lib/server'
import { useNet } from '../store/net'
import { OfflineIcon } from './icons'

/**
 * نوارِ وضعیتِ شبکه.
 *
 * چیزی است که نبودش روی گوشی گران تمام می‌شود: بدونِ آن، قطع‌شدنِ شبکه
 * به‌شکلِ یک اپِ خراب دیده می‌شود — جستجو جواب نمی‌دهد، کاورها نمی‌آیند، و هیچ
 * چیزی نمی‌گوید چرا. یک نوارِ ثابت این را از «خرابی» به «وضعیت» تبدیل می‌کند.
 *
 * سه وضعیت نشان می‌دهد نه یکی، چون کارِ کاربر در هرکدام فرق دارد:
 *
 *   `device`   شبکه‌ای نیست. کاری از دستش برنمی‌آید جز صبر — دکمه‌ای هم لازم نیست.
 *   `server`   شبکه هست، سرور نه. سرور را روشن کند یا آدرسش را درست کند.
 *   `internet` سرور هست، بین‌الملل نه. *بیشترِ برنامه کار می‌کند* و این مهم‌ترین
 *              چیزی است که باید بگوید — وگرنه کاربر برنامه را می‌بندد در حالی
 *              که کلِ کتابخانه‌اش قابلِ پخش است.
 *
 * تفاوتِ دوتای آخر را هیچ APIی در مرورگر نمی‌داند؛ `store/net` توضیح می‌دهد چرا.
 *
 * زیرِ هدرِ چسبان می‌نشیند نه رویش، تا سرچ‌بار را نپوشاند؛ و چون خودش هم
 * چسبان است، با اسکرول گم نمی‌شود.
 */
export default function OfflineBar() {
  const { t } = useI18n()
  const layer = useNet((s) => s.layer)
  const checking = useNet((s) => s.checking)
  const recheck = useNet((s) => s.recheck)
  const watch = useNet((s) => s.watch)

  useEffect(() => watch(), [watch])

  // `ok` و `unknown` هر دو یعنی «چیزی برای گفتن نیست». `unknown` مودِ دموست،
  // که سروری ندارد تا وضعیتش را بپرسد — و یک نوارِ هشدار آنجا فقط دروغ است.
  if (layer === 'ok' || layer === 'unknown') return null

  const intranet = layer === 'internet'
  const title = intranet ? t.intranetBar : layer === 'server' ? t.serverBar : t.offlineBar
  // سرورِ محلی آدرسی ندارد که «درست» یا «غلط» باشد؛ راهنمای عمومی کاربر را به
  // سمتِ چک‌کردنِ آی‌پی می‌فرستد در حالی که باید Termux را نگاه کند
  const hint = intranet
    ? t.intranetBarHint
    : layer === 'server'
      ? isLocalServer()
        ? t.serverBarHintLocal
        : t.serverBarHint
      : null

  return (
    <div
      role="status"
      // اینترانت زردِ هشدار نیست: بیشترِ برنامه کار می‌کند و رنگِ خطر، پیامِ
      // اشتباهی می‌دهد. رنگِ خنثی می‌گوید «یک وضعیت، نه یک خرابی».
      className={`glass-tint top-header sticky z-20 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 px-3 py-1.5 text-[11px] ${
        intranet ? 'bg-panel-2/70 text-muted' : 'bg-warn/15 text-warn'
      }`}
    >
      <span className="flex items-center gap-1.5">
        <OfflineIcon className="size-3.5 shrink-0" />
        {title}
      </span>

      {hint && <span className="opacity-70">— {hint}</span>}

      {/* دکمه فقط جایی که واقعاً کاری می‌کند: بدونِ شبکه‌ی دستگاه، پروب زدن
          صرفاً یک تایم‌اوت است و دکمه‌ای که هیچ‌وقت جواب نمی‌دهد بدتر از
          نبودنش است */}
      {layer !== 'device' && (
        <button
          type="button"
          onClick={() => void recheck()}
          disabled={checking}
          className="rounded-full px-2 py-0.5 underline underline-offset-2 transition-opacity hover:opacity-70 disabled:opacity-50"
        >
          {checking ? t.netChecking : t.netRecheck}
        </button>
      )}
    </div>
  )
}

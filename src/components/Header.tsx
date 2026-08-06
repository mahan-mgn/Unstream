import { digits } from '../lib/format'
import { useI18n } from '../lib/i18n'
import { QUALITIES } from '../lib/types'
import { useSettings } from '../store/settings'
import { HeadphonesIcon, MoonIcon, SunIcon } from './icons'

export default function Header({ onHome }: { onHome: () => void }) {
  const { quality, setQuality, theme, toggleTheme } = useSettings()
  const { t, lang, setLang } = useI18n()

  return (
    <header className="sticky top-0 z-30 border-b border-line-soft bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
        <button
          onClick={onHome}
          className="flex items-center gap-2 rounded-lg px-1 py-1 text-[15px] font-bold transition hover:opacity-80"
        >
          <span className="grid size-7 place-items-center rounded-lg bg-accent text-accent-fg">
            <HeadphonesIcon className="size-4" />
          </span>
          {t.brand}
        </button>

        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-1 rounded-full border border-line bg-panel p-0.5 ps-3"
            role="radiogroup"
            aria-label={t.quality}
          >
            <span className="text-[11px] text-muted-2">{t.quality}</span>
            {QUALITIES.map((q) => (
              <button
                key={q.id}
                role="radio"
                aria-checked={quality === q.id}
                onClick={() => setQuality(q.id)}
                className={`rounded-full px-2.5 py-1 text-xs transition ${
                  quality === q.id
                    ? 'bg-accent font-semibold text-accent-fg'
                    : 'text-muted hover:text-fg'
                }`}
              >
                {q.kbps === null ? t.qualityOriginal : digits(q.kbps, lang)}
              </button>
            ))}
          </div>

          <button
            onClick={() => setLang(lang === 'fa' ? 'en' : 'fa')}
            className="rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-muted transition hover:text-fg"
          >
            {t.langSwitch}
          </button>

          <button
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? t.themeLight : t.themeDark}
            className="flex items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-muted transition hover:text-fg"
          >
            {theme === 'dark' ? <SunIcon className="size-3.5" /> : <MoonIcon className="size-3.5" />}
            {theme === 'dark' ? t.themeLight : t.themeDark}
          </button>
        </div>
      </div>
    </header>
  )
}

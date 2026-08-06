import { useI18n } from '../lib/i18n'
import QualityPicker from './QualityPicker'
import { HeadphonesIcon, LibraryIcon, MoonIcon, SunIcon } from './icons'
import { useSettings } from '../store/settings'

interface Props {
  onHome: () => void
  onLibrary: () => void
  inLibrary: boolean
}

export default function Header({ onHome, onLibrary, inLibrary }: Props) {
  const { theme, toggleTheme } = useSettings()
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
          <button
            onClick={onLibrary}
            aria-current={inLibrary ? 'page' : undefined}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition ${
              inLibrary
                ? 'border-accent bg-accent font-semibold text-accent-fg'
                : 'border-line bg-panel text-muted hover:text-fg'
            }`}
          >
            <LibraryIcon className="size-3.5" />
            {t.library}
          </button>

          <QualityPicker />

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

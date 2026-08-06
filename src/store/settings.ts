import { create } from 'zustand'
import type { Quality } from '../lib/types'

type Theme = 'dark' | 'light'

interface SettingsState {
  quality: Quality
  theme: Theme
  setQuality: (q: Quality) => void
  toggleTheme: () => void
}

const read = <T extends string>(key: string, fallback: T): T =>
  (localStorage.getItem(key) as T | null) ?? fallback

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  localStorage.setItem('theme', theme)
}

const initialTheme = read<Theme>('theme', 'dark')
applyTheme(initialTheme)

export const useSettings = create<SettingsState>((set, get) => ({
  quality: read<Quality>('quality', '320'),
  theme: initialTheme,
  setQuality: (quality) => {
    localStorage.setItem('quality', quality)
    set({ quality })
  },
  toggleTheme: () => {
    const theme = get().theme === 'dark' ? 'light' : 'dark'
    applyTheme(theme)
    set({ theme })
  },
}))

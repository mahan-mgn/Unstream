import { create } from 'zustand'

const KEY = 'search:history'
const MAX = 8

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function write(items: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items))
  } catch {
    // سهمیه‌ی localStorage پر است — تاریخچه صرفاً یک راحتی است، نه چیز حیاتی
  }
}

interface SearchHistoryState {
  items: string[]
  /** جلو می‌آورد اگر از قبل بود، وگرنه اول لیست اضافه می‌کند — تا MAX تا */
  add: (query: string) => void
  remove: (query: string) => void
  clear: () => void
}

export const useSearchHistory = create<SearchHistoryState>((set, get) => ({
  items: read(),
  add: (query) => {
    const q = query.trim()
    if (!q) return
    const next = [q, ...get().items.filter((x) => x !== q)].slice(0, MAX)
    write(next)
    set({ items: next })
  },
  remove: (query) => {
    const next = get().items.filter((x) => x !== query)
    write(next)
    set({ items: next })
  },
  clear: () => {
    write([])
    set({ items: [] })
  },
}))

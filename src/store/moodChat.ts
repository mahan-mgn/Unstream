import { create } from 'zustand'

/**
 * باز/بسته بودن چت‌بات وایب.
 *
 * قبلاً state داخلی خودِ MoodChat بود؛ حالا بیرون آمده چون کاشی‌های حس‌وحال در
 * صفحه‌ی خانه باید هم پنل را باز کنند و هم بگویند «همین وایب را بساز» — بدون
 * این‌که خانه و چت‌بات به هم وصل شوند.
 */
interface MoodChatState {
  open: boolean
  /** وایبی که از بیرون درخواست شده و هنوز ارسال نشده — MoodChat مصرفش می‌کند */
  pendingVibe: string | null
  setOpen: (open: boolean) => void
  toggle: () => void
  ask: (vibe: string) => void
  consume: () => void
}

export const useMoodChat = create<MoodChatState>((set) => ({
  open: false,
  pendingVibe: null,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  ask: (vibe) => set({ open: true, pendingVibe: vibe }),
  consume: () => set({ pendingVibe: null }),
}))

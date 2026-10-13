import { create } from 'zustand'

export type ThemeMode = 'light' | 'dark' | 'system'
const KEY = 'theme'

const read = (): ThemeMode => { try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system' } catch { return 'system' } }
const prefersDark = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
const isDark = (m: ThemeMode) => m === 'dark' || (m === 'system' && prefersDark())

function apply(mode: ThemeMode) {
  document.documentElement.classList.toggle('dark', isDark(mode))
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark(mode) ? '#0c141e' : '#17324d')
}

interface ThemeState { mode: ThemeMode; dark: boolean; setMode: (m: ThemeMode) => void; cycle: () => void }

// light → dark → system → light …; "system" follows the OS setting live.
export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: read(),
  dark: isDark(read()),
  setMode: (mode) => {
    try { localStorage.setItem(KEY, mode) } catch { /* private mode: keep for this session only */ }
    apply(mode)
    set({ mode, dark: isDark(mode) })
  },
  cycle: () => get().setMode(({ light: 'dark', dark: 'system', system: 'light' } as const)[get().mode]),
}))

if (typeof matchMedia !== 'undefined') {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const { mode } = useThemeStore.getState()
    if (mode === 'system') { apply(mode); useThemeStore.setState({ dark: isDark(mode) }) }
  })
}
apply(read())

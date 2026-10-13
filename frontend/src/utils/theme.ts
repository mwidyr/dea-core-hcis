import { useMemo } from 'react'
import { useThemeStore } from '../store/theme'

// Libraries that take colours as props (recharts, jsPDF) cannot read CSS variables, so resolve them to "rgb(r, g, b)".
export type ThemeColor = 'brand' | 'danger' | 'ok' | 'warn' | 'info' | 'violet' | 'line' | 'muted' | 'ink' | 'panel'
export const token = (name: ThemeColor): string => {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim().split(/\s+/).join(', ')
  return `rgb(${raw})`
}
/** Re-resolves when the theme flips. */
export function useThemeColors(): Record<ThemeColor, string> {
  const dark = useThemeStore((s) => s.dark)
  return useMemo(() => Object.fromEntries((['brand', 'danger', 'ok', 'warn', 'info', 'violet', 'line', 'muted', 'ink', 'panel'] as ThemeColor[]).map((n) => [n, token(n)])) as Record<ThemeColor, string>, [dark])
}
/** CSS value for inline `style`: follows the theme without re-rendering. */
export const cssColor = (name: ThemeColor, alpha?: number) => `rgb(var(--${name})${alpha === undefined ? '' : ` / ${alpha}`})`

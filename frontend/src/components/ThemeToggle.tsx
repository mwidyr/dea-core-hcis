import { Moon, Monitor, Sun } from 'lucide-react'
import { useThemeStore } from '../store/theme'

const META = { light: { icon: Sun, label: 'Tema terang' }, dark: { icon: Moon, label: 'Tema gelap' }, system: { icon: Monitor, label: 'Tema mengikuti perangkat' } } as const

// One button that cycles light → dark → system.
export default function ThemeToggle({ className = '' }: { className?: string }) {
  const { mode, cycle } = useThemeStore()
  const { icon: Icon, label } = META[mode]
  return (
    <button type="button" onClick={cycle} className={`btn !px-2.5 ${className}`} title={`${label} (klik untuk mengganti)`} aria-label={label}>
      <Icon className="w-3.5 h-3.5" />
    </button>
  )
}

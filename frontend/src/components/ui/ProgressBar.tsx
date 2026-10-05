// Progress bar with the percentage; colour follows the value (or an explicit colour).
export default function ProgressBar({ value, color, label = true, small = false }: { value: number; color?: string; label?: boolean; small?: boolean }) {
  const v = Math.max(0, Math.min(100, value))
  const c = color ?? (v >= 100 ? '#2e9d65' : v > 0 ? '#4f7fc6' : '#cbd0d6')
  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <div className={`flex-1 bg-gray-100 rounded-full overflow-hidden ${small ? 'h-1.5' : 'h-2'}`}><div className="h-full rounded-full transition-all" style={{ width: `${v}%`, background: c }} /></div>
      {label && <span className="text-[10.5px] font-bold tabular-nums w-10 text-right">{Math.round(v * 10) / 10}%</span>}
    </div>
  )
}

import { useState } from 'react'

// Picks a KPI period: monthly ("2026-10") or quarterly ("2026-Q4"). Calls onChange with the period key.
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
export const currentPeriod = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}` }

export default function PeriodPicker({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  const quarterly = value.includes('Q')
  const year = Number(value.slice(0, 4))
  const [kind, setKind] = useState<'month' | 'quarter'>(quarterly ? 'quarter' : 'month')
  const now = new Date()
  const years = [now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]
  const setKindAndKey = (k: 'month' | 'quarter') => {
    setKind(k)
    if (k === 'quarter') onChange(`${year}-Q${Math.ceil((Number(value.slice(5, 7)) || 1) / 3)}`)      // month → the quarter that contains it
    else onChange(`${year}-${String(((Number(value.slice(-1)) || 1) - 1) * 3 + 1).padStart(2, '0')}`) // quarter → its first month
  }
  return (
    <div className="flex items-center gap-2">
      <select className="input" value={kind} onChange={(e) => setKindAndKey(e.target.value as 'month' | 'quarter')}><option value="month">Bulanan</option><option value="quarter">Kuartalan</option></select>
      {kind === 'month'
        ? <select className="input" value={value.slice(5, 7)} onChange={(e) => onChange(`${year}-${e.target.value}`)}>{MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}</select>
        : <select className="input" value={value.slice(-1)} onChange={(e) => onChange(`${year}-Q${e.target.value}`)}>{[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}</select>}
      <select className="input" value={year} onChange={(e) => onChange(kind === 'quarter' ? `${e.target.value}-Q${value.slice(-1)}` : `${e.target.value}-${value.slice(5, 7)}`)}>{years.map((y) => <option key={y}>{y}</option>)}</select>
    </div>
  )
}

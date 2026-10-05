import { useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'

const PRESETS = [10, 20]
export const MAX_PAGE_SIZE = 200

interface Props {
  page: number
  pageSize: number
  total: number
  onPage: (p: number) => void
  onPageSize: (n: number) => void
}

// Page window: 1 … 4 5 [6] 7 8 … 20  (first/last always visible)
function windowed(page: number, last: number): (number | '…')[] {
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1)
  const out: (number | '…')[] = [1]
  const from = Math.max(2, page - 1)
  const to = Math.min(last - 1, page + 1)
  if (from > 2) out.push('…')
  for (let i = from; i <= to; i++) out.push(i)
  if (to < last - 1) out.push('…')
  out.push(last)
  return out
}

export default function Pagination({ page, pageSize, total, onPage, onPageSize }: Props) {
  const last = Math.max(1, Math.ceil(total / pageSize))
  const cur = Math.min(page, last)
  const from = total === 0 ? 0 : (cur - 1) * pageSize + 1
  const to = Math.min(total, cur * pageSize)
  const isCustom = !PRESETS.includes(pageSize)
  const [custom, setCustom] = useState(isCustom)
  const [customVal, setCustomVal] = useState(String(pageSize))

  const applyCustom = (v: string) => {
    setCustomVal(v)
    const n = parseInt(v, 10)
    if (n >= 1) onPageSize(Math.min(n, MAX_PAGE_SIZE))
  }

  const btn = 'h-7 min-w-7 px-1.5 rounded-md border border-line text-xs grid place-items-center disabled:opacity-40 disabled:cursor-not-allowed enabled:hover:bg-gray-50'

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-3 text-xs">
      <div className="flex items-center gap-2 text-muted">
        <span>Tampilkan</span>
        <select className="input !py-1" value={custom || isCustom ? 'custom' : pageSize}
          onChange={(e) => {
            if (e.target.value === 'custom') { setCustom(true); applyCustom(customVal) }
            else { setCustom(false); onPageSize(Number(e.target.value)) }
          }}>
          {PRESETS.map((n) => <option key={n} value={n}>{n}</option>)}
          <option value="custom">Custom…</option>
        </select>
        {(custom || isCustom) && (
          <input className="input !py-1 w-16" type="number" min={1} max={MAX_PAGE_SIZE} value={customVal}
            onChange={(e) => applyCustom(e.target.value)} title={`1–${MAX_PAGE_SIZE}`} />
        )}
        <span>data · {from}–{to} dari {total}</span>
      </div>

      <div className="flex items-center gap-1">
        <button className={btn} disabled={cur <= 1} onClick={() => onPage(1)} title="Halaman pertama"><ChevronsLeft className="w-3.5 h-3.5" /></button>
        <button className={btn} disabled={cur <= 1} onClick={() => onPage(cur - 1)} title="Sebelumnya"><ChevronLeft className="w-3.5 h-3.5" /></button>
        {windowed(cur, last).map((p, i) =>
          p === '…' ? <span key={`e${i}`} className="px-1 text-muted">…</span> : (
            <button key={p} className={`${btn} ${p === cur ? '!bg-brand !border-brand text-white font-bold' : ''}`} onClick={() => onPage(p)}>{p}</button>
          ))}
        <button className={btn} disabled={cur >= last} onClick={() => onPage(cur + 1)} title="Berikutnya"><ChevronRight className="w-3.5 h-3.5" /></button>
        <button className={btn} disabled={cur >= last} onClick={() => onPage(last)} title="Halaman terakhir"><ChevronsRight className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  )
}

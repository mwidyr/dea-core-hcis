import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'
import { getHolidays } from '../../services/api'
import type { Holiday } from '../../types'

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const DOW = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']
const pad = (n: number) => String(n).padStart(2, '0')
const key = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`
const show = (v: string) => (v ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : '')

// holiday lookups are cached briefly per scope+year, so every date field on a page shares one request
const cache = new Map<string, { t: number; list: Holiday[] }>()
export const clearHolidayCache = () => cache.clear()
async function loadYear(scope: number | 'national', year: number): Promise<Holiday[]> {
  const k = `${scope}:${year}`
  const hit = cache.get(k)
  if (hit && Date.now() - hit.t < 60000) return hit.list
  const params = scope === 'national' ? { year, only_national: 1 } : { year, business_id: scope || undefined }
  const list = (await getHolidays(params)).data.data
  cache.set(k, { t: Date.now(), list })
  return list
}

interface Props {
  value: string
  onChange: (v: string) => void
  min?: string
  max?: string
  /** whose holidays to mark: a business id (national + that business), 'national' (national only), 0 = everything visible */
  businessId?: number | 'national'
  placeholder?: string
}

// Date picker that marks holidays: plain day off (green), cuti bersama / potong cuti (amber), weekends (red text).
export default function DateField({ value, onChange, min, max, businessId = 0, placeholder = 'Pilih tanggal' }: Props) {
  const [open, setOpen] = useState(false)
  const todayK = key(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())
  // with no value, open on today — pulled into the allowed range (min / max)
  const baseKey = () => value || (min && todayK < min ? min : max && todayK > max ? max : todayK)
  const initial = baseKey()
  const [view, setView] = useState({ y: Number(initial.slice(0, 4)), m: Number(initial.slice(5, 7)) - 1 })
  const [holidays, setHolidays] = useState<Record<string, Holiday>>({})
  const [hover, setHover] = useState('')
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const btn = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)

  useEffect(() => { // load the displayed year (and the neighbour year when browsing December/January)
    if (!open) return
    let alive = true
    const years = [view.y]
    if (view.m === 0) years.push(view.y - 1)
    if (view.m === 11) years.push(view.y + 1)
    Promise.all(years.map((y) => loadYear(businessId, y))).then((lists) => {
      if (!alive) return
      const map: Record<string, Holiday> = {}
      lists.flat().forEach((h) => { const k = h.date.slice(0, 10); if (!map[k] || h.deducts_leave) map[k] = h })
      setHolidays(map)
    }).catch(() => {})
    return () => { alive = false }
  }, [open, view.y, view.m, businessId])

  const place = () => {
    const r = btn.current?.getBoundingClientRect()
    if (!r) return
    const h = pop.current?.offsetHeight ?? 360
    const top = window.innerHeight - r.bottom < h + 12 && r.top > h + 12 ? r.top - h - 4 : r.bottom + 4
    setPos({ top, left: Math.min(r.left, window.innerWidth - 292) })
  }
  useLayoutEffect(() => { if (open) place() }, [open, view])
  useEffect(() => {
    if (!open) return
    const outside = (e: MouseEvent) => { if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    const scroll = (e: Event) => { if (!pop.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', esc, true)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', place)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', esc, true); window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', place) }
  }, [open])

  const openPicker = () => {
    const base = baseKey()
    setView({ y: Number(base.slice(0, 4)), m: Number(base.slice(5, 7)) - 1 })
    setHover(''); setOpen((o) => !o)
  }
  const shift = (d: number) => setView(({ y, m }) => { const t = m + d; return { y: y + Math.floor(t / 12), m: ((t % 12) + 12) % 12 } })

  const cells = useMemo(() => {
    const lead = (new Date(view.y, view.m, 1).getDay() + 6) % 7 // Monday-first
    const days = new Date(view.y, view.m + 1, 0).getDate()
    return [...Array(lead).fill(0), ...Array.from({ length: days }, (_, i) => i + 1)]
  }, [view])
  const todayKey = key(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())
  const hovered = hover ? holidays[hover] : undefined

  return (
    <>
      <button type="button" ref={btn} onClick={openPicker} className="input w-full text-left flex items-center justify-between">
        <span className={value ? '' : 'text-muted'}>{value ? show(value) : placeholder}</span><Calendar className="w-3.5 h-3.5 text-muted" />
      </button>
      {open && createPortal(
        <div ref={pop} style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 70, width: 284 }} className="bg-white border border-line rounded-xl shadow-2xl p-3 text-xs">
          <div className="flex items-center justify-between mb-2">
            <button type="button" className="p-1 rounded hover:bg-gray-100" onClick={() => shift(-1)} title="Bulan sebelumnya"><ChevronLeft className="w-4 h-4" /></button>
            <div className="font-bold">{MONTHS[view.m]} {view.y}</div>
            <button type="button" className="p-1 rounded hover:bg-gray-100" onClick={() => shift(1)} title="Bulan berikutnya"><ChevronRight className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-7 text-center text-[10px] font-bold text-muted mb-1">{DOW.map((d, i) => <div key={d} className={i >= 5 ? 'text-brand' : ''}>{d}</div>)}</div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((d, i) => {
              if (!d) return <div key={`b${i}`} />
              const k = key(view.y, view.m, d)
              const h = holidays[k]
              const weekend = i % 7 >= 5
              const disabled = (!!min && k < min) || (!!max && k > max)
              const selected = k === value
              let cls = 'h-8 rounded-md grid place-items-center relative '
              if (selected) cls += 'bg-brand text-white font-bold '
              else if (h) cls += (h.deducts_leave ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok') + ' font-bold '
              else if (weekend) cls += 'text-brand/70 '
              if (!selected && k === todayKey) cls += 'ring-1 ring-gray-400 '
              cls += disabled ? 'opacity-30 cursor-not-allowed' : selected ? '' : 'hover:bg-gray-100 cursor-pointer'
              return (
                <button type="button" key={k} disabled={disabled} className={cls} data-date={k} data-holiday={h ? (h.deducts_leave ? 'deduct' : 'free') : undefined}
                  title={h ? `${h.name} — ${h.deducts_leave ? 'cuti bersama (potong cuti)' : 'libur (tidak potong cuti)'}` : undefined}
                  onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover('')} onClick={() => { onChange(k); setOpen(false) }}>
                  {d}{h && <span className={`absolute bottom-0.5 w-1 h-1 rounded-full ${selected ? 'bg-white' : h.deducts_leave ? 'bg-warn' : 'bg-ok'}`} />}
                </button>
              )
            })}
          </div>
          <div className="mt-2 pt-2 border-t border-line min-h-[34px]">
            {hovered ? (
              <div><b>{hovered.name}</b><div className="text-muted">{hovered.deducts_leave ? 'Cuti bersama — memotong saldo cuti' : 'Libur — tidak memotong cuti'}{hovered.business_id === null ? ' · nasional' : ' · khusus bisnis ini'}</div></div>
            ) : (
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-muted">
                <span><i className="inline-block w-2 h-2 rounded-full bg-ok mr-1" />Libur</span>
                <span><i className="inline-block w-2 h-2 rounded-full bg-warn mr-1" />Cuti bersama (potong cuti)</span>
                <span><i className="text-brand/70 not-italic font-bold mr-1">12</i>Akhir pekan</span>
              </div>
            )}
          </div>
        </div>, document.body)}
    </>
  )
}

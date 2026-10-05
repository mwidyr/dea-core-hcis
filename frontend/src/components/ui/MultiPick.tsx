import { useEffect, useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'

export interface PickOption { id: number; label: string; sub?: string }

// Multi-select with search and chips (used for task members and watchers).
export default function MultiPick({ options, value, onChange, placeholder = 'Pilih…', disabled = false }: { options: PickOption[]; value: number[]; onChange: (v: number[]) => void; placeholder?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const out = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    // Escape closes just this list (not the dialog around it): capture + stopPropagation beats the Modal's handler
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', out)
    document.addEventListener('keydown', esc, true)
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc, true) }
  }, [open])
  const sel = options.filter((o) => value.includes(o.id))
  const list = options.filter((o) => `${o.label} ${o.sub ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  return (
    <div className="relative" ref={box}>
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} className="input w-full text-left flex items-center gap-1.5 flex-wrap min-h-[34px] disabled:bg-gray-100">
        {sel.length ? sel.map((o) => (
          <span key={o.id} className="inline-flex items-center gap-1 bg-gray-100 rounded-full pl-2 pr-1 py-0.5 text-[11px]">{o.label}
            <span role="button" className="rounded-full hover:bg-gray-300 p-0.5" onClick={(e) => { e.stopPropagation(); if (!disabled) toggle(o.id) }}><X className="w-2.5 h-2.5" /></span></span>
        )) : <span className="text-muted">{placeholder}</span>}
        <ChevronDown className="w-3.5 h-3.5 text-muted ml-auto shrink-0" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-line rounded-lg shadow-xl p-2">
          <input className="input w-full mb-1.5" placeholder="Cari…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <div className="max-h-48 overflow-auto">
            {list.map((o) => (
              <label key={o.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer text-xs">
                <input type="checkbox" checked={value.includes(o.id)} onChange={() => toggle(o.id)} /><span className="flex-1">{o.label}</span>{o.sub && <span className="text-muted text-[10.5px]">{o.sub}</span>}
              </label>
            ))}
            {!list.length && <div className="text-center text-muted py-3 text-xs">Tidak ada hasil</div>}
          </div>
        </div>
      )}
    </div>
  )
}

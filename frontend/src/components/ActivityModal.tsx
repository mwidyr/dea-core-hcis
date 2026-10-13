import { useEffect, useState } from 'react'
import Badge from './ui/Badge'
import Modal from './ui/Modal'
import Pagination from './ui/Pagination'
import { getActivity } from '../services/api'
import type { ActivityItem } from '../types'
import { useNavigate } from 'react-router-dom'

const dot = { ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger', info: 'bg-brand', muted: 'bg-muted' } as const
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Every logged activity ("Semua log activity"), newest first, with a date filter and paging.
export default function ActivityModal({ scope, onClose }: { scope: 'me' | 'team'; onClose: () => void }) {
  const nav = useNavigate()
  const [date, setDate] = useState(ymd(new Date()))
  const [allDays, setAllDays] = useState(false)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(20)
  const [rows, setRows] = useState<ActivityItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => setPage(1), [date, allDays, size])
  useEffect(() => {
    setLoading(true)
    getActivity({ scope, date: allDays ? undefined : date, page, page_size: size === 0 ? 200 : size })
      .then((r) => { setRows(r.data.data); setTotal(r.data.total) }).finally(() => setLoading(false))
  }, [scope, date, allDays, page, size])

  return (
    <Modal open onClose={onClose} title="Semua Aktivitas" size="lg">
      <div className="text-xs">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <label className="flex items-center gap-2 font-semibold">Tanggal <input type="date" className="input" value={date} disabled={allDays} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={allDays} onChange={(e) => setAllDays(e.target.checked)} />Semua tanggal</label>
          <span className="text-muted ml-auto">{total} aktivitas</span>
        </div>
        <ol className="relative border-l border-line ml-2 space-y-3 min-h-[8rem]">
          {rows.map((a) => (
            <li key={a.id} className="pl-4 relative">
              <span className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full ${dot[a.tone]}`} />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted tabular-nums">{allDays ? `${new Date(a.at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })} · ` : ''}{a.time}</span>
                {a.link ? <button className="font-semibold text-left hover:underline" onClick={() => { onClose(); nav(a.link) }}>{a.title}</button> : <b>{a.title}</b>}
                {a.actor && <Badge tone="gray">{a.actor}</Badge>}
              </div>
              {a.desc && <div className="text-muted">{a.desc}</div>}
            </li>
          ))}
          {!rows.length && <li className="pl-4 text-muted">{loading ? 'Memuat…' : 'Tidak ada aktivitas'}</li>}
        </ol>
        <Pagination page={page} pageSize={size} total={total} onPage={setPage} onPageSize={setSize} />
      </div>
    </Modal>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { getHolidays, getLeaveRequests, getTasks } from '../services/api'
import { useAuthStore } from '../store/auth'
import { bizParams, useBusinessStore } from '../store/business'
import { STATUS_BAR, ymd } from './tasks/taskUtils'
import type { Holiday, LeaveRow, TaskRow } from '../types'

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

// "Kalender Saya": my tasks (PIC or member), approved / pending leave, and holidays on one month grid.
export default function PersonalCalendar() {
  const nav = useNavigate()
  const me = useAuthStore((s) => s.user?.employee_id)
  const { businessId } = useBusinessStore()
  const now = new Date()
  const [view, setView] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [leaves, setLeaves] = useState<LeaveRow[]>([])
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const shift = (d: number) => setView(({ y, m }) => { const t = m + d; return { y: y + Math.floor(t / 12), m: ((t % 12) + 12) % 12 } })

  useEffect(() => { getHolidays({ year: view.y, ...bizParams(businessId) }).then((r) => setHolidays(r.data.data)).catch(() => setHolidays([])) }, [view.y, businessId])
  useEffect(() => {
    getLeaveRequests().then((r) => setLeaves(r.data.filter((l) => l.employee_id === me && (l.status === 'Disetujui' || l.status === 'Pending Approval')))).catch(() => setLeaves([]))
    Promise.all([getTasks({ scope: 'mine' }), getTasks({ scope: 'involved' })]).then(([a, b]) => {
      const seen = new Set<number>()
      setTasks([...a.data.data, ...b.data.data].filter((t) => !t.is_parent && !seen.has(t.id) && !!seen.add(t.id)))
    }).catch(() => setTasks([]))
  }, [me])

  const lead = (new Date(view.y, view.m, 1).getDay() + 6) % 7
  const days = new Date(view.y, view.m + 1, 0).getDate()
  const cells = [...Array(lead).fill(0), ...Array.from({ length: days }, (_, i) => i + 1)]
  const todayK = ymd(now)
  const holidayOn = useMemo(() => { const m = new Map<string, string[]>(); holidays.forEach((h) => { const k = h.date.slice(0, 10); m.set(k, [...(m.get(k) ?? []), h.name]) }); return m }, [holidays])
  const inRange = (k: string, s?: string | null, e?: string | null) => { const a = (s ?? e)?.slice(0, 10), b = (e ?? s)?.slice(0, 10); return !!a && !!b && k >= a && k <= b }

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2.5 border-b border-line flex-wrap">
        <div><h3 className="text-[15px] font-bold leading-tight">Kalender Saya</h3><p className="text-[11.5px] text-muted mt-0.5">Tugas, cuti, dan hari libur</p></div>
        <div className="flex items-center gap-2">
          <button className="btn !px-2" onClick={() => shift(-1)} aria-label="Bulan sebelumnya"><ChevronLeft className="w-3.5 h-3.5" /></button>
          <b className="w-36 text-center text-sm">{MONTHS[view.m]} {view.y}</b>
          <button className="btn !px-2" onClick={() => shift(1)} aria-label="Bulan berikutnya"><ChevronRight className="w-3.5 h-3.5" /></button>
          <button className="btn" onClick={() => setView({ y: now.getFullYear(), m: now.getMonth() })}>Hari ini</button>
        </div>
      </div>
      <div className="p-3">
        <div className="grid grid-cols-7 text-center text-[10px] font-bold text-muted mb-1">{['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((d, i) => <div key={d} className={i >= 5 ? 'text-danger' : ''}>{d}</div>)}</div>
        <div className="grid grid-cols-7 gap-px bg-line border border-line rounded-lg overflow-hidden">
          {cells.map((d, i) => {
            if (!d) return <div key={`b${i}`} className="bg-sunken min-h-[88px]" />
            const k = `${view.y}-${String(view.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
            const hol = holidayOn.get(k) ?? []
            const lv = leaves.filter((l) => inRange(k, l.start_date, l.end_date))
            const ts = tasks.filter((t) => inRange(k, t.start_date, t.due_date))
            return (
              <div key={k} className={`min-h-[88px] p-1 ${hol.length ? 'bg-danger-soft/40' : 'bg-panel'} ${k === todayK ? 'ring-2 ring-inset ring-brand/40' : ''}`}>
                <div className={`text-[10.5px] font-bold mb-0.5 ${i % 7 >= 5 || hol.length ? 'text-danger/80' : 'text-muted'}`}>{d}</div>
                <div className="space-y-0.5">
                  {hol.map((n) => <div key={n} title={n} className="text-[10px] leading-tight px-1 py-0.5 rounded truncate bg-danger-soft text-danger font-semibold">Libur · {n}</div>)}
                  {lv.map((l) => <div key={l.id} title={`${l.type_name} · ${l.status}`} className={`text-[10px] leading-tight px-1 py-0.5 rounded truncate ${l.status === 'Disetujui' ? 'bg-violet-soft text-violet' : 'bg-warn-soft text-warn'}`}>{l.type_name}{l.status !== 'Disetujui' ? ' (menunggu)' : ''}</div>)}
                  {ts.slice(0, 2).map((t) => <button key={t.id} onClick={() => nav(`/tasks?open=${t.id}`)} title={t.title} className="w-full text-left text-[10px] leading-tight px-1 py-0.5 rounded truncate text-white" style={{ background: STATUS_BAR[t.status] }}>{t.title}</button>)}
                  {ts.length > 2 && <div className="text-[10px] text-muted">+{ts.length - 2} tugas</div>}
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex flex-wrap gap-3 mt-2 text-[10.5px] text-muted"><span><i className="inline-block w-2.5 h-2.5 rounded mr-1 bg-danger-soft border border-danger/30" />Libur</span><span><i className="inline-block w-2.5 h-2.5 rounded mr-1 bg-violet-soft" />Cuti disetujui</span><span><i className="inline-block w-2.5 h-2.5 rounded mr-1 bg-warn-soft" />Cuti menunggu</span><span>Tugas diwarnai menurut statusnya</span></div>
      </div>
    </div>
  )
}

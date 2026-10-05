import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Flame } from 'lucide-react'
import Badge from '../ui/Badge'
import Pagination from '../ui/Pagination'
import ProgressBar from '../ui/ProgressBar'
import { setTaskStatus } from '../../services/api'
import type { TaskRow, TaskStatus } from '../../types'
import { STATUS_BAR, STATUS_LABEL, STATUS_TONE, buildTree, dateOf, dayDiff, flatten, fmt, initials, ymd, err } from './taskUtils'

export type GroupBy = 'none' | 'unit' | 'project' | 'pic' | 'status'
interface ViewProps { tasks: TaskRow[]; onOpen: (id: number) => void }

// ------------------------------------------------------------------ List (grouping + pagination)
const groupKey = (t: TaskRow, g: GroupBy) => (g === 'unit' ? t.unit_name || 'Tanpa unit' : g === 'project' ? t.project_name || 'Tanpa proyek' : g === 'pic' ? t.pic_name : g === 'status' ? STATUS_LABEL[t.status] : '')

export function TaskList({ tasks, onOpen, groupBy }: ViewProps & { groupBy: GroupBy }) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const sorted = useMemo(() => (groupBy === 'none' ? tasks : [...tasks].sort((a, b) => groupKey(a, groupBy).localeCompare(groupKey(b, groupBy)))), [tasks, groupBy])
  useEffect(() => setPage(1), [tasks, groupBy, pageSize])
  const last = Math.max(1, Math.ceil(sorted.length / pageSize))
  const cur = Math.min(page, last)
  const rows = sorted.slice((cur - 1) * pageSize, cur * pageSize)
  const counts = useMemo(() => { const m = new Map<string, number>(); sorted.forEach((t) => m.set(groupKey(t, groupBy), (m.get(groupKey(t, groupBy)) ?? 0) + 1)); return m }, [sorted, groupBy])
  return (
    <div>
      <div className="border border-line rounded-lg overflow-auto">
        <table className="w-full">
          <thead><tr>{['Tugas', 'PIC', 'Proyek', 'Deadline', 'Status', 'Progres'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((t, i) => {
              const g = groupKey(t, groupBy)
              const header = groupBy !== 'none' && (i === 0 || groupKey(rows[i - 1], groupBy) !== g)
              return (
                <Fragment key={t.id}>
                  {header && <tr><td colSpan={6} className="px-3 py-1.5 bg-gray-100 text-[11px] font-bold">{g} <span className="font-normal text-muted">· {counts.get(g)} tugas</span></td></tr>}
                  <tr className="cursor-pointer hover:bg-gray-50" onClick={() => onOpen(t.id)}>
                    <td className="td" style={{ paddingLeft: 12 + (t.depth - 1) * 14 }}>
                      <div className="flex items-center gap-1.5">{t.priority === 'tinggi' && <Flame className="w-3.5 h-3.5 text-brand shrink-0" />}<b>{t.title}</b>{t.is_parent && <Badge tone="purple">{t.kids_done}/{t.kids_total}</Badge>}</div>
                      {t.parent_title && <div className="text-muted text-[10.5px]">↳ {t.parent_title}</div>}
                    </td>
                    <td className="td"><div className="flex items-center gap-1.5"><span className="w-5 h-5 rounded-full bg-brand-soft text-brand text-[9px] font-bold grid place-items-center shrink-0">{initials(t.pic_name)}</span><span className="whitespace-nowrap">{t.pic_name}</span></div></td>
                    <td className="td text-muted">{t.project_name || '–'}</td>
                    <td className={`td whitespace-nowrap ${t.overdue ? 'text-brand font-bold' : ''}`}>{fmt(t.due_date)}</td>
                    <td className="td"><Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge></td>
                    <td className="td w-40"><ProgressBar value={t.progress} small /></td>
                  </tr>
                </Fragment>
              )
            })}
            {!rows.length && <tr><td className="td text-center text-muted" colSpan={6}>Tidak ada tugas</td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination page={cur} pageSize={pageSize} total={sorted.length} onPage={setPage} onPageSize={setPageSize} />
    </div>
  )
}

// ------------------------------------------------------------------ Board (Kanban)
const COLS: TaskStatus[] = ['todo', 'in_progress', 'review', 'done']
export function TaskBoard({ tasks, onOpen, onChanged }: ViewProps & { onChanged: () => void }) {
  const [drag, setDrag] = useState<TaskRow | null>(null)
  const [over, setOver] = useState<TaskStatus | null>(null)
  const [msg, setMsg] = useState('')
  const drop = async (col: TaskStatus) => {
    const t = drag; setDrag(null); setOver(null); setMsg('')
    if (!t || t.status === col) return
    if (col === 'todo' || col === 'in_progress') {
      try { await setTaskStatus(t.id, col); onChanged() } catch (e: any) { setMsg(err(e, 'Gagal memindahkan tugas')) }
    } else { setMsg('Menutup tugas dilakukan lewat tombol “Selesaikan” (ada lampiran hasil / approval). Dibuka detailnya untuk Anda.'); onOpen(t.id) }
  }
  const draggable = (t: TaskRow) => t.can_work && !t.is_parent && (t.status === 'todo' || t.status === 'in_progress')
  return (
    <div>
      {msg && <div className="mb-2 text-xs text-info bg-info-soft rounded-lg px-3 py-2">{msg}</div>}
      <div className="grid grid-cols-4 gap-3 items-start">
        {COLS.map((col) => {
          const list = tasks.filter((t) => t.status === col)
          return (
            <div key={col} onDragOver={(e) => { e.preventDefault(); setOver(col) }} onDragLeave={() => setOver((o) => (o === col ? null : o))} onDrop={() => drop(col)}
              className={`rounded-xl p-2 min-h-[240px] border ${over === col ? 'border-brand bg-brand-soft/30' : 'border-line bg-gray-50/60'}`}>
              <div className="flex items-center justify-between px-1 pb-2"><Badge tone={STATUS_TONE[col]}>{STATUS_LABEL[col]}</Badge><span className="text-[11px] text-muted font-bold">{list.length}</span></div>
              <div className="space-y-2">
                {list.map((t) => (
                  <div key={t.id} draggable={draggable(t)} onDragStart={() => setDrag(t)} onDragEnd={() => { setDrag(null); setOver(null) }} onClick={() => onOpen(t.id)}
                    className={`bg-white border border-line rounded-lg p-2.5 shadow-sm hover:shadow ${draggable(t) ? 'cursor-grab' : 'cursor-pointer'}`}>
                    <div className="flex items-start gap-1.5">{t.priority === 'tinggi' && <Flame className="w-3.5 h-3.5 text-brand shrink-0 mt-0.5" />}<b className="text-xs leading-snug">{t.title}</b></div>
                    {(t.project_name || t.parent_title) && <div className="text-[10.5px] text-muted mt-0.5 truncate">{t.project_name}{t.project_name && t.parent_title ? ' · ' : ''}{t.parent_title && `↳ ${t.parent_title}`}</div>}
                    {t.is_parent && <div className="mt-1.5"><ProgressBar value={t.progress} small /><div className="text-[10px] text-muted mt-0.5">{t.kids_done}/{t.kids_total} sub tugas</div></div>}
                    <div className="flex items-center justify-between mt-2">
                      <span className="flex items-center gap-1"><span className="w-5 h-5 rounded-full bg-brand-soft text-brand text-[9px] font-bold grid place-items-center">{initials(t.pic_name)}</span><span className="text-[10.5px] text-muted">{t.pic_name.split(' ')[0]}</span></span>
                      <span className={`text-[10.5px] ${t.overdue ? 'text-brand font-bold' : 'text-muted'}`}>{t.due_date ? fmt(t.due_date) : ''}</span>
                    </div>
                  </div>
                ))}
                {!list.length && <div className="text-center text-[11px] text-muted py-6">Kosong</div>}
              </div>
            </div>
          )
        })}
      </div>
      <p className="text-[11px] text-muted mt-2">Seret kartu antara To Do dan In Progress. Tugas induk mengikuti sub tugasnya (tidak bisa dipindah).</p>
    </div>
  )
}

// ------------------------------------------------------------------ Calendar (month)
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
export function TaskCalendar({ tasks, onOpen }: ViewProps) {
  const now = new Date()
  const [view, setView] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [more, setMore] = useState<string | null>(null)
  const shift = (d: number) => setView(({ y, m }) => { const t = m + d; return { y: y + Math.floor(t / 12), m: ((t % 12) + 12) % 12 } })
  const lead = (new Date(view.y, view.m, 1).getDay() + 6) % 7
  const days = new Date(view.y, view.m + 1, 0).getDate()
  const cells = [...Array(lead).fill(0), ...Array.from({ length: days }, (_, i) => i + 1)]
  const todayK = ymd(now)
  const onDay = (k: string) => tasks.filter((t) => { const s = (t.start_date ?? t.due_date)?.slice(0, 10), e = (t.due_date ?? t.start_date)?.slice(0, 10); return !!s && !!e && k >= s && k <= e })
  return (
    <div>
      <div className="flex items-center justify-center gap-3 mb-2">
        <button className="btn !px-2" onClick={() => shift(-1)}><ChevronLeft className="w-3.5 h-3.5" /></button>
        <b className="w-40 text-center">{MONTHS[view.m]} {view.y}</b>
        <button className="btn !px-2" onClick={() => shift(1)}><ChevronRight className="w-3.5 h-3.5" /></button>
        <button className="btn" onClick={() => setView({ y: now.getFullYear(), m: now.getMonth() })}>Hari ini</button>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] font-bold text-muted mb-1">{['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((d, i) => <div key={d} className={i >= 5 ? 'text-brand' : ''}>{d}</div>)}</div>
      <div className="grid grid-cols-7 gap-px bg-line border border-line rounded-lg overflow-hidden">
        {cells.map((d, i) => {
          if (!d) return <div key={`b${i}`} className="bg-gray-50 min-h-[96px]" />
          const k = `${view.y}-${String(view.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
          const list = onDay(k)
          const shown = more === k ? list : list.slice(0, 3)
          return (
            <div key={k} className={`bg-white min-h-[96px] p-1 ${k === todayK ? 'ring-2 ring-inset ring-brand/40' : ''}`}>
              <div className={`text-[10.5px] font-bold mb-0.5 ${i % 7 >= 5 ? 'text-brand/70' : 'text-gray-500'}`}>{d}</div>
              <div className="space-y-0.5">
                {shown.map((t) => (
                  <button key={t.id} onClick={() => onOpen(t.id)} title={`${t.title} — ${t.pic_name}`}
                    className="w-full text-left text-[10px] leading-tight px-1 py-0.5 rounded truncate text-white" style={{ background: t.overdue ? '#d84a4a' : STATUS_BAR[t.status] }}>{t.title}</button>
                ))}
                {list.length > 3 && more !== k && <button className="text-[10px] text-muted hover:underline" onClick={() => setMore(k)}>+{list.length - 3} lagi</button>}
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex gap-3 mt-2 text-[10.5px] text-muted">{(['todo', 'in_progress', 'review', 'done'] as TaskStatus[]).map((s) => <span key={s}><i className="inline-block w-2.5 h-2.5 rounded mr-1" style={{ background: STATUS_BAR[s] }} />{STATUS_LABEL[s]}</span>)}<span><i className="inline-block w-2.5 h-2.5 rounded mr-1 bg-brand" />Terlambat</span></div>
    </div>
  )
}

// ------------------------------------------------------------------ Gantt
const ROW = 34, NAME_W = 300
export function TaskGantt({ tasks, onOpen }: ViewProps) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [dayW, setDayW] = useState(26)
  const scroller = useRef<HTMLDivElement>(null)
  const rows = useMemo(() => flatten(buildTree(tasks), collapsed), [tasks, collapsed])
  const dated = tasks.filter((t) => t.start_date || t.due_date)
  const bounds = useMemo(() => {
    const todayD = dateOf(ymd(new Date()))
    let lo = todayD, hi = todayD
    dated.forEach((t) => { const s = dateOf((t.start_date ?? t.due_date)!), e = dateOf((t.due_date ?? t.start_date)!); if (s < lo) lo = s; if (e > hi) hi = e })
    const start = new Date(lo); start.setDate(start.getDate() - 3)
    const end = new Date(hi); end.setDate(end.getDate() + 5)
    if (dayDiff(start, end) < 28) end.setDate(start.getDate() + 28)
    return { start, total: dayDiff(start, end) + 1 }
  }, [tasks])
  useEffect(() => { // bring "today" into view
    const x = dayDiff(bounds.start, dateOf(ymd(new Date()))) * dayW - 120
    if (scroller.current) scroller.current.scrollLeft = Math.max(0, x)
  }, [bounds.start.getTime()])
  const toggle = (id: number) => setCollapsed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const todayX = dayDiff(bounds.start, dateOf(ymd(new Date()))) * dayW
  const width = bounds.total * dayW
  const dayList = Array.from({ length: bounds.total }, (_, i) => { const d = new Date(bounds.start); d.setDate(d.getDate() + i); return d })
  const months: { label: string; span: number }[] = []
  dayList.forEach((d) => { const l = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; if (months.length && months[months.length - 1].label === l) months[months.length - 1].span++; else months.push({ label: l, span: 1 }) })
  if (!tasks.length) return <div className="text-center text-muted text-xs py-10">Tidak ada tugas</div>
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 text-xs">
        <span className="text-muted">Zoom</span>
        {[[14, 'Ringkas'], [26, 'Normal'], [44, 'Lebar']].map(([w, l]) => <button key={w} className={`btn ${dayW === w ? '!bg-brand-soft !text-brand !border-brand' : ''}`} onClick={() => setDayW(w as number)}>{l}</button>)}
        <button className="btn ml-auto" onClick={() => { if (scroller.current) scroller.current.scrollLeft = Math.max(0, todayX - 120) }}>Ke hari ini</button>
        <button className="btn" onClick={() => setCollapsed(new Set(rows.filter((r) => r.hasKids).map((r) => r.task.id)))}>Ciutkan semua</button>
        <button className="btn" onClick={() => setCollapsed(new Set())}>Bentangkan</button>
      </div>
      <div ref={scroller} className="border border-line rounded-lg overflow-auto max-h-[70vh] bg-white">
        <div className="flex" style={{ width: NAME_W + width }}>
          <div className="sticky left-0 z-20 bg-white border-r border-line shrink-0" style={{ width: NAME_W }}>
            <div className="h-[52px] border-b border-line bg-gray-50 px-3 flex items-end pb-1.5 text-[10px] uppercase tracking-wider font-bold text-muted">Tugas</div>
            {rows.map(({ task: t, depth, hasKids }) => (
              <div key={t.id} className="flex items-center gap-1 px-2 border-b border-line/60 hover:bg-gray-50 cursor-pointer" style={{ height: ROW, paddingLeft: 8 + depth * 16 }} onClick={() => onOpen(t.id)}>
                {hasKids ? <button className="p-0.5 text-muted" onClick={(e) => { e.stopPropagation(); toggle(t.id) }}>{collapsed.has(t.id) ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}</button> : <span className="w-4" />}
                <span className={`truncate text-[11.5px] ${hasKids ? 'font-bold' : ''}`}>{t.title}</span>
                {t.priority === 'tinggi' && <Flame className="w-3 h-3 text-brand shrink-0" />}
                <span className="ml-auto text-[10px] text-muted pl-1 shrink-0">{Math.round(t.progress)}%</span>
              </div>
            ))}
          </div>
          <div className="relative shrink-0" style={{ width }}>
            <div className="h-[52px] border-b border-line bg-gray-50 sticky top-0 z-10">
              <div className="flex h-[26px]">{months.map((m) => <div key={m.label} className="border-r border-line text-[10.5px] font-bold px-2 flex items-center overflow-hidden whitespace-nowrap" style={{ width: m.span * dayW }}>{m.label}</div>)}</div>
              <div className="flex h-[26px]">{dayList.map((d, i) => <div key={i} className={`text-center text-[9.5px] leading-[26px] border-r border-line/60 ${d.getDay() % 6 === 0 ? 'text-brand/70 bg-gray-100/70' : 'text-muted'}`} style={{ width: dayW }}>{dayW >= 18 ? d.getDate() : d.getDate() === 1 || d.getDay() === 1 ? d.getDate() : ''}</div>)}</div>
            </div>
            <div className="absolute top-[52px] bottom-0 flex pointer-events-none">{dayList.map((d, i) => <div key={i} className={`border-r border-line/40 ${d.getDay() % 6 === 0 ? 'bg-gray-100/60' : ''}`} style={{ width: dayW }} />)}</div>
            <div className="absolute top-[52px] bottom-0 w-px bg-brand z-10 pointer-events-none" style={{ left: todayX + dayW / 2 }}><span className="absolute -top-0 -translate-x-1/2 bg-brand text-white text-[9px] px-1 rounded whitespace-nowrap">Hari ini</span></div>
            <div className="relative">
              {rows.map(({ task: t }) => {
                const s = t.start_date ?? t.due_date, e = t.due_date ?? t.start_date
                return (
                  <div key={t.id} className="relative border-b border-line/60" style={{ height: ROW }}>
                    {s && e ? (() => {
                      const left = dayDiff(bounds.start, dateOf(s)) * dayW
                      const w = (dayDiff(dateOf(s), dateOf(e)) + 1) * dayW
                      const color = t.overdue ? '#d84a4a' : STATUS_BAR[t.status]
                      return (
                        <button onClick={() => onOpen(t.id)} title={`${t.title} · ${fmt(s)} – ${fmt(e)} · ${Math.round(t.progress)}%`}
                          className="absolute top-[7px] h-[20px] rounded overflow-hidden text-left" style={{ left, width: Math.max(w, 6), background: `${color}33`, border: `1px solid ${color}` }}>
                          <span className="absolute inset-y-0 left-0" style={{ width: `${t.progress}%`, background: color, opacity: 0.85 }} />
                          {w > 70 && <span className="relative text-[10px] px-1.5 leading-[18px] text-gray-900 font-semibold truncate block">{t.pic_name.split(' ')[0]}</span>}
                        </button>
                      )
                    })() : <span className="absolute left-2 top-2 text-[10px] text-muted">tanpa jadwal</span>}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
      <div className="flex gap-3 mt-2 text-[10.5px] text-muted">{(['todo', 'in_progress', 'review', 'done'] as TaskStatus[]).map((s) => <span key={s}><i className="inline-block w-2.5 h-2.5 rounded mr-1" style={{ background: STATUS_BAR[s] }} />{STATUS_LABEL[s]}</span>)}<span><i className="inline-block w-2.5 h-2.5 rounded mr-1 bg-brand" />Terlambat</span><span>· bagian gelap = progres</span></div>
    </div>
  )
}

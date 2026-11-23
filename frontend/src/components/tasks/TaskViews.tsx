import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Flame, Pause, Play } from 'lucide-react'
import Badge from '../ui/Badge'
import Pagination, { rowsPerPage } from '../ui/Pagination'
import ProgressBar from '../ui/ProgressBar'
import Avatar from '../ui/Avatar'
import { getHolidays, pauseTaskSession, setTaskStatus, startTaskSession } from '../../services/api'
import { bizParams, useBusinessStore } from '../../store/business'
import type { TaskRow, TaskStatus } from '../../types'
import { cssColor } from '../../utils/theme'
import { STATUS_BAR, STATUS_LABEL, STATUS_TONE, statusText, TIMELINESS_LABEL, TIMELINESS_TONE, doneClass, buildTree, type TreeNode, dateOf, dayDiff, flatten, fmt, fmtShort, initials, ymd, err } from './taskUtils'
const fmtDT = (s: string) => new Date(s).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })

export type GroupBy = 'none' | 'unit' | 'project' | 'pic' | 'status'
interface ViewProps { tasks: TaskRow[]; onOpen: (id: number) => void }

// ------------------------------------------------------------------ List (grouping + pagination)
// "Unit Organisasi" grouping at a chosen level (L1 = the top): the PIC's unit at that level, or the deepest ancestor above it.
export const unitAtLevel = (t: TaskRow, level: number) => {
  const path = t.unit_path ?? []
  const hit = [...path].reverse().find((u) => u.level <= level)
  return hit?.name ?? t.unit_name ?? ''
}
const groupKey = (t: TaskRow, g: GroupBy, level = 3) => (g === 'unit' ? unitAtLevel(t, level) || 'Tanpa unit' : g === 'project' ? t.project_name || 'Tanpa proyek' : g === 'pic' ? t.pic_name : g === 'status' ? STATUS_LABEL[t.status] : '')

export function TaskList({ tasks, onOpen, groupBy, unitLevel = 3, onChanged }: ViewProps & { groupBy: GroupBy; unitLevel?: number; onChanged?: () => void }) {
  const [busyId, setBusyId] = useState(0)
  const toggle = async (t: TaskRow) => {
    setBusyId(t.id)
    try { await (t.running ? pauseTaskSession(t.id) : startTaskSession(t.id)); onChanged?.() } catch (e: any) { alert(err(e, 'Gagal mengubah sesi tugas')) } finally { setBusyId(0) }
  }
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  // children stay directly under their own parent (tree order inside each group); a child whose parent is filtered out shows as its own root
  const flat = useMemo(() => {
    const groups = new Map<string, TaskRow[]>()
    tasks.forEach((t) => { const k = groupKey(t, groupBy, unitLevel); groups.set(k, [...(groups.get(k) ?? []), t]) })
    const keys = [...groups.keys()]
    if (groupBy !== 'none') keys.sort((a, b) => a.localeCompare(b))
    return keys.flatMap((k) => flatten(buildTree(groups.get(k)!), new Set()))
  }, [tasks, groupBy, unitLevel])
  const sorted = useMemo(() => flat.map((f) => f.task), [flat])
  const indent = useMemo(() => new Map(flat.map((f) => [f.task.id, f.depth])), [flat])
  useEffect(() => setPage(1), [tasks, groupBy, unitLevel, pageSize])
  const per = rowsPerPage(pageSize, sorted.length)
  const last = Math.max(1, Math.ceil(sorted.length / per))
  const cur = Math.min(page, last)
  const rows = sorted.slice((cur - 1) * per, cur * per)
  const counts = useMemo(() => { const m = new Map<string, number>(); sorted.forEach((t) => m.set(groupKey(t, groupBy, unitLevel), (m.get(groupKey(t, groupBy, unitLevel)) ?? 0) + 1)); return m }, [sorted, groupBy])
  return (
    <div>
      <div className="border border-line rounded-lg overflow-auto">
        <table className="w-full">
          <thead><tr>{['Tugas', 'PIC', 'Departemen', 'Proyek', 'Plan', 'Aktual', 'Ketepatan', 'Status', 'Progres'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((t, i) => {
              const g = groupKey(t, groupBy, unitLevel)
              const header = groupBy !== 'none' && (i === 0 || groupKey(rows[i - 1], groupBy, unitLevel) !== g)
              return (
                <Fragment key={t.id}>
                  {header && <tr><td colSpan={9} className="px-3 py-1.5 bg-tint text-[11px] font-bold">{g} <span className="font-normal text-muted">· {counts.get(g)} tugas</span></td></tr>}
                  <tr className="cursor-pointer hover:bg-sunken" onClick={() => onOpen(t.id)}>
                    <td className="td" style={{ paddingLeft: 12 + (indent.get(t.id) ?? 0) * 14 }}>
                      <div className="flex items-center gap-1.5">{t.priority === 'tinggi' && <Flame className="w-3.5 h-3.5 text-danger shrink-0" />}<b className={doneClass(t)}>{t.title}</b>{t.is_parent && <Badge tone="purple">{t.kids_done}/{t.kids_total}</Badge>}</div>
                      {t.parent_title && <div className="text-muted text-[10.5px]">↳ {t.parent_title}</div>}
                    </td>
                    <td className="td"><div className="flex items-center gap-1.5"><Avatar empId={t.pic_id} name={t.pic_name} version={t.pic_avatar} size={20} /><span className="whitespace-nowrap">{t.pic_name}</span></div></td>
                    <td className="td text-muted">{t.unit_name || '–'}</td>
                    <td className="td text-muted">{t.project_name || '–'}</td>
                    <td className={`td whitespace-nowrap text-[11.5px] ${t.overdue ? 'text-danger' : ''}`}>
                      <div>{fmtShort(t.start_date)}{t.plan_start_time ? ` ${t.plan_start_time}` : ''}</div>
                      <div className={t.overdue ? 'font-bold' : 'text-muted'}>→ {fmtShort(t.due_date)}{t.plan_end_time ? ` ${t.plan_end_time}` : ''}</div>
                    </td>
                    <td className="td whitespace-nowrap text-[11.5px]">
                      {t.actual_start ? <><div>{fmtDT(t.actual_start)}</div><div className="text-muted">→ {t.completed_at ? fmtDT(t.completed_at) : 'berjalan'}</div></> : <span className="text-muted">–</span>}
                    </td>
                    <td className="td">{t.timeliness ? <Badge tone={TIMELINESS_TONE[t.timeliness]}>{TIMELINESS_LABEL[t.timeliness]}</Badge> : <span className="text-muted">–</span>}</td>
                    <td className="td">
                      <div className="flex items-center gap-1.5">
                        <Badge tone={t.running ? 'green' : STATUS_TONE[t.status]}>{statusText(t)}</Badge>
                        {t.can_session && <button className="p-1 rounded-md border border-line hover:bg-sunken disabled:opacity-50" disabled={busyId === t.id} title={t.running ? 'Pause' : t.actual_start ? 'Lanjutkan' : 'Mulai'} aria-label={t.running ? 'Pause' : 'Mulai'} onClick={(e) => { e.stopPropagation(); toggle(t) }}>{t.running ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}</button>}
                      </div>
                    </td>
                    <td className="td w-40"><ProgressBar value={t.progress} small /></td>
                  </tr>
                </Fragment>
              )
            })}
            {!rows.length && <tr><td className="td text-center text-muted" colSpan={9}>Tidak ada tugas</td></tr>}
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
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 items-start">
        {COLS.map((col) => {
          const list = tasks.filter((t) => t.status === col)
          return (
            <div key={col} onDragOver={(e) => { e.preventDefault(); setOver(col) }} onDragLeave={() => setOver((o) => (o === col ? null : o))} onDrop={() => drop(col)}
              className={`rounded-xl p-2 min-h-[240px] border ${over === col ? 'border-brand bg-brand-soft/30' : 'border-line bg-sunken/60'}`}>
              <div className="flex items-center justify-between px-1 pb-2"><Badge tone={STATUS_TONE[col]}>{STATUS_LABEL[col]}</Badge><span className="text-[11px] text-muted font-bold">{list.length}</span></div>
              <div className="space-y-2">
                {list.map((t) => (
                  <div key={t.id} draggable={draggable(t)} onDragStart={() => setDrag(t)} onDragEnd={() => { setDrag(null); setOver(null) }} onClick={() => onOpen(t.id)}
                    className={`bg-panel border border-line rounded-lg p-2.5 shadow-sm hover:shadow ${draggable(t) ? 'cursor-grab' : 'cursor-pointer'}`}>
                    <div className="flex items-start gap-1.5">{t.priority === 'tinggi' && <Flame className="w-3.5 h-3.5 text-danger shrink-0 mt-0.5" />}<b className={`text-xs leading-snug ${doneClass(t)}`}>{t.title}</b></div>
                    {t.timeliness && <div className="mt-1"><Badge tone={TIMELINESS_TONE[t.timeliness]}>{TIMELINESS_LABEL[t.timeliness]}</Badge></div>}
                    {(t.project_name || t.parent_title) && <div className="text-[10.5px] text-muted mt-0.5 truncate">{t.project_name}{t.project_name && t.parent_title ? ' · ' : ''}{t.parent_title && `↳ ${t.parent_title}`}</div>}
                    {t.is_parent && <div className="mt-1.5"><ProgressBar value={t.progress} small /><div className="text-[10px] text-muted mt-0.5">{t.kids_done}/{t.kids_total} sub tugas</div></div>}
                    <div className="flex items-center justify-between mt-2">
                      <span className="flex items-center gap-1"><Avatar empId={t.pic_id} name={t.pic_name} version={t.pic_avatar} size={22} /><span className="text-[10.5px] text-muted">{t.pic_name.split(' ')[0]}</span></span>
                      <span className={`text-[10.5px] ${t.overdue ? 'text-danger font-bold' : 'text-muted'}`}>{t.due_date ? fmt(t.due_date) : ''}</span>
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
  const { businessId } = useBusinessStore()
  const [holidays, setHolidays] = useState<Map<string, string[]>>(new Map())
  // holidays appear on the calendar like tasks, for the business being viewed
  useEffect(() => {
    getHolidays({ year: view.y, ...bizParams(businessId) }).then((r) => { const m = new Map<string, string[]>(); r.data.data.forEach((h) => { const k = h.date.slice(0, 10); m.set(k, [...(m.get(k) ?? []), h.name]) }); setHolidays(m) }).catch(() => setHolidays(new Map()))
  }, [view.y, businessId])
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
      <div className="grid grid-cols-7 text-center text-[10px] font-bold text-muted mb-1">{['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((d, i) => <div key={d} className={i >= 5 ? 'text-danger' : ''}>{d}</div>)}</div>
      <div className="grid grid-cols-7 gap-px bg-line border border-line rounded-lg overflow-hidden">
        {cells.map((d, i) => {
          if (!d) return <div key={`b${i}`} className="bg-sunken min-h-[96px]" />
          const k = `${view.y}-${String(view.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
          const list = onDay(k)
          const shown = more === k ? list : list.slice(0, 3)
          const hol = holidays.get(k) ?? []
          return (
            <div key={k} className={`min-h-[96px] p-1 ${hol.length ? 'bg-danger-soft/40' : 'bg-panel'} ${k === todayK ? 'ring-2 ring-inset ring-brand/40' : ''}`}>
              <div className={`text-[10.5px] font-bold mb-0.5 ${i % 7 >= 5 || hol.length ? 'text-danger/80' : 'text-muted'}`}>{d}</div>
              <div className="space-y-0.5">
                {hol.map((n) => <div key={n} title={`Libur: ${n}`} className="text-[10px] leading-tight px-1 py-0.5 rounded truncate bg-danger-soft text-danger font-semibold">Libur · {n}</div>)}
                {shown.map((t) => (
                  <button key={t.id} onClick={() => onOpen(t.id)} title={`${t.title} — ${t.pic_name}`}
                    className="w-full text-left text-[10px] leading-tight px-1 py-0.5 rounded truncate text-white" style={{ background: t.overdue ? cssColor('danger') : STATUS_BAR[t.status] }}>{t.title}</button>
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
// Plan = grey bar over its date range. Actual = coloured bar from the day work really started until it finished (or today while running).
// Colour follows priority (tinggi red, normal amber); a parent is blue.
const GANTT_COLOR = { tinggi: '#dc2626', normal: '#f59e0b', parent: '#2563eb' } as const
const GANTT_PLAN_BG = '#e2e8f0', GANTT_PLAN_LINE = '#cbd5e1'
const localDay = (iso: string) => ymd(new Date(iso))
type Span = { from: string; to: string; running: boolean }
function actualSpans(tasks: TaskRow[]) {
  const out = new Map<number, Span>()
  const today = ymd(new Date())
  const walk = (n: TreeNode): Span | null => {
    const t = n.task
    let r = null as Span | null
    if (n.children.length) {
      for (const c of n.children) {
        const x = walk(c)
        if (x) r = r ? { from: x.from < r.from ? x.from : r.from, to: x.to > r.to ? x.to : r.to, running: r.running || x.running } : x
      }
      if (r && t.status === 'done') r = { ...r, running: false }
    } else if (t.actual_start) {
      const running = t.status !== 'done'
      r = { from: localDay(t.actual_start), to: running ? today : localDay(t.completed_at ?? t.actual_start), running }
      if (r.to < r.from) r.to = r.from
    }
    if (r) out.set(t.id, r)
    return r
  }
  buildTree(tasks).forEach(walk)
  return out
}
const ROW = 34, NAME_W = 300
export function TaskGantt({ tasks, onOpen }: ViewProps) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [dayW, setDayW] = useState(26)
  const scroller = useRef<HTMLDivElement>(null)
  const rows = useMemo(() => flatten(buildTree(tasks), collapsed), [tasks, collapsed])
  const actual = useMemo(() => actualSpans(tasks), [tasks])
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
        <span className="hidden md:flex items-center gap-2.5 text-[10.5px] text-muted ml-2">
          <span><i className="inline-block w-3 h-2.5 rounded mr-1 align-middle" style={{ background: GANTT_PLAN_BG, border: `1px solid ${GANTT_PLAN_LINE}` }} />Plan</span>
          <span><i className="inline-block w-3 h-2.5 rounded mr-1 align-middle" style={{ background: GANTT_COLOR.tinggi }} />Aktual · prioritas tinggi</span>
          <span><i className="inline-block w-3 h-2.5 rounded mr-1 align-middle" style={{ background: GANTT_COLOR.normal }} />normal</span>
          <span><i className="inline-block w-3 h-2.5 rounded mr-1 align-middle" style={{ background: GANTT_COLOR.parent }} />induk</span>
        </span>
        <button className="btn ml-auto" onClick={() => { if (scroller.current) scroller.current.scrollLeft = Math.max(0, todayX - 120) }}>Ke hari ini</button>
        <button className="btn" onClick={() => setCollapsed(new Set(rows.filter((r) => r.hasKids).map((r) => r.task.id)))}>Ciutkan semua</button>
        <button className="btn" onClick={() => setCollapsed(new Set())}>Bentangkan</button>
      </div>
      <div ref={scroller} className="border border-line rounded-lg overflow-auto max-h-[70vh] bg-panel">
        <div className="flex" style={{ width: NAME_W + width }}>
          <div className="sticky left-0 z-20 bg-panel border-r border-line shrink-0" style={{ width: NAME_W }}>
            <div className="h-[52px] border-b border-line bg-sunken px-3 flex items-end pb-1.5 text-[10px] uppercase tracking-wider font-bold text-muted">Tugas</div>
            {rows.map(({ task: t, depth, hasKids }) => (
              <div key={t.id} className="flex items-center gap-1 px-2 border-b border-line/60 hover:bg-sunken cursor-pointer" style={{ height: ROW, paddingLeft: 8 + depth * 16 }} onClick={() => onOpen(t.id)}>
                {hasKids ? <button className="p-0.5 text-muted" onClick={(e) => { e.stopPropagation(); toggle(t.id) }}>{collapsed.has(t.id) ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}</button> : <span className="w-4" />}
                <span className={`truncate text-[11.5px] ${hasKids ? 'font-bold' : ''}`}>{t.title}</span>
                {t.priority === 'tinggi' && <Flame className="w-3 h-3 text-danger shrink-0" />}
                <span className="ml-auto text-[10px] text-muted pl-1 shrink-0">{Math.round(t.progress)}%</span>
              </div>
            ))}
          </div>
          <div className="relative shrink-0" style={{ width }}>
            <div className="h-[52px] border-b border-line bg-sunken sticky top-0 z-10">
              <div className="flex h-[26px]">{months.map((m) => <div key={m.label} className="border-r border-line text-[10.5px] font-bold px-2 flex items-center overflow-hidden whitespace-nowrap" style={{ width: m.span * dayW }}>{m.label}</div>)}</div>
              <div className="flex h-[26px]">{dayList.map((d, i) => <div key={i} className={`text-center text-[9.5px] leading-[26px] border-r border-line/60 ${d.getDay() % 6 === 0 ? 'text-danger/70 bg-sunken/70' : 'text-muted'}`} style={{ width: dayW }}>{dayW >= 18 ? d.getDate() : d.getDate() === 1 || d.getDay() === 1 ? d.getDate() : ''}</div>)}</div>
            </div>
            <div className="absolute top-[52px] bottom-0 flex pointer-events-none">{dayList.map((d, i) => <div key={i} className={`border-r border-line/40 ${d.getDay() % 6 === 0 ? 'bg-sunken/60' : ''}`} style={{ width: dayW }} />)}</div>
            <div className="absolute top-[52px] bottom-0 w-px bg-brand z-10 pointer-events-none" style={{ left: todayX + dayW / 2 }}><span className="absolute -top-0 -translate-x-1/2 bg-brand text-on-brand text-[9px] px-1 rounded whitespace-nowrap">Hari ini</span></div>
            <div className="relative">
              {rows.map(({ task: t }) => {
                const s = t.start_date ?? t.due_date, e = t.due_date ?? t.start_date
                const act = actual.get(t.id)
                const color = GANTT_COLOR[t.is_parent ? 'parent' : t.priority]
                return (
                  <div key={t.id} className="relative border-b border-line/60" style={{ height: ROW }}>
                    {s && e ? (() => {
                      const left = dayDiff(bounds.start, dateOf(s)) * dayW
                      const w = (dayDiff(dateOf(s), dateOf(e)) + 1) * dayW
                      const aLeft = act ? dayDiff(bounds.start, dateOf(act.from)) * dayW : 0
                      const aW = act ? (dayDiff(dateOf(act.from), dateOf(act.to)) + 1) * dayW : 0
                      const late = act && act.to > e // worked past the plan: the overrun is drawn outside the grey plan bar
                      return (
                        <button onClick={() => onOpen(t.id)} title={`${t.title} · Plan ${fmt(s)} – ${fmt(e)}${act ? ` · Aktual ${fmt(act.from)} – ${act.running ? 'berjalan' : fmt(act.to)}` : ' · belum dimulai'} · ${Math.round(t.progress)}%`}
                          className="absolute inset-y-0 left-0 w-full text-left cursor-pointer">
                          <span className="absolute top-[7px] h-[20px] rounded" style={{ left, width: Math.max(w, 6), background: GANTT_PLAN_BG, border: `1px solid ${GANTT_PLAN_LINE}` }} />
                          {act && <span className="absolute top-[7px] h-[20px] rounded flex items-center overflow-hidden" style={{ left: aLeft, width: Math.max(aW, 6), background: color, opacity: late ? 0.9 : 1 }}>
                            {aW > 70 && <span className="text-[10px] px-1.5 text-white font-semibold truncate">{t.pic_name.split(' ')[0]} · {Math.round(t.progress)}%</span>}
                          </span>}
                          {!act && w > 70 && <span className="absolute top-[7px] h-[20px] leading-[18px] text-[10px] px-1.5 text-muted font-semibold truncate" style={{ left }}>{t.pic_name.split(' ')[0]}</span>}
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

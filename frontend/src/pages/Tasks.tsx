import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import Layout from '../components/Layout/Layout'
import StatCard from '../components/ui/StatCard'
import TaskDetail from '../components/tasks/TaskDetail'
import TaskForm from '../components/tasks/TaskForm'
import RecurringTasks from '../components/tasks/RecurringTasks'
import { TaskBoard, TaskCalendar, TaskGantt, TaskList, type GroupBy } from '../components/tasks/TaskViews'
import { bizParams, useBusinessStore } from '../store/business'
import { getProjects, getTasks } from '../services/api'
import type { Project, TaskRow, TaskSummary } from '../types'

type View = 'list' | 'board' | 'calendar' | 'gantt'
const SCOPES = [
  ['mine', 'Tugas Saya', 'Tugas yang menjadi tanggung jawab Anda sebagai PIC'],
  ['given', 'Saya Berikan', 'Tugas yang Anda beri sebagai pemberi tugas'],
  ['involved', 'Saya Terlibat', 'Tugas di mana Anda menjadi anggota'],
  ['watching', 'Saya Amati', 'Tugas di mana Anda menjadi pengamat'],
  ['team', 'Tugas Tim', 'Tugas milik bawahan Anda'],
  ['all', 'Semua Tugas', 'Seluruh tugas yang dapat Anda akses'],
] as const

export default function Tasks() {
  const { businessId } = useBusinessStore()
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<View>('list')
  const [mode, setMode] = useState<'tasks' | 'recurring'>('tasks')
  const [scope, setScope] = useState('mine')
  const [status, setStatus] = useState('')
  const [deadline, setDeadline] = useState('')
  const [priority, setPriority] = useState('')
  const [projectId, setProjectId] = useState('')
  const [q, setQ] = useState('')
  const [groupBy, setGroupBy] = useState<GroupBy>('none')
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [summary, setSummary] = useState<TaskSummary>({})
  const [projects, setProjects] = useState<Project[]>([])
  const [openId, setOpenId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)

  const load = () => getTasks({ ...bizParams(businessId), scope, status: status || undefined, deadline: deadline || undefined, priority: priority || undefined, project_id: projectId || undefined, q: q || undefined })
    .then((r) => { setTasks(r.data.data); setSummary(r.data.summary) })
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t) }, [businessId, scope, status, deadline, priority, projectId, q])
  useEffect(() => { getProjects(bizParams(businessId)).then((r) => setProjects(r.data.data)) }, [businessId])
  // deep link from a notification: /tasks?open=<id>
  useEffect(() => { const o = Number(params.get('open')); if (o) { setOpenId(o); setScope('all'); setParams({}, { replace: true }) } }, [params])

  return (
    <Layout title="Tugas" subtitle="Penugasan per PIC dengan progres bertingkat dan approval penyelesaian">
      <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 w-fit mb-3">
        {([['tasks', 'Daftar Tugas'], ['recurring', 'Tugas Rutin']] as const).map(([m, l]) => (
          <button key={m} onClick={() => setMode(m)} className={`px-4 py-1.5 rounded-md text-xs font-semibold ${mode === m ? 'bg-white shadow-sm text-brand' : 'text-muted'}`}>{l}</button>
        ))}
      </div>
      {mode === 'recurring' ? <div className="card p-4"><RecurringTasks /></div> : <>
      <div className="grid grid-cols-6 gap-3 mb-3">
        <StatCard label="Total Tugas" value={summary.total ?? 0} foot="sesuai filter" />
        <StatCard label="Induk Tugas" value={summary.parents ?? 0} foot="punya sub tugas" />
        <StatCard label="Sub Tugas" value={summary.subtasks ?? 0} foot="detail pekerjaan" />
        <StatCard label="Open" value={summary.open ?? 0} foot="belum selesai" />
        <StatCard label="Menunggu Approval" value={summary.review ?? 0} foot="penyelesaian diajukan" />
        <StatCard label="Terlambat" value={<span className={(summary.overdue ?? 0) > 0 ? 'text-brand' : ''}>{summary.overdue ?? 0}</span>} foot="lewat deadline" />
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
            {([['list', 'List'], ['board', 'Board'], ['calendar', 'Kalender'], ['gantt', 'Gantt']] as const).map(([v, l]) => (
              <button key={v} onClick={() => setView(v)} className={`px-3.5 py-1 rounded-md text-xs font-semibold ${view === v ? 'bg-white shadow-sm text-brand' : 'text-muted'}`}>{l}</button>
            ))}
          </div>
          <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="w-3.5 h-3.5 inline mr-1" />Tugas</button>
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          <select className="input" value={scope} onChange={(e) => setScope(e.target.value)} title="Cakupan">{SCOPES.map(([v, l, d]) => <option key={v} value={v} title={d}>Cakupan: {l}</option>)}</select>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Semua Status</option><option value="todo">To Do</option><option value="in_progress">In Progress</option><option value="review">Menunggu Approval</option><option value="done">Selesai</option></select>
          <select className="input" value={deadline} onChange={(e) => setDeadline(e.target.value)}><option value="">Deadline: Semua</option><option value="overdue">Terlambat</option><option value="today">Hari ini</option><option value="week">7 hari ke depan</option><option value="nodate">Tanpa deadline</option></select>
          <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="">Prioritas: Semua</option><option value="tinggi">Prioritas tinggi</option></select>
          <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">Proyek: Semua</option><option value="none">Non Project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          {view === 'list' && <select className="input" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} title="Mengatur pengelompokan tampilan, bukan menyaring data"><option value="none">Grouping: Tidak ada</option><option value="unit">Grouping: Unit Organisasi</option><option value="project">Grouping: Proyek</option><option value="pic">Grouping: PIC</option><option value="status">Grouping: Status</option></select>}
          <div className="relative ml-auto"><Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" /><input className="input !pl-8 w-60" placeholder="Cari tugas atau PIC…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>

        {view === 'list' && <TaskList tasks={tasks} onOpen={setOpenId} groupBy={groupBy} />}
        {view === 'board' && <TaskBoard tasks={tasks} onOpen={setOpenId} onChanged={load} />}
        {view === 'calendar' && <TaskCalendar tasks={tasks} onOpen={setOpenId} />}
        {view === 'gantt' && <TaskGantt tasks={tasks} onOpen={setOpenId} />}
      </div>
      </>}

      {openId !== null && <TaskDetail id={openId} onClose={() => setOpenId(null)} onChanged={load} onOpen={setOpenId} />}
      {creating && <TaskForm onClose={() => setCreating(false)} onSaved={(t) => { setCreating(false); load(); setOpenId(t.id) }} />}
    </Layout>
  )
}

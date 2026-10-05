import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowLeft, ChevronDown, ChevronUp, Plus } from 'lucide-react'
import Layout from '../components/Layout/Layout'
import Badge from '../components/ui/Badge'
import FileThumbs from '../components/ui/FileThumbs'
import ProgressBar from '../components/ui/ProgressBar'
import StatCard from '../components/ui/StatCard'
import Tabs from '../components/ui/Tabs'
import TaskDetail from '../components/tasks/TaskDetail'
import TaskForm from '../components/tasks/TaskForm'
import { TaskGantt, TaskList } from '../components/tasks/TaskViews'
import { ProjectForm, PROJECT_TONE } from './Projects'
import { deleteProject, deleteProjectDocument, fetchProjectDocumentBlob, getProject, getProjectCurve, getProjectDocuments, getTasks, setProjectWeights, uploadProjectDocument } from '../services/api'
import type { CurvePoint, FileItem, Project, TaskRow } from '../types'
import { STATUS_LABEL, STATUS_TONE, buildTree, err, flatten, fmt, ymd } from '../components/tasks/taskUtils'

type Tab = 'wbs' | 'gantt' | 'curve' | 'tasks' | 'docs'
const MAX_FILE = 10 * 1024 * 1024

export default function ProjectDetail() {
  const { id } = useParams()
  const pid = Number(id)
  const nav = useNavigate()
  const [tab, setTab] = useState<Tab>('wbs')
  const [project, setProject] = useState<Project | null>(null)
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(false)

  const load = () => {
    getProject(pid).then((r) => setProject(r.data.project)).catch((e) => setError(err(e, 'Proyek tidak dapat dimuat')))
    getTasks({ scope: 'all', project_id: pid }).then((r) => setTasks(r.data.data))
  }
  useEffect(() => { load() }, [pid])

  if (error) return <Layout title="Proyek"><div className="card p-8 text-center text-sm text-brand">{error}</div></Layout>
  if (!project) return <Layout title="Proyek"><div className="card p-8 text-center text-sm text-muted">Memuat…</div></Layout>
  const p = project

  return (
    <Layout title={p.name} subtitle="Proyek berbasis WBS">
      <button className="btn mb-3" onClick={() => nav('/projects')}><ArrowLeft className="w-3 h-3 inline mr-1" />Semua proyek</button>
      <div className="card p-4 mb-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[260px]">
            <div className="flex items-center gap-2"><h2 className="text-base font-extrabold">{p.name}</h2><Badge tone={PROJECT_TONE[p.status]}>{p.status}</Badge></div>
            <div className="text-xs text-muted mt-0.5">Owner {p.owner_name} · {fmt(p.start_date)} – {fmt(p.end_date)}</div>
            {p.description && <p className="text-xs mt-1.5 text-gray-700">{p.description}</p>}
          </div>
          <div className="w-64"><div className="text-[10.5px] text-muted mb-1">Progres proyek {p.weighted ? '(berbobot)' : '(rata-rata tahapan)'}</div><ProgressBar value={p.progress} /></div>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="w-3.5 h-3.5 inline mr-1" />Tugas</button>
            {p.can_manage && <button className="btn" onClick={() => setEditing(true)}>Edit</button>}
            {p.can_manage && <button className="btn text-brand" onClick={async () => { if (confirm(`Hapus proyek "${p.name}"?`)) { try { await deleteProject(p.id); nav('/projects') } catch (e: any) { alert(err(e, 'Gagal menghapus')) } } }}>Hapus</button>}
          </div>
        </div>
        <div className="grid grid-cols-5 gap-3 mt-3">
          {[['Induk Tugas', p.top_level], ['Sub Tugas', p.subtasks], ['Open', p.open], ['Selesai', p.done], ['Terlambat', p.overdue]].map(([l, v]) => <div key={l as string} className="bg-gray-50 rounded-lg px-3 py-2"><div className="text-[10.5px] text-muted">{l}</div><div className="text-lg font-extrabold">{v}</div></div>)}
        </div>
      </div>

      <div className="card p-4">
        <Tabs tabs={[{ id: 'wbs', label: 'WBS & Bobot' }, { id: 'gantt', label: 'Gantt' }, { id: 'curve', label: 'Kurva-S' }, { id: 'tasks', label: `Tugas (${tasks.length})` }, { id: 'docs', label: 'Dokumen' }]} value={tab} onChange={setTab} />
        {tab === 'wbs' && <Wbs project={p} tasks={tasks} onOpen={setOpenId} onChanged={load} />}
        {tab === 'gantt' && <TaskGantt tasks={tasks} onOpen={setOpenId} />}
        {tab === 'curve' && <Curve project={p} refreshKey={tasks.map((t) => `${t.id}:${t.status}:${t.weight}`).join()} />}
        {tab === 'tasks' && <TaskList tasks={tasks} onOpen={setOpenId} groupBy="none" />}
        {tab === 'docs' && <Docs project={p} />}
      </div>

      {openId !== null && <TaskDetail id={openId} onClose={() => setOpenId(null)} onChanged={load} onOpen={setOpenId} />}
      {creating && <TaskForm defaults={{ project_id: p.id }} onClose={() => setCreating(false)} onSaved={(t) => { setCreating(false); load(); setOpenId(t.id) }} />}
      {editing && <ProjectForm project={p} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load() }} />}
    </Layout>
  )
}

// ---- WBS tree + the weight ("bobot") of every top-level work package
function Wbs({ project, tasks, onOpen, onChanged }: { project: Project; tasks: TaskRow[]; onOpen: (id: number) => void; onChanged: () => void }) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const rows = useMemo(() => flatten(buildTree(tasks), collapsed), [tasks, collapsed])
  const top = tasks.filter((t) => t.parent_id === null)
  const [w, setW] = useState<Record<number, string>>({})
  const [msg, setMsg] = useState('')
  useEffect(() => { setW(Object.fromEntries(top.map((t) => [t.id, t.weight != null ? String(t.weight) : '']))) }, [tasks.map((t) => `${t.id}:${t.weight}`).join()])
  const sum = top.reduce((s, t) => s + (Number(w[t.id]) || 0), 0)
  const allWeighted = top.length > 0 && top.every((t) => Number(w[t.id]) > 0)
  const save = async () => {
    setMsg('')
    try { await setProjectWeights(project.id, top.map((t) => ({ task_id: t.id, weight: w[t.id] === '' ? null : Number(w[t.id]) }))); setMsg('Bobot tersimpan'); onChanged() } catch (e: any) { setMsg(err(e, 'Gagal menyimpan bobot')) }
  }
  if (!tasks.length) return <div className="text-center text-muted text-xs py-10">Belum ada tugas. Klik “+ Tugas” untuk membuat tahapan pertama, lalu tambahkan sub tugasnya.</div>
  return (
    <div className="text-xs">
      <div className="mb-3 bg-gray-50 rounded-lg p-3 text-muted">
        Progres induk = rata-rata progres sub tugasnya (mis. 4 sub tugas, baru 1 selesai → 25%). Progres proyek = {allWeighted ? <b className="text-gray-800">rata-rata berbobot dari tahapan teratas</b> : <b className="text-gray-800">rata-rata tahapan teratas</b>}. {project.can_manage && 'Isi bobot pada setiap tahapan teratas (total ideal 100%) agar proyek dan Kurva-S berbobot.'}
      </div>
      <div className="border border-line rounded-lg overflow-auto">
        <table className="w-full">
          <thead><tr>{['Pekerjaan', 'Bobot', 'PIC', 'Jadwal', 'Status', 'Progres'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map(({ task: t, depth, hasKids }) => (
              <tr key={t.id} className={depth === 0 ? 'bg-gray-50/60' : ''}>
                <td className="td cursor-pointer" style={{ paddingLeft: 10 + depth * 20 }} onClick={() => onOpen(t.id)}>
                  <div className="flex items-center gap-1">
                    {hasKids ? <button className="p-0.5 text-muted" onClick={(e) => { e.stopPropagation(); setCollapsed((s) => { const n = new Set(s); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n }) }}>{collapsed.has(t.id) ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}</button> : <span className="w-4" />}
                    <b className={depth === 0 ? '' : 'font-semibold'}>{t.title}</b>{t.is_parent && <Badge tone="purple">{t.kids_done}/{t.kids_total}</Badge>}
                  </div>
                </td>
                <td className="td w-24">{t.parent_id === null ? <div className="flex items-center gap-1"><input className="input !py-1 w-16" type="number" min={0} max={100} step="any" disabled={!project.can_manage} value={w[t.id] ?? ''} onChange={(e) => setW({ ...w, [t.id]: e.target.value })} /><span className="text-muted">%</span></div> : <span className="text-muted">–</span>}</td>
                <td className="td whitespace-nowrap">{t.pic_name}</td>
                <td className={`td whitespace-nowrap ${t.overdue ? 'text-brand font-bold' : ''}`}>{t.start_date || t.due_date ? `${fmt(t.start_date)} – ${fmt(t.due_date)}` : '–'}</td>
                <td className="td"><Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge></td>
                <td className="td w-40"><ProgressBar value={t.progress} small /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {project.can_manage && (
        <div className="flex items-center gap-3 mt-3">
          <span>Total bobot: <b className={Math.abs(sum - 100) < 0.01 ? 'text-ok' : sum > 0 ? 'text-warn' : 'text-muted'}>{Math.round(sum * 100) / 100}%</b>{sum > 0 && Math.abs(sum - 100) >= 0.01 && <span className="text-muted"> (ideal 100% — selisih dinormalkan otomatis)</span>}</span>
          <button className="btn-primary" onClick={save}>Simpan Bobot</button>{msg && <span className="text-muted">{msg}</span>}
        </div>
      )}
    </div>
  )
}

// ---- Kurva-S
function Curve({ project, refreshKey }: { project: Project; refreshKey: string }) {
  const [data, setData] = useState<{ ok: boolean; points: CurvePoint[]; progress: number; plan_now: number; actual_now: number; deviation: number } | null>(null)
  useEffect(() => { getProjectCurve(project.id).then((r) => setData(r.data)) }, [project.id, refreshKey])
  if (!data) return <div className="text-center text-muted text-xs py-10">Memuat…</div>
  if (!data.ok) return <div className="text-center text-muted text-xs py-10">Kurva-S memerlukan tugas dengan jadwal (mulai/deadline) atau tanggal proyek. Lengkapi jadwal tugas, lalu buka tab ini lagi.</div>
  const chart = data.points.map((p) => ({ ...p, label: new Date(p.date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }) }))
  const todayLabel = chart.find((p) => p.date >= ymd(new Date()))?.label
  const dev = data.deviation
  return (
    <div className="text-xs">
      <div className="grid grid-cols-4 gap-3 mb-3">
        <StatCard label="Rencana (hingga sekarang)" value={`${data.plan_now}%`} />
        <StatCard label="Aktual (hingga sekarang)" value={`${data.actual_now}%`} />
        <StatCard label="Deviasi" value={<span className={dev < -0.05 ? 'text-brand' : dev > 0.05 ? 'text-ok' : ''}>{dev > 0 ? '+' : ''}{Math.round(dev * 10) / 10}%</span>} foot={dev < -0.05 ? 'tertinggal dari rencana' : dev > 0.05 ? 'lebih cepat dari rencana' : 'sesuai rencana'} />
        <StatCard label="Progres proyek" value={`${data.progress}%`} foot={project.weighted ? 'berbobot' : 'rata-rata'} />
      </div>
      <div className="h-[340px] border border-line rounded-lg p-3">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chart} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e8eb" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v: number | string) => `${v}%`} />
            <Legend />
            {todayLabel && <ReferenceLine x={todayLabel} stroke="#d84a4a" strokeDasharray="4 4" label={{ value: 'Hari ini', fontSize: 10, fill: '#d84a4a' }} />}
            <Line type="monotone" dataKey="plan" name="Rencana" stroke="#7c8189" strokeWidth={2} dot={{ r: 2 }} />
            <Line type="monotone" dataKey="actual" name="Aktual" stroke="#2e9d65" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-muted mt-2">Rencana: porsi setiap pekerjaan terbagi merata sepanjang jadwalnya (mulai–deadline). Aktual: porsi pekerjaan dihitung sejak hari ia selesai (setelah disetujui bila perlu approval). Porsi tiap tahapan mengikuti bobotnya.</p>
    </div>
  )
}

// ---- documents
function Docs({ project }: { project: Project }) {
  const [items, setItems] = useState<FileItem[]>([])
  const [label, setLabel] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const load = () => getProjectDocuments(project.id).then((r) => setItems(r.data.map((d) => ({ ...d, label: d.label }))))
  useEffect(() => { load() }, [project.id])
  const upload = async () => {
    setError('')
    if (!label.trim()) return setError('Isi nama/jenis dokumen')
    if (!file) return setError('Pilih file')
    if (file.size > MAX_FILE) return setError('File lebih dari 10 MB')
    try { await uploadProjectDocument(project.id, label.trim(), file); setLabel(''); setFile(null); load() } catch (e: any) { setError(err(e, 'Gagal mengunggah')) }
  }
  return (
    <div className="text-xs space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <input className="input w-56" list="project-doc-labels" placeholder="Nama dokumen (mis. Kontrak, BAST)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <datalist id="project-doc-labels">{['Kontrak', 'Purchase Order', 'Gambar Kerja', 'BAST', 'Laporan Progres', 'Foto Lapangan'].map((d) => <option key={d} value={d} />)}</datalist>
        <input key={file?.name ?? 'none'} className="input flex-1 min-w-[200px] file:mr-2 file:border-0 file:bg-gray-100 file:rounded file:px-2 file:py-1" type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button className="btn-primary" onClick={upload}>Unggah</button>
      </div>
      {error && <div className="text-brand bg-brand-soft rounded-lg px-3 py-2">{error}</div>}
      <FileThumbs items={items} fetchBlob={(did) => fetchProjectDocumentBlob(project.id, did).then((r) => r.data)} empty="Belum ada dokumen proyek." onDelete={project.can_manage ? async (f) => { if (confirm(`Hapus "${f.label}"?`)) { try { await deleteProjectDocument(project.id, f.id); load() } catch (e: any) { setError(err(e, 'Gagal menghapus')) } } } : undefined} />
      <p className="text-muted">JPG/PNG/WEBP/PDF, maks 10 MB. Disimpan lokal, lalu disalin ke Google Drive pada fase berikutnya.</p>
    </div>
  )
}

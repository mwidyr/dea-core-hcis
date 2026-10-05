import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import Layout from '../components/Layout/Layout'
import Badge from '../components/ui/Badge'
import DataTable from '../components/ui/DataTable'
import DateField from '../components/ui/DateField'
import Modal from '../components/ui/Modal'
import ProgressBar from '../components/ui/ProgressBar'
import StatCard from '../components/ui/StatCard'
import { useAuthStore } from '../store/auth'
import { bizParams, useBusinessStore } from '../store/business'
import { createProject, getProjects, getTaskAssignees, updateProject } from '../services/api'
import type { Assignee, Project } from '../types'
import { err, fmt } from '../components/tasks/taskUtils'

export const PROJECT_TONE = { Aktif: 'green', Ditunda: 'amber', Selesai: 'blue', Dibatalkan: 'gray' } as const

export function ProjectForm({ project, onClose, onSaved }: { project?: Project; onClose: () => void; onSaved: (p: Project) => void }) {
  const user = useAuthStore((s) => s.user)
  const [owners, setOwners] = useState<Assignee[]>([])
  const [f, setF] = useState({ name: project?.name ?? '', description: project?.description ?? '', owner_id: project?.owner_id ?? user?.employee_id ?? 0, start_date: project?.start_date?.slice(0, 10) ?? '', end_date: project?.end_date?.slice(0, 10) ?? '', status: project?.status ?? 'Aktif' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { getTaskAssignees().then((r) => setOwners(r.data)) }, [])
  const owner = owners.find((o) => o.id === f.owner_id)
  const submit = async () => {
    setError('')
    if (!f.name.trim()) return setError('Nama proyek wajib diisi')
    if (!f.owner_id) return setError('Pilih penanggung jawab')
    if (f.start_date && f.end_date && f.end_date < f.start_date) return setError('Tanggal selesai tidak boleh sebelum tanggal mulai')
    setBusy(true)
    try { const { data } = project ? await updateProject(project.id, f) : await createProject(f); onSaved(data) } catch (e: any) { setError(err(e, 'Gagal menyimpan proyek')) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={project ? 'Ubah Proyek' : 'Tambah Proyek'}>
      <div className="space-y-3 text-xs">
        <label className="block font-semibold">Nama proyek<input className="input w-full mt-1" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></label>
        <label className="block font-semibold">Deskripsi <span className="font-normal text-muted">(opsional)</span><textarea className="input w-full mt-1" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <label className="block font-semibold">Penanggung jawab (owner)
          <select className="input w-full mt-1" value={f.owner_id || ''} onChange={(e) => setF({ ...f, owner_id: Number(e.target.value) })}>
            <option value="">— Pilih —</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}{o.id === user?.employee_id ? ' (saya)' : ''}</option>)}
            {project && !owners.some((o) => o.id === project.owner_id) && <option value={project.owner_id}>{project.owner_name}</option>}
          </select>
          {owner && <span className="font-normal text-muted">Proyek mengikuti bisnis penanggung jawab.</span>}
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block font-semibold">Mulai<div className="mt-1 font-normal"><DateField value={f.start_date} businessId={owner?.business_id ?? project?.business_id ?? 0} onChange={(v) => setF({ ...f, start_date: v, end_date: f.end_date && f.end_date < v ? v : f.end_date })} /></div></label>
          <label className="block font-semibold">Selesai<div className="mt-1 font-normal"><DateField value={f.end_date} min={f.start_date || undefined} businessId={owner?.business_id ?? project?.business_id ?? 0} onChange={(v) => setF({ ...f, end_date: v })} /></div></label>
        </div>
        <p className="text-muted">Tanggal mulai & selesai diperlukan untuk Kurva-S.</p>
        {project && <label className="block font-semibold">Status<select className="input w-full mt-1" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Project['status'] })}>{['Aktif', 'Ditunda', 'Selesai', 'Dibatalkan'].map((s) => <option key={s}>{s}</option>)}</select></label>}
        {error && <div className="text-brand bg-brand-soft rounded-lg px-3 py-2">{error}</div>}
        <div className="flex justify-end gap-2"><button className="btn" onClick={onClose}>Batal</button><button className="btn-primary" disabled={busy} onClick={submit}>{busy ? 'Menyimpan…' : 'Simpan'}</button></div>
      </div>
    </Modal>
  )
}

export default function Projects() {
  const { businessId } = useBusinessStore()
  const nav = useNavigate()
  const [rows, setRows] = useState<Project[]>([])
  const [sum, setSum] = useState<Record<string, number>>({})
  const [canCreate, setCanCreate] = useState(false)
  const [status, setStatus] = useState('')
  const [form, setForm] = useState(false)
  const load = () => getProjects({ ...bizParams(businessId), status: status || undefined }).then((r) => { setRows(r.data.data); setSum(r.data.summary); setCanCreate(r.data.can_create) })
  useEffect(() => { load() }, [businessId, status])
  return (
    <Layout title="Proyek" subtitle="Monitoring proyek berbasis WBS: tugas bertingkat, bobot pekerjaan, timeline Gantt, Kurva-S, dan dokumen">
      <div className="grid grid-cols-4 gap-3 mb-3">
        <StatCard label="Proyek" value={sum.projects ?? 0} /><StatCard label="Induk Tugas" value={sum.parents ?? 0} foot="tahapan teratas" />
        <StatCard label="Sub Tugas" value={sum.subtasks ?? 0} foot="detail pekerjaan" /><StatCard label="Open Task" value={sum.open ?? 0} foot={`${sum.done ?? 0} selesai`} />
      </div>
      <div className="card p-4">
        <DataTable data={rows} rowKey={(p) => p.id} searchPlaceholder="Cari proyek, penanggung jawab…" searchText={(p) => `${p.name} ${p.owner_name}`}
          filters={<select className="input" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Semua Status</option>{['Aktif', 'Ditunda', 'Selesai', 'Dibatalkan'].map((s) => <option key={s}>{s}</option>)}</select>}
          actions={canCreate ? <button className="btn-primary" onClick={() => setForm(true)}><Plus className="w-3.5 h-3.5 inline mr-1" />Proyek</button> : undefined}
          empty="Belum ada proyek"
          columns={[
            { head: 'Proyek', render: (p) => <div><b>{p.name}</b><div className="text-muted text-[11px]">{fmt(p.start_date)} – {fmt(p.end_date)}</div></div> },
            { head: 'Induk Tugas', render: (p) => p.top_level },
            { head: 'Sub Tugas', render: (p) => p.subtasks },
            { head: 'Open', render: (p) => <span>{p.open}{p.overdue > 0 && <Badge tone="red">{p.overdue} terlambat</Badge>}</span> },
            { head: 'Done', render: (p) => p.done },
            { head: 'Owner / PIC', render: (p) => p.owner_name },
            { head: 'Status', render: (p) => <Badge tone={PROJECT_TONE[p.status]}>{p.status}</Badge> },
            { head: 'Progres', render: (p) => <div className="w-36"><ProgressBar value={p.progress} /></div> },
            { head: 'Aksi', render: (p) => <button className="btn" onClick={() => nav(`/projects/${p.id}`)}>Buka</button> },
          ]} />
      </div>
      {form && <ProjectForm onClose={() => setForm(false)} onSaved={(p) => { setForm(false); nav(`/projects/${p.id}`) }} />}
    </Layout>
  )
}

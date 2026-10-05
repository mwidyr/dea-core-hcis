import { useEffect, useMemo, useState } from 'react'
import { Flame } from 'lucide-react'
import DateField from '../ui/DateField'
import Modal from '../ui/Modal'
import MultiPick from '../ui/MultiPick'
import { useAuthStore } from '../../store/auth'
import { createTask, getApprovers, getEmployees, getKpiTaskOptions, getProjects, getTaskAssignees, getTasks, updateTask } from '../../services/api'
import type { Assignee, Employee, Person, Project, TaskRow } from '../../types'
import { err } from './taskUtils'

interface Props {
  task?: TaskRow                                           // edit when given
  defaults?: { project_id?: number | null; parent_id?: number | null; pic_id?: number }
  onClose: () => void
  onSaved: (t: TaskRow) => void
}

const L = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <label className="block font-semibold">{label}{hint && <span className="font-normal text-muted"> {hint}</span>}<div className="mt-1 font-normal">{children}</div></label>
)

export default function TaskForm({ task, defaults, onClose, onSaved }: Props) {
  const user = useAuthStore((s) => s.user)
  const editing = !!task
  const restricted = editing && !task!.can_manage // the PIC alone may only change description / members / watchers
  const [f, setF] = useState({
    title: task?.title ?? '', description: task?.description ?? '', priority: task?.priority ?? 'normal',
    pic_id: task?.pic_id ?? defaults?.pic_id ?? 0, assigner_id: task ? task.assigner_id : user?.employee_id ?? null,
    project_id: task ? task.project_id : defaults?.project_id ?? null, parent_id: task ? task.parent_id : defaults?.parent_id ?? null,
    start_date: task?.start_date?.slice(0, 10) ?? '', due_date: task?.due_date?.slice(0, 10) ?? '', weight: task?.weight != null ? String(task.weight) : '',
    require_result: task?.require_result ?? false, requires_approval: task?.requires_approval ?? true, approval_levels: task?.approval_levels ?? 1,
    approver_user_id: task?.approver_user_id ?? 0, kpi_id: task?.kpi_id ?? 0,
    member_ids: task?.members.filter((m) => m.role === 'member').map((m) => m.employee_id) ?? [] as number[],
    watcher_ids: task?.members.filter((m) => m.role === 'watcher').map((m) => m.employee_id) ?? [] as number[],
  })
  const [kind, setKind] = useState<'biasa' | 'sub'>(f.parent_id ? 'sub' : 'biasa')
  const [assignees, setAssignees] = useState<Assignee[]>([])
  const [people, setPeople] = useState<Employee[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [parents, setParents] = useState<TaskRow[]>([])
  const [approvers, setApprovers] = useState<Person[]>([])
  const [kpis, setKpis] = useState<{ id: number; title: string; period: string }[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))

  useEffect(() => { getTaskAssignees().then((r) => setAssignees(r.data)) }, [])
  const pic = assignees.find((a) => a.id === f.pic_id)
  const parent = parents.find((p) => p.id === f.parent_id)
  const project = projects.find((p) => p.id === f.project_id)
  // business of the task: its parent's, else its project's, else the PIC's
  const biz = parent?.business_id ?? project?.business_id ?? (task && !pic ? task.business_id : pic?.business_id) ?? 0

  useEffect(() => { // everyone in that business can be giver / member / watcher
    if (!biz) return
    getEmployees({ business_id: biz, status: 'Aktif', page_size: 1000 }).then((r) => setPeople(r.data.data ?? []))
    getProjects({ business_id: biz }).then((r) => setProjects(r.data.data.filter((p) => p.status === 'Aktif' || p.id === f.project_id)))
  }, [biz])
  useEffect(() => { // candidate parents (not itself or its own sub-tasks)
    if (kind !== 'sub' || !biz) return
    getTasks({ scope: 'all', business_id: biz }).then((r) => {
      const all = r.data.data
      const banned = new Set<number>()
      if (task) { banned.add(task.id); let grew = true; while (grew) { grew = false; all.forEach((t) => { if (t.parent_id && banned.has(t.parent_id) && !banned.has(t.id)) { banned.add(t.id); grew = true } }) } }
      setParents(all.filter((t) => !banned.has(t.id) && t.status !== 'review' && t.depth < 5))
    })
  }, [kind, biz])
  useEffect(() => { // auto KPI items of the PIC that this task can count toward
    if (!f.pic_id) { setKpis([]); return }
    getKpiTaskOptions(f.pic_id).then((r) => { setKpis(r.data); setF((x) => (x.kpi_id && !r.data.some((k) => k.id === x.kpi_id) ? { ...x, kpi_id: 0 } : x)) }).catch(() => setKpis([]))
  }, [f.pic_id])
  useEffect(() => { if (f.pic_id) getApprovers(f.pic_id).then((r) => setApprovers(r.data.candidates)).catch(() => setApprovers([])) }, [f.pic_id])

  const personOpts = useMemo(() => people.map((p) => ({ id: p.id, label: p.name, sub: p.position?.title })), [people])
  const memberOpts = personOpts.filter((o) => o.id !== f.pic_id)
  const topLevelProject = kind === 'biasa' && !!f.project_id

  const submit = async () => {
    setError('')
    if (!f.title.trim()) return setError('Nama tugas wajib diisi')
    if (!f.pic_id) return setError('Pilih PIC (penerima tugas)')
    if (kind === 'sub' && !f.parent_id) return setError('Pilih induk tugas untuk sub tugas')
    if (f.start_date && f.due_date && f.due_date < f.start_date) return setError('Deadline tidak boleh sebelum tanggal mulai')
    setBusy(true)
    try {
      const payload = {
        ...f, parent_id: kind === 'sub' ? f.parent_id : null, project_id: kind === 'sub' ? null : f.project_id,
        weight: topLevelProject && f.weight !== '' ? Number(f.weight) : null, approver_user_id: f.requires_approval && f.approver_user_id ? f.approver_user_id : null, kpi_id: f.kpi_id || null,
        unit_id: pic?.unit_id ?? task?.unit_id ?? null,
      }
      const { data } = editing ? await updateTask(task!.id, payload) : await createTask(payload)
      onSaved(data)
    } catch (e: any) { setError(err(e, 'Gagal menyimpan tugas')) } finally { setBusy(false) }
  }

  const dis = restricted
  return (
    <Modal open onClose={onClose} title={editing ? 'Ubah Tugas' : f.parent_id ? 'Tambah Sub Tugas' : 'Tambah Tugas'} size="lg">
      <div className="space-y-4 text-xs">
        {restricted && <div className="bg-info-soft text-info rounded-lg px-3 py-2">Sebagai PIC, Anda hanya dapat mengubah deskripsi, anggota, dan pengamat. Perubahan lain dilakukan oleh pemberi tugas atau atasan.</div>}
        <div className="flex gap-3 items-end">
          <div className="flex-1"><L label="Nama tugas *"><input className="input w-full" disabled={dis} value={f.title} onChange={(e) => set('title', e.target.value)} autoFocus /></L></div>
          <button type="button" disabled={dis} onClick={() => set('priority', f.priority === 'tinggi' ? 'normal' : 'tinggi')}
            className={`flex items-center gap-1 px-3 py-2 rounded-lg border font-semibold ${f.priority === 'tinggi' ? 'bg-brand-soft border-brand text-brand' : 'border-line text-muted'}`}><Flame className="w-3.5 h-3.5" />Prioritas</button>
        </div>
        <L label="Deskripsi" hint="(opsional)"><textarea className="input w-full" rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} /></L>

        <div className="border-t border-line pt-3 grid grid-cols-2 gap-3">
          <div className="col-span-2 font-bold">Penugasan</div>
          <L label="Pemberi tugas *" hint="(siapa yang memberi instruksi — termasuk via chat/call)">
            <select className="input w-full" disabled={dis} value={f.assigner_id ?? ''} onChange={(e) => set('assigner_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">— Pilih pemberi tugas —</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              {f.assigner_id && !people.some((p) => p.id === f.assigner_id) && <option value={f.assigner_id}>{task?.assigner_name || 'Saya'}</option>}
            </select>
          </L>
          <L label="PIC / penerima tugas *" hint="(satu orang)">
            <select className="input w-full" disabled={dis} value={f.pic_id || ''} onChange={(e) => set('pic_id', Number(e.target.value))}>
              <option value="">— Pilih PIC —</option>{assignees.map((a) => <option key={a.id} value={a.id}>{a.name}{a.id === user?.employee_id ? ' (saya)' : ''}</option>)}
              {task && !assignees.some((a) => a.id === task.pic_id) && <option value={task.pic_id}>{task.pic_name}</option>}
            </select>
          </L>
          <L label="Unit organisasi" hint="(otomatis mengikuti PIC)"><input className="input w-full bg-gray-50" disabled value={pic?.unit_name ?? task?.unit_name ?? '—'} /></L>
          <L label="Proyek" hint="(opsional)">
            <select className="input w-full" disabled={dis || kind === 'sub'} value={kind === 'sub' ? (parent?.project_id ?? '') : f.project_id ?? ''} onChange={(e) => set('project_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">Tidak ada / Non Project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {kind === 'sub' && <div className="text-muted text-[10.5px] mt-0.5">Sub tugas mengikuti proyek induknya.</div>}
          </L>
          <div className="col-span-2"><L label="Anggota terlibat" hint="(opsional)"><MultiPick options={memberOpts} value={f.member_ids} onChange={(v) => setF((x) => ({ ...x, member_ids: v, watcher_ids: x.watcher_ids.filter((w) => !v.includes(w)) }))} placeholder="Pilih anggota" /></L></div>
          <div className="col-span-2"><L label="Pengamat" hint="(opsional — memantau progres & hasil tanpa menjadi PIC/anggota)"><MultiPick options={memberOpts.filter((o) => !f.member_ids.includes(o.id))} value={f.watcher_ids} onChange={(v) => set('watcher_ids', v)} placeholder="Pilih pengamat" /></L></div>
        </div>

        <div className="border-t border-line pt-3 grid grid-cols-2 gap-3">
          <div className="col-span-2 font-bold">Struktur & waktu</div>
          <div className="col-span-2 flex gap-2">
            {([['biasa', 'Tugas Biasa / Induk', 'berdiri sendiri; menjadi induk saat diberi sub tugas'], ['sub', 'Sub Tugas', 'bagian dari tugas induk']] as const).map(([v, t, d]) => (
              <label key={v} className={`flex-1 flex gap-2 items-start border rounded-lg p-2 ${dis || editing && task!.is_parent && v === 'sub' ? 'opacity-60' : 'cursor-pointer'} ${kind === v ? 'border-brand bg-brand-soft' : 'border-line'}`}>
                <input type="radio" className="mt-0.5" disabled={dis || (editing && task!.is_parent && v === 'sub')} checked={kind === v} onChange={() => { setKind(v); if (v === 'biasa') set('parent_id', null) }} /><span><b>{t}</b><div className="text-muted text-[10.5px]">{d}</div></span>
              </label>
            ))}
          </div>
          {kind === 'sub' && (
            <div className="col-span-2"><L label="Induk tugas *">
              <select className="input w-full" disabled={dis} value={f.parent_id ?? ''} onChange={(e) => set('parent_id', e.target.value ? Number(e.target.value) : null)}>
                <option value="">— Pilih induk tugas —</option>{parents.map((p) => <option key={p.id} value={p.id}>{'— '.repeat(p.depth - 1)}{p.title}{p.project_name ? ` · ${p.project_name}` : ''}</option>)}
                {f.parent_id && !parents.some((p) => p.id === f.parent_id) && <option value={f.parent_id}>{task?.parent_title ?? 'Induk tugas'}</option>}
              </select>
            </L></div>
          )}
          <L label="Mulai" hint="(opsional)"><DateField value={f.start_date} businessId={biz} onChange={(v) => { set('start_date', v); if (f.due_date && f.due_date < v) set('due_date', v) }} /></L>
          <L label="Deadline" hint="(opsional)"><DateField value={f.due_date} min={f.start_date || undefined} businessId={biz} onChange={(v) => set('due_date', v)} /></L>
          {topLevelProject && <L label="Bobot proyek (%)" hint="(opsional — bobot tahapan ini di proyek & Kurva-S)"><input className="input w-full" type="number" min={0} max={100} step="any" disabled={dis} value={f.weight} onChange={(e) => set('weight', e.target.value)} placeholder="mis. 20" /></L>}
        </div>

        {kpis.length > 0 && (
          <div className="border-t border-line pt-3">
            <L label="Terkait KPI" hint="(opsional — tugas yang selesai tepat waktu menambah actual KPI otomatis)">
              <select className="input w-full" disabled={dis} value={f.kpi_id || ''} onChange={(e) => set('kpi_id', Number(e.target.value))}>
                <option value="">— Tidak terkait KPI —</option>{kpis.map((k) => <option key={k.id} value={k.id}>{k.title} · {k.period}</option>)}</select>
            </L>
          </div>
        )}

        <div className="border-t border-line pt-3 space-y-2">
          <div className="font-bold">Penyelesaian</div>
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" disabled={dis} checked={f.require_result} onChange={(e) => set('require_result', e.target.checked)} /><span><b>Lampiran hasil</b><div className="text-muted">PIC wajib melampirkan hasil pekerjaan saat menyelesaikan tugas.</div></span></label>
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" disabled={dis} checked={f.requires_approval} onChange={(e) => set('requires_approval', e.target.checked)} /><span><b>Perlu approval penyelesaian</b><div className="text-muted">Tugas baru ditutup setelah disetujui atasan (bisa berjenjang). Tugas induk selesai otomatis dari sub tugasnya.</div></span></label>
          {f.requires_approval && (
            <div className="ml-6 grid grid-cols-2 gap-3 bg-gray-50/70 rounded-lg p-3">
              <L label="Jenjang atasan PIC"><select className="input w-full" disabled={dis || !!f.approver_user_id} value={f.approval_levels} onChange={(e) => set('approval_levels', Number(e.target.value))}>{[1, 2, 3].map((n) => <option key={n} value={n}>{n} tingkat{n > 1 ? ' (berjenjang)' : ''}</option>)}</select></L>
              <L label="Approver" hint="(opsional)"><select className="input w-full" disabled={dis} value={f.approver_user_id || ''} onChange={(e) => set('approver_user_id', Number(e.target.value))}>
                <option value="">Atasan PIC (n+1)</option>{approvers.map((a) => <option key={a.user_id} value={a.user_id}>{a.name} ({a.role})</option>)}</select></L>
              <div className="col-span-2 text-muted text-[11px]">{f.approver_user_id ? 'Hanya approver ini yang menyetujui; atasan PIC tidak diperlukan.' : `Persetujuan dari ${f.approval_levels} tingkat atasan PIC (n+1${f.approval_levels > 1 ? ', n+2…' : ''}).`}</div>
            </div>
          )}
        </div>

        {error && <div className="text-brand bg-brand-soft rounded-lg px-3 py-2">{error}</div>}
        <div className="flex justify-end gap-2"><button className="btn" onClick={onClose}>Batal</button><button className="btn-primary" disabled={busy} onClick={submit}>{busy ? 'Menyimpan…' : 'Simpan'}</button></div>
      </div>
    </Modal>
  )
}

import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import Badge from '../ui/Badge'
import DataTable from '../ui/DataTable'
import DateField from '../ui/DateField'
import Modal from '../ui/Modal'
import { createRecurringTask, deleteRecurringTask, getApprovers, getRecurringTasks, getTaskAssignees, updateRecurringTask } from '../../services/api'
import type { Assignee, Person, RecurringTask } from '../../types'
import { err, fmt, ymd } from './taskUtils'

const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
export const freqText = (r: Pick<RecurringTask, 'frequency' | 'weekday' | 'day_of_month'>) =>
  r.frequency === 'daily' ? 'Setiap hari kerja (Sen–Jum)' : r.frequency === 'weekly' ? `Setiap hari ${DAYS[r.weekday]}` : r.day_of_month === 0 ? 'Setiap akhir bulan' : `Setiap tanggal ${r.day_of_month}`

const L = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <label className="block font-semibold">{label}{hint && <span className="font-normal text-muted"> {hint}</span>}<div className="mt-1 font-normal">{children}</div></label>
)

export default function RecurringTasks() {
  const [rows, setRows] = useState<RecurringTask[]>([])
  const [edit, setEdit] = useState<Partial<RecurringTask> | null>(null)
  const load = () => getRecurringTasks().then((r) => setRows(r.data.data))
  useEffect(() => { load() }, [])
  return (
    <>
      <div className="bg-gray-50 rounded-lg p-3 mb-3 text-xs text-muted">
        <b className="text-gray-800">Tugas rutin</b> adalah template yang membuat tugas biasa secara otomatis (harian, mingguan, atau bulanan) lengkap dengan PIC, deadline, dan approval. Isi <i>Tautkan ke KPI</i> dengan judul KPI otomatis PIC agar tiap tugas yang dibuat langsung terhitung di KPI periode itu.
      </div>
      <DataTable data={rows} rowKey={(r) => r.id} searchPlaceholder="Cari tugas rutin atau PIC…" searchText={(r) => `${r.title} ${r.pic_name}`} empty="Belum ada tugas rutin"
        actions={<button className="btn-primary" onClick={() => setEdit({ frequency: 'weekly', weekday: 1, day_of_month: 1, due_after_days: 2, priority: 'normal', requires_approval: true, approval_levels: 1, active: true, start_date: ymd(new Date()) })}><Plus className="w-3.5 h-3.5 inline mr-1" />Tugas Rutin</button>}
        columns={[
          { head: 'Tugas', render: (r) => <div><b>{r.title}</b>{r.kpi_title && <div className="text-muted text-[10.5px]">↳ KPI: {r.kpi_title}</div>}</div> },
          { head: 'PIC', render: (r) => <div>{r.pic_name}<div className="text-muted text-[10.5px]">{r.business_name}</div></div> },
          { head: 'Jadwal', render: (r) => <div>{freqText(r)}<div className="text-muted text-[10.5px]">deadline {r.due_after_days === 0 ? 'di hari yang sama' : `${r.due_after_days} hari setelahnya`}</div></div> },
          { head: 'Periode', render: (r) => <div className="text-[11px]">{fmt(r.start_date)} – {r.end_date ? fmt(r.end_date) : 'tanpa batas'}</div> },
          { head: 'Berikutnya', render: (r) => (r.active ? fmt(r.next_date) : '–') },
          { head: 'Dibuat', render: (r) => `${r.generated} tugas` },
          { head: 'Status', render: (r) => <Badge tone={r.active ? 'green' : 'gray'}>{r.active ? 'Aktif' : 'Dijeda'}</Badge> },
          { head: 'Aksi', render: (r) => r.can_manage && (
            <div className="flex gap-1.5">
              <button className="btn" onClick={() => setEdit(r)}>Edit</button>
              <button className="btn" onClick={async () => { await updateRecurringTask(r.id, { ...r, start_date: r.start_date.slice(0, 10), end_date: r.end_date?.slice(0, 10) ?? '', active: !r.active }); load() }}>{r.active ? 'Jeda' : 'Aktifkan'}</button>
              <button className="btn text-brand" onClick={async () => { if (confirm(`Hapus tugas rutin "${r.title}"? Tugas yang sudah dibuat tetap ada.`)) { await deleteRecurringTask(r.id); load() } }}>Hapus</button>
            </div>) },
        ]} />
      {edit && <RecurringForm initial={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load() }} />}
    </>
  )
}

function RecurringForm({ initial, onClose, onSaved }: { initial: Partial<RecurringTask>; onClose: () => void; onSaved: () => void }) {
  const editing = !!initial.id
  const [f, setF] = useState({
    title: initial.title ?? '', description: initial.description ?? '', priority: initial.priority ?? 'normal', pic_id: initial.pic_id ?? 0,
    frequency: initial.frequency ?? 'weekly', weekday: initial.weekday ?? 1, day_of_month: initial.day_of_month ?? 1, due_after_days: initial.due_after_days ?? 2,
    start_date: initial.start_date?.slice(0, 10) ?? '', end_date: initial.end_date?.slice(0, 10) ?? '', kpi_title: initial.kpi_title ?? '',
    require_result: initial.require_result ?? false, requires_approval: initial.requires_approval ?? true, approval_levels: initial.approval_levels ?? 1,
    approver_user_id: initial.approver_user_id ?? 0, active: initial.active ?? true,
  })
  const [assignees, setAssignees] = useState<Assignee[]>([])
  const [approvers, setApprovers] = useState<Person[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  useEffect(() => { getTaskAssignees().then((r) => setAssignees(r.data)) }, [])
  useEffect(() => { if (f.pic_id) getApprovers(f.pic_id).then((r) => setApprovers(r.data.candidates)).catch(() => setApprovers([])) }, [f.pic_id])
  const pic = assignees.find((a) => a.id === f.pic_id)
  const submit = async () => {
    setError('')
    if (!f.title.trim()) return setError('Nama tugas rutin wajib diisi')
    if (!f.pic_id) return setError('Pilih PIC')
    if (!f.start_date) return setError('Tanggal mulai wajib diisi')
    setBusy(true)
    try {
      const payload = { ...f, approver_user_id: f.requires_approval && f.approver_user_id ? f.approver_user_id : null }
      if (editing) await updateRecurringTask(initial.id!, payload); else await createRecurringTask(payload)
      onSaved()
    } catch (e: any) { setError(err(e, 'Gagal menyimpan tugas rutin')) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={editing ? 'Ubah Tugas Rutin' : 'Tambah Tugas Rutin'} size="lg">
      <div className="space-y-4 text-xs">
        <L label="Nama tugas *"><input className="input w-full" value={f.title} onChange={(e) => set('title', e.target.value)} autoFocus /></L>
        <L label="Deskripsi" hint="(opsional)"><textarea className="input w-full" rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} /></L>
        <div className="grid grid-cols-2 gap-3">
          <L label="PIC *">
            <select className="input w-full" value={f.pic_id || ''} onChange={(e) => set('pic_id', Number(e.target.value))}>
              <option value="">— Pilih PIC —</option>{assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              {initial.pic_id && !assignees.some((a) => a.id === initial.pic_id) && <option value={initial.pic_id}>{initial.pic_name}</option>}
            </select>
          </L>
          <L label="Prioritas"><select className="input w-full" value={f.priority} onChange={(e) => set('priority', e.target.value as 'normal' | 'tinggi')}><option value="normal">Normal</option><option value="tinggi">Tinggi</option></select></L>
        </div>
        <div className="border-t border-line pt-3 grid grid-cols-2 gap-3">
          <div className="col-span-2 font-bold">Jadwal</div>
          <L label="Pengulangan">
            <select className="input w-full" value={f.frequency} onChange={(e) => set('frequency', e.target.value as typeof f.frequency)}><option value="daily">Harian (hari kerja Sen–Jum)</option><option value="weekly">Mingguan</option><option value="monthly">Bulanan</option></select>
          </L>
          {f.frequency === 'weekly' && <L label="Setiap hari"><select className="input w-full" value={f.weekday} onChange={(e) => set('weekday', Number(e.target.value))}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></L>}
          {f.frequency === 'monthly' && <L label="Setiap tanggal"><select className="input w-full" value={f.day_of_month} onChange={(e) => set('day_of_month', Number(e.target.value))}><option value={0}>Akhir bulan</option>{Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></L>}
          <L label="Deadline" hint="(hari setelah tugas dibuat)"><input className="input w-full" type="number" min={0} max={90} value={f.due_after_days} onChange={(e) => set('due_after_days', Number(e.target.value))} /></L>
          <L label="Mulai *"><DateField value={f.start_date} min={editing ? undefined : ymd(new Date())} businessId={pic?.business_id} onChange={(v) => set('start_date', v)} /></L>
          <L label="Berakhir" hint="(opsional)"><DateField value={f.end_date} min={f.start_date || undefined} businessId={pic?.business_id} onChange={(v) => set('end_date', v)} /></L>
        </div>
        <div className="border-t border-line pt-3">
          <L label="Tautkan ke KPI" hint="(opsional — judul KPI otomatis “tugas tepat waktu” milik PIC; dicocokkan per periode)"><input className="input w-full" placeholder="mis. Laporan Mingguan" value={f.kpi_title} onChange={(e) => set('kpi_title', e.target.value)} /></L>
        </div>
        <div className="border-t border-line pt-3 space-y-2">
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={f.require_result} onChange={(e) => set('require_result', e.target.checked)} /><span><b>Lampiran hasil wajib</b></span></label>
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={f.requires_approval} onChange={(e) => set('requires_approval', e.target.checked)} /><span><b>Perlu approval penyelesaian</b></span></label>
          {f.requires_approval && (
            <div className="ml-6 grid grid-cols-2 gap-3 bg-gray-50/70 rounded-lg p-3">
              <L label="Jenjang atasan PIC"><select className="input w-full" disabled={!!f.approver_user_id} value={f.approval_levels} onChange={(e) => set('approval_levels', Number(e.target.value))}>{[1, 2, 3].map((n) => <option key={n} value={n}>{n} tingkat</option>)}</select></L>
              <L label="Approver" hint="(opsional)"><select className="input w-full" value={f.approver_user_id || ''} onChange={(e) => set('approver_user_id', Number(e.target.value))}><option value="">Atasan PIC (n+1)</option>{approvers.map((a) => <option key={a.user_id} value={a.user_id}>{a.name} ({a.role})</option>)}</select></L>
            </div>
          )}
        </div>
        {error && <div className="text-brand bg-brand-soft rounded-lg px-3 py-2">{error}</div>}
        <div className="flex justify-end gap-2"><button className="btn" onClick={onClose}>Batal</button><button className="btn-primary" disabled={busy} onClick={submit}>{busy ? 'Menyimpan…' : 'Simpan'}</button></div>
      </div>
    </Modal>
  )
}

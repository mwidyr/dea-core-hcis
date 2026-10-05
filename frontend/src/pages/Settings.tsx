import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import Layout from '../components/Layout/Layout'
import Badge from '../components/ui/Badge'
import DataTable from '../components/ui/DataTable'
import Modal from '../components/ui/Modal'
import Pagination from '../components/ui/Pagination'
import PasswordInput from '../components/ui/PasswordInput'
import Tabs from '../components/ui/Tabs'
import { useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { useBusinessStore } from '../store/business'
import { createUser, disconnectDrive, getAudit, getDriveConnectUrl, getDriveStatus, retryDriveFailed, syncDriveNow, getRolePermissions, resetRolePermissions, setRolePermissions, getEmployees, getKpiSettings, getLeaveTypes, getUsers, saveKpiSettings, saveLeaveType, updateUser } from '../services/api'
import type { DriveStatusData, AppUser, AuditRow, Employee, KpiSettings, LeaveType, PermDef, User } from '../types'

type Tab = 'users' | 'roles' | 'drive' | 'master' | 'kpi' | 'workflow' | 'audit'
const ROLES: { id: User['role']; label: string; hint: string }[] = [
  { id: 'super_admin', label: 'Super Admin', hint: 'Semua akses, semua bisnis' },
  { id: 'hr_admin', label: 'HR Admin', hint: 'Kelola karyawan, org, cuti; semua bisnis' },
  { id: 'manager', label: 'Manager', hint: 'Melihat tim sendiri, menyetujui pengajuan' },
  { id: 'employee', label: 'Karyawan', hint: 'Data dan pengajuan sendiri' },
]
const roleTone = { super_admin: 'red', hr_admin: 'purple', manager: 'blue', employee: 'gray' } as const
const dt = (d: string) => new Date(d).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function Settings() {
  const { user, can } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(user?.role ?? '')
  const all: { id: Tab; label: string; perm?: string }[] = [
    { id: 'users', label: 'User & Hak Akses', perm: 'users.manage' }, { id: 'roles', label: 'Role & Izin', perm: 'roles.manage' }, { id: 'drive', label: 'Google Drive', perm: 'drive.manage' }, { id: 'master', label: 'Master Data', perm: 'leave.admin' },
    { id: 'kpi', label: 'KPI', perm: 'kpi.settings' }, { id: 'workflow', label: 'Workflow Approval' }, { id: 'audit', label: 'Audit Log', perm: 'audit.view' },
  ]
  const tabs = all.filter((t) => !t.perm || can(t.perm))
  const [params] = useSearchParams() // /settings?tab=drive after returning from Google
  const wanted = params.get('tab') as Tab | null
  const [tab, setTab] = useState<Tab>(wanted && tabs.some((t) => t.id === wanted) ? wanted : tabs[0]?.id ?? 'workflow')
  return (
    <Layout title="User, Workflow & Master" subtitle="Akun pengguna, role & izin, master data, aturan approval, dan audit log">
      {!isAdmin ? <div className="card p-8 text-center text-sm text-muted">Halaman ini hanya untuk Super Admin dan HR Admin.</div> : (
        <div className="card p-4">
          <Tabs tabs={tabs.map(({ id, label }) => ({ id, label }))} value={tab} onChange={setTab} />
          {tab === 'users' && <Users />}
          {tab === 'roles' && <RolesPanel />}
          {tab === 'drive' && <DrivePanel result={params.get('drive')} />}
          {tab === 'master' && <LeaveTypes />}
          {tab === 'kpi' && <KpiPanel />}
          {tab === 'workflow' && <Workflow />}
          {tab === 'audit' && <Audit />}
        </div>
      )}
    </Layout>
  )
}

// Permission matrix: Super Admin always has everything; the other roles can be switched per feature.
function RolesPanel() {
  const [defs, setDefs] = useState<PermDef[]>([])
  const [saved, setSaved] = useState<Record<string, string[]>>({})
  const [draft, setDraft] = useState<Record<string, string[]>>({})
  const [msg, setMsg] = useState('')
  const load = () => getRolePermissions().then((r) => { setDefs(r.data.permissions); setSaved(r.data.roles); setDraft(r.data.roles) })
  useEffect(() => { load() }, [])
  const editable = ROLES.filter((r) => r.id !== 'super_admin')
  const toggle = (role: string, key: string) => setDraft((d) => ({ ...d, [role]: d[role].includes(key) ? d[role].filter((k) => k !== key) : [...d[role], key] }))
  const dirty = (role: string) => JSON.stringify([...(draft[role] ?? [])].sort()) !== JSON.stringify([...(saved[role] ?? [])].sort())
  const save = async (role: string) => { try { await setRolePermissions(role, draft[role]); setMsg(`Izin ${role} disimpan — berlaku langsung`); load() } catch (e: any) { setMsg(e.response?.data?.error ?? 'Gagal menyimpan') } }
  const reset = async (role: string) => { if (!confirm(`Kembalikan izin ${role} ke bawaan?`)) return; try { await resetRolePermissions(role); setMsg(`Izin ${role} dikembalikan ke bawaan`); load() } catch (e: any) { setMsg(e.response?.data?.error ?? 'Gagal') } }
  const groups = [...new Set(defs.map((d) => d.group))]
  return (
    <div className="mt-3 text-xs">
      <p className="text-muted mb-3">Atur fitur apa yang boleh dipakai setiap role. <b>Super Admin</b> selalu memiliki semua izin. Cakupan data (bisnis dan karyawan yang terlihat) tetap mengikuti role: HR Admin melihat semua bisnis, Manager hanya tim sendiri, Karyawan data sendiri. Perubahan berlaku langsung tanpa login ulang.</p>
      {msg && <div className="bg-info-soft text-info rounded-lg px-3 py-2 mb-3">{msg}</div>}
      <div className="border border-line rounded-lg overflow-auto">
        <table className="w-full">
          <thead><tr><th className="th">Izin</th>{ROLES.map((r) => <th key={r.id} className="th text-center">{r.label}</th>)}</tr></thead>
          <tbody>
            {groups.map((g) => [
              <tr key={g}><td colSpan={5} className="td bg-gray-50 font-bold text-[10.5px] uppercase tracking-wider text-muted">{g}</td></tr>,
              ...defs.filter((d) => d.group === g).map((d) => (
                <tr key={d.key}>
                  <td className="td"><b>{d.label}</b>{d.hint && <div className="text-muted text-[10.5px]">{d.hint}</div>}</td>
                  <td className="td text-center"><input type="checkbox" checked disabled /></td>
                  {editable.map((r) => <td key={r.id} className="td text-center"><input type="checkbox" disabled={d.locked} checked={!!draft[r.id]?.includes(d.key)} onChange={() => toggle(r.id, d.key)} title={d.locked ? 'Hanya Super Admin' : ''} /></td>)}
                </tr>
              )),
            ])}
            <tr>
              <td className="td text-muted">Simpan perubahan per role</td><td className="td" />
              {editable.map((r) => <td key={r.id} className="td text-center"><div className="flex flex-col gap-1 items-center"><button className="btn-primary disabled:opacity-40" disabled={!dirty(r.id)} onClick={() => save(r.id)}>Simpan</button><button className="btn" onClick={() => reset(r.id)}>Bawaan</button></div></td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

const DRIVE_RESULT: Record<string, [string, boolean]> = {
  terhubung: ['Akun Google Drive berhasil dihubungkan. File yang menunggu mulai diunggah.', true], ditolak: ['Izin ditolak di halaman Google.', false],
  gagal: ['Gagal menghubungkan akun (cek client id/secret dan redirect URI).', false], 'state-tidak-valid': ['Permintaan hubungkan kedaluwarsa — coba lagi.', false],
}

// Google Drive: connection (OAuth), folder layout, and the sync queue per tab.
function DrivePanel({ result }: { result: string | null }) {
  const [d, setD] = useState<DriveStatusData | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(result && DRIVE_RESULT[result] ? DRIVE_RESULT[result] : null)
  const [busy, setBusy] = useState(false)
  const load = () => getDriveStatus().then((r) => setD(r.data))
  useEffect(() => { load() }, [])
  const run = async (fn: () => Promise<any>, ok: (r: any) => string) => {
    setBusy(true)
    try { const r = await fn(); setMsg([ok(r.data), true]) } catch (e: any) { setMsg([e.response?.data?.error ?? 'Gagal', false]) } finally { setBusy(false); load() }
  }
  const connect = async () => { try { const r = await getDriveConnectUrl(); window.location.href = r.data.url } catch (e: any) { setMsg([e.response?.data?.error ?? 'Gagal', false]) } }
  if (!d) return <p className="mt-3 text-xs text-muted">Memuat…</p>
  const total = d.counts.reduce((a, c) => ({ pending: a.pending + c.pending, synced: a.synced + c.synced, failed: a.failed + c.failed }), { pending: 0, synced: 0, failed: 0 })
  return (
    <div className="mt-3 text-xs space-y-4">
      {msg && <div className={`rounded-lg px-3 py-2 ${msg[1] ? 'bg-info-soft text-info' : 'bg-brand-soft text-brand'}`}>{msg[0]}</div>}
      <div className="border border-line rounded-lg p-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="font-bold text-sm mb-1">Koneksi Google Drive</div>
            {!d.enabled || !d.configured ? (
              <div className="text-muted max-w-xl">Belum dikonfigurasi. Di <code>backend/.env</code> isi <code>GDRIVE_ENABLED=true</code>, <code>GDRIVE_CLIENT_ID</code> dan <code>GDRIVE_CLIENT_SECRET</code> (OAuth client tipe <i>Web application</i> dari Google Cloud Console), daftarkan <code>{d.redirect_url}</code> sebagai Authorized redirect URI, lalu restart server.</div>
            ) : d.connected ? (
              <div><Badge tone="green">Terhubung</Badge> <span className="ml-1">{d.email || (d.source === 'env' ? 'melalui GDRIVE_REFRESH_TOKEN' : '')}</span>
                <div className="text-muted mt-1">Izin: {d.scope.endsWith('/drive') ? 'penuh (folder root sendiri)' : 'hanya file buatan aplikasi'}</div></div>
            ) : <div><Badge tone="amber">Belum terhubung</Badge><div className="text-muted mt-1">Klik “Hubungkan” lalu pilih akun Google yang akan menyimpan file.</div></div>}
          </div>
          <div className="flex gap-2 flex-wrap">
            {d.enabled && d.configured && <button className="btn-primary" disabled={busy} onClick={connect}>{d.connected ? 'Hubungkan Ulang' : 'Hubungkan Google Drive'}</button>}
            {d.connected && d.source === 'app' && <button className="btn" disabled={busy} onClick={async () => { if (confirm('Putuskan akun Google Drive? File tetap aman di Drive dan di server; sinkronisasi berhenti sampai dihubungkan lagi.')) { await disconnectDrive(); load() } }}>Putuskan</button>}
            {d.root_url && <a className="btn" href={d.root_url} target="_blank" rel="noreferrer">Buka folder di Drive</a>}
          </div>
        </div>
        <div className="mt-3 bg-gray-50 rounded-lg px-3 py-2"><b>Struktur folder:</b> <span className="font-mono">{d.structure}</span>
          <div className="text-muted mt-0.5">Tab = Karyawan, Cuti & Izin, Tugas, Proyek · Tahun = tahun file diunggah · File lokal tetap disimpan di server; menghapus file di aplikasi tidak menghapus salinan di Drive.</div></div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="border border-line rounded-lg p-3"><div className="text-muted">Sudah di Drive</div><div className="text-2xl font-extrabold text-ok">{total.synced}</div></div>
        <div className="border border-line rounded-lg p-3"><div className="text-muted">Menunggu</div><div className="text-2xl font-extrabold">{total.pending}</div></div>
        <div className="border border-line rounded-lg p-3"><div className="text-muted">Gagal</div><div className={`text-2xl font-extrabold ${total.failed ? 'text-brand' : ''}`}>{total.failed}</div></div>
      </div>

      <div className="border border-line rounded-lg overflow-auto">
        <table className="w-full"><thead><tr>{['Tab', 'Menunggu', 'Di Drive', 'Gagal'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>{d.counts.map((c) => <tr key={c.tab}><td className="td font-semibold">{c.tab}</td><td className="td">{c.pending}</td><td className="td">{c.synced}</td><td className="td">{c.failed ? <b className="text-brand">{c.failed}</b> : 0}</td></tr>)}</tbody></table>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button className="btn-primary" disabled={busy || !d.connected} onClick={() => run(syncDriveNow, (r) => `Sinkronisasi selesai: ${r.synced} berhasil, ${r.failed} gagal`)}>{busy ? 'Memproses…' : 'Sinkronkan Sekarang'}</button>
        <button className="btn" disabled={busy || !d.connected || !total.failed} onClick={() => run(retryDriveFailed, (r) => `${r.requeued} file dikembalikan ke antrean`)}>Ulangi yang Gagal</button>
        <span className="text-muted">Berjalan otomatis tiap menit. {d.last_run.at && !d.last_run.at.startsWith('0001') ? `Terakhir: ${dt(d.last_run.at)} · ${d.last_run.synced} berhasil, ${d.last_run.failed} gagal${d.last_run.error ? ' · ' + d.last_run.error : ''}` : ''}</span>
      </div>

      {d.failures.length > 0 && (
        <div>
          <div className="font-bold mb-1.5">File gagal diunggah <span className="font-normal text-muted">(dicoba ulang otomatis dengan jeda bertahap)</span></div>
          <div className="border border-line rounded-lg overflow-auto"><table className="w-full"><thead><tr>{['Tab', 'File', 'Percobaan', 'Kesalahan'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>{d.failures.map((f) => <tr key={f.tab + f.id}><td className="td">{f.tab}</td><td className="td">{f.file_name}</td><td className="td">{f.attempts}</td><td className="td text-brand">{f.error}</td></tr>)}</tbody></table></div>
        </div>
      )}
    </div>
  )
}

function Users() {
  const me = useAuthStore((s) => s.user)
  const { businesses } = useBusinessStore()
  const [users, setUsers] = useState<AppUser[]>([])
  const [emps, setEmps] = useState<Employee[]>([])
  const [edit, setEdit] = useState<any>(null)
  const [error, setError] = useState('')

  const load = () => { getUsers().then((r) => setUsers(r.data)); getEmployees({ page_size: 1000 }).then((r) => setEmps(r.data.data ?? [])) }
  useEffect(load, [])

  const withoutAccount = emps.filter((e) => !users.some((u) => u.employee_id === e.id))
  const openNew = () => { setError(''); setEdit({ email: '', name: '', password: '', role: 'employee', employee_id: 0, business_ids: [] }) }
  const openEdit = (u: AppUser) => { setError(''); setEdit({ id: u.id, email: u.email, name: u.name, password: '', role: u.role, is_active: u.is_active, business_ids: u.businesses.map((b) => b.id), self: u.id === me?.id }) }

  const pickEmployee = (id: number) => {
    const e = emps.find((x) => x.id === id)
    setEdit((x: any) => ({ ...x, employee_id: id, name: e?.name ?? x.name, email: x.email || e?.email || '', business_ids: e ? [e.business_id] : x.business_ids }))
  }
  const toggleBiz = (id: number) => setEdit((x: any) => ({ ...x, business_ids: x.business_ids.includes(id) ? x.business_ids.filter((b: number) => b !== id) : [...x.business_ids, id] }))

  const save = async () => {
    setError('')
    try {
      if (edit.id) await updateUser(edit.id, { name: edit.name, role: edit.role, is_active: edit.is_active, business_ids: edit.business_ids, password: edit.password || undefined })
      else await createUser({ ...edit, employee_id: edit.employee_id || null })
      setEdit(null); load()
    } catch (e: any) { setError(e.response?.data?.error || 'Gagal menyimpan') }
  }
  const groupLevel = edit && ['super_admin', 'hr_admin'].includes(edit.role)

  return (
    <>
      <DataTable data={users} rowKey={(u) => u.id} searchPlaceholder="Cari nama, email, role…"
        searchText={(u) => `${u.name} ${u.email} ${u.role} ${u.employee_name}`}
        actions={<button className="btn-primary" onClick={openNew}><Plus className="w-3.5 h-3.5 inline mr-1" />User</button>}
        columns={[
          { head: 'Nama', render: (u) => <b>{u.name}</b> },
          { head: 'Email', render: (u) => u.email },
          { head: 'Role', render: (u) => <Badge tone={roleTone[u.role]}>{ROLES.find((r) => r.id === u.role)?.label}</Badge> },
          { head: 'Karyawan', render: (u) => u.employee_name || '-' },
          { head: 'Akses Bisnis', render: (u) => ['super_admin', 'hr_admin'].includes(u.role) ? <span className="text-muted">Semua bisnis</span> : u.businesses.map((b) => b.code).join(', ') || '-' },
          { head: 'Status', render: (u) => u.is_active ? <Badge tone="green">Aktif</Badge> : <Badge>Nonaktif</Badge> },
          { head: 'Aksi', render: (u) => <button className="btn" onClick={() => openEdit(u)}>Edit</button> },
        ]} />

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Ubah User' : 'Tambah User'}>
        {edit && (
          <div className="space-y-3 text-xs">
            {!edit.id && (
              <label className="block font-semibold">Hubungkan ke karyawan <span className="font-normal text-muted">(opsional; wajib agar bisa mengajukan cuti)</span>
                <select className="input w-full mt-1" value={edit.employee_id || ''} onChange={(e) => pickEmployee(Number(e.target.value))}>
                  <option value="">— Tidak (akun admin saja) —</option>{withoutAccount.map((e) => <option key={e.id} value={e.id}>{e.name}{e.position ? ` — ${e.position.title}` : ''}</option>)}
                </select></label>
            )}
            <label className="block font-semibold">Nama<input className="input w-full mt-1" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
            <label className="block font-semibold">Email (login)<input className="input w-full mt-1 disabled:bg-gray-100" disabled={!!edit.id} value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></label>
            <label className="block font-semibold">{edit.id ? 'Reset password (kosongkan jika tidak diubah)' : 'Password'}<div className="mt-1 font-normal"><PasswordInput autoComplete="new-password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} placeholder="minimal 6 karakter" /></div></label>
            <label className="block font-semibold">Role
              <select className="input w-full mt-1" disabled={edit.self} value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>{ROLES.map((r) => <option key={r.id} value={r.id}>{r.label} — {r.hint}</option>)}</select></label>
            {groupLevel ? <p className="text-muted">Role ini otomatis dapat mengakses semua bisnis.</p> : (
              <div><div className="font-semibold mb-1">Akses bisnis</div>
                <div className="grid grid-cols-2 gap-1">{businesses.map((b) => <label key={b.id} className="flex items-center gap-2"><input type="checkbox" checked={edit.business_ids.includes(b.id)} onChange={() => toggleBiz(b.id)} />{b.name}</label>)}</div></div>
            )}
            {edit.id && <label className="flex items-center gap-2 font-semibold"><input type="checkbox" disabled={edit.self} checked={edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} />Akun aktif</label>}
            {error && <div className="text-brand bg-brand-soft rounded-lg px-3 py-2">{error}</div>}
            <div className="flex justify-end gap-2"><button className="btn" onClick={() => setEdit(null)}>Batal</button><button className="btn-primary" onClick={save}>Simpan</button></div>
          </div>
        )}
      </Modal>
    </>
  )
}

function LeaveTypes() {
  const [types, setTypes] = useState<LeaveType[]>([])
  const [edit, setEdit] = useState<Partial<LeaveType> | null>(null)
  const [error, setError] = useState('')
  const load = () => getLeaveTypes().then((r) => setTypes(r.data))
  useEffect(() => { load() }, [])
  const save = async () => {
    try { await saveLeaveType(edit!); setEdit(null); load() } catch (e: any) { setError(e.response?.data?.error || 'Gagal menyimpan') }
  }
  return (
    <>
      <div className="text-xs text-muted mb-3">Master data jenis cuti & izin. “Potong saldo” = jenis yang mengurangi saldo cuti tahunan.</div>
      <DataTable data={types} rowKey={(t) => t.id} searchText={(t) => `${t.name} ${t.category}`} searchPlaceholder="Cari jenis…"
        actions={<button className="btn-primary" onClick={() => { setError(''); setEdit({ name: '', category: 'izin', default_days: 0, deducts_balance: false, requires_attachment: false, is_active: true }) }}><Plus className="w-3.5 h-3.5 inline mr-1" />Jenis</button>}
        columns={[
          { head: 'Nama', render: (t) => <b>{t.name}</b> },
          { head: 'Kategori', render: (t) => <Badge tone="blue">{t.category}</Badge> },
          { head: 'Jatah Default / Tahun', render: (t) => t.deducts_balance ? `${t.default_days} hari` : '-' },
          { head: 'Potong Saldo', render: (t) => t.deducts_balance ? <Badge tone="amber">Ya</Badge> : 'Tidak' },
          { head: 'Wajib Lampiran', render: (t) => t.requires_attachment ? <Badge tone="purple">Ya</Badge> : 'Tidak' },
          { head: 'Status', render: (t) => t.is_active ? <Badge tone="green">Aktif</Badge> : <Badge>Nonaktif</Badge> },
          { head: 'Aksi', render: (t) => <button className="btn" onClick={() => { setError(''); setEdit(t) }}>Edit</button> },
        ]} />
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Ubah Jenis' : 'Tambah Jenis'}>
        {edit && (
          <div className="space-y-3 text-xs">
            <label className="block font-semibold">Nama<input className="input w-full mt-1" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
            <label className="block font-semibold">Kategori<select className="input w-full mt-1" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value as LeaveType['category'] })}><option value="cuti">cuti</option><option value="izin">izin</option><option value="sakit">sakit</option></select></label>
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={!!edit.deducts_balance} onChange={(e) => setEdit({ ...edit, deducts_balance: e.target.checked })} />Potong saldo cuti tahunan</label>
            {edit.deducts_balance && <label className="block font-semibold">Jatah default per tahun (hari)<input className="input w-full mt-1" type="number" min={0} value={edit.default_days ?? 0} onChange={(e) => setEdit({ ...edit, default_days: Number(e.target.value) })} /></label>}
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={!!edit.requires_attachment} onChange={(e) => setEdit({ ...edit, requires_attachment: e.target.checked })} />Wajib melampirkan dokumen (mis. surat dokter)</label>
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={!!edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} />Aktif</label>
            {error && <div className="text-brand bg-brand-soft rounded-lg px-3 py-2">{error}</div>}
            <div className="flex justify-end gap-2"><button className="btn" onClick={() => setEdit(null)}>Batal</button><button className="btn-primary" onClick={save}>Simpan</button></div>
          </div>
        )}
      </Modal>
    </>
  )
}

function Workflow() {
  const Step = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
    <div className="flex gap-3"><div className="w-6 h-6 rounded-full bg-brand text-white text-xs font-bold grid place-items-center shrink-0">{n}</div><div><div className="font-bold">{title}</div><div className="text-muted">{children}</div></div></div>
  )
  return (
    <div className="text-xs space-y-4 max-w-2xl">
      <p className="text-muted">Aturan persetujuan yang berlaku untuk Cuti & Izin (dan modul lain yang memakai approval: absensi manual, tugas, perubahan data karyawan, roster).</p>
      <Step n={1} title="Default: atasan langsung (n+1)">Pengajuan masuk ke atasan langsung pemohon, dari garis “Melapor ke” pada jabatan. Jabatan atasan yang kosong (vacant) dilewati ke atas.</Step>
      <Step n={2} title="Bisa ditugaskan ke approver lain">Saat mengajukan, pemohon/HR dapat memilih approver tertentu. Jika approver yang ditugaskan menyetujui, atasan n+1 <b className="text-gray-800">tidak perlu</b> menyetujui lagi.</Step>
      <Step n={3} title="Cadangan otomatis">Bila atasan tidak ada atau belum punya akun, pengajuan diarahkan ke HR Admin (lalu Super Admin) agar tidak menggantung.</Step>
      <Step n={4} title="Hasil">Disetujui → saldo cuti terpotong. Ditolak (alasan wajib) / dibatalkan pemohon → saldo yang dicadangkan dikembalikan.</Step>
    </div>
  )
}

function Audit() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  useEffect(() => setPage(1), [q, pageSize])
  useEffect(() => { const t = setTimeout(() => getAudit({ q: q || undefined, page, page_size: pageSize }).then((r) => { setRows(r.data.data); setTotal(r.data.total) }), 200); return () => clearTimeout(t) }, [q, page, pageSize])
  return (
    <>
      <input className="input w-64 mb-3" placeholder="Cari user, aksi, entitas…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="border border-line rounded-lg overflow-auto">
        <table className="w-full"><thead><tr>{['Waktu', 'User', 'Aksi', 'Entitas', 'ID'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>{rows.map((a) => <tr key={a.id}><td className="td">{dt(a.created_at)}</td><td className="td">{a.user_name || '-'}</td><td className="td"><Badge tone="blue">{a.action}</Badge></td><td className="td">{a.entity}</td><td className="td">{a.entity_id}</td></tr>)}
            {!rows.length && <tr><td className="td text-center text-muted" colSpan={5}>Belum ada aktivitas</td></tr>}</tbody></table>
      </div>
      <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={setPageSize} />
    </>
  )
}

// How the final employee score is composed + what counts as Good / Attention / Critical
function KpiPanel() {
  const [f, setF] = useState<KpiSettings | null>(null)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { getKpiSettings().then((r) => setF(r.data)) }, [])
  if (!f) return <p className="text-xs text-muted">Memuat…</p>
  const sum = (f.weight_kpi || 0) + (f.weight_task || 0) + (f.weight_attendance || 0)
  const num = (k: keyof KpiSettings, v: string) => setF({ ...f, [k]: v === '' ? 0 : Number(v) })
  const save = async () => {
    setMsg(''); setError('')
    try { const r = await saveKpiSettings(f); setF(r.data); setMsg('Pengaturan KPI tersimpan') } catch (e: any) { setError(e.response?.data?.error || 'Gagal menyimpan') }
  }
  const Field = ({ label, k, hint }: { label: string; k: keyof KpiSettings; hint?: string }) => (
    <label className="block font-semibold">{label}<input className="input w-full mt-1" type="number" min={0} step="any" value={f[k]} onChange={(e) => num(k, e.target.value)} />{hint && <span className="font-normal text-muted">{hint}</span>}</label>
  )
  return (
    <div className="text-xs max-w-2xl space-y-4">
      <p className="text-muted">Skor akhir karyawan = KPI + penyelesaian tugas + absensi. Komponen yang belum punya data pada suatu periode tidak dihitung dan bobotnya disesuaikan otomatis.</p>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Bobot KPI (%)" k="weight_kpi" /><Field label="Bobot Tugas (%)" k="weight_task" /><Field label="Bobot Absensi (%)" k="weight_attendance" />
      </div>
      <div>Total bobot: <b className={Math.abs(sum - 100) < 0.01 ? 'text-ok' : 'text-brand'}>{Math.round(sum * 100) / 100}%</b>{Math.abs(sum - 100) >= 0.01 && <span className="text-brand"> — harus 100%</span>}</div>
      <div className="grid grid-cols-3 gap-3 border-t border-line pt-3">
        <Field label="Batas Good (≥)" k="good_min" hint="skor di atas ini = Good" /><Field label="Batas Attention (≥)" k="attention_min" hint="di bawahnya = Critical" /><Field label="Target Company KPI (%)" k="company_target" />
      </div>
      {error && <div className="text-brand bg-brand-soft rounded-lg px-3 py-2">{error}</div>}
      <div className="flex items-center gap-3"><button className="btn-primary" onClick={save}>Simpan</button>{msg && <span className="text-ok">{msg}</span>}</div>
    </div>
  )
}

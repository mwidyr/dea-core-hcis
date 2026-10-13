import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Save } from 'lucide-react'
import Layout from '../components/Layout/Layout'
import Tabs from '../components/ui/Tabs'
import Badge from '../components/ui/Badge'
import CompetencyTab from '../components/employee/CompetencyTab'
import ContractHistory from '../components/employee/ContractHistory'
import DocumentsTab from '../components/employee/DocumentsTab'
import Placements from '../components/employee/Placements'
import { useAuthStore } from '../store/auth'
import { useBusinessStore } from '../store/business'
import { getEmployee, getLocations, getPositions, getWorkCalendars, saveEmployee, setEmployeeStatus } from '../services/api'
import { day, errMsg, fmtLong, iso, tenure } from '../utils/format'
import type { Employee, Location, Position, WorkCalendar } from '../types'

type TabId = 'personal' | 'competency' | 'docs'
const STATUSES = ['Aktif', 'Non aktif', 'Suspend', 'Tidak Bekerja'] as const
const STATUS_HINT: Record<string, string> = {
  Aktif: 'Karyawan aktif: dihitung di dashboard, bisa login dan absen.',
  'Non aktif': 'Tetap bisa login, tetapi tidak dihitung sebagai karyawan aktif dan tidak bisa absen.',
  Suspend: 'Tidak bisa login dan tidak bisa absen.',
  'Tidak Bekerja': 'Tidak bisa login dan tidak bisa absen. Riwayat data tetap tersimpan.',
}

const L = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="block font-semibold">{label}<div className="mt-1 font-normal">{children}</div></label>
const Section = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <section className="card p-4 mb-3 text-xs">
    <div className="mb-3"><h3 className="text-[13px] font-extrabold">{title}</h3>{hint && <p className="text-muted mt-0.5">{hint}</p>}</div>
    {children}
  </section>
)

// Full-page employee form: Data Personal | Kompetensi History | Foto & Dokumen.
export default function EmployeeDetail() {
  const { id } = useParams()
  const empId = Number(id) || 0
  const nav = useNavigate()
  const { businessId, businesses } = useBusinessStore()
  const canEdit = useAuthStore((s) => s.can)('employees.manage')

  const [tab, setTab] = useState<TabId>('personal')
  const [emp, setEmp] = useState<Employee | null>(null)
  const [form, setForm] = useState<Partial<Employee>>({ business_id: businessId || 0, employee_type: 'Tetap', name: '' })
  const [first, setFirst] = useState({ start: '', end: '' }) // first contract of a NEW Kontrak / Freelance employee
  const [positions, setPositions] = useState<Position[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [calendars, setCalendars] = useState<WorkCalendar[]>([])
  const [statusDraft, setStatusDraft] = useState({ status: 'Aktif', note: '' })
  const [loading, setLoading] = useState(!!empId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const editing = empId > 0
  const set = (k: keyof Employee, v: any) => setForm((f) => ({ ...f, [k]: v }))

  const load = () => getEmployee(empId).then((r) => {
    const e = r.data
    setEmp(e)
    setForm({ ...e, position: undefined, unit: undefined, location: undefined, business: undefined, placements: undefined, contracts: undefined })
    setStatusDraft({ status: e.status, note: e.status_note ?? '' })
  }).catch(() => setError('Karyawan tidak ditemukan')).finally(() => setLoading(false))
  useEffect(() => { if (empId) load() }, [empId])

  const bizId = form.business_id
  useEffect(() => {
    if (!bizId) { setPositions([]); setLocations([]); setCalendars([]); return }
    getPositions({ business_id: bizId }).then((r) => setPositions(r.data))
    getLocations({ business_id: bizId }).then((r) => setLocations(r.data))
    getWorkCalendars({ business_id: bizId }).then((r) => setCalendars(r.data.data.filter((c) => c.is_active)))
  }, [bizId])

  const submit = async () => {
    setError(''); setNotice('')
    if (!form.name?.trim()) return setError('Nama wajib diisi')
    if (!form.business_id) return setError('Pilih bisnis terlebih dahulu')
    const needsFirst = !editing && (form.employee_type === 'Kontrak' || form.employee_type === 'Freelance') && first.start
    if (needsFirst && first.end && first.end < first.start) return setError('Tanggal berakhir tidak boleh sebelum tanggal mulai')
    setBusy(true)
    try {
      const payload: Partial<Employee> = { ...form, birth_date: iso(day(form.birth_date)), join_date: iso(day(form.join_date)) }
      delete payload.contract_start; delete payload.contract_end; delete payload.doh; delete payload.contract_count
      if (needsFirst) { payload.contract_start = iso(first.start); payload.contract_end = iso(first.end) }
      const { data: saved } = await saveEmployee(payload)
      if (!editing) nav(`/employees/${saved.id}`, { replace: true, state: { created: true } })
      else { await load(); setNotice('Data karyawan tersimpan.') }
    } catch (e: any) { setError(errMsg(e, 'Gagal menyimpan')) } finally { setBusy(false) }
  }

  const saveStatus = async () => {
    setError(''); setNotice('')
    try { await setEmployeeStatus(empId, statusDraft.status, statusDraft.note); await load(); setNotice('Status tersimpan.') } catch (e: any) { setError(errMsg(e, 'Gagal mengubah status')) }
  }

  const bizLocked = editing || businessId !== 0
  const isContract = form.employee_type === 'Kontrak' || form.employee_type === 'Freelance'
  const title = editing ? (emp?.name ?? 'Karyawan') : 'Tambah Karyawan'
  const back = <button className="btn" onClick={() => nav('/employees')}><ArrowLeft className="w-3.5 h-3.5 inline mr-1" />Daftar Karyawan</button>

  if (!canEdit) return <Layout title="Karyawan" actions={back}><div className="card p-8 text-center text-sm text-muted">Anda tidak memiliki izin untuk mengelola data karyawan.</div></Layout>
  if (loading) return <Layout title="Karyawan" actions={back}><div className="card p-8 text-center text-sm text-muted">Memuat…</div></Layout>
  if (editing && !emp) return <Layout title="Karyawan" actions={back}><div className="card p-8 text-center text-sm text-danger">{error || 'Karyawan tidak ditemukan'}</div></Layout>

  const tabs: { id: TabId; label: string }[] = editing
    ? [{ id: 'personal', label: 'Data Personal' }, { id: 'competency', label: 'Kompetensi History' }, { id: 'docs', label: 'Foto & Dokumen' }]
    : [{ id: 'personal', label: 'Data Personal' }]
  const bizPositions = positions.filter((p) => p.business_id === form.business_id)

  return (
    <Layout title={title} subtitle={editing ? `${emp?.nik ?? ''}${emp?.business ? ` · ${emp.business.name}` : ''}` : 'Isi data personal lalu simpan; kompetensi dan dokumen bisa diisi setelahnya'} actions={back}>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'personal' && <>
        <Section title="Data Personal">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <L label="Nama Lengkap"><input className="input w-full" value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} /></L>
            <L label="NIK (login absen)"><input className="input w-full" value={form.nik ?? ''} onChange={(e) => set('nik', e.target.value)} placeholder={editing ? '' : 'otomatis jika kosong'} /></L>
            <L label="Telepon"><input className="input w-full" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></L>
            <L label="Email"><input className="input w-full" type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} /></L>
            <L label="Tempat Lahir"><input className="input w-full" value={form.birth_place ?? ''} onChange={(e) => set('birth_place', e.target.value)} /></L>
            <L label="Tanggal Lahir"><input className="input w-full" type="date" value={day(form.birth_date)} onChange={(e) => set('birth_date', e.target.value)} /></L>
          </div>
        </Section>

        <Section title="Kepegawaian">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <L label={bizLocked ? 'Bisnis (terkunci)' : 'Bisnis'}>
              <select className="input w-full disabled:bg-tint" disabled={bizLocked} value={form.business_id || ''}
                onChange={(e) => setForm({ ...form, business_id: Number(e.target.value), position_id: null, location_id: null, work_calendar_id: null, manager_id: null })}>
                <option value="">— Pilih bisnis —</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </L>
            <L label="Jenis Karyawan">
              <select className="input w-full" value={form.employee_type} onChange={(e) => set('employee_type', e.target.value)}><option>Tetap</option><option>Kontrak</option><option>Freelance</option></select>
            </L>
            <L label="Jabatan">
              <select className="input w-full" disabled={!form.business_id} value={form.position_id ?? ''} onChange={(e) => setForm({ ...form, position_id: e.target.value ? Number(e.target.value) : null, manager_id: null })}>
                <option value="">{form.business_id ? '—' : 'Pilih bisnis dulu'}</option>{bizPositions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </L>
            {emp?.roster ? (
              <>
                <L label="Lokasi (mengikuti roster)">
                  <input className="input w-full bg-tint" disabled value={emp.roster.location_name || 'Belum diatur di roster'} />
                </L>
                <L label="Kalender Kerja (mengikuti roster)">
                  <input className="input w-full bg-tint" disabled value={`Roster: ${emp.roster.name} · ${emp.roster.start_time}–${emp.roster.end_time}`} />
                  <p className="text-muted mt-1">{emp.roster.pattern}. Karyawan hanya dapat berada di satu roster; ubah di Setup Waktu Kerja, Roster.</p>
                </L>
              </>
            ) : (
              <>
                <L label="Lokasi">
                  <select className="input w-full" disabled={!form.business_id} value={form.location_id ?? ''} onChange={(e) => set('location_id', e.target.value ? Number(e.target.value) : null)}>
                    <option value="">—</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </L>
                <L label="Kalender Kerja">
                  <select className="input w-full" disabled={!form.business_id} value={form.work_calendar_id ?? ''} onChange={(e) => set('work_calendar_id', e.target.value ? Number(e.target.value) : null)}>
                    <option value="">— Default bisnis —</option>{calendars.map((c) => <option key={c.id} value={c.id}>{c.name}{c.is_default ? ' (default)' : ''}</option>)}
                  </select>
                </L>
              </>
            )}
          </div>
          {!editing && isContract && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <L label="Kontrak pertama: mulai"><input className="input w-full" type="date" value={first.start} onChange={(e) => setFirst({ ...first, start: e.target.value })} /></L>
              <L label="Kontrak pertama: berakhir"><input className="input w-full" type="date" value={first.end} onChange={(e) => setFirst({ ...first, end: e.target.value })} /></L>
            </div>
          )}
          {editing && (
            <div className="mt-4 border-t border-line pt-3">
              <div className="flex items-center gap-2 mb-2"><span className="font-bold">Status karyawan</span><Badge tone={({ Aktif: 'green', 'Non aktif': 'blue', Suspend: 'amber', 'Tidak Bekerja': 'gray' } as const)[emp!.status] ?? 'gray'}>{emp!.status}</Badge><span className="text-muted">diatur manual, tidak mengikuti tanggal kontrak</span></div>
              <div className="flex flex-wrap gap-2 mb-2">
                {STATUSES.map((s) => (
                  <button key={s} type="button" onClick={() => setStatusDraft({ ...statusDraft, status: s })}
                    className={`border rounded-lg px-3 py-1.5 font-semibold ${statusDraft.status === s ? 'border-brand bg-brand-soft text-brand' : 'border-line hover:bg-sunken'}`}>{s}</button>
                ))}
              </div>
              <p className="text-muted mb-2">{STATUS_HINT[statusDraft.status]}</p>
              <div className="flex gap-2">
                <input className="input flex-1" placeholder="Catatan / alasan (opsional)" value={statusDraft.note} onChange={(e) => setStatusDraft({ ...statusDraft, note: e.target.value })} />
                <button type="button" className="btn-primary" disabled={statusDraft.status === emp!.status && statusDraft.note === (emp!.status_note ?? '')} onClick={saveStatus}>Simpan Status</button>
              </div>
            </div>
          )}
        </Section>

        <Section title="DOH & POH" hint="DOH (Date of Hire) adalah hari pertama bekerja dan tidak berubah saat kontrak diperpanjang. POH (Place of Hire) adalah tempat karyawan direkrut.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <L label="DOH — Tanggal Masuk Pertama"><input className="input w-full" type="date" value={day(form.join_date)} onChange={(e) => set('join_date', e.target.value)} /></L>
            <L label="POH — Lokasi Perekrutan"><input className="input w-full" value={form.place_of_hire ?? ''} onChange={(e) => set('place_of_hire', e.target.value)} placeholder="mis. Jakarta" /></L>
          </div>
          {editing && emp && (
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-muted">
              <span>DOH: <b className="text-ink">{fmtLong(emp.doh)}</b></span>
              <span>Masa kerja sejak DOH: <b className="text-ink">{tenure(emp.doh)}</b></span>
              <span>Jumlah kontrak: <b className="text-ink">{emp.contract_count ?? 0}x</b></span>
            </div>
          )}
        </Section>

        {editing && <>
          <Section title="Histori Kontrak" hint="Satu karyawan bisa memiliki banyak kontrak. Dokumen tiap kontrak bisa ditambahkan lebih dari satu.">
            <ContractHistory empId={empId} canEdit onChanged={load} />
          </Section>
          <Section title="Penempatan Tambahan" hint="Bisnis lain tempat karyawan juga bekerja; satu jabatan per bisnis.">
            <Placements empId={empId} primaryBusinessId={form.business_id!} businesses={businesses} />
          </Section>
        </>}

        {error && <div className="text-danger bg-danger-soft rounded-lg px-3 py-2 mb-3 text-xs">{error}</div>}
        {notice && <div className="text-ok bg-ok-soft rounded-lg px-3 py-2 mb-3 text-xs">{notice}</div>}
        <div className="sticky bottom-0 -mx-1 px-1 py-3 bg-surface/95 backdrop-blur flex justify-end gap-2">
          <button className="btn" onClick={() => nav('/employees')}>{editing ? 'Tutup' : 'Batal'}</button>
          <button className="btn-primary" disabled={busy} onClick={submit}><Save className="w-3.5 h-3.5 inline mr-1" />{busy ? 'Menyimpan…' : editing ? 'Simpan Perubahan' : 'Simpan Karyawan'}</button>
        </div>
      </>}

      {tab === 'competency' && editing && <div className="card p-4"><CompetencyTab empId={empId} canEdit /></div>}
      {tab === 'docs' && editing && <div className="card p-4"><DocumentsTab empId={empId} canEdit onChanged={load} /></div>}
    </Layout>
  )
}

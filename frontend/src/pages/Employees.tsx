import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Trash2, X } from 'lucide-react'
import Layout from '../components/Layout/Layout'
import Badge from '../components/ui/Badge'
import Modal from '../components/ui/Modal'
import StatCard from '../components/ui/StatCard'
import Pagination from '../components/ui/Pagination'
import FileThumbs from '../components/ui/FileThumbs'
import { useAuthStore } from '../store/auth'
import { bizParams, useBusinessStore } from '../store/business'
import {
  getWorkCalendars, addPlacement, removePlacement, deleteEmployee, deleteEmployeeDocument, fetchEmployeeDocumentBlob, getEmployee, getEmployeeDocuments, getEmployees,
  getLocations, getPositions, saveEmployee, setEmployeeStatus, uploadEmployeeDocument,
} from '../services/api'
import type { Employee, EmployeeDocument, Location, Position, WorkCalendar } from '../types'

const STATUSES = ['Aktif', 'Suspend', 'Tidak Bekerja'] as const
const statusTone = { Aktif: 'green', Suspend: 'amber', 'Tidak Bekerja': 'gray' } as const
const DOC_SUGGESTIONS = ['Foto KTP', 'Foto KK', 'Foto NPWP', 'Foto Ijazah', 'Foto Lain-lain']
const MAX_FILE = 10 * 1024 * 1024

const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '-')
const day = (d?: string | null) => (d ? d.slice(0, 10) : '') // "2020-06-01T07:00:00+07:00" → "2020-06-01"
const iso = (d?: string | null) => (d ? `${d}T00:00:00+07:00` : null) // date input → Go time.Time
const tenure = (d: string | null) => {
  if (!d) return '-'
  const m = Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / (30.44 * 864e5)))
  return `${Math.floor(m / 12)} th ${m % 12} bln`
}
const daysLeft = (d: string | null) => (d ? Math.ceil((new Date(d).getTime() - Date.now()) / 864e5) : null)
const errMsg = (e: any, fallback: string) => e.response?.data?.error || fallback

type DocRow = { key: number; label: string; file: File | null }
let rowSeq = 0
const newRow = (): DocRow => ({ key: ++rowSeq, label: '', file: null })

export default function Employees() {
  const { businessId, businesses } = useBusinessStore()
  const canEdit = useAuthStore((s) => s.can)('employees.manage')
  const [list, setList] = useState<Employee[]>([])
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [stats, setStats] = useState({ active: 0, tetap: 0, kontrak: 0, multi: 0, expiring: 0 })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [positions, setPositions] = useState<Position[]>([])
  const [locations, setLocations] = useState<Location[]>([])

  const [detail, setDetail] = useState<Employee | null>(null)
  const [managerName, setManagerName] = useState('-')
  const [form, setForm] = useState<Partial<Employee> | null>(null)
  const [params, setParams] = useSearchParams()
  const [statusEdit, setStatusEdit] = useState<{ emp: Employee; status: string; note: string } | null>(null)

  const load = () => {
    getEmployees({ ...bizParams(businessId), q: q || undefined, employee_type: type || undefined, status: status || undefined, page, page_size: pageSize }).then((r) => {
      setList(r.data.data ?? []); setTotal(r.data.total)
      if (r.data.stats) setStats(r.data.stats) // absent on an outdated backend — keep zeros instead of crashing
      const last = Math.max(1, Math.ceil(r.data.total / pageSize))
      if (page > last) setPage(last)
    })
  }
  useEffect(() => setPage(1), [businessId, q, type, status, pageSize])
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t) }, [businessId, q, type, status, page, pageSize])
  useEffect(() => { getPositions(bizParams(businessId)).then((r) => setPositions(r.data)); getLocations(bizParams(businessId)).then((r) => setLocations(r.data)) }, [businessId])

  // deep link from Kontrak & Dokumen: /employees?edit=<id> opens that employee's form
  useEffect(() => {
    const id = Number(params.get('edit'))
    if (!id || !canEdit) return
    getEmployee(id).then((r) => setForm({ ...r.data, position: undefined, unit: undefined, location: undefined, business: undefined, placements: undefined }))
    setParams({}, { replace: true })
  }, [])

  const openDetail = (e: Employee) => {
    setDetail(e); setManagerName('-')
    if (e.manager_id) getEmployee(e.manager_id).then((r) => setManagerName(r.data.name))
  }

  const remove = async (e: Employee) => {
    if (!confirm(`Hapus karyawan "${e.name}" permanen?\n\nAkun login dan semua foto/dokumennya ikut terhapus. Jika hanya berhenti bekerja, gunakan "Status → Tidak Bekerja" agar riwayat tetap ada.`)) return
    try { await deleteEmployee(e.id); load() } catch (err: any) { alert(errMsg(err, 'Gagal menghapus')) }
  }

  const saveStatus = async () => {
    if (!statusEdit) return
    try { await setEmployeeStatus(statusEdit.emp.id, statusEdit.status, statusEdit.note); setStatusEdit(null); load() } catch (err: any) { alert(errMsg(err, 'Gagal mengubah status')) }
  }

  const addNew = () => setForm({ business_id: businessId || 0, employee_type: 'Tetap', name: '' })

  return (
    <Layout title="Karyawan" subtitle="Employee Management 360">
      <div className="grid grid-cols-4 gap-3 mb-3">
        <StatCard label="Karyawan Aktif" value={stats.active} />
        <StatCard label="Tetap" value={stats.tetap} />
        <StatCard label="Kontrak" value={stats.kontrak} />
        <StatCard label="Kontrak ≤ 30 Hari · Multi Penempatan" value={`${stats.expiring} · ${stats.multi}`} />
      </div>
      <div className="card p-3">
        <div className="flex flex-wrap gap-2 mb-3">
          <input className="input w-64" placeholder="Cari nama, email, jabatan…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}><option value="">Semua Jenis</option><option>Tetap</option><option>Kontrak</option></select>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Semua Status</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
          {canEdit && <button className="btn-primary ml-auto" onClick={addNew}><Plus className="w-3.5 h-3.5 inline mr-1" />Karyawan</button>}
        </div>
        <div className="border border-line rounded-lg overflow-auto">
          <table className="w-full">
            <thead><tr>{['Nama', 'Penempatan Utama', 'Jabatan', 'Lokasi', 'Masa Kerja', 'Kontrak', 'Penempatan Tambahan', 'Status', ''].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>
              {list.map((e) => {
                const dl = daysLeft(e.contract_end)
                const extra = e.placements?.filter((p) => !p.is_primary) ?? []
                return (
                  <tr key={e.id} className={e.status !== 'Aktif' ? 'bg-gray-50/70 text-gray-500' : ''}>
                    <td className="td"><b>{e.name}</b>{e.nik && <div className="text-muted text-[11px]">{e.nik}</div>}</td>
                    <td className="td">{e.business?.name}</td>
                    <td className="td">{e.position?.title ?? '-'}</td>
                    <td className="td">{e.location?.name ?? '-'}</td>
                    <td className="td">{tenure(e.join_date)}</td>
                    <td className="td">{e.contract_end ? <>PKWT · s.d. {fmt(e.contract_end)} <Badge tone={dl! <= 30 ? 'red' : 'amber'}>{dl} hari lagi</Badge></> : <Badge tone="green">{e.employee_type}</Badge>}</td>
                    <td className="td">{extra.length ? extra.map((p) => `${p.business?.name} — ${p.position?.title}`).join(', ') : '—'}</td>
                    <td className="td"><Badge tone={statusTone[e.status] ?? 'gray'}>{e.status}</Badge></td>
                    <td className="td whitespace-nowrap">
                      <button className="btn mr-1" onClick={() => openDetail(e)}>Detail</button>
                      {canEdit && <>
                        <button className="btn mr-1" onClick={() => setForm({ ...e, position: undefined, unit: undefined, location: undefined, business: undefined, placements: undefined })}>Edit</button>
                        <button className="btn mr-1" onClick={() => setStatusEdit({ emp: e, status: e.status, note: e.status_note ?? '' })}>Status</button>
                        <button className="btn text-brand" title="Hapus" onClick={() => remove(e)}><Trash2 className="w-3.5 h-3.5" /></button>
                      </>}
                    </td>
                  </tr>
                )
              })}
              {!list.length && <tr><td className="td text-center text-muted" colSpan={9}>Tidak ada karyawan</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={setPageSize} />
      </div>

      {/* ---- detail ---- */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.name ?? ''}>
        {detail && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-xs">
              {[['Bisnis', detail.business?.name], ['Unit', detail.unit?.name], ['Jabatan', detail.position?.title], ['Lokasi', detail.location?.name],
                ['NIK', detail.nik], ['Email', detail.email], ['Telepon', detail.phone], ['Tempat, Tgl Lahir', detail.birth_place || detail.birth_date ? `${detail.birth_place || '-'}, ${fmt(detail.birth_date)}` : '-'],
                ['Jenis', detail.employee_type], ['Tanggal Masuk', fmt(detail.join_date)], ['Kontrak Berakhir', fmt(detail.contract_end)],
                ['Atasan (n+1)', managerName], ['Penempatan', detail.placements?.length ? detail.placements.map((p) => `${p.business?.name}: ${p.position?.title}${p.is_primary ? ' (utama)' : ''}`).join(' · ') : '-'], ['Status', detail.status + (detail.status_note ? ` — ${detail.status_note}` : '')]].map(([k, v]) => (
                <div key={k as string}><dt className="text-muted text-[10.5px]">{k}</dt><dd className="font-semibold">{v || '-'}</dd></div>
              ))}
            </dl>
            {canEdit && <div><div className="text-[11px] font-bold mb-2">Foto & Dokumen</div><DocGallery empId={detail.id} /></div>}
          </div>
        )}
      </Modal>

      {/* ---- status ---- */}
      <Modal open={!!statusEdit} onClose={() => setStatusEdit(null)} title={`Status — ${statusEdit?.emp.name ?? ''}`}>
        {statusEdit && (
          <div className="space-y-3 text-xs">
            <div className="flex gap-2">
              {STATUSES.map((s) => (
                <button key={s} onClick={() => setStatusEdit({ ...statusEdit, status: s })}
                  className={`flex-1 border rounded-lg py-2 font-semibold ${statusEdit.status === s ? 'border-brand bg-brand-soft text-brand' : 'border-line hover:bg-gray-50'}`}>{s}</button>
              ))}
            </div>
            <label className="block font-semibold">Catatan / alasan<textarea className="input w-full mt-1" rows={3} value={statusEdit.note} onChange={(e) => setStatusEdit({ ...statusEdit, note: e.target.value })} placeholder="mis. resign 30/09, suspend sampai investigasi selesai…" /></label>
            {statusEdit.status !== 'Aktif' && <p className="text-warn bg-warn-soft rounded-lg px-3 py-2">Karyawan dengan status ini tidak dapat login dan tidak dihitung sebagai karyawan aktif.</p>}
            <div className="flex justify-end gap-2"><button className="btn" onClick={() => setStatusEdit(null)}>Batal</button><button className="btn-primary" onClick={saveStatus}>Simpan</button></div>
          </div>
        )}
      </Modal>

      {form && <EmployeeForm form={form} setForm={setForm} businesses={businesses} positions={positions} locations={locations}
        lockedByHeader={businessId !== 0} onSaved={() => { setForm(null); load() }} onClose={() => setForm(null)} />}
    </Layout>
  )
}

// module-level on purpose: a component defined inside EmployeeForm would remount (and drop input focus) on every keystroke
const L = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="block font-semibold">{label}<div className="mt-1 font-normal">{children}</div></label>

function EmployeeForm({ form, setForm, businesses, positions, locations, lockedByHeader, onSaved, onClose }: {
  form: Partial<Employee>; setForm: (f: Partial<Employee>) => void; businesses: { id: number; name: string }[]
  positions: Position[]; locations: Location[]; lockedByHeader: boolean; onSaved: () => void; onClose: () => void
}) {
  const [rows, setRows] = useState<DocRow[]>([])
  const [existing, setExisting] = useState<EmployeeDocument[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [calendars, setCalendars] = useState<WorkCalendar[]>([])
  const editing = !!form.id
  const bizLocked = lockedByHeader || editing // header selection, or existing employee: business can't change
  const set = (k: keyof Employee, v: any) => setForm({ ...form, [k]: v })

  useEffect(() => { if (form.id) getEmployeeDocuments(form.id).then((r) => setExisting(r.data)) }, [form.id])
  useEffect(() => { if (form.business_id) getWorkCalendars({ business_id: form.business_id }).then((r) => setCalendars(r.data.data.filter((c) => c.is_active))); else setCalendars([]) }, [form.business_id])

  const bizPositions = positions.filter((p) => p.business_id === form.business_id)
  const bizLocations = locations.filter((l) => l.business_id === form.business_id)
  const patchRow = (key: number, p: Partial<DocRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)))

  const pickFile = (key: number, file: File | null) => {
    if (file && file.size > MAX_FILE) { setError(`"${file.name}" lebih dari 10 MB`); return }
    setError(''); patchRow(key, { file })
  }

  const submit = async () => {
    setError('')
    if (!form.name?.trim()) return setError('Nama wajib diisi')
    if (!form.business_id) return setError('Pilih bisnis terlebih dahulu')
    const filled = rows.filter((r) => r.label.trim() || r.file)
    for (const r of filled) {
      if (!r.label.trim()) return setError('Isi jenis foto (mis. Foto KTP) untuk setiap file')
      if (!r.file) return setError(`Pilih file untuk "${r.label}" atau hapus barisnya`)
    }
    setBusy(true)
    try {
      const payload = { ...form, birth_date: iso(day(form.birth_date)), join_date: iso(day(form.join_date)), contract_start: iso(day(form.contract_start)), contract_end: iso(day(form.contract_end)) }
      const { data: saved } = await saveEmployee(payload as Partial<Employee>)
      const failed: DocRow[] = []
      for (const r of filled) {
        try { await uploadEmployeeDocument(saved.id, r.label.trim(), r.file!) } catch (e: any) { failed.push({ ...r, label: r.label }); setError(errMsg(e, `Gagal upload "${r.label}"`)) }
      }
      if (failed.length) { // employee is saved; keep only the failed uploads so they can be retried
        setForm({ ...form, id: saved.id }); setRows(failed)
        setError(`Karyawan tersimpan, tetapi ${failed.length} file gagal diunggah. ${error}`)
        getEmployeeDocuments(saved.id).then((r) => setExisting(r.data))
      } else onSaved()
    } catch (e: any) { setError(errMsg(e, 'Gagal menyimpan')) } finally { setBusy(false) }
  }

  const delExisting = async (d: EmployeeDocument) => {
    if (!confirm(`Hapus "${d.label}"?`)) return
    await deleteEmployeeDocument(form.id!, d.id)
    setExisting((x) => x.filter((y) => y.id !== d.id))
  }

  return (
    <Modal open onClose={onClose} title={editing ? 'Ubah Karyawan' : 'Tambah Karyawan'}>
      <div className="space-y-3 text-xs">
        <L label={bizLocked ? 'Bisnis (terkunci)' : 'Bisnis'}>
          <select className="input w-full disabled:bg-gray-100" disabled={bizLocked} value={form.business_id || ''}
            onChange={(e) => setForm({ ...form, business_id: Number(e.target.value), position_id: null, location_id: null, manager_id: null })}>
            <option value="">— Pilih bisnis —</option>
            {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </L>

        <div className="grid grid-cols-2 gap-3">
          <L label="Nama Lengkap"><input className="input w-full" value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} /></L>
          <L label="NIK (login absen)"><input className="input w-full" value={form.nik ?? ''} onChange={(e) => set('nik', e.target.value)} placeholder={editing ? '' : 'otomatis jika kosong'} /></L>
          <L label="Telepon"><input className="input w-full" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></L>
          <L label="Email"><input className="input w-full" type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} /></L>
          <L label="Tempat Lahir"><input className="input w-full" value={form.birth_place ?? ''} onChange={(e) => set('birth_place', e.target.value)} /></L>
          <L label="Tanggal Lahir"><input className="input w-full" type="date" value={day(form.birth_date)} onChange={(e) => set('birth_date', e.target.value)} /></L>
          <L label="Tanggal Masuk"><input className="input w-full" type="date" value={day(form.join_date)} onChange={(e) => set('join_date', e.target.value)} /></L>
          <L label="Jabatan">
            <select className="input w-full" disabled={!form.business_id} value={form.position_id ?? ''} onChange={(e) => setForm({ ...form, position_id: e.target.value ? Number(e.target.value) : null, manager_id: null })}>
              <option value="">{form.business_id ? '—' : 'Pilih bisnis dulu'}</option>{bizPositions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </L>
          <L label="Lokasi">
            <select className="input w-full" disabled={!form.business_id} value={form.location_id ?? ''} onChange={(e) => set('location_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">—</option>{bizLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </L>
          <L label="Kalender Kerja">
            <select className="input w-full" disabled={!form.business_id} value={form.work_calendar_id ?? ''} onChange={(e) => set('work_calendar_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">— Default bisnis —</option>{calendars.map((c) => <option key={c.id} value={c.id}>{c.name}{c.is_default ? ' (default)' : ''}</option>)}
            </select>
          </L>
          <L label="Jenis Karyawan">
            <select className="input w-full" value={form.employee_type} onChange={(e) => set('employee_type', e.target.value)}><option>Tetap</option><option>Kontrak</option></select>
          </L>
        </div>
        {form.employee_type === 'Kontrak' && (
          <div className="grid grid-cols-2 gap-3">
            <L label="Kontrak Mulai"><input className="input w-full" type="date" value={day(form.contract_start)} onChange={(e) => set('contract_start', e.target.value)} /></L>
            <L label="Kontrak Berakhir"><input className="input w-full" type="date" value={day(form.contract_end)} onChange={(e) => set('contract_end', e.target.value)} /></L>
          </div>
        )}

        {editing && <Placements empId={form.id!} primaryBusinessId={form.business_id!} businesses={businesses} />}

        {/* ---- photos / documents: any number of (label, file) rows ---- */}
        <div className="border-t border-line pt-3">
          <div className="flex items-center justify-between mb-2">
            <div className="font-bold">Foto & Dokumen <span className="font-normal text-muted">(JPG/PNG/WEBP/PDF, maks 10 MB)</span></div>
            <button type="button" className="btn" onClick={() => setRows((r) => [...r, newRow()])}><Plus className="w-3 h-3 inline mr-1" />Tambah Foto</button>
          </div>
          <datalist id="doc-labels">{DOC_SUGGESTIONS.map((d) => <option key={d} value={d} />)}</datalist>

          {existing.length > 0 && <div className="mb-2"><DocGallery empId={form.id!} docs={existing} onDelete={delExisting} /></div>}

          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.key} className="flex gap-2 items-center">
                <input className="input w-44" list="doc-labels" placeholder="Foto apa? (mis. Foto KTP)" value={r.label} onChange={(e) => patchRow(r.key, { label: e.target.value })} />
                <input className="input flex-1 min-w-0 file:mr-2 file:border-0 file:bg-gray-100 file:rounded file:px-2 file:py-1" type="file" accept="image/*,application/pdf" onChange={(e) => pickFile(r.key, e.target.files?.[0] ?? null)} />
                <button type="button" className="btn !px-2" title="Hapus baris" onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))}><X className="w-3.5 h-3.5" /></button>
              </div>
            ))}
            {!rows.length && !existing.length && <p className="text-muted">Belum ada foto. Klik “Tambah Foto” untuk KTP, KK, atau lainnya — bisa ditambah sebanyak yang dibutuhkan.</p>}
          </div>
        </div>

        {error && <div className="text-brand bg-brand-soft rounded-lg px-3 py-2">{error}</div>}
        <div className="flex justify-end gap-2 pt-1"><button className="btn" onClick={onClose}>{editing && rows.length === 0 ? 'Tutup' : 'Batal'}</button><button className="btn-primary" disabled={busy} onClick={submit}>{busy ? 'Menyimpan…' : 'Simpan'}</button></div>
      </div>
    </Modal>
  )
}

// Thumbnails of an employee's uploaded documents.
function DocGallery({ empId, docs, onDelete }: { empId: number; docs?: EmployeeDocument[]; onDelete?: (d: EmployeeDocument) => void }) {
  const [own, setOwn] = useState<EmployeeDocument[]>([])
  useEffect(() => { if (!docs) getEmployeeDocuments(empId).then((r) => setOwn(r.data)) }, [empId, docs])
  const list = docs ?? own
  return <FileThumbs items={list} fetchBlob={(id) => fetchEmployeeDocumentBlob(empId, id).then((r) => r.data)} empty="Belum ada foto/dokumen." onDelete={onDelete ? (f) => onDelete(list.find((d) => d.id === f.id)!) : undefined} />
}

// Additional placements: an employee may work in several businesses, but holds ONE position per business.
function Placements({ empId, primaryBusinessId, businesses }: { empId: number; primaryBusinessId: number; businesses: { id: number; name: string }[] }) {
  const [list, setList] = useState<Employee['placements']>([])
  const [bizId, setBizId] = useState(0)
  const [positions, setPositions] = useState<Position[]>([])
  const [posId, setPosId] = useState(0)
  const [error, setError] = useState('')
  const reload = () => getEmployee(empId).then((r) => setList(r.data.placements ?? []))
  useEffect(() => { reload() }, [empId])
  useEffect(() => { setPosId(0); if (bizId) getPositions({ business_id: bizId }).then((r) => setPositions(r.data)); else setPositions([]) }, [bizId])

  const used = new Set([primaryBusinessId, ...(list ?? []).map((p) => p.business?.id ?? 0)])
  const free = businesses.filter((b) => !used.has(b.id))
  const add = async () => {
    setError('')
    if (!bizId || !posId) return setError('Pilih bisnis dan jabatan')
    try { await addPlacement(empId, bizId, posId); setBizId(0); await reload() } catch (e: any) { setError(errMsg(e, 'Gagal menambah penempatan')) }
  }
  const del = async (id: number) => { if (confirm('Hapus penempatan ini?')) { await removePlacement(empId, id); reload() } }
  const extra = (list ?? []).filter((p) => !p.is_primary)

  return (
    <div className="border-t border-line pt-3">
      <div className="font-bold mb-1">Penempatan Tambahan <span className="font-normal text-muted">(bisnis lain · satu jabatan per bisnis)</span></div>
      {extra.map((p) => (
        <div key={p.id} className="flex items-center gap-2 border border-line rounded-lg px-2 py-1.5 mb-1">
          <Badge tone="blue">{p.business?.name}</Badge><span className="flex-1">{p.position?.title}</span>
          <button type="button" className="p-0.5 text-brand" title="Hapus" onClick={() => del(p.id)}><X className="w-3.5 h-3.5" /></button>
        </div>
      ))}
      {!extra.length && <p className="text-muted mb-1">Belum ada penempatan di bisnis lain.</p>}
      {free.length > 0 && (
        <div className="flex gap-2 items-center mt-1">
          <select className="input" value={bizId} onChange={(e) => setBizId(Number(e.target.value))}><option value={0}>— Bisnis —</option>{free.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          <select className="input flex-1 min-w-0" disabled={!bizId} value={posId} onChange={(e) => setPosId(Number(e.target.value))}>
            <option value={0}>{bizId ? '— Jabatan —' : 'Pilih bisnis dulu'}</option>{positions.map((p) => <option key={p.id} value={p.id} disabled={p.holder !== 'Vacant'}>{p.title}{p.holder !== 'Vacant' ? ` (terisi: ${p.holder})` : ''}</option>)}
          </select>
          <button type="button" className="btn" onClick={add}><Plus className="w-3 h-3 inline mr-1" />Tambah</button>
        </div>
      )}
      {error && <div className="text-brand bg-brand-soft rounded-lg px-3 py-2 mt-2">{error}</div>}
    </div>
  )
}

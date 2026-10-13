import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, ArrowUpDown, Plus, Trash2 } from 'lucide-react'
import Layout from '../components/Layout/Layout'
import Badge from '../components/ui/Badge'
import Modal from '../components/ui/Modal'
import StatCard from '../components/ui/StatCard'
import Pagination from '../components/ui/Pagination'
import Tabs from '../components/ui/Tabs'
import CompetencyTab from '../components/employee/CompetencyTab'
import ContractHistory from '../components/employee/ContractHistory'
import DocumentsTab from '../components/employee/DocumentsTab'
import { useAuthStore } from '../store/auth'
import { bizParams, useBusinessStore } from '../store/business'
import { deleteEmployee, getEmployee, getEmployees, setEmployeeStatus } from '../services/api'
import { daysLeft, errMsg, fmt, tenure } from '../utils/format'
import type { Employee } from '../types'

const STATUSES = ['Aktif', 'Non aktif', 'Suspend', 'Tidak Bekerja'] as const
const statusTone = { Aktif: 'green', 'Non aktif': 'blue', Suspend: 'amber', 'Tidak Bekerja': 'gray' } as const

export default function Employees() {
  const { businessId } = useBusinessStore()
  const nav = useNavigate()
  const canEdit = useAuthStore((s) => s.can)('employees.manage')
  const [list, setList] = useState<Employee[]>([])
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [stats, setStats] = useState({ active: 0, tetap: 0, kontrak: 0, freelance: 0, multi: 0, expiring: 0 })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [sort, setSort] = useState<{ col: 'name' | 'tenure' | 'contract_end'; dir: 'asc' | 'desc' }>({ col: 'name', dir: 'asc' }) // default: nama A–Z

  const [detail, setDetail] = useState<Employee | null>(null)
  const [managerName, setManagerName] = useState('-')
  const [detailTab, setDetailTab] = useState<'personal' | 'competency' | 'docs'>('personal')
  const [params, setParams] = useSearchParams()
  const [statusEdit, setStatusEdit] = useState<{ emp: Employee; status: string; note: string } | null>(null)

  const load = () => {
    getEmployees({ ...bizParams(businessId), q: q || undefined, employee_type: type || undefined, status: status || undefined, page, page_size: pageSize, sort: sort.col, dir: sort.dir }).then((r) => {
      setList(r.data.data ?? []); setTotal(r.data.total)
      if (r.data.stats) setStats(r.data.stats) // absent on an outdated backend — keep zeros instead of crashing
      const last = pageSize === 0 ? 1 : Math.max(1, Math.ceil(r.data.total / pageSize))
      if (page > last) setPage(last)
    })
  }
  useEffect(() => setPage(1), [businessId, q, type, status, pageSize, sort])
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t) }, [businessId, q, type, status, page, pageSize, sort])

  // old deep link /employees?edit=<id> now opens the full page
  useEffect(() => {
    const id = Number(params.get('edit'))
    if (id && canEdit) nav(`/employees/${id}`, { replace: true })
  }, [])

  const openDetail = (e: Employee) => {
    setDetail(e); setManagerName('-'); setDetailTab('personal')
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

  const addNew = () => nav('/employees/new')
  const toggleSort = (col: typeof sort.col) => setSort((x) => (x.col === col ? { col, dir: x.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' }))

  return (
    <Layout title="Karyawan" subtitle="Employee Management 360">
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 mb-3">
        <StatCard label="Karyawan Aktif" value={stats.active} />
        <StatCard label="Tetap" value={stats.tetap} />
        <StatCard label="Kontrak" value={stats.kontrak} />
        <StatCard label="Freelance" value={stats.freelance} />
        <StatCard label="Kontrak ≤ 30 Hari · Multi Penempatan" value={`${stats.expiring} · ${stats.multi}`} />
      </div>
      <div className="card p-3">
        <div className="flex flex-wrap gap-2 mb-3">
          <input className="input w-64" placeholder="Cari nama, email, jabatan…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}><option value="">Semua Jenis</option><option>Tetap</option><option>Kontrak</option><option>Freelance</option></select>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Semua Status</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
          {canEdit && <button className="btn-primary ml-auto" onClick={addNew}><Plus className="w-3.5 h-3.5 inline mr-1" />Karyawan</button>}
        </div>
        <div className="border border-line rounded-lg overflow-auto">
          <table className="w-full">
            <thead><tr>{[['Nama', 'name'], ['Penempatan Utama'], ['Jabatan'], ['Lokasi'], ['Masa Kerja', 'tenure'], ['Kontrak', 'contract_end'], ['Penempatan Tambahan'], ['Status'], ['']].map(([h, col]) => (
              <th key={h} className="th" aria-sort={col && sort.col === col ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                {col ? (
                  <button type="button" className="inline-flex items-center gap-1 font-[inherit] uppercase tracking-[inherit] hover:text-brand" onClick={() => toggleSort(col as typeof sort.col)} title="Urutkan">
                    {h}{sort.col === col ? (sort.dir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                  </button>
                ) : h}
              </th>
            ))}</tr></thead>
            <tbody>
              {list.map((e) => {
                const dl = daysLeft(e.contract_end)
                const extra = e.placements?.filter((p) => !p.is_primary) ?? []
                return (
                  <tr key={e.id} className={e.status !== 'Aktif' ? 'bg-sunken/70 text-muted' : ''}>
                    <td className="td"><b>{e.name}</b>{e.nik && <div className="text-muted text-[11px]">{e.nik}</div>}</td>
                    <td className="td">{e.business?.name}</td>
                    <td className="td">{e.position?.title ?? '-'}</td>
                    <td className="td">{e.location?.name ?? '-'}</td>
                    <td className="td">{tenure(e.join_date)}</td>
                    <td className="td">{e.contract_end ? <>{e.employee_type === 'Freelance' ? 'Freelance' : 'PKWT'} · s.d. {fmt(e.contract_end)} <Badge tone={dl! <= 30 ? 'red' : 'amber'}>{dl} hari lagi</Badge></> : <Badge tone="green">{e.employee_type}</Badge>}</td>
                    <td className="td">{extra.length ? extra.map((p) => `${p.business?.name} — ${p.position?.title}`).join(', ') : '—'}</td>
                    <td className="td"><Badge tone={statusTone[e.status] ?? 'gray'}>{e.status}</Badge></td>
                    <td className="td whitespace-nowrap">
                      <button className="btn mr-1" onClick={() => openDetail(e)}>Detail</button>
                      {canEdit && <>
                        <button className="btn mr-1" onClick={() => nav(`/employees/${e.id}`)}>Edit</button>
                        <button className="btn mr-1" onClick={() => setStatusEdit({ emp: e, status: e.status, note: e.status_note ?? '' })}>Status</button>
                        <button className="btn text-danger" title="Hapus" onClick={() => remove(e)}><Trash2 className="w-3.5 h-3.5" /></button>
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
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.name ?? ''} size="lg">
        {detail && (
          <div className="space-y-4">
            {canEdit && <Tabs tabs={[{ id: 'personal', label: 'Data Personal' }, { id: 'competency', label: 'Kompetensi History' }, { id: 'docs', label: 'Foto & Dokumen' }]} value={detailTab} onChange={setDetailTab} />}
            {detailTab === 'personal' && <>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {[['Bisnis', detail.business?.name], ['Unit', detail.unit?.name], ['Jabatan', detail.position?.title], ['Lokasi', detail.location?.name],
                ['NIK', detail.nik], ['Email', detail.email], ['Telepon', detail.phone], ['Tempat, Tgl Lahir', detail.birth_place || detail.birth_date ? `${detail.birth_place || '-'}, ${fmt(detail.birth_date)}` : '-'],
                ['Jenis', detail.employee_type], ['Tanggal Masuk', fmt(detail.join_date)], ['Kontrak Berakhir', fmt(detail.contract_end)],
                ['Atasan (n+1)', managerName], ['Penempatan', detail.placements?.length ? detail.placements.map((p) => `${p.business?.name}: ${p.position?.title}${p.is_primary ? ' (utama)' : ''}`).join(' · ') : '-'], ['DOH (Tanggal Masuk Pertama)', fmt(detail.doh)], ['POH (Lokasi Perekrutan)', detail.place_of_hire], ['Masa Kerja', tenure(detail.doh)], ['Status', detail.status + (detail.status_note ? ` — ${detail.status_note}` : '')]].map(([k, v]) => (
                <div key={k as string}><dt className="text-muted text-[10.5px]">{k}</dt><dd className="font-semibold">{v || '-'}</dd></div>
              ))}
            </dl>
            {canEdit && <div><div className="text-[11px] font-bold mb-2">Histori Kontrak</div><ContractHistory empId={detail.id} canEdit={false} onChanged={() => {}} /></div>}
            </>}
            {canEdit && detailTab === 'competency' && <CompetencyTab empId={detail.id} canEdit={false} />}
            {canEdit && detailTab === 'docs' && <DocumentsTab empId={detail.id} canEdit={false} />}
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
                  className={`flex-1 border rounded-lg py-2 font-semibold ${statusEdit.status === s ? 'border-brand bg-brand-soft text-brand' : 'border-line hover:bg-sunken'}`}>{s}</button>
              ))}
            </div>
            <label className="block font-semibold">Catatan / alasan<textarea className="input w-full mt-1" rows={3} value={statusEdit.note} onChange={(e) => setStatusEdit({ ...statusEdit, note: e.target.value })} placeholder="mis. resign 30/09, suspend sampai investigasi selesai…" /></label>
            {statusEdit.status === 'Non aktif' && <p className="text-info bg-info-soft rounded-lg px-3 py-2">Non aktif: tetap bisa login, tetapi tidak dihitung sebagai karyawan aktif dan tidak bisa absen.</p>}
            {(statusEdit.status === 'Suspend' || statusEdit.status === 'Tidak Bekerja') && <p className="text-warn bg-warn-soft rounded-lg px-3 py-2">Karyawan dengan status ini tidak dapat login, tidak bisa absen, dan tidak dihitung sebagai karyawan aktif.</p>}
            <div className="flex justify-end gap-2"><button className="btn" onClick={() => setStatusEdit(null)}>Batal</button><button className="btn-primary" onClick={saveStatus}>Simpan</button></div>
          </div>
        )}
      </Modal>

    </Layout>
  )
}

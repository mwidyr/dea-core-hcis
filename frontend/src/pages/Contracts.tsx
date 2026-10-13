import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, FileText, X } from 'lucide-react'
import Layout from '../components/Layout/Layout'
import Badge from '../components/ui/Badge'
import DataTable from '../components/ui/DataTable'
import Modal from '../components/ui/Modal'
import StatCard from '../components/ui/StatCard'
import { useAuthStore } from '../store/auth'
import { bizParams, useBusinessStore } from '../store/business'
import { getContractDocCounts, getDocLabels, getEmployees } from '../services/api'
import { daysLeft, fmt, fmtLong } from '../utils/format'
import type { Employee } from '../types'

// A checklist item is "done" when the employee has any document whose label contains one of the keywords.
const CHECKLIST = [
  { key: 'KTP', words: ['ktp'] },
  { key: 'KK', words: ['kk', 'kartu keluarga'] },
  { key: 'NPWP', words: ['npwp'] },
  { key: 'Kontrak', words: ['kontrak', 'pkwt', 'pkwtt'] },
]
const has = (labels: string[], words: string[]) => labels.some((l) => words.some((w) => l.toLowerCase().includes(w)))
const byName = (a: Employee, b: Employee) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }) // default order: nama A–Z

export default function Contracts() {
  const { businessId } = useBusinessStore()
  const isAdmin = useAuthStore((s) => s.can)('employees.manage')
  const nav = useNavigate()
  const [emps, setEmps] = useState<Employee[]>([])
  const [labels, setLabels] = useState<Record<string, string[]>>({})
  const [contractDocs, setContractDocs] = useState<Record<string, number>>({}) // contract id → documents attached
  const [openEmp, setOpenEmp] = useState<Employee | null>(null)
  const [fContract, setFContract] = useState('')
  const [fDocs, setFDocs] = useState('')

  useEffect(() => {
    if (!isAdmin) return
    const p = bizParams(businessId)
    getEmployees({ ...p, status: 'Aktif', page_size: 1000 }).then((r) => setEmps(r.data.data ?? []))
    getDocLabels(p).then((r) => setLabels(r.data))
    getContractDocCounts().then((r) => setContractDocs(r.data))
  }, [businessId, isAdmin])

  // The "Kontrak" item is done when the CURRENT contract has a document attached; employees without contract rows (e.g. permanent) fall back to a document labelled Kontrak.
  const done = (e: Employee, c: (typeof CHECKLIST)[number]) => {
    const current = e.contracts?.[0]
    if (c.key === 'Kontrak' && current) return (contractDocs[current.id] ?? 0) > 0
    return has(labels[e.id] ?? [], c.words)
  }
  const missing = (e: Employee) => CHECKLIST.filter((c) => !done(e, c)).map((c) => c.key)
  const rows = useMemo(() => emps.filter((e) => {
    const d = daysLeft(e.contract_end)
    if (fContract === 'tetap' && e.employee_type !== 'Tetap') return false
    if (fContract === 'expired' && !(d !== null && d < 0)) return false
    if (/^\d+$/.test(fContract) && !(d !== null && d >= 0 && d <= Number(fContract))) return false
    if (fDocs === 'complete' && missing(e).length) return false
    if (fDocs === 'incomplete' && !missing(e).length) return false
    return true
  }), [emps, labels, fContract, fDocs])

  const soon = emps.filter((e) => { const d = daysLeft(e.contract_end); return d !== null && d >= 0 && d <= 30 }).length
  const expired = emps.filter((e) => { const d = daysLeft(e.contract_end); return d !== null && d < 0 }).length
  const incomplete = emps.filter((e) => missing(e).length).length

  return (
    <Layout title="Kontrak & Dokumen" subtitle="Monitoring masa kontrak dan kelengkapan dokumen karyawan (KTP, KK, NPWP, Kontrak)">
      {!isAdmin ? <div className="card p-8 text-center text-sm text-muted">Halaman ini hanya untuk Super Admin dan HR Admin.</div> : <>
        <div className="grid grid-cols-4 gap-3 mb-3">
          <StatCard label="Karyawan Aktif" value={emps.length} />
          <StatCard label="Kontrak Berakhir ≤ 30 Hari" value={soon} />
          <StatCard label="Kontrak Sudah Berakhir" value={expired} />
          <StatCard label="Dokumen Belum Lengkap" value={incomplete} />
        </div>
        <div className="card p-4">
          <DataTable data={rows} rowKey={(e) => e.id} defaultSort={byName} searchPlaceholder="Cari karyawan, jabatan…" searchText={(e) => `${e.name} ${e.position?.title ?? ''} ${e.business?.name ?? ''}`}
            filters={<>
              <select className="input" value={fContract} onChange={(e) => setFContract(e.target.value)}>
                <option value="">Semua Kontrak</option><option value="tetap">Karyawan Tetap</option><option value="90">≤ 90 hari</option><option value="30">≤ 30 hari</option><option value="7">≤ 7 hari</option><option value="expired">Sudah berakhir</option></select>
              <select className="input" value={fDocs} onChange={(e) => setFDocs(e.target.value)}><option value="">Semua Dokumen</option><option value="complete">Lengkap</option><option value="incomplete">Belum lengkap</option></select>
            </>}
            columns={[
              { head: 'Karyawan', sortValue: (e) => e.name, render: (e) => <div><b>{e.name}</b><div className="text-muted text-[11px]">{e.position?.title ?? '-'} · {e.business?.name}</div></div> },
              { head: 'Status Kerja', sortValue: (e) => e.employee_type, render: (e) => <Badge tone={e.employee_type === 'Tetap' ? 'green' : 'amber'}>{e.employee_type}</Badge> },
              { head: 'Kontrak Berakhir', sortValue: (e) => (e.contract_end ? new Date(e.contract_end).getTime() : null), render: (e) => { const d = daysLeft(e.contract_end); return e.contract_end ? <>{fmt(e.contract_end)} <Badge tone={d! < 0 ? 'red' : d! <= 30 ? 'red' : 'amber'}>{d! < 0 ? 'berakhir' : `${d} hari lagi`}</Badge></> : '-' } },
              { head: 'Riwayat', render: (e: Employee) => e.contracts?.length ? <button className="btn" onClick={() => setOpenEmp(e)}>{e.contracts.length} kontrak</button> : <span className="text-muted">-</span> },
              ...CHECKLIST.map((c) => ({ head: c.key, render: (e: Employee) => done(e, c) ? <Check className="w-4 h-4 text-ok" /> : <X className="w-4 h-4 text-brand" /> })),
              { head: 'Kelengkapan', render: (e: Employee) => missing(e).length ? <Badge tone="amber">Kurang {missing(e).length}</Badge> : <Badge tone="green">Lengkap</Badge> },
              { head: 'Aksi', render: (e: Employee) => <button className="btn" onClick={() => nav(`/employees/${e.id}`)}>Kelola</button> },
            ]} />
        </div>
        <Modal open={!!openEmp} onClose={() => setOpenEmp(null)} title={`Riwayat Kontrak — ${openEmp?.name ?? ''}`}>
          {openEmp && (
            <div className="space-y-2 text-xs">
              {(openEmp.contracts ?? []).map((c, i, all) => {
                const d = daysLeft(c.end_date)
                return (
                  <div key={c.id} className="border border-line rounded-lg px-3 py-2 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-bold">Kontrak ke-{all.length - i}{c.number ? ` · ${c.number}` : ''} {i === 0 && <Badge tone="blue">Saat ini</Badge>}</div>
                      <div className="text-muted">{fmtLong(c.start_date)} s.d. {c.end_date ? fmtLong(c.end_date) : 'belum ditentukan'}{c.end_date && d !== null && <> · {d < 0 ? 'berakhir' : `${d} hari lagi`}</>}</div>
                    </div>
                    <span className="inline-flex items-center gap-1 text-muted"><FileText className="w-3.5 h-3.5" />{contractDocs[c.id] ?? 0} dokumen</span>
                  </div>
                )
              })}
              <div className="flex justify-end pt-1"><button className="btn-primary" onClick={() => nav(`/employees/${openEmp.id}`)}>Kelola di halaman karyawan</button></div>
            </div>
          )}
        </Modal>
      </>}
    </Layout>
  )
}

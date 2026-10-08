import { useEffect, useMemo, useState } from 'react'
import { FileDown, FileSpreadsheet } from 'lucide-react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import Layout from '../components/Layout/Layout'
import PeriodPicker, { currentPeriod } from '../components/PeriodPicker'
import DataTable from '../components/ui/DataTable'
import DateField from '../components/ui/DateField'
import StatCard from '../components/ui/StatCard'
import { err, ymd } from '../components/tasks/taskUtils'
import { useAuthStore } from '../store/auth'
import { bizParams, useBusinessStore } from '../store/business'
import { downloadReportXlsx, getReport, getUnits } from '../services/api'
import type { OrgUnit, ReportData } from '../types'

const TYPES = [
  ['employees', 'Karyawan', 'Daftar karyawan aktif per bisnis/unit'],
  ['attendance', 'Rekap Absensi', 'Kehadiran, keterlambatan, dan jam kerja per karyawan'],
  ['leave', 'Cuti & Izin', 'Pengajuan cuti, izin, dan sakit'],
  ['tasks', 'Tugas', 'Tugas berdasarkan deadline, PIC, dan status'],
  ['projects', 'Proyek', 'Progres dan beban kerja proyek'],
  ['kpi', 'KPI & Scorecard', 'Skor akhir KPI + tugas + absensi per periode'],
] as const
type Type = (typeof TYPES)[number][0]

const monthStart = () => { const n = new Date(); return ymd(new Date(n.getFullYear(), n.getMonth(), 1)) }
const monthEnd = () => { const n = new Date(); return ymd(new Date(n.getFullYear(), n.getMonth() + 1, 0)) }

export default function Reports() {
  const { businessId } = useBusinessStore()
  const can = useAuthStore((s) => s.can)
  const canExport = can('reports.export')
  const [type, setType] = useState<Type>('employees')
  const [f, setF] = useState({ from: monthStart(), to: monthEnd(), period: currentPeriod(), unit_id: '', employee_type: '', status: '', category: '' })
  const [units, setUnits] = useState<OrgUnit[]>([])
  const [rep, setRep] = useState<ReportData | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }))

  useEffect(() => { getUnits(bizParams(businessId)).then((r) => setUnits(r.data)) }, [businessId])
  const params = useMemo(() => {
    const p: Record<string, string | number | undefined> = { ...bizParams(businessId) }
    if (['attendance', 'leave', 'tasks'].includes(type)) { p.from = f.from; p.to = f.to }
    if (type === 'kpi') p.period = f.period
    if (['employees', 'attendance', 'kpi'].includes(type) && f.unit_id) p.unit_id = f.unit_id
    if (type === 'employees' && f.employee_type) p.employee_type = f.employee_type
    if (['leave', 'projects'].includes(type) && f.status) p.status = f.status
    if (type === 'tasks' && f.status) p.status = f.status
    if (type === 'leave' && f.category) p.category = f.category
    return p
  }, [type, f, businessId])
  const key = JSON.stringify(params)
  useEffect(() => {
    setError('')
    const t = setTimeout(() => getReport(type, params).then((r) => setRep(r.data)).catch((e) => { setRep(null); setError(err(e, 'Gagal memuat laporan')) }), 200)
    return () => clearTimeout(t)
  }, [type, key])

  const xlsx = async () => { setBusy(true); try { await downloadReportXlsx(type, params) } catch (e: any) { setError('Gagal mengekspor Excel') } finally { setBusy(false) } }
  const pdf = () => {
    if (!rep) return
    const doc = new jsPDF({ orientation: rep.columns.length > 7 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' })
    doc.setFontSize(14); doc.text(rep.title, 40, 40)
    doc.setFontSize(9); doc.setTextColor(110); doc.text(rep.subtitle, 40, 56)
    rep.summary.forEach((kv, i) => doc.text(`${kv[0]}: ${kv[1]}`, 40, 72 + i * 11))
    autoTable(doc, { startY: 80 + rep.summary.length * 11, head: [rep.columns], body: rep.rows.map((r) => r.map((c) => String(c ?? ''))), styles: { fontSize: 7.5, cellPadding: 3 }, headStyles: { fillColor: [216, 74, 74] }, margin: { left: 40, right: 40 },
      didDrawPage: () => { doc.setFontSize(8); doc.setTextColor(140); doc.text(`Dicetak ${new Date().toLocaleString('id-ID')} · CORE HCIS`, 40, doc.internal.pageSize.getHeight() - 20) } })
    doc.save(`laporan-${type}-${ymd(new Date())}.pdf`)
  }

  const sel = 'input'
  if (!can('reports.view')) return <Layout title="Laporan"><div className="card p-8 text-center text-sm text-muted">Anda tidak memiliki izin untuk melihat laporan. Hubungi Super Admin bila diperlukan.</div></Layout>
  return (
    <Layout title="Laporan" subtitle="Laporan per karyawan, absensi, cuti, tugas, proyek, dan KPI — ekspor ke Excel atau PDF">
      <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 w-fit mb-3 flex-wrap">
        {TYPES.map(([id, label, hint]) => <button key={id} title={hint} onClick={() => { setType(id); setF((x) => ({ ...x, status: '', category: '' })) }} className={`px-3.5 py-1.5 rounded-md text-xs font-semibold ${type === id ? 'bg-white shadow-sm text-brand' : 'text-muted'}`}>{label}</button>)}
      </div>

      <div className="card p-4">
        <div className="flex flex-wrap items-end gap-3 mb-3 text-xs">
          {['attendance', 'leave', 'tasks'].includes(type) && <>
            <label className="font-semibold">{type === 'tasks' ? 'Deadline dari' : 'Dari'}<div className="mt-1 font-normal w-40"><DateField value={f.from} onChange={(v) => set('from', v)} /></div></label>
            <label className="font-semibold">Sampai<div className="mt-1 font-normal w-40"><DateField value={f.to} min={f.from || undefined} onChange={(v) => set('to', v)} /></div></label>
          </>}
          {type === 'kpi' && <div><div className="font-semibold mb-1">Periode</div><PeriodPicker value={f.period} onChange={(v) => set('period', v)} /></div>}
          {['employees', 'attendance', 'kpi'].includes(type) && <label className="font-semibold">Unit<div className="mt-1"><select className={sel} value={f.unit_id} onChange={(e) => set('unit_id', e.target.value)}><option value="">Semua unit</option>{units.map((u) => <option key={u.id} value={u.id}>L{u.level} · {u.name}</option>)}</select></div></label>}
          {type === 'employees' && <label className="font-semibold">Tipe<div className="mt-1"><select className={sel} value={f.employee_type} onChange={(e) => set('employee_type', e.target.value)}><option value="">Semua</option><option>Tetap</option><option>Kontrak</option><option>Freelance</option></select></div></label>}
          {type === 'leave' && <>
            <label className="font-semibold">Jenis<div className="mt-1"><select className={sel} value={f.category} onChange={(e) => set('category', e.target.value)}><option value="">Semua</option><option value="cuti">Cuti</option><option value="izin">Izin</option><option value="sakit">Sakit</option></select></div></label>
            <label className="font-semibold">Status<div className="mt-1"><select className={sel} value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">Semua</option><option>Pending Approval</option><option>Disetujui</option><option>Ditolak</option><option>Dibatalkan</option></select></div></label>
          </>}
          {type === 'tasks' && <label className="font-semibold">Status<div className="mt-1"><select className={sel} value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">Semua</option><option value="todo">To Do</option><option value="in_progress">In Progress</option><option value="review">Menunggu Approval</option><option value="done">Selesai</option></select></div></label>}
          {type === 'projects' && <label className="font-semibold">Status<div className="mt-1"><select className={sel} value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">Semua</option><option>Aktif</option><option>Ditunda</option><option>Selesai</option><option>Dibatalkan</option></select></div></label>}
          <div className="ml-auto flex gap-2">
            {canExport ? <>
              <button className="btn" disabled={!rep || busy} onClick={xlsx}><FileSpreadsheet className="w-3.5 h-3.5 inline mr-1" />Excel</button>
              <button className="btn" disabled={!rep} onClick={pdf}><FileDown className="w-3.5 h-3.5 inline mr-1" />PDF</button>
            </> : <span className="text-muted self-center">Anda tidak memiliki izin ekspor</span>}
          </div>
        </div>

        {error && <div className="text-brand bg-brand-soft rounded-lg px-3 py-2 mb-3 text-xs">{error}</div>}
        {rep && <>
          <div className="mb-3"><div className="font-bold text-sm">{rep.title}</div><div className="text-xs text-muted">{rep.subtitle}</div></div>
          {rep.summary.length > 0 && <div className="grid gap-3 mb-3" style={{ gridTemplateColumns: `repeat(${Math.min(4, rep.summary.length)}, minmax(0, 1fr))` }}>{rep.summary.map((kv) => <StatCard key={kv[0]} label={kv[0]} value={<span className="text-xl">{kv[1]}</span>} />)}</div>}
          <DataTable key={type} data={rep.rows} rowKey={(r) => r.join('|')} searchText={(r) => r.join(' ')} searchPlaceholder="Cari di laporan…" empty="Tidak ada data untuk filter ini"
            columns={rep.columns.map((h, i) => ({ head: h, render: (r: (string | number)[]) => <span className={typeof r[i] === 'number' ? 'tabular-nums' : ''}>{r[i] === '' || r[i] == null ? <span className="text-muted">–</span> : String(r[i])}</span> }))} />
        </>}
      </div>
    </Layout>
  )
}

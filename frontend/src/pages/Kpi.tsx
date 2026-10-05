import { useEffect, useMemo, useState } from 'react'
import { Lock, Plus } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import Layout from '../components/Layout/Layout'
import PeriodPicker, { currentPeriod } from '../components/PeriodPicker'
import Badge from '../components/ui/Badge'
import DataTable from '../components/ui/DataTable'
import Modal from '../components/ui/Modal'
import ProgressBar from '../components/ui/ProgressBar'
import StatCard from '../components/ui/StatCard'
import Tabs from '../components/ui/Tabs'
import { STATUS_COLOR, STATUS_TONE, num, pctText, scoreColor } from '../components/kpi/kpiUtils'
import { useAuthStore } from '../store/auth'
import { bizParams, useBusinessStore } from '../store/business'
import {
  closeKpiPeriod, createDeptKpi, createKpiItem, deleteDeptKpi, deleteKpiItem, getDeptKpis, getKpiHistory, getKpiItems, getScorecard, reopenKpiPeriod, getScorecardDetail, getTaskAssignees, getUnits, updateDeptKpi, updateKpiItem,
} from '../services/api'
import type { Assignee, DeptKpi, EmpScore, KpiClose, KpiHistoryRow, KpiItem, KpiSettings, OrgUnit, ScoreTaskRow } from '../types'
import { dt, err, fmt } from '../components/tasks/taskUtils'

type Tab = 'dept' | 'items' | 'scorecard'

export default function Kpi() {
  const { businessId } = useBusinessStore()
  const [params] = useSearchParams() // deep link from a notification: /kpi?tab=scorecard&period=2026-09
  const [period, setPeriod] = useState(params.get('period') || currentPeriod())
  const [tab, setTab] = useState<Tab>((['dept', 'items', 'scorecard'] as string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'scorecard')
  const [canDept, setCanDept] = useState<boolean | null>(null) // KPI departemen is for superiors / leadership only (the server decides)
  useEffect(() => { getDeptKpis({ ...bizParams(businessId), period }).then(() => setCanDept(true)).catch(() => { setCanDept(false); setTab((t) => (t === 'dept' ? 'scorecard' : t)) }) }, [businessId, period])
  const tabs = [...(canDept ? [{ id: 'dept' as Tab, label: 'KPI Departemen' }] : []), { id: 'items' as Tab, label: 'KPI Karyawan' }, { id: 'scorecard' as Tab, label: 'Scorecard' }]
  return (
    <Layout title="KPI & Scorecard" subtitle="KPI departemen, KPI karyawan (dihitung otomatis dari tugas), dan skor akhir gabungan dengan absensi">
      <div className="card p-4">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-2">
          <Tabs tabs={tabs} value={tab} onChange={setTab} />
          <PeriodPicker value={period} onChange={setPeriod} />
        </div>
        {tab === 'dept' && canDept && <DeptTab period={period} />}
        {tab === 'items' && <ItemsTab period={period} />}
        {tab === 'scorecard' && <ScorecardTab period={period} />}
      </div>
    </Layout>
  )
}

// A closed period is frozen (snapshot). HR can close / reopen from the Scorecard tab.
function ClosedBanner({ closed, onReopen }: { closed: KpiClose | null; onReopen?: () => void }) {
  if (!closed) return null
  return (
    <div className="flex items-center gap-2 bg-info-soft text-info rounded-lg px-3 py-2 mb-3 text-xs">
      <Lock className="w-3.5 h-3.5 shrink-0" />
      <span className="flex-1"><b>Periode ditutup</b> — skor dibekukan sebagai riwayat ({closed.auto ? 'otomatis' : `oleh ${closed.closed_by}`}, {dt(closed.closed_at)}). KPI periode ini tidak dapat diubah.</span>
      {onReopen && <button className="btn" onClick={onReopen}>Buka Kembali</button>}
    </div>
  )
}

const periodEnded = (key: string) => {
  const y = Number(key.slice(0, 4)), end = key.includes('Q') ? new Date(y, Number(key.slice(-1)) * 3, 0) : new Date(y, Number(key.slice(5, 7)), 0)
  end.setHours(23, 59, 59)
  return end.getTime() < Date.now()
}

// ------------------------------------------------------------------ KPI Departemen
function DeptTab({ period }: { period: string }) {
  const { businessId } = useBusinessStore()
  const [rows, setRows] = useState<DeptKpi[]>([])
  const [sum, setSum] = useState<{ company_score: number | null; company_target: number; best: { unit_name: string; score: number } | null; attention: number } | null>(null)
  const [can, setCan] = useState(false)
  const [closed, setClosed] = useState<KpiClose | null>(null)
  const [edit, setEdit] = useState<Partial<DeptKpi> | null>(null)
  const load = () => getDeptKpis({ ...bizParams(businessId), period }).then((r) => { setRows(r.data.data); setSum(r.data.summary); setCan(r.data.can_manage); setClosed(r.data.closed) })
  useEffect(() => { load() }, [businessId, period])
  const target = sum?.company_target ?? 90
  return (
    <>
      <ClosedBanner closed={closed} />
      <div className="grid grid-cols-4 gap-3 mb-3">
        <StatCard label="Company KPI" value={<span style={{ color: scoreColor(sum?.company_score, target) }}>{pctText(sum?.company_score)}</span>} foot="rata-rata berbobot KPI departemen" />
        <StatCard label="Target Perusahaan" value={`${target}%`} foot="diatur di Settings → KPI" />
        <StatCard label="Best Dept" value={sum?.best ? `${num(sum.best.score)}%` : '–'} foot={sum?.best?.unit_name ?? 'belum ada data'} />
        <StatCard label="Need Attention" value={<span className={(sum?.attention ?? 0) > 0 ? 'text-brand' : ''}>{sum?.attention ?? 0}</span>} foot="departemen di bawah Good" />
      </div>
      <p className="text-xs text-muted mb-2">Target departemen diturunkan dari objective perusahaan. Actual diisi manual, atau otomatis dari <b>rata-rata skor akhir karyawan</b> di unit tersebut (termasuk sub-unit).</p>
      <DataTable data={rows} rowKey={(d) => d.id} searchPlaceholder="Cari departemen atau objective…" searchText={(d) => `${d.unit_name} ${d.objective}`} empty="Belum ada KPI departemen untuk periode ini"
        actions={can ? <button className="btn-primary" onClick={() => setEdit({ source: 'manual', direction: 'higher', unit: '%', target: 90, weight: 0 })}><Plus className="w-3.5 h-3.5 inline mr-1" />KPI</button> : undefined}
        columns={[
          { head: 'Departemen', render: (d) => <b>{d.unit_name}</b> },
          { head: 'Objective', render: (d) => <div>{d.objective}{d.direction === 'lower' && <span className="text-muted text-[10.5px]"> · lebih kecil lebih baik</span>}</div> },
          { head: 'Target', render: (d) => `${num(d.target)}${d.unit}` },
          { head: 'Actual', render: (d) => <div>{num(d.actual_value)}{d.unit}{d.source === 'team_score' && <div className="text-muted text-[10.5px]">skor tim ({d.team_size} orang)</div>}</div> },
          { head: 'Weight', render: (d) => (d.weight ? `${num(d.weight, 0)}%` : '–') },
          { head: 'Score', render: (d) => <div className="w-32"><ProgressBar value={Math.min(100, d.score)} color={STATUS_COLOR[d.status]} label={false} /><b className="text-[11px]">{num(d.score)}%</b></div> },
          { head: 'Status', render: (d) => <Badge tone={STATUS_TONE[d.status]}>{d.status}</Badge> },
          { head: 'Aksi', render: (d) => can && <div className="flex gap-1.5"><button className="btn" onClick={() => setEdit(d)}>Edit</button><button className="btn text-brand" onClick={async () => { if (confirm(`Hapus KPI "${d.objective}"?`)) { await deleteDeptKpi(d.id); load() } }}>Hapus</button></div> },
        ]} />
      {edit && <DeptForm initial={edit} period={period} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load() }} />}
    </>
  )
}

function DeptForm({ initial, period, onClose, onSaved }: { initial: Partial<DeptKpi>; period: string; onClose: () => void; onSaved: () => void }) {
  const { businessId, businesses } = useBusinessStore()
  const [units, setUnits] = useState<OrgUnit[]>([])
  const [f, setF] = useState({ unit_id: initial.unit_id ?? 0, objective: initial.objective ?? '', unit: initial.unit ?? '%', direction: initial.direction ?? 'higher', target: String(initial.target ?? 90), actual: String(initial.actual ?? 0), source: initial.source ?? 'manual', weight: String(initial.weight ?? 0) })
  const [error, setError] = useState('')
  const editing = !!initial.id
  useEffect(() => { getUnits(bizParams(businessId)).then((r) => setUnits(r.data)) }, [businessId])
  const bizName = (id: number) => businesses.find((b) => b.id === id)?.code ?? ''
  const submit = async () => {
    setError('')
    if (!f.unit_id) return setError('Pilih departemen (unit organisasi)')
    if (!f.objective.trim()) return setError('Objective wajib diisi')
    if (!(Number(f.target) > 0)) return setError('Target harus lebih dari 0')
    const body = { ...f, unit_id: Number(f.unit_id), target: Number(f.target), actual: Number(f.actual) || 0, weight: Number(f.weight) || 0, period_key: period }
    try { await (editing ? updateDeptKpi(initial.id!, body) : createDeptKpi(body)); onSaved() } catch (e: any) { setError(err(e, 'Gagal menyimpan KPI departemen')) }
  }
  return (
    <Modal open onClose={onClose} title={editing ? 'Ubah KPI Departemen' : 'Tambah KPI Departemen'}>
      <div className="space-y-3 text-xs">
        <label className="block font-semibold">Departemen (unit organisasi)
          <select className="input w-full mt-1 disabled:bg-gray-100" disabled={editing} value={f.unit_id || ''} onChange={(e) => setF({ ...f, unit_id: Number(e.target.value) })}>
            <option value="">— Pilih unit —</option>{units.map((u) => <option key={u.id} value={u.id}>{bizName(u.business_id)} · L{u.level} {u.name}</option>)}
          </select></label>
        <label className="block font-semibold">Objective<input className="input w-full mt-1" value={f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })} placeholder="mis. Operational Delivery" /></label>
        <div className="grid grid-cols-3 gap-3">
          <label className="block font-semibold">Target<input className="input w-full mt-1" type="number" step="any" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></label>
          <label className="block font-semibold">Satuan<input className="input w-full mt-1" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></label>
          <label className="block font-semibold">Bobot (%)<input className="input w-full mt-1" type="number" min={0} max={100} value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })} /></label>
        </div>
        <label className="block font-semibold">Arah<select className="input w-full mt-1" value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value as 'higher' | 'lower' })}><option value="higher">Lebih besar lebih baik</option><option value="lower">Lebih kecil lebih baik (mis. jumlah komplain)</option></select></label>
        <div>
          <div className="font-semibold mb-1">Sumber Actual</div>
          {([['manual', 'Diisi manual', 'masukkan nilai actual sendiri'], ['team_score', 'Skor tim otomatis', 'rata-rata skor akhir karyawan di unit ini (dan sub-unit)']] as const).map(([v, t, d]) => (
            <label key={v} className={`flex gap-2 items-start border rounded-lg p-2 mb-1.5 cursor-pointer ${f.source === v ? 'border-brand bg-brand-soft' : 'border-line'}`}><input type="radio" className="mt-0.5" checked={f.source === v} onChange={() => setF({ ...f, source: v })} /><span><b>{t}</b><div className="text-muted">{d}</div></span></label>
          ))}
        </div>
        {f.source === 'manual' && <label className="block font-semibold">Actual<input className="input w-full mt-1" type="number" step="any" value={f.actual} onChange={(e) => setF({ ...f, actual: e.target.value })} /></label>}
        <p className="text-muted">Skor = actual ÷ target × 100 (maksimal 120%; terbalik untuk “lebih kecil lebih baik”). Bila semua KPI memiliki bobot, Company KPI dihitung berbobot; jika tidak, rata-rata biasa.</p>
        {error && <div className="text-brand bg-brand-soft rounded-lg px-3 py-2">{error}</div>}
        <div className="flex justify-end gap-2"><button className="btn" onClick={onClose}>Batal</button><button className="btn-primary" onClick={submit}>Simpan</button></div>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ KPI Karyawan
function ItemsTab({ period }: { period: string }) {
  const { businessId } = useBusinessStore()
  const [rows, setRows] = useState<KpiItem[]>([])
  const [canAssign, setCanAssign] = useState(false)
  const [closed, setClosed] = useState<KpiClose | null>(null)
  const [edit, setEdit] = useState<Partial<KpiItem> | null>(null)
  const load = () => getKpiItems({ ...bizParams(businessId), period }).then((r) => { setRows(r.data.data); setCanAssign(r.data.can_assign); setClosed(r.data.closed) })
  useEffect(() => { load() }, [businessId, period])
  return (
    <>
      <ClosedBanner closed={closed} />
      <div className="bg-gray-50 rounded-lg p-3 mb-3 text-xs text-muted">
        <b className="text-gray-800">KPI otomatis dari tugas:</b> pilih metode “Tugas tepat waktu”, lalu tautkan tugas ke KPI itu (kolom <i>Terkait KPI</i> di form tugas). Actual = jumlah tugas tertaut yang selesai <b>tepat waktu</b> pada periode ini. Contoh: target 12 laporan, 11 selesai tepat waktu → 91,7%.
      </div>
      <DataTable data={rows} rowKey={(k) => k.id} searchPlaceholder="Cari karyawan atau KPI…" searchText={(k) => `${k.employee_name} ${k.title} ${k.unit_name}`} empty="Belum ada KPI karyawan untuk periode ini"
        actions={canAssign ? <button className="btn-primary" onClick={() => setEdit({ metric: 'tasks_on_time', direction: 'higher', unit: 'tugas', weight: 0 })}><Plus className="w-3.5 h-3.5 inline mr-1" />Assign KPI</button> : undefined}
        columns={[
          { head: 'Karyawan', render: (k) => <div><b>{k.employee_name}</b><div className="text-muted text-[11px]">{k.unit_name}</div></div> },
          { head: 'KPI', render: (k) => <div>{k.title}{k.dept_objective && <div className="text-muted text-[10.5px]">↳ {k.dept_objective}</div>}</div> },
          { head: 'Metode', render: (k) => (k.auto ? <Badge tone="blue">Otomatis · tugas tepat waktu</Badge> : <Badge>Manual</Badge>) },
          { head: 'Target', render: (k) => `${num(k.target)} ${k.unit}` },
          { head: 'Actual', render: (k) => <div>{num(k.actual_value)} {k.unit}{k.auto && <div className="text-muted text-[10.5px]">{k.linked_done}/{k.linked_tasks} tugas tertaut selesai</div>}</div> },
          { head: 'Score', render: (k) => <div className="w-28"><ProgressBar value={Math.min(100, k.score)} color={STATUS_COLOR[k.status]} label={false} small /><b className="text-[11px]">{num(k.score)}%</b></div> },
          { head: 'Bobot', render: (k) => (k.weight ? `${num(k.weight, 0)}%` : '–') },
          { head: 'Status', render: (k) => <Badge tone={STATUS_TONE[k.status]}>{k.status}</Badge> },
          { head: 'Aksi', render: (k) => k.can_edit && <div className="flex gap-1.5"><button className="btn" onClick={() => setEdit(k)}>Edit</button><button className="btn text-brand" onClick={async () => { if (confirm(`Hapus KPI "${k.title}"? Tugas yang tertaut tidak ikut terhapus.`)) { await deleteKpiItem(k.id); load() } }}>Hapus</button></div> },
        ]} />
      {edit && <ItemForm initial={edit} period={period} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load() }} />}
    </>
  )
}

function ItemForm({ initial, period, onClose, onSaved }: { initial: Partial<KpiItem>; period: string; onClose: () => void; onSaved: () => void }) {
  const user = useAuthStore((s) => s.user)
  const isAdmin = ['super_admin', 'hr_admin'].includes(user?.role ?? '')
  const editing = !!initial.id
  const [people, setPeople] = useState<Assignee[]>([])
  const [depts, setDepts] = useState<DeptKpi[]>([])
  const [f, setF] = useState({ employee_id: initial.employee_id ?? 0, title: initial.title ?? '', metric: initial.metric ?? 'tasks_on_time', unit: initial.unit ?? 'tugas', direction: initial.direction ?? 'higher', target: String(initial.target ?? ''), actual: String(initial.actual ?? 0), weight: String(initial.weight ?? 0), dept_kpi_id: initial.dept_kpi_id ?? 0 })
  const [error, setError] = useState('')
  useEffect(() => {
    getTaskAssignees().then((r) => setPeople(r.data.filter((p) => isAdmin || p.id !== user?.employee_id))) // a superior assigns to subordinates, not to themselves
    getDeptKpis({ period }).then((r) => setDepts(r.data.data)).catch(() => setDepts([])) // only superiors can see dept KPIs
  }, [])
  const emp = people.find((p) => p.id === f.employee_id)
  const bizDepts = depts.filter((d) => !emp || d.business_id === emp.business_id)
  const submit = async () => {
    setError('')
    if (!f.employee_id) return setError('Pilih karyawan')
    if (!f.title.trim()) return setError('Nama KPI wajib diisi')
    if (!(Number(f.target) > 0)) return setError('Target harus lebih dari 0')
    const body = { ...f, target: Number(f.target), actual: Number(f.actual) || 0, weight: Number(f.weight) || 0, dept_kpi_id: f.dept_kpi_id || null, period_key: period }
    try { await (editing ? updateKpiItem(initial.id!, body) : createKpiItem(body)); onSaved() } catch (e: any) { setError(err(e, 'Gagal menyimpan KPI')) }
  }
  return (
    <Modal open onClose={onClose} title={editing ? 'Ubah KPI Karyawan' : 'Assign KPI Karyawan'}>
      <div className="space-y-3 text-xs">
        <label className="block font-semibold">Karyawan
          <select className="input w-full mt-1 disabled:bg-gray-100" disabled={editing} value={f.employee_id || ''} onChange={(e) => setF({ ...f, employee_id: Number(e.target.value), dept_kpi_id: 0 })}>
            <option value="">— Pilih karyawan —</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.unit_name ? ` — ${p.unit_name}` : ''}</option>)}
            {editing && !people.some((p) => p.id === f.employee_id) && <option value={f.employee_id}>{initial.employee_name}</option>}
          </select></label>
        <label className="block font-semibold">Nama KPI<input className="input w-full mt-1" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="mis. Weekly Operational Report" /></label>
        <div>
          <div className="font-semibold mb-1">Metode pengukuran</div>
          {([['tasks_on_time', 'Otomatis dari tugas', 'actual = jumlah tugas tertaut yang selesai tepat waktu pada periode'], ['manual', 'Manual', 'actual diisi dan diperbarui oleh atasan / HR']] as const).map(([v, t, d]) => (
            <label key={v} className={`flex gap-2 items-start border rounded-lg p-2 mb-1.5 cursor-pointer ${f.metric === v ? 'border-brand bg-brand-soft' : 'border-line'}`}><input type="radio" className="mt-0.5" checked={f.metric === v} onChange={() => setF({ ...f, metric: v, unit: v === 'tasks_on_time' && f.unit === '%' ? 'tugas' : f.unit })} /><span><b>{t}</b><div className="text-muted">{d}</div></span></label>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <label className="block font-semibold">Target<input className="input w-full mt-1" type="number" step="any" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></label>
          <label className="block font-semibold">Satuan<input className="input w-full mt-1" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="laporan, %, …" /></label>
          <label className="block font-semibold">Bobot (%)<input className="input w-full mt-1" type="number" min={0} max={100} value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })} /></label>
        </div>
        {f.metric === 'manual' && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block font-semibold">Actual<input className="input w-full mt-1" type="number" step="any" value={f.actual} onChange={(e) => setF({ ...f, actual: e.target.value })} /></label>
            <label className="block font-semibold">Arah<select className="input w-full mt-1" value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value as 'higher' | 'lower' })}><option value="higher">Lebih besar lebih baik</option><option value="lower">Lebih kecil lebih baik</option></select></label>
          </div>
        )}
        {bizDepts.length > 0 && <label className="block font-semibold">Mendukung objective departemen <span className="font-normal text-muted">(opsional)</span>
          <select className="input w-full mt-1" value={f.dept_kpi_id || ''} onChange={(e) => setF({ ...f, dept_kpi_id: Number(e.target.value) })}><option value="">—</option>{bizDepts.map((d) => <option key={d.id} value={d.id}>{d.unit_name} · {d.objective}</option>)}</select></label>}
        <p className="text-muted">Bobot memengaruhi skor KPI karyawan; kosongkan (0) pada semua item agar dihitung rata-rata biasa.</p>
        {error && <div className="text-brand bg-brand-soft rounded-lg px-3 py-2">{error}</div>}
        <div className="flex justify-end gap-2"><button className="btn" onClick={onClose}>Batal</button><button className="btn-primary" onClick={submit}>Simpan</button></div>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ Scorecard
function ScorecardTab({ period }: { period: string }) {
  const { businessId } = useBusinessStore()
  const [rows, setRows] = useState<EmpScore[]>([])
  const [settings, setSettings] = useState<KpiSettings | null>(null)
  const [sum, setSum] = useState({ average: 0, good: 0, attention: 0, critical: 0, no_data: 0 })
  const [units, setUnits] = useState<OrgUnit[]>([])
  const [unit, setUnit] = useState('')
  const [detail, setDetail] = useState<number | null>(null)
  const [closed, setClosed] = useState<KpiClose | null>(null)
  const isHR = ['super_admin', 'hr_admin'].includes(useAuthStore((s) => s.user)?.role ?? '')
  const [msg, setMsg] = useState('')
  useEffect(() => { getUnits(bizParams(businessId)).then((r) => setUnits(r.data)) }, [businessId])
  const load = () => getScorecard({ ...bizParams(businessId), period, unit_id: unit || undefined }).then((r) => { setRows(r.data.rows); setSettings(r.data.settings); setSum(r.data.summary); setClosed(r.data.closed) })
  useEffect(() => { load() }, [businessId, period, unit])
  const close = async () => {
    const warn = periodEnded(period) ? '' : '\n\nPeriode ini belum berakhir — skor akan dibekukan dengan data saat ini.'
    if (!confirm(`Tutup periode ${period}? Skor semua karyawan dibekukan sebagai riwayat dan KPI periode ini tidak dapat diubah (bisa dibuka kembali).${warn}`)) return
    try { await closeKpiPeriod(period); setMsg(''); load() } catch (e: any) { setMsg(err(e, 'Gagal menutup periode')) }
  }
  const reopen = async () => {
    if (!confirm(`Buka kembali periode ${period}? Skor yang dibekukan dihapus dan dihitung ulang dari data terkini. Periode ini tidak akan ditutup otomatis lagi.`)) return
    try { await reopenKpiPeriod(period); setMsg(''); load() } catch (e: any) { setMsg(err(e, 'Gagal membuka periode')) }
  }
  const good = settings?.good_min ?? 90, att = settings?.attention_min ?? 70
  const sorted = useMemo(() => [...rows].sort((a, b) => (a.rank || 9999) - (b.rank || 9999) || a.name.localeCompare(b.name)), [rows])
  const cell = (v: number | null) => <b style={{ color: scoreColor(v, good, att) }}>{pctText(v)}</b>
  return (
    <>
      <ClosedBanner closed={closed} onReopen={isHR ? reopen : undefined} />
      {!closed && isHR && <div className="flex items-center justify-between gap-3 bg-gray-50 rounded-lg px-3 py-2 mb-3 text-xs"><span className="text-muted">Periode berjalan: skor dihitung langsung dari data terkini. Periode otomatis ditutup sehari setelah berakhir; HR dapat menutupnya lebih awal.</span><button className="btn" onClick={close}><Lock className="w-3.5 h-3.5 inline mr-1" />Tutup Periode</button></div>}
      {msg && <div className="text-brand bg-brand-soft rounded-lg px-3 py-2 mb-3 text-xs">{msg}</div>}
      <div className="grid grid-cols-5 gap-3 mb-3">
        <StatCard label="Rata-rata skor akhir" value={<span style={{ color: scoreColor(sum.average, good, att) }}>{pctText(sum.average)}</span>} />
        <StatCard label="Good" value={<span className="text-ok">{sum.good}</span>} foot={`≥ ${good}%`} />
        <StatCard label="Attention" value={<span className="text-warn">{sum.attention}</span>} foot={`${att}–${good}%`} />
        <StatCard label="Critical" value={<span className="text-brand">{sum.critical}</span>} foot={`< ${att}%`} />
        <StatCard label="Belum ada data" value={sum.no_data} />
      </div>
      {settings && <p className="text-xs text-muted mb-2">Skor akhir = KPI <b>{settings.weight_kpi}%</b> + Penyelesaian tugas <b>{settings.weight_task}%</b> + Absensi <b>{settings.weight_attendance}%</b>. Komponen yang belum punya data tidak dihitung (bobot disesuaikan otomatis).</p>}
      <DataTable data={sorted} rowKey={(r) => r.employee_id} searchPlaceholder="Cari nama atau NIK…" searchText={(r) => `${r.name} ${r.nik} ${r.unit_name}`}
        filters={<select className="input" value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">Semua Unit</option>{units.map((u) => <option key={u.id} value={u.id}>L{u.level} · {u.name}</option>)}</select>}
        columns={[
          { head: '#', render: (r) => (r.rank ? <b>{r.rank}</b> : '–') },
          { head: 'Karyawan', render: (r) => <div><b>{r.name}</b><div className="text-muted text-[11px]">{r.unit_name} · {r.nik}</div></div> },
          { head: 'KPI', render: (r) => <div>{cell(r.kpi_score)}<div className="text-muted text-[10.5px]">{r.items.length} item</div></div> },
          { head: 'Penyelesaian Tugas', render: (r) => <div>{cell(r.task_score)}<div className="text-muted text-[10.5px]">{r.tasks.done}/{r.tasks.total} selesai</div></div> },
          { head: 'Absensi', render: (r) => <div>{cell(r.attendance_score)}<div className="text-muted text-[10.5px]">{r.attendance.present}/{r.attendance.required} hari</div></div> },
          { head: 'Skor Akhir', render: (r) => <div className="w-32"><ProgressBar value={Math.min(100, r.final_score ?? 0)} color={scoreColor(r.final_score, good, att)} label={false} /><b className="text-[11.5px]">{pctText(r.final_score)}</b></div> },
          { head: 'Status', render: (r) => (r.status ? <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge> : <span className="text-muted">–</span>) },
          { head: 'Aksi', render: (r) => <button className="btn" onClick={() => setDetail(r.employee_id)}>Detail</button> },
        ]} />
      {detail !== null && <ScoreDetail id={detail} period={period} onClose={() => setDetail(null)} />}
    </>
  )
}

function ScoreDetail({ id, period, onClose }: { id: number; period: string; onClose: () => void }) {
  const [d, setD] = useState<{ period: string; score: EmpScore; tasks: ScoreTaskRow[]; settings: KpiSettings; closed?: KpiClose | null } | null>(null)
  const [hist, setHist] = useState<KpiHistoryRow[]>([])
  useEffect(() => { getScorecardDetail(id, period).then((r) => setD(r.data)) }, [id, period])
  // the trend compares like with like: monthly periods with monthly, quarters with quarters
  useEffect(() => { getKpiHistory(id).then((r) => setHist(r.data.data.filter((h) => h.period_key.includes('Q') === period.includes('Q')))).catch(() => setHist([])) }, [id, period])
  if (!d) return <Modal open onClose={onClose} title="Scorecard"><p className="text-xs text-muted">Memuat…</p></Modal>
  const s = d.score, st = d.settings
  const comps = [{ name: 'KPI', v: s.kpi_score, w: st.weight_kpi, note: `${s.items.length} item KPI` }, { name: 'Tugas', v: s.task_score, w: st.weight_task, note: `${s.tasks.done}/${s.tasks.total} selesai · ${s.tasks.on_time} tepat waktu` }, { name: 'Absensi', v: s.attendance_score, w: st.weight_attendance, note: `${s.attendance.present}/${s.attendance.required} hari hadir` }]
  const radar = comps.map((c) => ({ komponen: c.name, skor: c.v ?? 0, target: st.good_min }))
  return (
    <Modal open onClose={onClose} title={`Scorecard — ${s.name}`} size="lg">
      <div className="space-y-4 text-xs">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="text-center px-4"><div className="text-4xl font-extrabold" style={{ color: scoreColor(s.final_score, st.good_min, st.attention_min) }}>{pctText(s.final_score)}</div><div className="text-muted">skor akhir · {d.period}</div></div>
          <div className="flex-1 min-w-[220px]"><div className="font-bold text-sm">{s.name}</div><div className="text-muted">{s.unit_name} · {s.nik}</div><div className="mt-1.5 flex gap-1.5">{s.status && <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>}{s.rank > 0 && <Badge tone="blue">Peringkat #{s.rank}</Badge>}</div></div>
          <div className="w-56 h-40"><ResponsiveContainer width="100%" height="100%"><RadarChart data={radar} outerRadius="70%"><PolarGrid /><PolarAngleAxis dataKey="komponen" tick={{ fontSize: 11 }} /><PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} /><Radar name="Target" dataKey="target" stroke="#c5cad1" fill="#c5cad1" fillOpacity={0.25} /><Radar name="Skor" dataKey="skor" stroke="#d84a4a" fill="#d84a4a" fillOpacity={0.35} /></RadarChart></ResponsiveContainer></div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {comps.map((c) => (
            <div key={c.name} className="border border-line rounded-lg p-3">
              <div className="flex items-center justify-between"><b>{c.name}</b><span className="text-muted">bobot {c.w}%</span></div>
              <div className="text-xl font-extrabold mt-1" style={{ color: scoreColor(c.v, st.good_min, st.attention_min) }}>{pctText(c.v)}</div>
              <ProgressBar value={Math.min(100, c.v ?? 0)} color={scoreColor(c.v, st.good_min, st.attention_min)} label={false} small /><div className="text-muted mt-1">{c.v === null ? 'belum ada data' : c.note}</div>
            </div>
          ))}
        </div>

        {d.closed && <div className="flex items-center gap-1.5 text-info"><Lock className="w-3.5 h-3.5" />Skor dibekukan saat periode ditutup ({dt(d.closed.closed_at)}).</div>}
        {hist.length > 0 && (
          <div>
            <div className="font-bold mb-1.5">Riwayat skor akhir <span className="font-normal text-muted">({period.includes('Q') ? 'kuartal' : 'bulan'} yang sudah ditutup)</span></div>
            <div className="h-36 border border-line rounded-lg p-2"><ResponsiveContainer width="100%" height="100%"><LineChart data={hist.map((h) => ({ periode: h.label, skor: h.final_score }))} margin={{ left: -20, right: 10, top: 5 }}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="periode" tick={{ fontSize: 10 }} interval={0} /><YAxis domain={[0, 120]} tick={{ fontSize: 10 }} /><Tooltip /><Line type="monotone" dataKey="skor" stroke="#d84a4a" strokeWidth={2} dot /></LineChart></ResponsiveContainer></div>
          </div>
        )}

        <div>
          <div className="font-bold mb-1.5">KPI karyawan</div>
          {s.items.length ? (
            <div className="border border-line rounded-lg overflow-auto"><table className="w-full"><thead><tr>{['KPI', 'Metode', 'Target', 'Actual', 'Skor', 'Bobot'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead><tbody>
              {s.items.map((k) => <tr key={k.id}><td className="td"><b>{k.title}</b></td><td className="td">{k.auto ? 'Otomatis (tugas)' : 'Manual'}</td><td className="td">{num(k.target)} {k.unit}</td><td className="td">{num(k.actual_value)} {k.unit}{k.auto && <span className="text-muted"> ({k.linked_done}/{k.linked_tasks} tertaut)</span>}</td><td className="td"><b style={{ color: STATUS_COLOR[k.status] }}>{num(k.score)}%</b></td><td className="td">{k.weight ? `${num(k.weight, 0)}%` : '–'}</td></tr>)}
            </tbody></table></div>
          ) : <p className="text-muted">Belum ada KPI untuk periode ini.</p>}
        </div>

        <div>
          <div className="font-bold mb-1.5">Penyelesaian tugas <span className="font-normal text-muted">(tugas dengan deadline di periode ini yang sudah jatuh tempo atau selesai)</span></div>
          {d.tasks.length ? (
            <div className="border border-line rounded-lg overflow-auto max-h-56"><table className="w-full"><thead><tr>{['Tugas', 'Deadline', 'Status', 'Selesai', 'Ketepatan'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead><tbody>
              {d.tasks.map((t) => <tr key={t.id} className={t.counted ? '' : 'text-muted'}><td className="td">{t.title}</td><td className="td">{fmt(t.due_date)}</td><td className="td">{t.status === 'done' ? 'Selesai' : t.status === 'review' ? 'Menunggu approval' : t.status === 'in_progress' ? 'In progress' : 'To do'}</td><td className="td">{fmt(t.completed_at)}</td><td className="td">{!t.counted ? 'belum jatuh tempo' : t.status !== 'done' ? <Badge tone="red">belum selesai</Badge> : t.on_time ? <Badge tone="green">tepat waktu</Badge> : <Badge tone="amber">terlambat</Badge>}</td></tr>)}
            </tbody></table></div>
          ) : <p className="text-muted">Tidak ada tugas dengan deadline pada periode ini.</p>}
        </div>

        <div className="grid grid-cols-5 gap-2 text-center">
          {[['Hari wajib hadir', s.attendance.required], ['Hadir', s.attendance.present], ['Terlambat', s.attendance.late], ['Tidak hadir', s.attendance.absent], ['Cuti / izin / sakit', s.attendance.leave]].map(([l, v]) => <div key={l as string} className="bg-gray-50 rounded-lg py-2"><div className="text-lg font-extrabold">{v}</div><div className="text-[10.5px] text-muted">{l}</div></div>)}
        </div>
      </div>
    </Modal>
  )
}

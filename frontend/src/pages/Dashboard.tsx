import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import Layout from '../components/Layout/Layout'
import Badge from '../components/ui/Badge'
import ProgressBar from '../components/ui/ProgressBar'
import StatCard from '../components/ui/StatCard'
import { STATUS_COLOR, STATUS_TONE, pctText, scoreColor } from '../components/kpi/kpiUtils'
import { bizParams, useBusinessStore } from '../store/business'
import { getDashboard } from '../services/api'
import type { DashboardData, PerfRow } from '../types'

const TASK_COLORS: Record<string, string> = { todo: '#9aa3ad', in_progress: '#4f7fc6', review: '#c68a2a', done: '#2e9d65' }
const TASK_LABEL: Record<string, string> = { todo: 'To Do', in_progress: 'In Progress', review: 'Menunggu Approval', done: 'Selesai' }

const Panel = ({ title, hint, children, className = '' }: { title: string; hint?: string; children: React.ReactNode; className?: string }) => (
  <div className={`card p-4 ${className}`}><div className="mb-2"><b className="text-[13px]">{title}</b>{hint && <span className="text-muted text-[10.5px]"> · {hint}</span>}</div>{children}</div>
)

function Perf({ rows, good, att }: { rows: PerfRow[]; good: number; att: number }) {
  if (!rows.length) return <p className="text-xs text-muted">Belum ada data</p>
  return <div className="space-y-2">{rows.map((r) => (
    <div key={r.name} className="flex items-center gap-2 text-xs">
      <div className="flex-1 min-w-0"><div className="font-semibold truncate">{r.name}</div><div className="text-muted text-[10.5px] truncate">{r.unit}</div></div>
      <b style={{ color: scoreColor(r.score, good, att) }}>{pctText(r.score)}</b><Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
    </div>))}</div>
}

export default function Dashboard() {
  const { businessId } = useBusinessStore()
  const [d, setD] = useState<DashboardData | null>(null)
  useEffect(() => { getDashboard(bizParams(businessId)).then((r) => setD(r.data)).catch(() => setD(null)) }, [businessId])
  if (!d) return <Layout title="Dashboard" subtitle="Ringkasan operasional"><p className="text-sm text-muted">Memuat…</p></Layout>
  const a = d.attendance, k = d.kpi, good = k.settings.good_min, att = k.settings.attention_min
  const taskPie = Object.entries(d.tasks.status).map(([s, v]) => ({ name: TASK_LABEL[s], value: v, key: s })).filter((x) => x.value > 0)
  const kpiBars = [{ name: 'Good', jumlah: k.good, fill: STATUS_COLOR.Good }, { name: 'Attention', jumlah: k.attention, fill: STATUS_COLOR.Attention }, { name: 'Critical', jumlah: k.critical, fill: STATUS_COLOR.Critical }]
  const alerts = [
    d.people.expiring > 0 && { t: `${d.people.expiring} kontrak berakhir ≤ 30 hari`, to: '/contracts' },
    d.tasks.overdue > 0 && { t: `${d.tasks.overdue} tugas melewati deadline`, to: '/tasks' },
    d.pending_leave > 0 && { t: `${d.pending_leave} pengajuan cuti/izin menunggu approval`, to: '/leave' },
    d.me.pending_approvals > 0 && { t: `${d.me.pending_approvals} approval menunggu keputusan Anda`, to: '/approval' },
    d.people.vacant > 0 && { t: `${d.people.vacant} posisi masih vacant`, to: '/org' },
  ].filter(Boolean) as { t: string; to: string }[]
  return (
    <Layout title="Dashboard" subtitle={`Ringkasan operasional · ${d.scope}`}>
      <div className="grid grid-cols-6 gap-3 mb-3">
        <StatCard label="Karyawan Aktif" value={d.people.active} foot={`${d.people.tetap} tetap · ${d.people.kontrak} kontrak · ${d.people.freelance} freelance`} />
        <StatCard label="Hadir Hari Ini" value={`${a.present}/${a.scheduled}`} foot="dari jadwal kerja hari ini" />
        <StatCard label="Terlambat Hari Ini" value={a.late} foot={`${a.leave} cuti/izin/sakit`} />
        <StatCard label="Tugas Terlambat" value={<span className={d.tasks.overdue > 0 ? 'text-brand' : ''}>{d.tasks.overdue}</span>} foot={`${d.tasks.due_week} jatuh tempo 7 hari`} />
        <StatCard label="Tugas Saya" value={d.me.open_tasks} foot={`${d.me.overdue_tasks} terlambat`} />
        <StatCard label={`Skor KPI ${k.period}`} value={<span style={{ color: scoreColor(k.scored ? k.average : null, good, att) }}>{k.scored ? pctText(k.average) : '–'}</span>} foot={`${k.scored} karyawan dinilai${k.closed ? ' · ditutup' : ''}`} />
      </div>

      {alerts.length > 0 && (
        <div className="card p-3 mb-3 flex flex-wrap gap-2 items-center text-xs"><b className="mr-1">Perlu perhatian:</b>
          {alerts.map((x) => <Link key={x.t} to={x.to} className="px-2.5 py-1 rounded-full bg-brand-soft text-brand font-semibold hover:opacity-80">{x.t}</Link>)}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 mb-3">
        <Panel title="Kehadiran 7 hari terakhir" className="col-span-2">
          <div className="h-56"><ResponsiveContainer width="100%" height="100%"><BarChart data={a.trend} margin={{ left: -20, right: 12, top: 12 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar isAnimationActive={false} dataKey="present" name="Hadir" stackId="a" fill="#2e9d65" /><Bar isAnimationActive={false} dataKey="late" name="Terlambat" stackId="a" fill="#c68a2a" /><Bar isAnimationActive={false} dataKey="leave" name="Cuti/Izin/Sakit" stackId="a" fill="#4f7fc6" /><Bar isAnimationActive={false} dataKey="absent" name="Tidak hadir" stackId="a" fill="#d84a4a" /></BarChart></ResponsiveContainer></div>
        </Panel>
        <Panel title="Status tugas" hint="tugas kerja (tanpa induk)">
          {taskPie.length ? <div className="h-56"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie isAnimationActive={false} data={taskPie} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>{taskPie.map((x) => <Cell key={x.key} fill={TASK_COLORS[x.key]} />)}</Pie><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart></ResponsiveContainer></div> : <p className="text-xs text-muted py-16 text-center">Belum ada tugas</p>}
        </Panel>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3">
        <Panel title="Tugas dibuat vs selesai" hint="6 minggu terakhir">
          <div className="h-44"><ResponsiveContainer width="100%" height="100%"><LineChart data={d.tasks.weekly} margin={{ left: -20, right: 12, top: 12 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} tick={{ fontSize: 10 }} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
            <Line isAnimationActive={false} type="monotone" dataKey="created" name="Dibuat" stroke="#4f7fc6" strokeWidth={2} /><Line isAnimationActive={false} type="monotone" dataKey="completed" name="Selesai" stroke="#2e9d65" strokeWidth={2} /></LineChart></ResponsiveContainer></div>
        </Panel>
        <Panel title={`Sebaran skor KPI · ${k.period}`}>
          <div className="h-44"><ResponsiveContainer width="100%" height="100%"><BarChart data={kpiBars} margin={{ left: -20, right: 12, top: 12 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 10 }} /><Tooltip /><Bar isAnimationActive={false} dataKey="jumlah" name="Karyawan">{kpiBars.map((x) => <Cell key={x.name} fill={x.fill} />)}</Bar></BarChart></ResponsiveContainer></div>
        </Panel>
        <Panel title="Sedang cuti / izin hari ini">
          {d.on_leave.length ? <div className="space-y-1.5 text-xs">{d.on_leave.map((l, i) => <div key={i} className="flex justify-between gap-2"><span className="font-semibold">{l.name}</span><span className="text-muted">{l.type} · s/d {l.until}</span></div>)}</div> : <p className="text-xs text-muted">Tidak ada yang cuti hari ini</p>}
        </Panel>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Panel title="Proyek aktif" hint={`${d.projects.active} proyek`}>
          {d.projects.top.length ? <div className="space-y-3">{d.projects.top.map((p) => (
            <Link to={`/projects/${p.id}`} key={p.id} className="block text-xs hover:opacity-80"><div className="flex justify-between"><b>{p.name}</b><span className="text-muted">{p.overdue > 0 ? <span className="text-brand">{p.overdue} terlambat</span> : p.owner}</span></div><ProgressBar value={p.progress} color="#d84a4a" label small /></Link>))}</div> : <p className="text-xs text-muted">Belum ada proyek aktif</p>}
        </Panel>
        <Panel title="Performa terbaik" hint={k.period}><Perf rows={k.top} good={good} att={att} /></Panel>
        <Panel title="Perlu pembinaan" hint="skor terendah"><Perf rows={k.bottom} good={good} att={att} /></Panel>
      </div>
    </Layout>
  )
}

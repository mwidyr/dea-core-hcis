import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Download } from 'lucide-react'
import Layout from '../components/Layout/Layout'
import ActivityModal from '../components/ActivityModal'
import Badge from '../components/ui/Badge'
import ProgressBar from '../components/ui/ProgressBar'
import StatCard from '../components/ui/StatCard'
import { TIMELINESS_TONE } from '../components/tasks/taskUtils'
import { bizParams, useBusinessStore } from '../store/business'
import { getActivity, getDashboard } from '../services/api'
import { exportPdf } from '../utils/pdf'
import type { ActivityItem, DashboardData, Timeliness } from '../types'

const dot = { ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger', info: 'bg-brand', muted: 'bg-muted' } as const
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const hm = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour12: false, hour: '2-digit', minute: '2-digit' }) : '–')
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

// Card with the prototype's section header (title + subtitle on the left, an action on the right)
function Section({ title, sub, action, children, className = '' }: { title: string; sub?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`card ${className}`}>
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2.5 border-b border-line">
        <div className="min-w-0"><h3 className="text-[15px] font-bold leading-tight">{title}</h3>{sub && <p className="text-[11.5px] text-muted mt-0.5">{sub}</p>}</div>
        {action}
      </div>
      {children}
    </div>
  )
}

const kpiTone = (v: number | null | undefined, good: number, attn: number) => (v === null || v === undefined ? 'text-muted' : v >= good ? 'text-ok' : v >= attn ? 'text-warn' : 'text-danger')

export default function Dashboard() {
  const { businessId } = useBusinessStore()
  const nav = useNavigate()
  const [view, setView] = useState<'team' | 'me'>(() => { try { return localStorage.getItem('dash_view') === 'me' ? 'me' : 'team' } catch { return 'team' } })
  const [d, setD] = useState<DashboardData | null>(null)
  const [error, setError] = useState(false)
  const [allActivity, setAllActivity] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => { setError(false); getDashboard({ ...bizParams(businessId), view }).then((r) => setD(r.data)).catch(() => { setD(null); setError(true) }) }, [businessId, view])
  const pick = (v: 'team' | 'me') => { setView(v); try { localStorage.setItem('dash_view', v) } catch { /* ignore */ } }
  const mine = d?.view === 'me'

  const exportView = async () => {
    if (!d) return
    setBusy(true)
    try {
      // the PDF carries the whole day's log, not only the latest entries shown on screen
      const day = ymd(new Date())
      const log: ActivityItem[] = (await getActivity({ scope: mine ? 'me' : 'team', date: day, page: 1, page_size: 200 })).data.data
      const k = d.kpi
      const tasksOpen = (d.tasks.status.todo ?? 0) + (d.tasks.status.in_progress ?? 0) + (d.tasks.status.review ?? 0)
      const summary: [string, string | number][] = mine && d.personal
        ? [['Karyawan', d.personal.name], ['Absensi hari ini', d.personal.attendance_today.status], ['Sisa cuti', `${d.personal.leave.remaining} hari`], ['Task open', tasksOpen], ['Skor KPI', k.scored ? `${k.average}%` : '-']]
        : [['Karyawan aktif', d.people.active], ['Hadir hari ini', d.attendance.present], ['Task open', tasksOpen], ['Task overdue', d.tasks.overdue], ['Proyek aktif', d.projects.active], ['Rata-rata KPI', k.scored ? `${k.average}%` : '-']]
      exportPdf({
        title: `Dashboard ${mine ? 'Personal' : 'Tim Saya'}`, subtitle: `${d.scope} · ${new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`, summary,
        orientation: 'landscape', filename: `dashboard-${mine ? 'personal' : 'tim'}-${day}.pdf`,
        tables: [
          ...(mine ? [{ title: 'Tugas Saya', columns: ['Tugas', 'Proyek', 'Deadline', 'Status', 'Ketepatan', 'Progres'], rows: (d.personal?.my_tasks ?? []).map((t) => [t.title, t.project || '-', t.due || '-', t.status, t.timeliness_label || '-', `${Math.round(t.progress)}%`]) }]
            : [{ title: `Performance Departemen — ${k.period}`, columns: ['Unit', 'Skor KPI', 'Jumlah karyawan'], rows: (d.units ?? []).map((u) => [u.name, `${u.score}%`, u.count]) }]),
          { title: 'Perlu Perhatian', columns: ['Hal', 'Keterangan', 'Status'], rows: d.actions.map((a) => [a.title, a.sub, a.badge]) },
          { title: 'Project / Pekerjaan Aktif', columns: ['Proyek', 'Bisnis', 'PIC', 'Berakhir', 'Tugas (open/overdue)', 'Progres', 'Status'], rows: d.project_rows.map((p) => [p.name, p.business, p.owner, p.end || '-', `${p.tasks} (${p.open}/${p.overdue})`, `${Math.round(p.progress)}%`, p.status]) },
          ...(mine ? [] : [{ title: 'Team Performance', columns: ['Nama', 'Unit', 'Open Task', 'Overdue', 'KPI', 'Kehadiran'], rows: (d.team ?? []).map((t) => [t.name, t.unit || '-', t.open, t.overdue, t.kpi === null ? '-' : `${Math.round(t.kpi)}%`, t.attendance === null ? '-' : `${t.attendance}%`]) }]),
          { title: `Aktivitas Hari Ini (${log.length})`, columns: ['Jam', 'Pelaku', 'Aktivitas', 'Keterangan'], rows: log.map((a) => [a.time, a.actor, a.title, a.desc]) },
        ],
      })
    } finally { setBusy(false) }
  }

  const toggle = useMemo(() => (d?.can_team ? (
    <div className="flex gap-0.5 p-0.5 rounded-lg bg-tint" role="tablist" aria-label="Tampilan dashboard">
      {([['team', 'Tim Saya'], ['me', 'Personal']] as const).map(([v, l]) => <button key={v} role="tab" aria-selected={view === v} onClick={() => pick(v)} className={`px-3 py-1.5 rounded-md text-xs font-semibold ${view === v ? 'bg-panel shadow-sm text-brand' : 'text-muted'}`}>{l}</button>)}
    </div>) : null), [d?.can_team, view])
  const actions = <>{toggle}<button className="btn" disabled={!d || busy} onClick={exportView}><Download className="w-3.5 h-3.5 inline mr-1" />{busy ? 'Menyiapkan…' : 'Ekspor PDF'}</button></>

  if (!d) return <Layout title="Dashboard" subtitle="Ringkasan kondisi people, work dan performance"><p className="text-sm text-muted">{error ? 'Gagal memuat dashboard.' : 'Memuat…'}</p></Layout>

  const k = d.kpi, good = k.settings.good_min, attn = k.settings.attention_min
  const open = (d.tasks.status.todo ?? 0) + (d.tasks.status.in_progress ?? 0) + (d.tasks.status.review ?? 0)
  const att = d.attendance
  const presentPct = att.scheduled ? Math.round((att.present / att.scheduled) * 100) : 0
  const monthLabel = `${MONTHS[new Date().getMonth()]} ${new Date().getFullYear()}`
  const risky = d.project_rows.filter((p) => p.status === 'At Risk').length
  const p = d.personal

  const kpis = mine && p ? [
    { label: 'Absensi Hari Ini', value: p.attendance_today.status, foot: p.attendance_today.check_in ? `Masuk ${hm(p.attendance_today.check_in)}${p.attendance_today.check_out ? ` · pulang ${hm(p.attendance_today.check_out)}` : ''}` : 'Belum tap in' },
    { label: 'Task Open Saya', value: d.me.open_tasks, foot: <><span className={d.me.overdue_tasks > 0 ? 'text-danger font-bold' : ''}>{d.me.overdue_tasks} overdue</span> · {d.tasks.due_week} due minggu ini</> },
    { label: 'Sisa Cuti', value: `${p.leave.remaining} hari`, foot: `terpakai ${p.leave.used} · menunggu ${p.leave.pending}` },
    { label: 'Approval Menunggu', value: d.me.pending_approvals, foot: p.pending_leave_mine ? `${p.pending_leave_mine} pengajuan cuti Anda diproses` : 'untuk keputusan Anda' },
    { label: 'Skor KPI Saya', value: <span className={kpiTone(k.scored ? k.average : null, good, attn)}>{k.scored ? `${k.average}%` : '–'}</span>, foot: `Periode ${k.period}` },
  ] : [
    { label: 'Karyawan Aktif', value: d.people.active, foot: d.scope },
    { label: 'Hadir Hari Ini', value: att.present, foot: `${presentPct}% attendance · ${att.late} terlambat` },
    { label: 'Task Open', value: open, foot: <><span className={d.tasks.overdue > 0 ? 'text-danger font-bold' : ''}>{d.tasks.overdue} overdue</span> · {d.tasks.due_week} due minggu ini</> },
    { label: 'Proyek Aktif', value: d.projects.active, foot: risky ? `${risky} perlu perhatian` : 'semua berjalan baik' },
    { label: 'Rata-rata KPI', value: <span className={kpiTone(k.scored ? k.average : null, good, attn)}>{k.scored ? `${k.average}%`.replace('.', ',') : '–'}</span>, foot: `Target perusahaan ${k.settings.company_target}%` },
  ]

  return (
    <Layout title="Dashboard" subtitle="Ringkasan kondisi people, work dan performance" actions={actions}>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {kpis.map((c) => <StatCard key={c.label} label={c.label} value={c.value} foot={c.foot} />)}
      </div>

      <div className="grid xl:grid-cols-[1.35fr_.65fr] gap-3 mt-3">
        {mine && p ? (
          <Section title="Tugas Saya" sub="Diurutkan dari yang paling mendesak" action={<Link to="/tasks" className="btn">Buka Tugas</Link>}>
            <div className="divide-y divide-line">
              {p.my_tasks.map((t) => (
                <button key={t.id} onClick={() => nav(`/tasks?open=${t.id}`)} className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-sunken">
                  <div className="min-w-0 flex-1"><div className="font-semibold truncate">{t.title}</div><div className="text-[11px] text-muted truncate">{t.project || 'Non project'} · deadline {t.due || '–'}</div></div>
                  {t.timeliness && <Badge tone={TIMELINESS_TONE[t.timeliness as Exclude<Timeliness, ''>]}>{t.timeliness_label}</Badge>}
                  <div className="w-24 hidden sm:block"><ProgressBar value={t.progress} small /></div>
                </button>
              ))}
              {!p.my_tasks.length && <div className="px-4 py-8 text-center text-xs text-muted">Tidak ada tugas terbuka</div>}
            </div>
          </Section>
        ) : (
          <Section title="Performance Departemen" sub={`KPI bulan berjalan · ${monthLabel}`} action={<Link to="/kpi" className="btn">Detail</Link>}>
            <div className="p-4">
              {(d.units ?? []).map((u, i, a) => (
                <div key={u.name} className={i === a.length - 1 ? '' : 'mb-3'}>
                  <div className="flex justify-between text-[11px] mb-1"><span>{u.name} <span className="text-muted">· {u.count} orang</span></span><b className={kpiTone(u.score, good, attn)}>{u.score}%</b></div>
                  <ProgressBar value={u.score} label={false} color="rgb(var(--brand))" />
                </div>
              ))}
              {!(d.units ?? []).length && <p className="text-xs text-muted">Belum ada skor KPI periode ini</p>}
            </div>
          </Section>
        )}

        <Section title="Perlu Perhatian" sub="Action center hari ini">
          {d.actions.map((a, i) => (
            <Link key={a.title + i} to={a.to} className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-line last:border-0 hover:bg-sunken">
              <div className="min-w-0"><div className="font-semibold">{a.title}</div><div className="text-[11.5px] text-muted truncate">{a.sub}</div></div>
              <Badge tone={a.tone}>{a.badge}</Badge>
            </Link>
          ))}
        </Section>
      </div>

      <Section className="mt-3" title="Project / Pekerjaan Aktif" sub={mine ? 'Proyek yang Anda ikuti' : 'Monitoring progres project dan pekerjaan'} action={<Link to="/projects" className="btn">Lihat Semua Project</Link>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead><tr>{['Proyek / Program', 'Berakhir', 'Bisnis', 'PIC', 'Tugas', 'Kesiapan', 'Status'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>
              {d.project_rows.map((r) => (
                <tr key={r.id} className="hover:bg-sunken">
                  <td className="td"><Link to={`/projects/${r.id}`} className="font-bold hover:underline">{r.name}</Link>{r.desc && <div className="text-[11px] text-muted truncate max-w-[260px]">{r.desc}</div>}</td>
                  <td className="td whitespace-nowrap">{r.end || '–'}{r.days_left !== null && <div className={`text-[11px] ${r.days_left < 0 ? 'text-danger' : 'text-muted'}`}>{r.days_left < 0 ? `lewat ${-r.days_left} hari` : `${r.days_left} hari lagi`}</div>}</td>
                  <td className="td">{r.business}</td>
                  <td className="td">{r.owner}</td>
                  <td className="td whitespace-nowrap">{r.tasks}<div className="text-[11px] text-muted">{r.open} open · <span className={r.overdue ? 'text-danger font-bold' : ''}>{r.overdue} overdue</span></div></td>
                  <td className="td"><div className="flex items-center gap-2 min-w-[130px]"><div className="flex-1"><ProgressBar value={r.progress} label={false} small color="rgb(var(--brand))" /></div><b className="text-[10px]">{Math.round(r.progress)}%</b></div></td>
                  <td className="td"><Badge tone={r.status_tone}>{r.status}</Badge></td>
                </tr>
              ))}
              {!d.project_rows.length && <tr><td className="td text-center text-muted" colSpan={7}>Belum ada proyek aktif</td></tr>}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid xl:grid-cols-[1.35fr_.65fr] gap-3 mt-3">
        {mine && p ? (
          <Section title="Kehadiran & Cuti" sub={`Ringkasan pribadi · ${p.name}${p.position ? ` · ${p.position}` : ''}`} action={<Link to="/leave" className="btn">Cuti & Izin</Link>}>
            <div className="grid sm:grid-cols-2 gap-4 p-4">
              <div>
                <div className="text-[11px] text-muted">Absensi hari ini</div>
                <div className="text-lg font-extrabold">{p.attendance_today.status}</div>
                <div className="text-[11.5px] text-muted">{p.attendance_today.check_in ? `Masuk ${hm(p.attendance_today.check_in)}` : 'Belum tap in'}{p.attendance_today.check_out ? ` · pulang ${hm(p.attendance_today.check_out)}` : ''}{p.attendance_today.late_minutes ? ` · terlambat ${p.attendance_today.late_minutes} mnt` : ''}</div>
                <Link to="/absen" className="btn inline-block mt-2">Buka halaman absen</Link>
              </div>
              <div>
                <div className="text-[11px] text-muted">Saldo cuti tahunan</div>
                <div className="text-lg font-extrabold">{p.leave.remaining} <span className="text-xs font-normal text-muted">dari {p.leave.initial} hari</span></div>
                <div className="mt-1"><ProgressBar value={p.leave.initial ? (p.leave.remaining / p.leave.initial) * 100 : 0} label={false} small color="rgb(var(--ok))" /></div>
                <div className="text-[11.5px] text-muted mt-1">terpakai {p.leave.used} · menunggu persetujuan {p.leave.pending}</div>
              </div>
            </div>
          </Section>
        ) : (
          <Section title="Team Performance" sub="Karyawan yang perlu dimonitor dari task dan KPI" action={<Link to="/employees" className="btn">Buka Karyawan</Link>}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px]">
                <thead><tr>{['Nama', 'Unit', 'Open Task', 'Overdue', 'KPI', 'Kehadiran'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
                <tbody>
                  {(d.team ?? []).map((t) => (
                    <tr key={t.employee_id}>
                      <td className="td"><b>{t.name}</b></td><td className="td">{t.unit || '–'}</td><td className="td">{t.open}</td>
                      <td className="td">{t.overdue > 0 ? <span className="text-danger font-extrabold">{t.overdue}</span> : 0}</td>
                      <td className="td">{t.kpi === null ? '–' : <b className={kpiTone(t.kpi, good, attn)}>{Math.round(t.kpi)}%</b>}</td>
                      <td className="td">{t.attendance === null ? '–' : <Badge tone={t.attendance >= 95 ? 'green' : t.attendance >= 85 ? 'amber' : 'red'}>{t.attendance}%</Badge>}</td>
                    </tr>
                  ))}
                  {!(d.team ?? []).length && <tr><td className="td text-center text-muted" colSpan={6}>Belum ada data tim</td></tr>}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        <Section title="Aktivitas Hari Ini" sub="Update terbaru lintas modul" action={<button className="btn" onClick={() => setAllActivity(true)}>Lihat semua{d.activity_total > d.activity.length ? ` (${d.activity_total})` : ''}</button>}>
          <ol className="relative border-l border-line ml-6 mr-4 my-4 space-y-3">
            {d.activity.map((a) => (
              <li key={a.id} className="pl-4 relative">
                <span className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full ${dot[a.tone]}`} />
                <div className="font-semibold">{a.time} · {a.link ? <Link to={a.link} className="hover:underline">{a.title}</Link> : a.title}</div>
                <div className="text-[11.5px] text-muted">{a.actor ? `${a.actor}${a.desc ? ' · ' : ''}` : ''}{a.desc}</div>
              </li>
            ))}
            {!d.activity.length && <li className="pl-4 text-muted text-xs">Belum ada aktivitas hari ini</li>}
          </ol>
        </Section>
      </div>

      {allActivity && <ActivityModal scope={mine ? 'me' : 'team'} onClose={() => setAllActivity(false)} />}
    </Layout>
  )
}

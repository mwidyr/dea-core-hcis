import { useCallback, useEffect, useState } from 'react'
import { Pause, Play, Plus, Square } from 'lucide-react'
import Badge from '../ui/Badge'
import Modal from '../ui/Modal'
import TaskForm from './TaskForm'
import { TIMELINESS_LABEL, TIMELINESS_TONE, statusText, STATUS_TONE, doneClass, err, fmtShort, ymd } from './taskUtils'
import { completeTask, getActivityTasks, pauseTaskSession, startTaskSession } from '../../services/api'
import type { ActivityRow } from '../../types'

type Period = 'yesterday' | 'today' | 'tomorrow' | 'custom'
const PERIODS: [Period, string][] = [['today', 'Hari Ini'], ['yesterday', 'Kemarin'], ['tomorrow', 'Besok'], ['custom', 'Custom']]
const hm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour12: false, hour: '2-digit', minute: '2-digit' })
const dur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}j ${m % 60}m` : `${m}m`)
const shift = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d) }

// "Aktivitas / Tugas Harian": my tasks for a day with Mulai / Lanjutkan, Pause and Selesai. Actual time = the sessions logged here.
export default function ActivityPanel({ onOpen }: { onOpen: (id: number) => void }) {
  const [period, setPeriod] = useState<Period>('today')
  const [custom, setCustom] = useState(ymd(new Date()))
  const [rows, setRows] = useState<ActivityRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [msg, setMsg] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [finish, setFinish] = useState<ActivityRow | null>(null)
  const [note, setNote] = useState('')
  const [creating, setCreating] = useState(false)
  const [, tick] = useState(0)
  const date = period === 'today' ? shift(0) : period === 'yesterday' ? shift(-1) : period === 'tomorrow' ? shift(1) : custom

  const load = useCallback(() => getActivityTasks(date).then((r) => { setRows(r.data.data); setLoaded(true) }).catch(() => { setRows([]); setLoaded(true) }), [date])
  useEffect(() => { setLoaded(false); load() }, [load])
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t) }, []) // running minutes keep counting

  const run = async (r: ActivityRow, fn: () => Promise<unknown>) => {
    setMsg(''); setBusyId(r.id)
    try { await fn(); await load() } catch (e: any) { setMsg(err(e, 'Gagal memproses')) } finally { setBusyId(null) }
  }
  const submitFinish = async () => {
    if (!finish) return
    const r = finish
    try {
      await completeTask(r.id, note)
      setFinish(null); setNote(''); load()
    } catch (e: any) { setFinish(null); setMsg(err(e, 'Gagal menyelesaikan tugas')); if (r.require_result) onOpen(r.id) }
  }
  const live = (r: ActivityRow) => r.minutes // refreshed from the server each load; the 30 s tick re-renders the running label below

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2.5 border-b border-line flex-wrap">
        <div><h3 className="text-[15px] font-bold leading-tight">Aktivitas / Tugas Harian</h3><p className="text-[11.5px] text-muted mt-0.5">Tugas yang menjadi tanggung jawab Anda atau yang Anda ikuti sebagai anggota</p></div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-0.5 p-0.5 rounded-lg bg-tint">
            {PERIODS.map(([p, l]) => <button key={p} onClick={() => setPeriod(p)} className={`px-3 py-1.5 rounded-md text-xs font-semibold ${period === p ? 'bg-panel shadow-sm text-brand' : 'text-muted'}`}>{l}</button>)}
          </div>
          {period === 'custom' && <input type="date" className="input" value={custom} onChange={(e) => e.target.value && setCustom(e.target.value)} />}
          <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="w-3.5 h-3.5 inline mr-1" />Tugas</button>
        </div>
      </div>
      {msg && <div className="mx-4 mt-3 text-danger bg-danger-soft rounded-lg px-3 py-2 text-xs">{msg}</div>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px]">
          <thead><tr>{['Plan', 'Aktivitas / Tugas', 'Aktual', 'Ketepatan', 'Status / Hasil', 'Aksi'].map((h) => <th key={h} className="th uppercase">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-sunken">
                <td className="td whitespace-nowrap text-[11.5px]">
                  <div className="font-semibold">{r.plan_start_time || '–'} – {r.plan_end_time || '–'}</div>
                  <div className="text-muted">{fmtShort(r.start_date)} → {fmtShort(r.due_date)}</div>
                </td>
                <td className="td">
                  <button className={`font-semibold text-left hover:underline ${doneClass(r)}`} onClick={() => onOpen(r.id)}>{r.title}</button>
                  <div className="text-[11px] text-muted">{r.project_name || 'Non project'}{r.parent_title ? ` · ↳ ${r.parent_title}` : ''}{!r.is_pic ? ' · sebagai anggota' : ''}</div>
                </td>
                <td className="td text-[11.5px]">
                  {r.sessions.length ? (
                    <>
                      <div>{r.sessions.map((s) => `${hm(s.started_at)}–${s.ended_at ? hm(s.ended_at) : '…'}`).join(' + ')}</div>
                      <div className="text-muted">{dur(live(r))}{r.running ? ' · berjalan' : ''}</div>
                    </>
                  ) : <span className="text-muted">{r.status === 'done' && r.completed_at ? `selesai ${hm(r.completed_at)}` : '–'}</span>}
                </td>
                <td className="td">{r.timeliness ? <Badge tone={TIMELINESS_TONE[r.timeliness]}>{TIMELINESS_LABEL[r.timeliness]}</Badge> : <span className="text-muted">–</span>}</td>
                <td className="td"><Badge tone={STATUS_TONE[r.status]}>{statusText(r)}</Badge></td>
                <td className="td whitespace-nowrap">
                  <div className="flex gap-1.5">
                    {r.can_session && !r.running && <button className="btn-primary" disabled={busyId === r.id} onClick={() => run(r, () => startTaskSession(r.id))}><Play className="w-3 h-3 inline mr-1" />{r.sessions.length ? 'Lanjutkan' : 'Mulai'}</button>}
                    {r.can_session && r.running && <button className="btn" disabled={busyId === r.id} onClick={() => run(r, () => pauseTaskSession(r.id))}><Pause className="w-3 h-3 inline mr-1" />Pause</button>}
                    {r.can_finish && <button className="btn" onClick={() => { setNote(''); setFinish(r) }}><Square className="w-3 h-3 inline mr-1" />Selesai</button>}
                    {!r.can_session && <button className="btn" onClick={() => onOpen(r.id)}>Detail</button>}
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td className="td text-center text-muted py-8" colSpan={6}>{loaded ? 'Tidak ada tugas pada tanggal ini' : 'Memuat…'}</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal open={!!finish} onClose={() => setFinish(null)} title={`Selesaikan — ${finish?.title ?? ''}`}>
        <div className="space-y-3 text-xs">
          <label className="block font-semibold">Hasil pekerjaan / catatan<textarea className="input w-full mt-1" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. laporan terkirim ke atasan" /></label>
          <p className="text-muted">{finish?.requires_approval ? 'Tugas ini perlu approval: setelah diajukan statusnya menjadi Menunggu Approval.' : 'Tugas ini tanpa approval: langsung berstatus Selesai.'}{finish?.require_result ? ' Lampiran hasil wajib; jika belum ada, detail tugas akan dibuka.' : ''}</p>
          <div className="flex justify-end gap-2"><button className="btn" onClick={() => setFinish(null)}>Batal</button><button className="btn-primary" onClick={submitFinish}>Selesaikan</button></div>
        </div>
      </Modal>
      {creating && <TaskForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load() }} />}
    </div>
  )
}

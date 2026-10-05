import { useEffect, useState } from 'react'
import { Copy, ExternalLink, Plus } from 'lucide-react'
import Layout from '../components/Layout/Layout'
import Badge from '../components/ui/Badge'
import DataTable from '../components/ui/DataTable'
import DateField from '../components/ui/DateField'
import Modal from '../components/ui/Modal'
import Tabs from '../components/ui/Tabs'
import { useAuthStore } from '../store/auth'
import { bizParams, useBusinessStore } from '../store/business'
import { cancelManualAttendance, createManualAttendance, getApprovers, getAttendanceDaily, getAttendanceRecap, getAttendanceSchedule, getLeaveBalances, getManualAttendance } from '../services/api'
import type { AttRow, AttStatus, AttSummary, ManualRow, Person, RecapRow, ShiftRow } from '../types'

type Tab = 'daily' | 'recap' | 'schedule' | 'manual'
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const hm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour12: false, hour: '2-digit', minute: '2-digit' }) : '–')
const dur = (m: number) => (m ? `${Math.floor(m / 60)}j ${m % 60}m` : '–')
const fmtDate = (d: string) => new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: '2-digit' })
const tone: Record<AttStatus, 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'gray'> = { Hadir: 'green', Terlambat: 'amber', 'Belum Absen': 'gray', 'Tidak Hadir': 'red', Cuti: 'blue', Izin: 'purple', Sakit: 'purple', OFF: 'gray', Libur: 'gray', Terjadwal: 'gray' }
const manualTone = { 'Pending Approval': 'amber', Disetujui: 'green', Ditolak: 'red', Dibatalkan: 'gray' } as const
const err = (e: any, f: string) => e.response?.data?.error || f

export default function Attendance() {
  const { businessId } = useBusinessStore()
  const [tab, setTab] = useState<Tab>('daily')
  const [date, setDate] = useState(ymd(new Date()))
  const [month, setMonth] = useState(ymd(new Date()).slice(0, 7))
  const [daily, setDaily] = useState<{ rows: AttRow[]; summary: AttSummary }>({ rows: [], summary: {} })
  const [recap, setRecap] = useState<RecapRow[]>([])
  const [shifts, setShifts] = useState<ShiftRow[]>([])
  const [manual, setManual] = useState<ManualRow[]>([])
  const [fStatus, setFStatus] = useState('')
  const [form, setForm] = useState(false)
  const [copied, setCopied] = useState(false)
  const link = `${window.location.origin}/absen`

  const load = () => {
    const p = bizParams(businessId)
    if (tab === 'daily') getAttendanceDaily({ ...p, date }).then((r) => setDaily(r.data))
    if (tab === 'recap') getAttendanceRecap({ ...p, month }).then((r) => setRecap(r.data.rows))
    if (tab === 'schedule') getAttendanceSchedule({ ...p, date }).then((r) => setShifts(r.data.rows))
    if (tab === 'manual') getManualAttendance(p).then((r) => setManual(r.data))
  }
  useEffect(load, [businessId, tab, date, month])

  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { window.prompt('Salin link absen:', link) } }
  const s = daily.summary

  return (
    <Layout title="Absensi" subtitle="Kehadiran harian, rekap, jadwal/shift, dan pengajuan absensi manual">
      <div className="card p-3 mb-3 flex flex-wrap items-center gap-3 text-xs">
        <div className="flex-1 min-w-[260px]">
          <div className="font-bold">Halaman absen karyawan (tanpa login)</div>
          <div className="text-muted">Karyawan membuka link ini, memasukkan NIK/email dan password, lalu memilih Tap In atau Tap Out. Lokasi GPS dicatat.</div>
        </div>
        <code className="bg-gray-100 rounded-lg px-3 py-2 select-all">{link}</code>
        <button className="btn" onClick={copy}><Copy className="w-3 h-3 inline mr-1" />{copied ? 'Tersalin' : 'Salin'}</button>
        <a className="btn" href={link} target="_blank" rel="noreferrer"><ExternalLink className="w-3 h-3 inline mr-1" />Buka</a>
      </div>

      <div className="card p-4">
        <Tabs tabs={[{ id: 'daily', label: 'Harian' }, { id: 'recap', label: 'Rekap' }, { id: 'schedule', label: 'Jadwal / Shift' }, { id: 'manual', label: 'Absensi Manual' }]} value={tab} onChange={setTab} />

        {tab === 'daily' && <>
          <div className="grid md:grid-cols-2 gap-3 mb-3">
            <div className="rounded-lg border border-line border-l-4 border-l-ok p-3">
              <div className="text-[10.5px] text-muted font-semibold">HARI KERJA</div>
              <div className="flex items-end gap-5 mt-1 flex-wrap">
                <div><span className="text-3xl font-extrabold">{s.kerja ?? 0}</span> <span className="text-xs text-muted">orang</span></div>
                <Stat label="Hadir" v={s.hadir} /><Stat label="Izin" v={s.izin} /><Stat label="Sakit" v={s.sakit} /><Stat label="Belum Hadir" v={s.belum} />
                <span className="border-l border-line pl-4 flex gap-5"><Stat label="Terlambat" v={s.terlambat} /><Stat label="Kerja Hari Libur" v={s.kerja_hari_libur} /></span>
              </div>
            </div>
            <div className="rounded-lg border border-line border-l-4 border-l-gray-300 p-3">
              <div className="text-[10.5px] text-muted font-semibold">HARI NON-KERJA</div>
              <div className="flex items-end gap-5 mt-1">
                <div><span className="text-3xl font-extrabold">{s.nonkerja ?? 0}</span> <span className="text-xs text-muted">orang</span></div>
                <Stat label="Cuti" v={s.cuti} /><Stat label="OFF" v={s.off} /><Stat label="Libur" v={s.libur} />
              </div>
            </div>
          </div>
          <DataTable data={fStatus ? daily.rows.filter((r) => r.status === fStatus) : daily.rows} rowKey={(r) => r.employee_id} searchPlaceholder="Cari nama, NIK, lokasi…"
            searchText={(r) => `${r.name} ${r.nik} ${r.location_name} ${r.business_name} ${r.status}`}
            filters={<>
              <div className="w-40"><DateField value={date} onChange={setDate} businessId={businessId} /></div>
              <select className="input" value={fStatus} onChange={(e) => setFStatus(e.target.value)}><option value="">Semua Status</option>{Object.keys(tone).map((k) => <option key={k}>{k}</option>)}</select>
            </>}
            columns={[
              { head: 'Karyawan', render: (r) => <div><b>{r.name}</b><div className="text-muted text-[11px]">{r.nik} · {r.business_name}</div></div> },
              { head: 'Lokasi', render: (r) => r.location_name || '-' },
              { head: 'Kebijakan', render: (r) => <span className="text-muted">{r.policy}</span> },
              { head: 'Jadwal', render: (r) => <div>{r.schedule}{r.worked_on_off_day && <div><Badge tone="purple">Kerja Hari Libur</Badge></div>}{r.holiday && r.sched_status === 'libur' && <div className="text-[10.5px] text-muted">{r.holiday}</div>}</div> },
              { head: 'Check-in', render: (r) => hm(r.check_in) },
              { head: 'Check-out', render: (r) => hm(r.check_out) },
              { head: 'Jam Kerja', render: (r) => dur(r.work_minutes) },
              { head: 'Status', render: (r) => <Badge tone={tone[r.status]}>{r.status}</Badge> },
              { head: 'Keterangan', render: (r) => <span className="text-muted text-[11px]">{[r.late_minutes > 0 && `terlambat ${r.late_minutes} mnt`, r.early_leave_minutes > 0 && r.check_out && `pulang awal ${r.early_leave_minutes} mnt`, r.in_distance !== null && r.in_distance !== undefined && `${r.in_distance} m dari titik`, r.source === 'manual' && 'manual', r.leave_type && r.status !== 'Hadir' && r.status !== 'Terlambat' && r.leave_type].filter(Boolean).join(' · ') || '-'}</span> },
            ]} />
        </>}

        {tab === 'recap' && (
          <DataTable data={recap} rowKey={(r) => r.employee_id} searchPlaceholder="Cari nama atau NIK…" searchText={(r) => `${r.name} ${r.nik} ${r.business_name}`}
            filters={<input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />}
            columns={[
              { head: 'Karyawan', render: (r) => <div><b>{r.name}</b><div className="text-muted text-[11px]">{r.nik} · {r.business_name}</div></div> },
              { head: 'Hari Kerja', render: (r) => r.work_days },
              { head: 'Hadir', render: (r) => r.present - r.worked_off },
              { head: 'Terlambat', render: (r) => r.late ? <Badge tone="amber">{r.late}</Badge> : 0 },
              { head: 'Belum/Tidak Absen', render: (r) => r.absent ? <Badge tone="red">{r.absent}</Badge> : 0 },
              { head: 'Cuti', render: (r) => r.cuti },
              { head: 'Izin', render: (r) => r.izin },
              { head: 'Sakit', render: (r) => r.sakit },
              { head: 'Kerja Hari Libur', render: (r) => r.worked_off },
              { head: 'OFF / Libur', render: (r) => `${r.off} / ${r.holiday}` },
              { head: 'Total Jam', render: (r) => dur(r.work_minutes) },
              { head: 'Kehadiran', render: (r) => <b className={r.rate >= 90 ? 'text-ok' : r.rate >= 75 ? 'text-warn' : 'text-brand'}>{r.rate}%</b> },
            ]} />
        )}

        {tab === 'schedule' && (
          <DataTable data={shifts} rowKey={(r) => r.employee_id} searchPlaceholder="Cari nama, NIK, lokasi, pola…" searchText={(r) => `${r.name} ${r.nik} ${r.location_name} ${r.pattern} ${r.schedule_name}`}
            filters={<div className="w-40"><DateField value={date} onChange={setDate} businessId={businessId} /></div>}
            columns={[
              { head: 'Karyawan', render: (r) => <div><b>{r.name}</b><div className="text-muted text-[11px]">{r.nik} · {r.business_name}</div></div> },
              { head: 'Lokasi', render: (r) => r.location_name || '-' },
              { head: 'Kebijakan', render: (r) => <span className="text-muted">{r.policy}</span> },
              { head: 'Pola', render: (r) => <div>{r.pattern}{r.adjusted && <> <Badge tone="purple">Disesuaikan</Badge></>}<div className="text-muted text-[11px]">{r.schedule_name}</div></div> },
              { head: 'Hari Ini', render: (r) => <Badge tone={r.today_state === 'kerja' ? 'green' : 'gray'}>{r.today}</Badge> },
              { head: 'Besok', render: (r) => <Badge tone={r.tomorrow_state === 'kerja' ? 'green' : 'gray'}>{r.tomorrow}</Badge> },
            ]} />
        )}

        {tab === 'manual' && (
          <DataTable data={manual} rowKey={(r) => r.id} searchPlaceholder="Cari karyawan, alasan…" searchText={(r) => `${r.employee_name} ${r.reason} ${r.status}`}
            actions={<button className="btn-primary" onClick={() => setForm(true)}><Plus className="w-3.5 h-3.5 inline mr-1" />Ajukan Absensi Manual</button>}
            empty="Belum ada pengajuan absensi manual"
            columns={[
              { head: 'Karyawan', render: (r) => <div><b>{r.employee_name}</b><div className="text-muted text-[11px]">{r.unit_name}</div></div> },
              { head: 'Tanggal', render: (r) => fmtDate(r.date) },
              { head: 'Jam', render: (r) => `${r.check_in} – ${r.check_out}` },
              { head: 'Alasan', render: (r) => r.reason },
              { head: 'Status', render: (r) => <div><Badge tone={manualTone[r.status]}>{r.status === 'Pending Approval' ? 'Menunggu Persetujuan' : r.status}</Badge>{r.waiting_for && <div className="text-[10.5px] text-muted mt-0.5">oleh {r.waiting_for}</div>}</div> },
              { head: 'Aksi', render: (r) => r.can_cancel && <button className="btn text-brand" onClick={async () => { if (confirm('Batalkan pengajuan ini?')) { try { await cancelManualAttendance(r.id); load() } catch (e: any) { alert(err(e, 'Gagal membatalkan')) } } }}>Batalkan</button> },
            ]} />
        )}
      </div>

      {form && <ManualForm businessId={businessId} onClose={() => setForm(false)} onSaved={() => { setForm(false); load() }} />}
    </Layout>
  )
}

const Stat = ({ label, v }: { label: string; v?: number }) => <div className="text-center"><div className="text-lg font-bold leading-none">{v ?? 0}</div><div className="text-[10px] text-muted mt-0.5">{label}</div></div>

function ManualForm({ businessId, onClose, onSaved }: { businessId: number; onClose: () => void; onSaved: () => void }) {
  const user = useAuthStore((s) => s.user)
  const [opts, setOpts] = useState<{ employee_id: number; name: string; unit_name: string; business_name: string; business_id: number }[]>([])
  const [employeeId, setEmployeeId] = useState<number>(user?.employee_id ?? 0)
  const [date, setDate] = useState('')
  const [inT, setInT] = useState('08:00')
  const [outT, setOutT] = useState('17:00')
  const [reason, setReason] = useState('')
  const [nplus, setNplus] = useState<Person[]>([])
  const [cands, setCands] = useState<Person[]>([])
  const [assigned, setAssigned] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { // people this user may file for = the same scope as leave: self (+ subordinates / everyone for HR)
    getLeaveBalances({ ...bizParams(businessId), year: new Date().getFullYear() }).then((r) => { setOpts(r.data); if (!employeeId && r.data.length) setEmployeeId(r.data[0].employee_id) })
  }, [])
  useEffect(() => { if (employeeId) { setAssigned(0); getApprovers(employeeId).then((r) => { setNplus(r.data.nplus1); setCands(r.data.candidates) }) } }, [employeeId])
  const biz = opts.find((o) => o.employee_id === employeeId)?.business_id ?? 0
  const assignedPerson = cands.find((c) => c.user_id === assigned)
  const todayStr = ymd(new Date())
  const minDate = ymd(new Date(Date.now() - 31 * 864e5))

  const submit = async () => {
    setError('')
    if (!employeeId) return setError('Pilih karyawan')
    if (!date) return setError('Pilih tanggal')
    if (!reason.trim()) return setError('Alasan wajib diisi')
    if (outT <= inT) return setError('Jam keluar harus setelah jam masuk')
    setBusy(true)
    try { await createManualAttendance({ employee_id: employeeId, date, check_in: inT, check_out: outT, reason, assigned_user_id: assigned || null }); onSaved() } catch (e: any) { setError(err(e, 'Gagal mengajukan')) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="Ajukan Absensi Manual">
      <div className="space-y-3 text-xs">
        <p className="text-muted">Untuk lupa tap in / tap out atau kendala GPS. Setelah disetujui atasan, data masuk ke rekap kehadiran.</p>
        {opts.length > 1 && (
          <label className="block font-semibold">Karyawan <span className="font-normal text-muted">(diri sendiri atau bawahan)</span>
            <select className="input w-full mt-1" value={employeeId || ''} onChange={(e) => setEmployeeId(Number(e.target.value))}>{opts.map((o) => <option key={o.employee_id} value={o.employee_id}>{o.name}{o.employee_id === user?.employee_id ? ' (saya)' : ''}</option>)}</select>
          </label>
        )}
        <label className="block font-semibold">Tanggal <span className="font-normal text-muted">(31 hari terakhir)</span><div className="mt-1 font-normal"><DateField value={date} min={minDate} max={todayStr} businessId={biz} onChange={setDate} /></div></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block font-semibold">Jam masuk<input className="input w-full mt-1" type="time" value={inT} onChange={(e) => setInT(e.target.value)} /></label>
          <label className="block font-semibold">Jam keluar<input className="input w-full mt-1" type="time" value={outT} onChange={(e) => setOutT(e.target.value)} /></label>
        </div>
        <label className="block font-semibold">Alasan<textarea className="input w-full mt-1" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. lupa tap in, GPS bermasalah, dinas luar" /></label>
        <div className="border border-line rounded-lg p-3 bg-gray-50/60 space-y-2">
          <div className="font-bold">Persetujuan</div>
          {assigned ? <div className="text-ok bg-ok-soft rounded px-2 py-1.5">Hanya <b>{assignedPerson?.name}</b> yang menyetujui. Atasan (n+1) tidak diperlukan.</div> : <div>Atasan langsung (n+1): <b>{nplus.length ? nplus.map((p) => p.name).join(' → ') : '—'}</b></div>}
          <label className="block font-semibold">Tugaskan ke approver lain <span className="font-normal text-muted">(opsional)</span>
            <select className="input w-full mt-1" value={assigned} onChange={(e) => setAssigned(Number(e.target.value))}><option value={0}>— Tidak, gunakan atasan (n+1) —</option>{cands.map((c) => <option key={c.user_id} value={c.user_id}>{c.name} ({c.role})</option>)}</select>
          </label>
        </div>
        {error && <div className="text-brand bg-brand-soft rounded-lg px-3 py-2">{error}</div>}
        <div className="flex justify-end gap-2"><button className="btn" onClick={onClose}>Batal</button><button className="btn-primary" disabled={busy} onClick={submit}>{busy ? 'Mengirim…' : 'Ajukan'}</button></div>
      </div>
    </Modal>
  )
}

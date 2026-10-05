import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BellRing, Paperclip, Plus, X } from 'lucide-react'
import Layout from '../components/Layout/Layout'
import Badge from '../components/ui/Badge'
import DataTable from '../components/ui/DataTable'
import DateField from '../components/ui/DateField'
import FileThumbs from '../components/ui/FileThumbs'
import Modal from '../components/ui/Modal'
import { useAuthStore } from '../store/auth'
import { bizParams, useBusinessStore } from '../store/business'
import {
  adjustLeaveBalance, approveRequest, cancelLeaveRequest, createLeaveRequest, deleteLeaveAttachment, fetchLeaveAttachmentBlob, getApproval, getApprovers,
  getLeaveAttachments, getLeaveBalances, getLeaveCalc, getLeaveRequests, getLeaveSummary, getLeaveTypes, getRosterWindow, grantLeave, rejectRequest, uploadLeaveAttachment,
} from '../services/api'
import type { ApprovalRequest, FileItem, LeaveBalanceRow, LeaveCalc, LeaveRow, LeaveSummary, LeaveType, Person, RosterWindow } from '../types'

const fmt = (d: string) => new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: '2-digit' })
const dt = (d?: string | null) => (d ? new Date(d).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-')
const period = (r: LeaveRow) => (r.start_date.slice(0, 10) === r.end_date.slice(0, 10) ? fmt(r.start_date) : `${fmt(r.start_date)} – ${fmt(r.end_date)}`)
const statusTone = { 'Pending Approval': 'amber', Disetujui: 'green', Ditolak: 'red', Dibatalkan: 'gray' } as const
const timeTone: Record<string, 'blue' | 'purple' | 'gray'> = { 'Sedang Berlangsung': 'blue', 'Akan Datang': 'purple', Selesai: 'gray' }
const initials = (n: string) => n.split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase()
const err = (e: any, f: string) => e.response?.data?.error || f
const MAX_FILE = 10 * 1024 * 1024

export default function Leave() {
  const { businessId } = useBusinessStore()
  const user = useAuthStore((s) => s.user)
  const canAdjust = useAuthStore((s) => s.can)('leave.admin')
  const [mode, setMode] = useState<'data' | 'balance'>('data')
  const [rows, setRows] = useState<LeaveRow[]>([])
  const [balances, setBalances] = useState<LeaveBalanceRow[]>([])
  const [types, setTypes] = useState<LeaveType[]>([])
  const [summary, setSummary] = useState<LeaveSummary | null>(null)
  const [fType, setFType] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fTime, setFTime] = useState('')
  const [year, setYear] = useState(new Date().getFullYear())
  const [form, setForm] = useState(false)
  const [formStart, setFormStart] = useState('') // prefilled start date (from a reminder / banner)
  const [params, setParams] = useSearchParams()
  const [roster, setRoster] = useState<RosterWindow | null>(null)
  const [detail, setDetail] = useState<LeaveRow | null>(null)
  const [decision, setDecision] = useState<{ row: LeaveRow; approve: boolean; note: string } | null>(null)
  const [decisionError, setDecisionError] = useState('')
  const [adjust, setAdjust] = useState<LeaveBalanceRow | null>(null)
  const [grant, setGrant] = useState<{ b: LeaveBalanceRow; days: string; reason: string } | null>(null)
  const [grantError, setGrantError] = useState('')

  const load = () => {
    const p = bizParams(businessId)
    getLeaveRequests({ ...p, type_id: fType || undefined, status: fStatus || undefined, time: fTime || undefined }).then((r) => setRows(r.data))
    getLeaveSummary(p).then((r) => setSummary(r.data))
    getLeaveBalances({ ...p, year }).then((r) => setBalances(r.data))
  }
  useEffect(load, [businessId, fType, fStatus, fTime, year])
  useEffect(() => { getLeaveTypes().then((r) => setTypes(r.data)) }, [])
  // roster members only: reminder banner about the coming OFF block (everyone else sees nothing)
  const loadRoster = () => { if (user?.employee_id) getRosterWindow(user.employee_id).then((r) => setRoster(r.data)).catch(() => {}) }
  useEffect(loadRoster, [])
  // deep link from the reminder notification: /leave?new=1&from=YYYY-MM-DD opens the form on that date
  // (reacts to URL changes too: clicking the bell while already on this page only changes the query string)
  useEffect(() => {
    if (params.get('new')) { setFormStart(params.get('from') ?? ''); setForm(true); setParams({}, { replace: true }) }
  }, [params])
  const rw = roster?.is_roster ? roster.window : undefined
  const showBanner = !!rw && !roster?.has_request && (rw.in_off || rw.days_until_off <= 14)

  const cancel = async (r: LeaveRow) => {
    if (!confirm(r.status === 'Disetujui' ? 'Batalkan cuti yang sudah disetujui? Hari cuti akan dikembalikan ke saldo.' : 'Batalkan pengajuan ini?')) return
    try { await cancelLeaveRequest(r.id); setDetail(null); load() } catch (e: any) { alert(err(e, 'Gagal membatalkan')) }
  }
  const submitDecision = async () => {
    if (!decision) return
    if (!decision.approve && !decision.note.trim()) return setDecisionError('Alasan penolakan wajib diisi')
    try { await (decision.approve ? approveRequest : rejectRequest)(decision.row.approval_id!, decision.note); setDecision(null); setDecisionError(''); load() } catch (e: any) { setDecisionError(err(e, 'Gagal memproses')); load() }
  }
  const submitGrant = async () => {
    if (!grant) return
    const days = Number(grant.days)
    if (!days || days < 1) return setGrantError('Jumlah hari minimal 1')
    if (!grant.reason.trim()) return setGrantError('Alasan wajib diisi')
    try { await grantLeave(grant.b.employee_id, { year: grant.b.year, days, reason: grant.reason }); setGrant(null); setGrantError(''); load() } catch (e: any) { setGrantError(err(e, 'Gagal menambah cuti')) }
  }

  const Person = ({ name, sub }: { name: string; sub: string }) => (
    <div className="flex items-center gap-2"><span className="w-7 h-7 rounded-full bg-brand-soft text-brand grid place-items-center text-[10px] font-bold">{initials(name)}</span><span><b className="block leading-tight">{name}</b><small className="text-muted">{sub}</small></span></div>
  )

  return (
    <Layout title="Cuti & Izin" subtitle="Pengajuan cuti tahunan, izin, dan sakit — saldo cuti, lampiran dokumen, dan persetujuan atasan (n+1)">
      {showBanner && rw && (
        <div className="mb-3 rounded-xl border border-warn/40 bg-warn-soft p-3 text-xs flex items-start gap-3">
          <BellRing className="w-5 h-5 text-warn shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-bold text-gray-900">{rw.in_off ? 'Anda sedang dalam masa OFF roster' : `Masa OFF roster Anda dimulai ${rw.days_until_off === 1 ? 'besok' : `${rw.days_until_off} hari lagi`}`}</div>
            <div className="text-gray-700 mt-0.5">OFF {fmt(rw.off_start)} – {fmt(rw.off_end)}. Ingin memperpanjang libur? Cuti tahunan hanya dapat diajukan <b>bersambung setelah masa OFF</b>, mulai <b>{fmt(rw.leave_from)}</b> (tidak bisa di masa kerja atau sebelum OFF karena memotong hari kerja).</div>
          </div>
          <button className="btn-primary whitespace-nowrap" onClick={() => { setFormStart(rw.leave_from.slice(0, 10)); setForm(true) }}>Ajukan cuti mulai {fmt(rw.leave_from)}</button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 mb-3">
        <Score title="Karyawan Aktif" value={summary?.active ?? 0} unit="orang" />
        <Score title="Karyawan Tidak Bekerja" value={summary?.off ?? 0} unit="orang" tone="red" details={[['Cuti', summary?.cuti ?? 0], ['Izin', summary?.izin ?? 0], ['Sakit', summary?.sakit ?? 0]]} />
        <Score title="Karyawan Bekerja" value={summary?.working ?? 0} unit="orang" tone="green" details={[['Pending Pengajuan', summary?.pending ?? 0]]} />
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-extrabold tracking-wide">{mode === 'data' ? 'DATA CUTI & IZIN' : `SALDO CUTI ${year}`}</div>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
            {(['data', 'balance'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={`px-3 py-1 rounded-md text-xs font-semibold ${mode === m ? 'bg-white shadow-sm text-brand' : 'text-muted'}`}>{m === 'data' ? 'Data' : 'Saldo Cuti'}</button>
            ))}
          </div>
        </div>

        {mode === 'data' ? (
          <DataTable data={rows} rowKey={(r) => r.id} searchPlaceholder="Cari karyawan, jenis, alasan…"
            searchText={(r) => `${r.employee_name} ${r.unit_name} ${r.type_name} ${r.reason} ${r.status} ${r.waiting_for}`}
            filters={<>
              <select className="input" value={fType} onChange={(e) => setFType(e.target.value)}><option value="">Semua Jenis</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
              <select className="input" value={fStatus} onChange={(e) => setFStatus(e.target.value)}><option value="">Semua Status</option>{Object.keys(statusTone).map((s) => <option key={s}>{s}</option>)}</select>
              <select className="input" value={fTime} onChange={(e) => setFTime(e.target.value)}><option value="">Semua Waktu</option><option>Akan Datang</option><option>Sedang Berlangsung</option><option>Selesai</option></select>
            </>}
            actions={<button className="btn-primary" onClick={() => setForm(true)}><Plus className="w-3.5 h-3.5 inline mr-1" />Ajukan Cuti / Izin</button>}
            columns={[
              { head: 'Karyawan', render: (r) => <Person name={r.employee_name} sub={r.unit_name || r.business_name} /> },
              { head: 'Jenis', render: (r) => <span className="inline-flex items-center gap-1">{r.type_name}{r.attachment_count > 0 && <span title={`${r.attachment_count} lampiran`} className="inline-flex items-center text-muted"><Paperclip className="w-3 h-3" />{r.attachment_count}</span>}</span> },
              { head: 'Tanggal', render: (r) => period(r) },
              { head: 'Durasi', render: (r) => `${r.days} hari` },
              { head: 'Kembali Kerja', render: (r) => fmt(r.back_date) },
              { head: 'Alasan', render: (r) => <span className="line-clamp-2">{r.reason || '-'}</span> },
              { head: 'Status', render: (r) => <div><Badge tone={statusTone[r.status]}>{r.status === 'Pending Approval' ? 'Menunggu Persetujuan' : r.status}</Badge>{r.waiting_for && <div className="text-[10.5px] text-muted mt-0.5">oleh {r.waiting_for}</div>}</div> },
              { head: 'Waktu', render: (r) => r.status === 'Disetujui' ? <Badge tone={timeTone[r.time_state] ?? 'gray'}>{r.time_state}</Badge> : '-' },
              { head: 'Aksi', render: (r) => (
                <div className="flex gap-1.5 whitespace-nowrap">
                  <button className="btn" onClick={() => setDetail(r)}>Detail</button>
                  {r.can_decide && <>
                    <button className="btn-primary" onClick={() => { setDecisionError(''); setDecision({ row: r, approve: true, note: '' }) }}>Setujui</button>
                    <button className="btn text-brand" onClick={() => { setDecisionError(''); setDecision({ row: r, approve: false, note: '' }) }}>Tolak</button>
                  </>}
                  {r.can_cancel && <button className="btn text-brand" onClick={() => cancel(r)}>Batalkan</button>}
                </div>) },
            ]} />
        ) : (
          <DataTable data={balances} rowKey={(b) => b.employee_id} searchPlaceholder="Cari karyawan atau unit…"
            searchText={(b) => `${b.name} ${b.unit_name} ${b.business_name}`}
            filters={<select className="input" value={year} onChange={(e) => setYear(Number(e.target.value))}>{[year - 1, year, year + 1].filter((v, i, a) => a.indexOf(v) === i).map((y) => <option key={y}>{y}</option>)}</select>}
            columns={[
              { head: 'Karyawan', render: (b) => <Person name={b.name} sub={b.unit_name || b.business_name} /> },
              { head: 'Saldo Awal', render: (b) => b.initial },
              { head: 'Tambahan', render: (b) => b.added },
              { head: 'Terpakai', render: (b) => b.used },
              { head: 'Pending', render: (b) => b.pending ? <Badge tone="amber">{b.pending}</Badge> : 0 },
              { head: 'Cuti Bersama', render: (b) => <span title="Libur yang memotong cuti, berlaku untuk semua karyawan">{b.collective}</span> },
              { head: 'Sisa', render: (b) => <b className={b.remaining <= 2 ? 'text-brand' : 'text-ok'}>{b.remaining}</b> },
              { head: 'Kedaluwarsa', render: (b) => fmt(b.expiry) },
              { head: 'Aksi', render: (b) => (
                <div className="flex gap-1.5 whitespace-nowrap">
                  {b.can_grant && <button className="btn" onClick={() => { setGrantError(''); setGrant({ b, days: '1', reason: '' }) }}>Tambah Cuti</button>}
                  {canAdjust && <button className="btn" onClick={() => setAdjust(b)}>Atur</button>}
                </div>) },
            ]} />
        )}
      </div>

      {form && <LeaveForm types={types} year={year} businessId={businessId} initialStart={formStart} onClose={() => { setForm(false); setFormStart('') }} onSaved={() => { setForm(false); setFormStart(''); load(); loadRoster() }} />}

      {detail && <LeaveDetail row={detail} types={types} onClose={() => setDetail(null)} onCancel={() => cancel(detail)} onChanged={load} />}

      <Modal open={!!decision} onClose={() => setDecision(null)} title={decision?.approve ? 'Setujui Pengajuan' : 'Tolak Pengajuan'}>
        {decision && (
          <div className="space-y-3 text-xs">
            <div className="bg-gray-50 rounded-lg p-3"><b>{decision.row.type_name} — {decision.row.employee_name}</b><div className="text-muted mt-0.5">{period(decision.row)} · {decision.row.days} hari · {decision.row.reason || 'tanpa alasan'}</div></div>
            {decision.row.attachment_count > 0 && <div><div className="font-bold mb-1">Lampiran (validasi dokumen)</div><LeaveFiles id={decision.row.id} /></div>}
            <label className="block font-semibold">Catatan {decision.approve ? '(opsional)' : '(wajib)'}<textarea className="input w-full mt-1" rows={3} value={decision.note} onChange={(e) => setDecision({ ...decision, note: e.target.value })} /></label>
            {decisionError && <div className="text-brand bg-brand-soft rounded-lg px-3 py-2">{decisionError}</div>}
            <div className="flex justify-end gap-2"><button className="btn" onClick={() => setDecision(null)}>Batal</button><button className={decision.approve ? 'btn-primary' : 'btn-primary !bg-gray-800 !border-gray-800'} onClick={submitDecision}>{decision.approve ? 'Setujui' : 'Tolak'}</button></div>
          </div>
        )}
      </Modal>

      <Modal open={!!grant} onClose={() => setGrant(null)} title={`Tambah Cuti — ${grant?.b.name ?? ''}`}>
        {grant && (
          <div className="space-y-3 text-xs">
            <p className="text-muted">Menambah jumlah hari cuti tahun {grant.b.year}. Saldo sekarang: <b className="text-gray-800">sisa {grant.b.remaining} hari</b>. Pemberian tercatat di audit log.</p>
            <label className="block font-semibold">Jumlah hari tambahan<input className="input w-full mt-1" type="number" min={1} max={60} value={grant.days} onChange={(e) => setGrant({ ...grant, days: e.target.value })} /></label>
            <label className="block font-semibold">Alasan<textarea className="input w-full mt-1" rows={2} value={grant.reason} onChange={(e) => setGrant({ ...grant, reason: e.target.value })} placeholder="mis. kompensasi lembur proyek, bonus kinerja…" /></label>
            {grantError && <div className="text-brand bg-brand-soft rounded-lg px-3 py-2">{grantError}</div>}
            <div className="flex justify-end gap-2"><button className="btn" onClick={() => setGrant(null)}>Batal</button><button className="btn-primary" onClick={submitGrant}>Tambahkan</button></div>
          </div>
        )}
      </Modal>

      <Modal open={!!adjust} onClose={() => setAdjust(null)} title={`Atur Saldo — ${adjust?.name ?? ''}`}>
        {adjust && (
          <div className="space-y-3 text-xs">
            <label className="block font-semibold">Saldo Awal {adjust.year}<input className="input w-full mt-1" type="number" min={0} value={adjust.initial} onChange={(e) => setAdjust({ ...adjust, initial: Number(e.target.value) })} /></label>
            <label className="block font-semibold">Tambahan (total)<input className="input w-full mt-1" type="number" value={adjust.added} onChange={(e) => setAdjust({ ...adjust, added: Number(e.target.value) })} /></label>
            <div className="flex justify-end gap-2"><button className="btn" onClick={() => setAdjust(null)}>Batal</button>
              <button className="btn-primary" onClick={async () => { await adjustLeaveBalance(adjust.employee_id, { year: adjust.year, initial: adjust.initial, added: adjust.added }); setAdjust(null); load() }}>Simpan</button></div>
          </div>
        )}
      </Modal>
    </Layout>
  )
}

function Score({ title, value, unit, tone, details }: { title: string; value: number; unit: string; tone?: 'red' | 'green'; details?: [string, number][] }) {
  return (
    <div className={`card p-4 border-l-4 ${tone === 'red' ? 'border-l-brand' : tone === 'green' ? 'border-l-ok' : 'border-l-gray-300'}`}>
      <div className="text-[10.5px] text-muted font-semibold">{title}</div>
      <div className="flex items-end gap-4 mt-1">
        <div><span className="text-3xl font-extrabold">{value}</span> <span className="text-xs text-muted">{unit}</span></div>
        {details && <div className="flex gap-4 ml-auto">{details.map(([l, v]) => <div key={l} className="text-center"><div className="text-lg font-bold leading-none">{v}</div><div className="text-[10px] text-muted mt-0.5">{l}</div></div>)}</div>}
      </div>
    </div>
  )
}

// attachments of a leave request (viewable by requester, superiors, approvers, HR)
function LeaveFiles({ id, canEdit, onChanged }: { id: number; canEdit?: boolean; onChanged?: () => void }) {
  const [items, setItems] = useState<FileItem[]>([])
  const [error, setError] = useState('')
  const reload = () => getLeaveAttachments(id).then((r) => setItems(r.data.map((a) => ({ ...a, label: a.file_name })))).catch(() => {})
  useEffect(() => { reload() }, [id])
  const add = async (file: File | undefined) => {
    if (!file) return
    if (file.size > MAX_FILE) return setError('File lebih dari 10 MB')
    try { setError(''); await uploadLeaveAttachment(id, file); await reload(); onChanged?.() } catch (e: any) { setError(err(e, 'Gagal mengunggah')) }
  }
  const del = async (f: FileItem) => {
    if (!confirm(`Hapus lampiran "${f.file_name}"?`)) return
    try { setError(''); await deleteLeaveAttachment(id, f.id); await reload(); onChanged?.() } catch (e: any) { setError(err(e, 'Gagal menghapus')) }
  }
  return (
    <div className="space-y-2">
      <FileThumbs items={items} fetchBlob={(aid) => fetchLeaveAttachmentBlob(id, aid).then((r) => r.data)} onDelete={canEdit ? del : undefined} empty="Tidak ada lampiran." />
      {canEdit && <label className="btn inline-block cursor-pointer"><Plus className="w-3 h-3 inline mr-1" />Tambah lampiran<input type="file" className="hidden" accept="image/*,application/pdf" onChange={(e) => { add(e.target.files?.[0]); e.target.value = '' }} /></label>}
      {error && <div className="text-brand bg-brand-soft rounded-lg px-3 py-2">{error}</div>}
    </div>
  )
}

function LeaveDetail({ row, types, onClose, onCancel, onChanged }: { row: LeaveRow; types: LeaveType[]; onClose: () => void; onCancel: () => void; onChanged: () => void }) {
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'super_admin' || user?.role === 'hr_admin'
  const [ap, setAp] = useState<ApprovalRequest | null>(null)
  useEffect(() => { if (row.approval_id) getApproval(row.approval_id).then((r) => setAp(r.data)).catch(() => {}) }, [row.approval_id])
  const own = row.employee_id === user?.employee_id
  const t = types.find((x) => x.id === row.type_id)
  const kindLabel = { 'n+1': 'atasan n+1', assigned: 'ditugaskan', fallback: 'HR' } as const
  return (
    <Modal open onClose={onClose} title={`${row.type_name} — ${row.employee_name}`}>
      <div className="space-y-4 text-xs">
        <dl className="grid grid-cols-2 gap-3">
          {[['Karyawan', `${row.employee_name} (${row.unit_name || row.business_name})`], ['Jenis', row.type_name], ['Tanggal', period(row)], ['Durasi', `${row.days} hari kerja`], ['Kembali Kerja', fmt(row.back_date)], ['Status', row.status], ['Alasan', row.reason || '-'], ['Diajukan', dt(ap?.created_at)]].map(([k, v]) => (
            <div key={k}><dt className="text-muted text-[10.5px]">{k}</dt><dd className="font-semibold">{v}</dd></div>
          ))}
        </dl>
        <div>
          <div className="font-bold mb-1.5">Lampiran {t?.requires_attachment && <span className="font-normal text-muted">(wajib untuk jenis ini)</span>}</div>
          <LeaveFiles id={row.id} canEdit={(own || isAdmin) && row.status === 'Pending Approval'} onChanged={onChanged} />
        </div>
        <div>
          <div className="font-bold mb-1.5">Alur Persetujuan</div>
          {ap ? <ol className="space-y-1.5">{ap.steps.map((s) => (
            <li key={s.id} className="flex items-start gap-2">
              <Badge tone={s.status === 'Approved' ? 'green' : s.status === 'Rejected' ? 'red' : s.status === 'Pending' ? 'amber' : 'gray'}>{s.status === 'Approved' ? 'Disetujui' : s.status === 'Rejected' ? 'Ditolak' : s.status === 'Pending' ? 'Menunggu' : s.status}</Badge>
              <span><b>{s.approver_name}</b> <span className="text-muted">({kindLabel[s.kind]})</span>{s.acted_at && <span className="text-muted"> · {dt(s.acted_at)}</span>}{s.note && <div className="text-muted">“{s.note}”</div>}</span>
            </li>))}</ol> : <p className="text-muted">Memuat…</p>}
        </div>
        <div className="flex justify-end gap-2"><button className="btn" onClick={onClose}>Tutup</button>{row.can_cancel && <button className="btn text-brand" onClick={onCancel}>Batalkan</button>}</div>
      </div>
    </Modal>
  )
}

// "21 Okt Cuti Bersama, OFF roster (7 hari)" — repeated names (e.g. a roster OFF block) collapse into one count
function skippedText(list: LeaveCalc['skipped']) {
  const byName = new Map<string, string[]>()
  list.forEach((x) => byName.set(x.name, [...(byName.get(x.name) ?? []), x.date]))
  return [...byName.entries()].map(([name, dates]) => dates.length > 1 ? `${name} (${dates.length} hari)` : `${new Date(dates[0]).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })} ${name}`).join(', ')
}

type Opt = { employee_id: number; name: string; unit_name: string; business_name: string; business_id: number }

function LeaveForm({ types, year, businessId, initialStart, onClose, onSaved }: { types: LeaveType[]; year: number; businessId: number; initialStart?: string; onClose: () => void; onSaved: () => void }) {
  const user = useAuthStore((s) => s.user)
  const [opts, setOpts] = useState<Opt[]>([])
  const [employeeId, setEmployeeId] = useState<number>(user?.employee_id ?? 0)
  const [typeId, setTypeId] = useState<number>(types.find((t) => t.deducts_balance)?.id ?? types[0]?.id ?? 0)
  const [start, setStart] = useState(initialStart ?? '')
  const [end, setEnd] = useState(initialStart ?? '')
  const [reason, setReason] = useState('')
  const [rosterInfo, setRosterInfo] = useState<RosterWindow | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [nplus, setNplus] = useState<Person[]>([])
  const [cands, setCands] = useState<Person[]>([])
  const [assigned, setAssigned] = useState(0)
  const [calc, setCalc] = useState<LeaveCalc | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // people this user may file for = exactly the balance scope: self (+ all subordinates for a superior, everyone for HR)
  useEffect(() => {
    getLeaveBalances({ ...bizParams(businessId), year }).then((r) => {
      setOpts(r.data)
      if (!employeeId && r.data.length) setEmployeeId(r.data[0].employee_id)
    })
  }, [])
  useEffect(() => {
    if (!employeeId) return
    setAssigned(0)
    getApprovers(employeeId).then((r) => { setNplus(r.data.nplus1); setCands(r.data.candidates) })
  }, [employeeId])
  useEffect(() => { // roster members get the rule hint; everyone else gets nothing
    if (employeeId) getRosterWindow(employeeId).then((r) => setRosterInfo(r.data)).catch(() => setRosterInfo(null))
  }, [employeeId])
  useEffect(() => { // weekends / holidays / roster OFF are not counted; the roster rule is previewed too
    if (!employeeId || !start || !end || end < start) { setCalc(null); return }
    getLeaveCalc(employeeId, start, end, typeId).then((r) => setCalc(r.data)).catch(() => setCalc(null))
  }, [employeeId, start, end, typeId])

  const empBusinessId = opts.find((o) => o.employee_id === employeeId)?.business_id ?? 0 // holidays shown = national + this employee's business
  const type = types.find((t) => t.id === typeId)
  const assignedPerson = cands.find((c) => c.user_id === assigned)
  const days = calc?.days ?? 0
  const forOthers = opts.length > 1
  const needFile = !!type?.requires_attachment
  const onPick = (list: FileList | null) => {
    if (!list) return
    const next = [...files]
    for (const f of Array.from(list)) {
      if (f.size > MAX_FILE) { setError(`"${f.name}" lebih dari 10 MB`); continue }
      if (next.length < 10) next.push(f)
    }
    setFiles(next)
  }

  const submit = async () => {
    setError('')
    if (!employeeId) return setError('Pilih karyawan')
    if (!start || !end) return setError('Tanggal mulai dan selesai wajib diisi')
    if (end < start) return setError('Tanggal selesai tidak boleh sebelum tanggal mulai')
    if (calc?.error) return setError(calc.error)
    if (!days) return setError('Rentang tanggal tidak mengandung hari kerja (akhir pekan, hari libur, atau masa OFF roster tidak dihitung)')
    if (needFile && !files.length) return setError(`Jenis "${type?.name}" wajib melampirkan dokumen pendukung (mis. surat dokter)`)
    setBusy(true)
    try {
      await createLeaveRequest({ employee_id: employeeId, type_id: typeId, start_date: start, end_date: end, reason, assigned_user_id: assigned || null }, files)
      onSaved()
    } catch (e: any) { setError(err(e, 'Gagal mengajukan')) } finally { setBusy(false) }
  }

  const noEmployee = !user?.employee_id && !opts.length
  return (
    <Modal open onClose={onClose} title="Ajukan Cuti / Izin">
      {noEmployee ? <p className="text-xs text-brand">Akun Anda belum terhubung ke data karyawan. Hubungi HR.</p> : (
        <div className="space-y-3 text-xs">
          {forOthers && (
            <label className="block font-semibold">Karyawan <span className="font-normal text-muted">(diri sendiri atau bawahan)</span>
              <select className="input w-full mt-1" value={employeeId || ''} onChange={(e) => setEmployeeId(Number(e.target.value))}>
                {opts.map((o) => <option key={o.employee_id} value={o.employee_id}>{o.name}{o.employee_id === user?.employee_id ? ' (saya)' : ''} — {o.unit_name || o.business_name}</option>)}
              </select>
            </label>
          )}
          <label className="block font-semibold">Jenis
            <select className="input w-full mt-1" value={typeId} onChange={(e) => setTypeId(Number(e.target.value))}>{types.filter((t) => t.is_active).map((t) => <option key={t.id} value={t.id}>{t.name}{t.deducts_balance ? ' (potong saldo)' : ''}{t.requires_attachment ? ' · wajib lampiran' : ''}</option>)}</select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block font-semibold">Tanggal Mulai<div className="mt-1 font-normal"><DateField value={start} businessId={empBusinessId} onChange={(v) => { setStart(v); if (!end || end < v) setEnd(v) }} /></div></label>
            <label className="block font-semibold">Tanggal Selesai<div className="mt-1 font-normal"><DateField value={end} min={start} businessId={empBusinessId} onChange={setEnd} /></div></label>
          </div>
          {rosterInfo?.is_roster && rosterInfo.window && type?.category === 'cuti' && (
            <div className="rounded-lg border border-warn/40 bg-warn-soft p-2.5">
              <div className="font-bold text-gray-900">Karyawan roster</div>
              <div className="text-gray-700">Cuti tahunan hanya dapat bersambung <b>tepat setelah masa OFF</b>: OFF {fmt(rosterInfo.window.off_start)} – {fmt(rosterInfo.window.off_end)}, cuti dimulai <b>{fmt(rosterInfo.window.leave_from)}</b>. Tidak bisa di masa kerja atau sebelum OFF. Sakit dan izin tidak dibatasi.</div>
              <button type="button" className="btn mt-1.5" onClick={() => { const d = rosterInfo.window!.leave_from.slice(0, 10); setStart(d); setEnd(d) }}>Isi mulai {fmt(rosterInfo.window.leave_from)}</button>
            </div>
          )}
          {calc?.error && <div className="text-brand bg-brand-soft rounded-lg px-3 py-2">{calc.error}</div>}
          {calc && (
            <div className="text-muted space-y-1">
              <div>Durasi: <b className="text-gray-800">{calc.days} hari kerja</b>{type?.deducts_balance && calc.days > 0 && <> · akan memotong saldo cuti</>}</div>
              {calc.skipped.length > 0 && <div className="text-[11px]">Tidak dihitung: {skippedText(calc.skipped)}</div>}
            </div>
          )}
          <label className="block font-semibold">Alasan<textarea className="input w-full mt-1" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Keperluan keluarga, sakit, dll." /></label>

          <div>
            <div className="font-semibold mb-1">Lampiran dokumen {needFile ? <span className="text-brand">(wajib — mis. surat dokter)</span> : <span className="font-normal text-muted">(opsional)</span>}</div>
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-2 border border-line rounded-lg px-2 py-1 mb-1"><Paperclip className="w-3 h-3 text-muted" /><span className="flex-1 truncate">{f.name}</span><span className="text-muted">{Math.max(1, Math.round(f.size / 1024))} KB</span>
                <button type="button" className="p-0.5" onClick={() => setFiles(files.filter((_, j) => j !== i))}><X className="w-3.5 h-3.5" /></button></div>
            ))}
            <label className="btn inline-block cursor-pointer"><Plus className="w-3 h-3 inline mr-1" />Lampirkan file<input type="file" multiple className="hidden" accept="image/*,application/pdf" onChange={(e) => { onPick(e.target.files); e.target.value = '' }} /></label>
            <span className="text-muted ml-2">JPG/PNG/WEBP/PDF, maks 10 MB per file</span>
          </div>

          <div className="border border-line rounded-lg p-3 bg-gray-50/60 space-y-2">
            <div className="font-bold">Persetujuan</div>
            {assigned ? (
              <div className="text-ok bg-ok-soft rounded px-2 py-1.5">Hanya <b>{assignedPerson?.name}</b> yang menyetujui. Persetujuan atasan (n+1) tidak diperlukan.</div>
            ) : (
              <div>Atasan langsung (n+1): <b>{nplus.length ? nplus.map((p) => p.name).join(' → ') : '—'}</b></div>
            )}
            <label className="block font-semibold">Tugaskan ke approver lain <span className="font-normal text-muted">(opsional)</span>
              <select className="input w-full mt-1" value={assigned} onChange={(e) => setAssigned(Number(e.target.value))}>
                <option value={0}>— Tidak, gunakan atasan (n+1) —</option>{cands.map((c) => <option key={c.user_id} value={c.user_id}>{c.name} ({c.role})</option>)}
              </select>
            </label>
          </div>

          {error && <div className="text-brand bg-brand-soft rounded-lg px-3 py-2">{error}</div>}
          <div className="flex justify-end gap-2"><button className="btn" onClick={onClose}>Batal</button><button className="btn-primary" disabled={busy || !!calc?.error} onClick={submit}>{busy ? 'Mengirim…' : 'Ajukan'}</button></div>
        </div>
      )}
    </Modal>
  )
}

import { useEffect, useState } from 'react'
import Layout from '../components/Layout/Layout'
import Badge from '../components/ui/Badge'
import DataTable from '../components/ui/DataTable'
import Modal from '../components/ui/Modal'
import Tabs from '../components/ui/Tabs'
import FileThumbs from '../components/ui/FileThumbs'
import { bizParams, useBusinessStore } from '../store/business'
import { approveRequest, fetchAttendancePhotoBlob, fetchLeaveAttachmentBlob, fetchTaskAttachmentBlob, getTaskAttachments, getApprovalHistory, getApprovalInbox, getLeaveAttachments, getMyApprovalRequests, rejectRequest } from '../services/api'
import type { ApprovalRequest, ApprovalStep, FileItem } from '../types'

const dt = (d?: string | null) => (d ? new Date(d).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-')
const typeLabel: Record<string, string> = { leave: 'Cuti & Izin', attendance_manual: 'Absensi Manual', task: 'Tugas', task_deadline: 'Deadline Tugas', attendance_location: 'Absen di Luar Lokasi', employee_change: 'Data Karyawan', roster: 'Roster' }
const tone = { Pending: 'amber', Approved: 'green', Rejected: 'red', Cancelled: 'gray' } as const
const label = { Pending: 'Menunggu', Approved: 'Disetujui', Rejected: 'Ditolak', Cancelled: 'Dibatalkan' } as const
const kind: Record<ApprovalStep['kind'], string> = { 'n+1': 'atasan n+1', assigned: 'ditugaskan', fallback: 'HR' }

// who is/was deciding, e.g. "Abdul Haq (atasan n+1)"
const chainText = (r: ApprovalRequest) => r.steps.map((s) => `${s.approver_name} (${kind[s.kind]})${s.status === 'Approved' ? ' ✓' : s.status === 'Rejected' ? ' ✗' : ''}`).join(' → ')

// leave requests carry supporting documents (e.g. surat dokter) that the approver validates
function LeaveFilesForApprover({ id }: { id: number }) {
  const [items, setItems] = useState<FileItem[]>([])
  useEffect(() => { getLeaveAttachments(id).then((r) => setItems(r.data.map((a) => ({ ...a, label: a.file_name })))).catch(() => {}) }, [id])
  return <FileThumbs items={items} fetchBlob={(aid) => fetchLeaveAttachmentBlob(id, aid).then((r) => r.data)} empty="Tidak ada lampiran." />
}

// The stamped tap photos (in / out) of an attendance record, for the approver judging an out-of-radius tap.
function TapPhotosForApprover({ recordId }: { recordId: number }) {
  const [urls, setUrls] = useState<{ kind: string; url: string }[]>([])
  const [done, setDone] = useState(false)
  useEffect(() => {
    let alive = true
    const made: string[] = []
    Promise.all((['in', 'out'] as const).map((k) => fetchAttendancePhotoBlob(recordId, k).then((r) => { const u = URL.createObjectURL(r.data); made.push(u); return { kind: k, url: u } }).catch(() => null)))
      .then((l) => { if (alive) setUrls(l.filter(Boolean) as { kind: string; url: string }[]) }).finally(() => { if (alive) setDone(true) })
    return () => { alive = false; made.forEach((u) => URL.revokeObjectURL(u)) }
  }, [recordId])
  if (!urls.length) return <p className="text-muted">{done ? 'Foto tidak tersedia.' : 'Memuat foto…'}</p>
  return <div className="grid grid-cols-2 gap-2">{urls.map((u) => <a key={u.kind} href={u.url} target="_blank" rel="noreferrer"><div className="text-[10.5px] text-muted mb-0.5">{u.kind === 'in' ? 'Tap In' : 'Tap Out'}</div><img src={u.url} alt={`Foto tap ${u.kind}`} className="w-full rounded-lg border border-line" /></a>)}</div>
}

function TaskFilesForApprover({ id }: { id: number }) {
  const [items, setItems] = useState<FileItem[]>([])
  useEffect(() => { getTaskAttachments(id).then((r) => setItems(r.data.map((a) => ({ ...a, label: a.file_name })))).catch(() => {}) }, [id])
  return <FileThumbs items={items} fetchBlob={(aid) => fetchTaskAttachmentBlob(id, aid).then((r) => r.data)} empty="Tidak ada lampiran hasil." />
}

export default function Approvals({ mode }: { mode: 'inbox' | 'history' }) {
  const { businessId } = useBusinessStore()
  const [tab, setTab] = useState<'inbox' | 'mine'>('inbox')
  const [rows, setRows] = useState<ApprovalRequest[]>([])
  const [decision, setDecision] = useState<{ req: ApprovalRequest; approve: boolean; note: string } | null>(null)
  const [error, setError] = useState('')

  const load = () => {
    const p = bizParams(businessId)
    const call = mode === 'history' ? getApprovalHistory(p) : tab === 'inbox' ? getApprovalInbox(p) : getMyApprovalRequests()
    call.then((r) => setRows(r.data))
  }
  useEffect(load, [businessId, mode, tab])

  const submit = async () => {
    if (!decision) return
    if (!decision.approve && !decision.note.trim()) return setError('Alasan penolakan wajib diisi')
    try {
      await (decision.approve ? approveRequest : rejectRequest)(decision.req.id, decision.note)
      setDecision(null); setError(''); load()
    } catch (e: any) { setError(e.response?.data?.error || 'Gagal memproses'); load() }
  }

  const base = [
    { head: 'Request', render: (r: ApprovalRequest) => <div><b>{r.title}</b><div className="text-muted text-[11px]">{r.summary}</div></div> },
    { head: 'Tipe', render: (r: ApprovalRequest) => <Badge tone="blue">{typeLabel[r.request_type] ?? r.request_type}</Badge> },
    { head: 'Pemohon', render: (r: ApprovalRequest) => r.requester_name },
  ]
  const search = (r: ApprovalRequest) => `${r.title} ${r.summary} ${r.requester_name} ${typeLabel[r.request_type] ?? ''} ${chainText(r)}`

  return (
    <Layout title={mode === 'history' ? 'Riwayat Approval' : 'Approval Saya'} subtitle={mode === 'history' ? 'Keputusan yang sudah diproses' : 'Persetujuan menunggu keputusan Anda dan pengajuan Anda sendiri'}>
      <div className="card p-4">
        {mode === 'inbox' && <Tabs tabs={[{ id: 'inbox', label: 'Menunggu Saya' }, { id: 'mine', label: 'Pengajuan Saya' }]} value={tab} onChange={setTab} />}

        {mode === 'history' ? (
          <DataTable data={rows} rowKey={(r) => r.id} searchText={search} searchPlaceholder="Cari request, pemohon…" columns={[
            ...base,
            { head: 'Keputusan', render: (r) => <Badge tone={tone[r.status]}>{label[r.status]}</Badge> },
            { head: 'Oleh', render: (r) => r.steps.find((s) => s.acted_by_name)?.acted_by_name || (r.status === 'Cancelled' ? r.requester_name : '-') },
            { head: 'Tanggal', render: (r) => dt(r.decided_at) },
            { head: 'Catatan', render: (r) => r.decision_note || r.steps.find((s) => s.note)?.note || '-' },
          ]} />
        ) : tab === 'inbox' ? (
          <DataTable data={rows} rowKey={(r) => r.id} searchText={search} searchPlaceholder="Cari request, pemohon…" empty="Tidak ada pengajuan yang menunggu Anda" columns={[
            ...base,
            { head: 'Diajukan', render: (r) => dt(r.created_at) },
            { head: 'Alur Persetujuan', render: (r) => <span className="text-muted">{chainText(r)}</span> },
            { head: 'Aksi', render: (r) => (
              <div className="flex gap-1.5">
                <button className="btn-primary" onClick={() => { setError(''); setDecision({ req: r, approve: true, note: '' }) }}>Setujui</button>
                <button className="btn text-danger" onClick={() => { setError(''); setDecision({ req: r, approve: false, note: '' }) }}>Tolak</button>
              </div>) },
          ]} />
        ) : (
          <DataTable data={rows} rowKey={(r) => r.id} searchText={search} searchPlaceholder="Cari request…" empty="Anda belum mengajukan apa pun" columns={[
            ...base.filter((c) => c.head !== 'Pemohon'),
            { head: 'Diajukan', render: (r) => dt(r.created_at) },
            { head: 'Status', render: (r) => <Badge tone={tone[r.status]}>{label[r.status]}</Badge> },
            { head: 'Menunggu / Alur', render: (r) => <span className="text-muted">{chainText(r)}</span> },
            { head: 'Catatan', render: (r) => r.steps.find((s) => s.note)?.note || '-' },
          ]} />
        )}
      </div>

      <Modal open={!!decision} onClose={() => setDecision(null)} title={decision?.approve ? 'Setujui Pengajuan' : 'Tolak Pengajuan'}>
        {decision && (
          <div className="space-y-3 text-xs">
            <div className="bg-sunken rounded-lg p-3"><b>{decision.req.title}</b><div className="text-muted mt-0.5">{decision.req.summary}</div></div>
            {decision.req.request_type === 'task' && <div><div className="font-bold mb-1">Hasil pekerjaan (validasi)</div><TaskFilesForApprover id={decision.req.ref_id} /></div>}
            {decision.req.request_type === 'attendance_location' && <div><div className="font-bold mb-1">Foto absen (validasi lokasi)</div><TapPhotosForApprover recordId={decision.req.ref_id} /></div>}
            {decision.req.request_type === 'leave' && <div><div className="font-bold mb-1">Lampiran (validasi dokumen)</div><LeaveFilesForApprover id={decision.req.ref_id} /></div>}
            <label className="block font-semibold">Catatan {decision.approve ? '(opsional)' : '(wajib)'}
              <textarea className="input w-full mt-1" rows={3} value={decision.note} onChange={(e) => setDecision({ ...decision, note: e.target.value })} autoFocus /></label>
            {error && <div className="text-danger bg-danger-soft rounded-lg px-3 py-2">{error}</div>}
            <div className="flex justify-end gap-2"><button className="btn" onClick={() => setDecision(null)}>Batal</button>
              <button className={decision.approve ? 'btn-primary' : 'btn-primary !bg-brand !border-brand'} onClick={submit}>{decision.approve ? 'Setujui' : 'Tolak'}</button></div>
          </div>
        )}
      </Modal>
    </Layout>
  )
}

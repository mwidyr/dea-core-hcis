import { useEffect, useState } from 'react'
import { CalendarClock, Flame, History, Paperclip, Plus } from 'lucide-react'
import Badge from '../ui/Badge'
import FileThumbs from '../ui/FileThumbs'
import Modal from '../ui/Modal'
import ProgressBar from '../ui/ProgressBar'
import Tabs from '../ui/Tabs'
import DateField from '../ui/DateField'
import TaskForm from './TaskForm'
import { useAuthStore } from '../../store/auth'
import {
  addTaskComment, cancelDeadlineRequest, cancelTaskCompletion, completeTask, deleteTask, deleteTaskAttachment, fetchTaskAttachmentBlob, getApproval, getTask,
  reopenTask, requestDeadlineChange, setTaskProgress, setTaskStatus, uploadTaskAttachment,
} from '../../services/api'
import type { ApprovalRequest, FileItem, TaskDetailData, TaskHistoryRow } from '../../types'
import { STATUS_LABEL, STATUS_TONE, TIMELINESS_LABEL, TIMELINESS_TONE, doneClass, dt, err, fmt, initials } from './taskUtils'

const MAX_FILE = 10 * 1024 * 1024
const kindLabel = { 'n+1': 'atasan', assigned: 'ditugaskan', fallback: 'HR' } as const

interface Props { id: number; onClose: () => void; onChanged: () => void; onOpen: (id: number) => void }

export default function TaskDetail({ id, onClose, onChanged, onOpen }: Props) {
  const user = useAuthStore((s) => s.user)
  const [d, setD] = useState<TaskDetailData | null>(null)
  const [ap, setAp] = useState<ApprovalRequest | null>(null)
  const [form, setForm] = useState<{ edit?: boolean; parent?: number } | null>(null)
  const [completing, setCompleting] = useState(false)
  const [note, setNote] = useState('')
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'detail' | 'work' | 'talk' | 'history'>('detail')
  const [pct, setPct] = useState<number | null>(null) // manual progress being edited
  const [dl, setDl] = useState<{ due: string; note: string } | null>(null) // deadline change request form

  const load = () => getTask(id).then((r) => { setD(r.data); setError('') }).catch((e) => setError(err(e, 'Tugas tidak dapat dimuat')))
  useEffect(() => { setD(null); setAp(null); setTab('detail'); setPct(null); load() }, [id])
  useEffect(() => { if (d) setPct(d.task.own_progress) }, [d?.task.own_progress, d?.task.id])
  useEffect(() => { // approval chain (only visible to the people involved in the approval)
    if (d?.task.approval_id) getApproval(d.task.approval_id).then((r) => setAp(r.data)).catch(() => setAp(null)); else setAp(null)
  }, [d?.task.approval_id, d?.task.status])

  const refresh = () => { load(); onChanged() }
  const run = async (fn: () => Promise<unknown>, fail: string) => { setBusy(true); try { await fn(); setError(''); refresh() } catch (e: any) { setError(err(e, fail)) } finally { setBusy(false) } }

  if (error && !d) return <Modal open onClose={onClose} title="Tugas"><p className="text-xs text-danger">{error}</p></Modal>
  if (!d) return <Modal open onClose={onClose} title="Tugas"><p className="text-xs text-muted">Memuat…</p></Modal>
  const t = d.task
  const isMember = t.members.some((m) => m.employee_id === user?.employee_id && m.role === 'member')
  const canFiles = (t.can_work || isMember) && t.status !== 'done'
  const files: FileItem[] = d.attachments.map((a) => ({ ...a, label: a.file_name }))
  const leaf = !t.is_parent
  const members = t.members.filter((m) => m.role === 'member'), watchers = t.members.filter((m) => m.role === 'watcher')

  const upload = async (file?: File) => {
    if (!file) return
    if (file.size > MAX_FILE) return setError('File lebih dari 10 MB')
    await run(() => uploadTaskAttachment(t.id, file), 'Gagal mengunggah')
  }
  const finish = async () => { await run(() => completeTask(t.id, note), 'Gagal menyelesaikan tugas'); setCompleting(false); setNote('') }

  return (
    <>
      <Modal open onClose={onClose} title={t.title} size="lg">
        <div className="space-y-4 text-xs">
          {d.ancestors.length > 0 && <div className="text-muted">{d.ancestors.map((a, i) => <span key={a.id}>{i > 0 && ' › '}<button className="hover:underline" onClick={() => onOpen(a.id)}>{a.title}</button></span>)} ›</div>}
          {t.status === 'done' && <div className={`text-sm font-bold ${doneClass(t)}`}>{t.title}</div>}
          <Tabs tabs={[{ id: 'detail', label: 'Detail' }, { id: 'work', label: `Sub Tugas & Lampiran (${d.children.length + d.attachments.length})` }, { id: 'talk', label: `Diskusi (${d.comments.length})` }, { id: 'history', label: `Riwayat (${d.history.length})` }]} value={tab} onChange={setTab} />
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
            {t.priority === 'tinggi' && <Badge tone="red"><Flame className="w-3 h-3 inline -mt-0.5" /> Prioritas</Badge>}
            {t.timeliness && <Badge tone={TIMELINESS_TONE[t.timeliness]}>{TIMELINESS_LABEL[t.timeliness]}</Badge>}
            {t.is_parent && <Badge tone="purple">Induk · {t.kids_done}/{t.kids_total} sub tugas selesai</Badge>}
            {t.parent_id && <Badge tone="blue">Sub tugas</Badge>}
            {t.project_name && <Badge tone="gray">{t.project_name}</Badge>}
            {t.waiting_for && <span className="text-muted">menunggu approval {t.waiting_for}</span>}
          </div>

          {tab === 'detail' && <>
          <div>
            <div className="flex items-center justify-between mb-1"><b>Progres</b><span className="text-muted">{t.is_parent ? `dihitung dari sub tugas (${t.kids_done}/${t.kids_total} selesai${d.children.length > 0 && d.children.every((c) => c.weight) ? ', berbobot' : ''})` : t.status === 'done' ? 'Selesai' : `${t.own_progress}% · isi manual`}</span></div>
            <ProgressBar value={t.progress} />
            {leaf && t.can_work && (t.status === 'todo' || t.status === 'in_progress') && pct !== null && (
              <div className="flex items-center gap-2 mt-2">
                <input type="range" min={0} max={100} step={5} value={pct} onChange={(e) => setPct(Number(e.target.value))} className="flex-1 accent-[rgb(var(--brand))]" aria-label="Progress manual" />
                <input type="number" min={0} max={100} className="input w-16 !py-1" value={pct} onChange={(e) => setPct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} aria-label="Progress dalam persen" />
                <button className="btn" disabled={busy || pct === t.own_progress} onClick={() => run(() => setTaskProgress(t.id, pct), 'Gagal menyimpan progress')}>Simpan</button>
              </div>
            )}
          </div>

          <dl className="grid grid-cols-3 gap-3">
            {[['Pemberi tugas', t.assigner_name || '–'], ['PIC', t.pic_name], ['Unit', t.unit_name || '–'], ['Mulai', fmt(t.start_date)], ['Deadline', fmt(t.due_date)], ['Bobot', t.weight != null ? `${t.weight}` : '–'], ...(t.kpi_title ? [['Terkait KPI', t.kpi_title]] : [])].map(([k, v]) => (
              <div key={k}><dt className="text-muted text-[10.5px]">{k}</dt><dd className="font-semibold">{v}</dd></div>
            ))}
          </dl>
          {t.pending_deadline && (
            <div className="rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 flex flex-wrap items-center gap-2">
              <CalendarClock className="w-4 h-4 text-warn shrink-0" />
              <span className="flex-1 min-w-0"><b>Pengajuan perubahan deadline:</b> {fmt(t.pending_deadline.old_due)} → <b>{fmt(t.pending_deadline.new_due)}</b> · menunggu {t.pending_deadline.waiting_for || 'approver'}<div className="text-muted">“{t.pending_deadline.note}”</div></span>
              {(t.can_work || t.can_manage) && <button className="btn" disabled={busy} onClick={() => run(() => cancelDeadlineRequest(t.id), 'Gagal membatalkan pengajuan')}>Batalkan</button>}
            </div>
          )}
          {leaf && t.is_pic && !t.pending_deadline && (t.status === 'todo' || t.status === 'in_progress') && (
            <div><button className="btn" onClick={() => setDl({ due: t.due_date?.slice(0, 10) ?? '', note: '' })}><CalendarClock className="w-3.5 h-3.5 inline mr-1" />Ajukan perubahan deadline</button></div>
          )}
          {t.description && <p className="bg-sunken rounded-lg p-3 whitespace-pre-wrap">{t.description}</p>}

          <div className="grid grid-cols-2 gap-3">
            <div><div className="font-bold mb-1">Anggota ({members.length})</div><div className="flex flex-wrap gap-1.5">{members.length ? members.map((m) => <Chip key={m.employee_id} name={m.name} />) : <span className="text-muted">–</span>}</div></div>
            <div><div className="font-bold mb-1">Pengamat ({watchers.length})</div><div className="flex flex-wrap gap-1.5">{watchers.length ? watchers.map((m) => <Chip key={m.employee_id} name={m.name} />) : <span className="text-muted">–</span>}</div></div>
          </div>

          {leaf && (
            <div className="border border-line rounded-lg p-3 space-y-1.5">
              <div className="font-bold">Penyelesaian</div>
              <div className="text-muted">Lampiran hasil: <b className="text-ink">{t.require_result ? 'wajib' : 'tidak wajib'}</b> · Approval: <b className="text-ink">{t.requires_approval ? (t.approver_user_id ? 'approver tertentu' : `${t.approval_levels} tingkat atasan PIC`) : 'tidak perlu'}</b></div>
              {ap && ap.steps.length > 0 && (
                <ol className="space-y-1 pt-1">{ap.steps.map((s) => (
                  <li key={s.id} className="flex items-start gap-2"><Badge tone={s.status === 'Approved' ? 'green' : s.status === 'Rejected' ? 'red' : s.status === 'Pending' ? 'amber' : 'gray'}>{s.status === 'Approved' ? 'Disetujui' : s.status === 'Rejected' ? 'Ditolak' : s.status === 'Pending' ? 'Menunggu' : s.status}</Badge>
                    <span><b>{s.approver_name}</b> <span className="text-muted">({kindLabel[s.kind]}){s.acted_at ? ` · ${dt(s.acted_at)}` : ''}</span>{s.note && <div className="text-muted">“{s.note}”</div>}</span></li>))}</ol>
              )}
            </div>
          )}
          </>}

          {tab === 'work' && <>
          {leaf && (
            <div>
              <div className="font-bold mb-1.5">Hasil / lampiran {t.require_result && <span className="font-normal text-danger">(wajib sebelum selesai)</span>}</div>
              <FileThumbs items={files} fetchBlob={(aid) => fetchTaskAttachmentBlob(t.id, aid).then((r) => r.data)} empty="Belum ada lampiran." onDelete={canFiles && t.status !== 'review' ? (f) => { if (confirm(`Hapus "${f.file_name}"?`)) run(() => deleteTaskAttachment(t.id, f.id), 'Gagal menghapus') } : undefined} />
              {canFiles && <label className="btn inline-block cursor-pointer mt-2"><Plus className="w-3 h-3 inline mr-1" />Tambah lampiran<input type="file" className="hidden" accept="image/*,application/pdf" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = '' }} /></label>}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5"><b>Sub tugas ({d.children.length})</b><button className="btn" onClick={() => setForm({ parent: t.id })}><Plus className="w-3 h-3 inline mr-1" />Sub tugas</button></div>
            {d.children.length > 0 && (
              <div className="border border-line rounded-lg divide-y divide-line">
                {d.children.map((c) => (
                  <button key={c.id} onClick={() => onOpen(c.id)} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-sunken">
                    <span className="flex-1 min-w-0"><b className="truncate block">{c.title}</b><span className="text-muted">{c.pic_name}{c.due_date ? ` · ${fmt(c.due_date)}` : ''}{c.is_parent ? ` · ${c.kids_done}/${c.kids_total} sub` : ''}</span></span>
                    <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                    <div className="w-28"><ProgressBar value={c.progress} small /></div>
                  </button>
                ))}
              </div>
            )}
          </div>
          </>}

          {tab === 'talk' && <>
          <div>
            <div className="font-bold mb-1.5">Komentar ({d.comments.length})</div>
            <div className="space-y-2 max-h-48 overflow-auto">
              {d.comments.map((c) => <div key={c.id} className="bg-sunken rounded-lg px-3 py-2"><div className="text-[10.5px] text-muted"><b className="text-ink">{c.user_name}</b> · {dt(c.created_at)}</div><div className="whitespace-pre-wrap">{c.body}</div></div>)}
            </div>
            <div className="flex gap-2 mt-2"><input className="input flex-1" placeholder="Tulis komentar…" value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && comment.trim()) { run(() => addTaskComment(t.id, comment), 'Gagal mengirim komentar').then(() => setComment('')) } }} />
              <button className="btn" disabled={!comment.trim() || busy} onClick={() => run(() => addTaskComment(t.id, comment), 'Gagal mengirim komentar').then(() => setComment(''))}>Kirim</button></div>
          </div>
          </>}

          {tab === 'history' && (
            <div>
              <div className="font-bold mb-1.5 flex items-center gap-1.5"><History className="w-3.5 h-3.5" />Riwayat perubahan</div>
              {d.deadline_requests.length > 0 && (
                <div className="mb-3">
                  <div className="text-[10.5px] font-bold text-muted mb-1">PENGAJUAN PERUBAHAN DEADLINE</div>
                  <div className="space-y-1">{d.deadline_requests.map((r) => (
                    <div key={r.id} className="flex flex-wrap items-center gap-2 border border-line rounded-lg px-3 py-1.5">
                      <Badge tone={r.status === 'Disetujui' ? 'green' : r.status === 'Ditolak' ? 'red' : r.status === 'Dibatalkan' ? 'gray' : 'amber'}>{r.status === 'Pending Approval' ? 'Menunggu' : r.status}</Badge>
                      <span>{fmt(r.old_due)} → <b>{fmt(r.new_due)}</b></span><span className="text-muted flex-1 min-w-0 truncate">{r.user_name} · “{r.note}”</span><span className="text-muted">{dt(r.created_at)}</span>
                    </div>))}</div>
                </div>
              )}
              <ol className="relative border-l border-line ml-2 space-y-3">
                {d.history.map((h) => (
                  <li key={h.id} className="pl-4 relative">
                    <span className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-brand" />
                    <div className="text-[10.5px] text-muted"><b className="text-ink">{h.user_name || '–'}</b> · {dt(h.created_at)}</div>
                    <div>{historyText(h)}</div>
                    {h.note && <div className="text-muted">“{h.note}”</div>}
                  </li>
                ))}
                {!d.history.length && <li className="pl-4 text-muted">Belum ada riwayat.</li>}
              </ol>
            </div>
          )}

          {error && <div className="text-danger bg-danger-soft rounded-lg px-3 py-2">{error}</div>}

          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-line">
            {leaf && t.can_work && t.status === 'todo' && <button className="btn" disabled={busy} onClick={() => run(() => setTaskStatus(t.id, 'in_progress'), 'Gagal mengubah status')}>Mulai Dikerjakan</button>}
            {leaf && t.can_work && t.status === 'in_progress' && t.own_status === 'in_progress' && <button className="btn" disabled={busy} onClick={() => run(() => setTaskStatus(t.id, 'todo'), 'Gagal mengubah status')}>Kembali ke To Do</button>}
            {leaf && t.can_work && (t.status === 'todo' || t.status === 'in_progress') && <button className="btn-primary" disabled={busy} onClick={() => setCompleting(true)}>Selesaikan{t.requires_approval ? ' & ajukan approval' : ''}</button>}
            {leaf && t.can_work && t.status === 'review' && <button className="btn" disabled={busy} onClick={() => run(() => cancelTaskCompletion(t.id), 'Gagal membatalkan')}>Batalkan penyelesaian</button>}
            {leaf && t.can_manage && t.status === 'done' && <button className="btn" disabled={busy} onClick={() => { const n = prompt('Alasan membuka kembali tugas (opsional):'); if (n !== null) run(() => reopenTask(t.id, n), 'Gagal membuka kembali') }}>Buka Kembali</button>}
            <span className="flex-1" />
            {(t.can_manage || t.can_work) && <button className="btn" onClick={() => setForm({ edit: true })}>Edit</button>}
            {t.can_manage && <button className="btn text-danger" onClick={async () => { if (confirm(`Hapus tugas "${t.title}"${t.is_parent ? ' beserta semua sub tugasnya' : ''}?`)) { try { await deleteTask(t.id); onChanged(); onClose() } catch (e: any) { setError(err(e, 'Gagal menghapus')) } } }}>Hapus</button>}
          </div>
        </div>
      </Modal>

      <Modal open={completing} onClose={() => setCompleting(false)} title="Selesaikan Tugas">
        <div className="space-y-3 text-xs">
          <div className="bg-sunken rounded-lg p-3"><b>{t.title}</b><div className="text-muted mt-0.5">PIC {t.pic_name}</div></div>
          {t.require_result && t.attachment_count === 0 && <div className="text-danger bg-danger-soft rounded-lg px-3 py-2">Tugas ini wajib melampirkan hasil pekerjaan. Tambahkan lampiran dulu sebelum menyelesaikan.</div>}
          {t.attachment_count > 0 && <div className="text-muted flex items-center gap-1"><Paperclip className="w-3 h-3" />{t.attachment_count} lampiran hasil akan ikut dikirim.</div>}
          {t.requires_approval ? <div className="text-info bg-info-soft rounded-lg px-3 py-2">Tugas akan diajukan untuk persetujuan ({t.approver_user_id ? 'approver tertentu' : `${t.approval_levels} tingkat atasan PIC`}). Status berubah menjadi “Menunggu Approval” dan baru Selesai setelah disetujui.</div> : <div className="text-muted">Tugas ini tidak memerlukan approval, status langsung menjadi Selesai.</div>}
          <label className="block font-semibold">Catatan <span className="font-normal text-muted">(opsional)</span><textarea className="input w-full mt-1" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <div className="flex justify-end gap-2"><button className="btn" onClick={() => setCompleting(false)}>Batal</button><button className="btn-primary" disabled={busy || (t.require_result && t.attachment_count === 0)} onClick={finish}>{t.requires_approval ? 'Ajukan Approval' : 'Selesaikan'}</button></div>
        </div>
      </Modal>

      <Modal open={!!dl} onClose={() => setDl(null)} title="Ajukan Perubahan Deadline">
        {dl && (
          <div className="space-y-3 text-xs">
            <div className="bg-sunken rounded-lg p-3"><b>{t.title}</b><div className="text-muted mt-0.5">Deadline saat ini: {fmt(t.due_date)}</div></div>
            <label className="block font-semibold">Deadline baru<div className="mt-1 font-normal"><DateField value={dl.due} min={t.start_date?.slice(0, 10)} businessId={t.business_id} onChange={(v) => setDl({ ...dl, due: v })} /></div></label>
            <label className="block font-semibold">Catatan / alasan *<textarea className="input w-full mt-1 font-normal" rows={3} value={dl.note} onChange={(e) => setDl({ ...dl, note: e.target.value })} placeholder="mis. menunggu dokumen dari vendor" /></label>
            <div className="text-info bg-info-soft rounded-lg px-3 py-2">Deadline baru berlaku setelah disetujui {t.approver_user_id ? 'approver tertentu' : `atasan PIC (${t.approval_levels} tingkat)`}.</div>
            {error && <div className="text-danger bg-danger-soft rounded-lg px-3 py-2">{error}</div>}
            <div className="flex justify-end gap-2"><button className="btn" onClick={() => setDl(null)}>Batal</button>
              <button className="btn-primary" disabled={busy || !dl.due || !dl.note.trim()} onClick={async () => { await run(() => requestDeadlineChange(t.id, dl.due, dl.note.trim()), 'Gagal mengajukan perubahan deadline'); setDl(null) }}>Ajukan</button></div>
          </div>
        )}
      </Modal>

      {form && <TaskForm task={form.edit ? t : undefined} defaults={form.parent ? { parent_id: form.parent, pic_id: t.pic_id } : undefined} onClose={() => setForm(null)}
        onSaved={() => { setForm(null); refresh() }} />}
    </>
  )
}

const Chip = ({ name }: { name: string }) => <span className="inline-flex items-center gap-1.5 bg-tint rounded-full pl-1 pr-2.5 py-0.5"><span className="w-5 h-5 rounded-full bg-brand-soft text-brand text-[9px] font-bold grid place-items-center">{initials(name)}</span>{name}</span>

const FIELD_LABEL: Record<string, string> = {
  created: 'Tugas dibuat', title: 'Nama tugas', description: 'Deskripsi', priority: 'Prioritas', status: 'Status', progress: 'Progress', pic: 'PIC', assigner: 'Pemberi tugas',
  start_date: 'Tanggal mulai', due_date: 'Deadline', weight: 'Bobot', require_result: 'Lampiran hasil wajib', requires_approval: 'Perlu approval', project: 'Proyek', deadline_request: 'Pengajuan deadline',
}
const historyText = (h: TaskHistoryRow) => {
  if (h.field === 'created') return <>Tugas dibuat: <b>{h.new_value}</b></>
  if (h.field === 'description') return <>Deskripsi diubah</>
  const label = FIELD_LABEL[h.field] ?? h.field
  return <><b>{label}</b>: {h.old_value ? <span className="text-muted">{h.old_value}</span> : <span className="text-muted">–</span>} → <b>{h.new_value || '–'}</b></>
}

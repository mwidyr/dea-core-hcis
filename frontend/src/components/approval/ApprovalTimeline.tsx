import Badge from '../ui/Badge'
import type { ApprovalKind } from '../../types'
import type { ApprovalStep } from '../../types'

export const stepKind: Record<ApprovalKind, string> = { 'n+1': 'atasan n+1', assigned: 'ditugaskan', fallback: 'HR', direct_manager: 'atasan langsung', position: 'jabatan tertentu', hr: 'HR', hr_superior: 'atasan HR' }
export const stepLabel = (s: string) => (s === 'Approved' ? 'Disetujui' : s === 'Rejected' ? 'Ditolak' : s === 'Pending' ? 'Menunggu' : s === 'Cancelled' ? 'Dibatalkan' : s === 'Waiting' ? 'Belum giliran' : s)
const stepTone = (s: string) => (s === 'Approved' ? 'green' : s === 'Rejected' ? 'red' : s === 'Pending' ? 'amber' : 'gray') as 'green' | 'red' | 'amber' | 'gray'
const dt = (d?: string | null) => (d ? new Date(d).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')

// Routing history of one approval request: level, approver, status, time and note per step (rejecting step highlighted).
export default function ApprovalTimeline({ steps }: { steps: ApprovalStep[] }) {
  if (!steps.length) return <p className="text-muted">Belum ada langkah persetujuan.</p>
  return (
    <ol className="space-y-1.5">
      {steps.map((s) => (
        <li key={s.id} className={`flex items-start gap-2 ${s.status === 'Rejected' ? 'rounded-lg bg-danger-soft px-2 py-1.5' : ''}`}>
          <span className="text-muted tabular-nums w-14 shrink-0 pt-0.5 whitespace-nowrap">Level {s.level}</span>
          <Badge tone={stepTone(s.status)}>{stepLabel(s.status)}</Badge>
          <span className="min-w-0">
            <b>{s.approver_name}</b> <span className="text-muted">({stepKind[s.kind]})</span>
            {s.acted_by_name && s.acted_by_name !== s.approver_name && <span className="text-muted"> · diputuskan oleh {s.acted_by_name}</span>}
            {s.acted_at && <span className="text-muted"> · {dt(s.acted_at)}</span>}
            {s.note && <div className="text-muted">“{s.note}”</div>}
          </span>
        </li>
      ))}
    </ol>
  )
}

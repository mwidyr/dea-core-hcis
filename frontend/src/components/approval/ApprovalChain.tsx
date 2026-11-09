import type { ChainStep } from '../../types'
import { stepKind, stepLabel } from './ApprovalTimeline'

const dot = (s: string) => (s === 'Approved' ? 'text-ok' : s === 'Rejected' ? 'text-danger' : s === 'Pending' ? 'text-warn font-bold' : 'text-muted')

// Read-only approval chain (who approves, in order, and where it stands) for list rows: shown to the requester too.
export default function ApprovalChain({ chain }: { chain?: ChainStep[] }) {
  if (!chain?.length) return <span className="text-muted">-</span>
  return (
    <ol className="space-y-0.5 text-[11px]">
      {chain.map((s) => (
        <li key={s.level} className={dot(s.status)} title={`${stepKind[s.kind]} · ${stepLabel(s.status)}`}>
          {s.level}. {s.name}{s.status === 'Approved' ? ' ✓' : s.status === 'Rejected' ? ' ✗' : s.status === 'Pending' ? ' …' : ''}
        </li>
      ))}
    </ol>
  )
}

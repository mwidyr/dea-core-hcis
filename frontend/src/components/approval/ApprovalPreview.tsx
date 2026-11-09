import type { PreviewStep } from '../../types'
import { stepKind } from './ApprovalTimeline'

// Read-only preview of the approval chain a new request will get (resolved by the server with the same resolver as submit).
export default function ApprovalPreview({ chain }: { chain: PreviewStep[] }) {
  return (
    <div className="border border-line rounded-lg p-3 bg-sunken/60 space-y-1">
      <div className="font-bold">Alur Persetujuan</div>
      {chain.length ? (
        <ol className="space-y-0.5">
          {chain.map((s) => (
            <li key={s.level}>{s.level}. <b>{s.name}</b> <span className="text-muted">({s.kind === 'position' && s.position ? s.position : stepKind[s.kind]})</span></li>
          ))}
        </ol>
      ) : <div className="text-muted">—</div>}
      <div className="text-muted">Berjenjang: pengajuan berpindah ke langkah berikutnya setelah langkah sebelumnya menyetujui. Alur diatur oleh HR.</div>
    </div>
  )
}

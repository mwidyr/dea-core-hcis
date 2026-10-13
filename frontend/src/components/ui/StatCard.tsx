export default function StatCard({ label, value, foot }: { label: string; value: React.ReactNode; foot?: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className="text-2xl font-extrabold my-1 leading-tight">{value}</div>
      {foot && <div className="text-[11px] text-muted">{foot}</div>}
    </div>
  )
}

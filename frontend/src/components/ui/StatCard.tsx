export default function StatCard({ label, value, foot }: { label: string; value: React.ReactNode; foot?: string }) {
  return (
    <div className="card p-4">
      <div className="text-[10.5px] text-muted">{label}</div>
      <div className="text-2xl font-extrabold my-1">{value}</div>
      {foot && <div className="text-[10px] text-muted">{foot}</div>}
    </div>
  )
}

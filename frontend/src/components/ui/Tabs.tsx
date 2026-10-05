export default function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 border-b border-line mb-3">
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={`px-3 py-2 text-xs font-semibold -mb-px border-b-2 ${value === t.id ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-gray-800'}`}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

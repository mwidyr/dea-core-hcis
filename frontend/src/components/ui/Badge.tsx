const tones = {
  green: 'bg-ok-soft text-ok', red: 'bg-brand-soft text-brand', amber: 'bg-warn-soft text-warn',
  blue: 'bg-info-soft text-info', purple: 'bg-violet-soft text-violet', gray: 'bg-gray-100 text-gray-600',
}
export default function Badge({ tone = 'gray', children }: { tone?: keyof typeof tones; children: React.ReactNode }) {
  return <span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-full text-[10.5px] font-semibold ${tones[tone]}`}>{children}</span>
}

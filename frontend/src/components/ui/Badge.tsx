const tones = {
  green: 'bg-ok-soft text-ok', red: 'bg-danger-soft text-danger', amber: 'bg-warn-soft text-warn',
  blue: 'bg-info-soft text-info', purple: 'bg-violet-soft text-violet', gray: 'bg-tint text-ink/80',
}
export default function Badge({ tone = 'gray', children }: { tone?: keyof typeof tones; children: React.ReactNode }) {
  return <span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-full text-[10.5px] font-semibold ${tones[tone]}`}>{children}</span>
}

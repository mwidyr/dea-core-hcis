import { useEffect, useState } from 'react'
import { fetchAvatarBlob } from '../../services/api'

const cache = new Map<string, Promise<string | null>>() // "empId:version" → object URL (null = none)
const load = (emp: number, v: number) => {
  const k = `${emp}:${v}`
  if (!cache.has(k)) cache.set(k, fetchAvatarBlob(emp).then((r) => URL.createObjectURL(r.data)).catch(() => null))
  return cache.get(k)!
}
const initialsOf = (n: string) => n.split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase()

// Round avatar: the account's photo when there is one (version > 0), else initials.
export default function Avatar({ empId, name, version, size = 20, className = '', square = false }: { empId?: number | null; name: string; version?: number; size?: number; className?: string; square?: boolean }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setUrl(null)
    if (empId && version) load(empId, version).then((u) => live && setUrl(u))
    return () => { live = false }
  }, [empId, version])
  const shape = square ? 'rounded-lg' : 'rounded-full'
  const style = { width: size, height: square ? size * 1.2 : size, fontSize: Math.max(8, Math.round(size * 0.42)) }
  if (url) return <img src={url} alt={name} title={name} className={`${shape} object-cover shrink-0 ${className}`} style={style} />
  return <span title={name} className={`${shape} bg-brand-soft text-brand font-bold grid place-items-center shrink-0 ${className}`} style={style}>{initialsOf(name)}</span>
}

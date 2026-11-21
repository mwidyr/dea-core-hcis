import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getAttendanceToday } from '../../services/api'
import type { AttendanceToday } from '../../types'

const hm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour12: false, hour: '2-digit', minute: '2-digit' })
const dur = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}j ${String(min % 60).padStart(2, '0')}m`

// Header pill: working since tap-in, with the running duration until tap-out.
export default function WorkingPill() {
  const [a, setA] = useState<AttendanceToday | null>(null)
  const [now, setNow] = useState(Date.now())
  const offset = useRef(0) // server time − browser time
  useEffect(() => {
    const load = () => getAttendanceToday().then((r) => { setA(r.data); if (r.data.server_time) offset.current = new Date(r.data.server_time).getTime() - Date.now() }).catch(() => setA(null))
    load()
    const t = setInterval(load, 120000)
    const k = setInterval(() => setNow(Date.now()), 30000)
    return () => { clearInterval(t); clearInterval(k) }
  }, [])
  if (!a?.applicable) return null
  if (a.state === 'none' || !a.check_in) return <Link to="/absen" className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-full border border-line text-[11.5px] text-muted hover:bg-sunken"><i className="w-2 h-2 rounded-full bg-muted" />Belum tap-in <b className="text-brand">Tap In</b></Link>
  const end = a.check_out ? new Date(a.check_out).getTime() : now + offset.current
  const mins = Math.max(0, Math.floor((end - new Date(a.check_in).getTime()) / 60000))
  const working = a.state === 'working'
  return (
    <div className={`hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-full border text-[11.5px] ${working ? 'border-ok/40 bg-ok-soft text-ok' : 'border-line text-muted'}`}>
      <i className={`w-2 h-2 rounded-full ${working ? 'bg-ok animate-pulse' : 'bg-muted'}`} />
      <b>{working ? 'Sedang Bekerja' : 'Selesai Bekerja'}</b>
      <span className="text-ink">In <b>{hm(a.check_in)}</b>{a.check_out ? <> · Out <b>{hm(a.check_out)}</b></> : null}</span>
      {a.location && <span className="text-muted">{a.location}</span>}
      <span className="text-ink">Durasi <b>{dur(mins)}</b></span>
      {working && <Link to="/absen" className="btn !py-0.5 !px-2 !text-[11px]">Clock Out</Link>}
    </div>
  )
}

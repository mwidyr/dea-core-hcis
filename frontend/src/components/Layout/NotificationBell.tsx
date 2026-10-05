import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { getNotifications, markAllNotificationsRead, markNotificationRead } from '../../services/api'
import type { AppNotification } from '../../types'

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  return m < 1 ? 'baru saja' : m < 60 ? `${m} mnt lalu` : m < 1440 ? `${Math.round(m / 60)} jam lalu` : `${Math.round(m / 1440)} hari lalu`
}

// Bell in the header: unread badge + dropdown, refreshed every minute.
export default function NotificationBell() {
  const [items, setItems] = useState<AppNotification[]>([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const nav = useNavigate()

  const load = () => getNotifications().then((r) => { setItems(r.data.data); setUnread(r.data.unread) }).catch(() => {})
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t) }, [])
  useEffect(() => {
    if (!open) return
    load()
    const out = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', out)
    return () => document.removeEventListener('mousedown', out)
  }, [open])

  const go = async (n: AppNotification) => {
    if (!n.read_at) { await markNotificationRead(n.id).catch(() => {}); load() }
    setOpen(false)
    if (n.link) nav(n.link)
  }

  return (
    <div className="relative" ref={box}>
      <button className="btn relative" title="Notifikasi" aria-label="Notifikasi" onClick={() => setOpen((o) => !o)}>
        <Bell className="w-3.5 h-3.5" />
        {unread > 0 && <span className="absolute -top-1.5 -right-1.5 bg-brand text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 px-1 grid place-items-center">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[360px] bg-white border border-line rounded-xl shadow-2xl z-40 text-xs">
          <div className="flex items-center justify-between px-3 py-2 border-b border-line">
            <b>Notifikasi</b>
            {unread > 0 && <button className="text-brand font-semibold" onClick={async () => { await markAllNotificationsRead(); load() }}>Tandai semua dibaca</button>}
          </div>
          <div className="max-h-96 overflow-auto divide-y divide-line">
            {items.map((n) => (
              <button key={n.id} onClick={() => go(n)} className={`w-full text-left px-3 py-2.5 hover:bg-gray-50 ${n.read_at ? '' : 'bg-brand-soft/40'}`}>
                <div className="flex items-start gap-2">
                  {!n.read_at && <span className="w-2 h-2 rounded-full bg-brand mt-1 shrink-0" />}
                  <div className="min-w-0"><div className="font-bold">{n.title}</div><div className="text-muted mt-0.5">{n.body}</div><div className="text-[10px] text-gray-400 mt-1">{ago(n.created_at)}</div></div>
                </div>
              </button>
            ))}
            {!items.length && <div className="px-3 py-8 text-center text-muted">Belum ada notifikasi</div>}
          </div>
        </div>
      )}
    </div>
  )
}

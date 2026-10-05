import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { navGroups } from './nav'
import { useAuthStore } from '../../store/auth'
import { useBusinessStore } from '../../store/business'
import { getApprovalCount, getMe } from '../../services/api'
import NotificationBell from './NotificationBell'

export default function Layout({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  const { user, logout, can, token, setAuth } = useAuthStore()
  const { businessId, setBusinessId, businesses, refresh } = useBusinessStore()
  const nav = useNavigate()

  const [inbox, setInbox] = useState(0)
  // sidebar: collapsed = icons only (remembered per browser)
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('sidebar_collapsed') === '1' } catch { return false } })
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem('sidebar_collapsed', c ? '0' : '1') } catch { /* ignore */ } return !c })

  useEffect(() => { refresh() }, [])
  // permissions can change while someone is logged in (Settings → Role & Izin): pick up the latest on every page load
  useEffect(() => { getMe().then((r) => token && setAuth({ ...r.data }, token)).catch(() => {}) }, [])
  // pending-approval badge on the sidebar, refreshed every minute
  useEffect(() => {
    const load = () => getApprovalCount().then((r) => setInbox(r.data.inbox)).catch(() => {})
    load()
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className={`grid min-h-screen transition-[grid-template-columns] duration-200 ${collapsed ? 'grid-cols-[64px_1fr]' : 'grid-cols-[248px_1fr]'}`}>
      <aside className={`bg-white border-r border-line sticky top-0 h-screen overflow-y-auto overflow-x-hidden ${collapsed ? 'p-2' : 'p-3'}`}>
        <div className={`flex items-center pt-1 pb-4 ${collapsed ? 'flex-col gap-2' : 'gap-2.5 px-2'}`}>
          <div className="w-9 h-9 rounded-[10px] bg-brand text-white grid place-items-center font-black shrink-0">C</div>
          {!collapsed && <div className="flex-1 min-w-0"><b className="text-[15px]">CORE</b><span className="block text-[10px] text-muted truncate">Business Operations Platform</span></div>}
          <button onClick={toggle} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 shrink-0" title={collapsed ? 'Tampilkan menu' : 'Sembunyikan menu'} aria-label={collapsed ? 'Tampilkan menu' : 'Sembunyikan menu'}>
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>
        {navGroups.map((g) => (
          <div key={g.title} className={collapsed ? 'mb-2 pb-2 border-b border-line/60 last:border-0' : 'mb-3.5'}>
            {!collapsed && <div className="text-[9px] tracking-widest uppercase text-gray-400 font-extrabold px-2.5 pb-1.5">{g.title}</div>}
            {g.items.filter((i) => !i.perm || can(i.perm)).map((i) => (
              <NavLink key={i.to} to={i.to} end={i.to === '/'} title={collapsed ? i.label : undefined}
                className={({ isActive }) => `relative flex items-center rounded-[9px] text-xs ${collapsed ? 'justify-center h-9 mb-0.5' : 'gap-2.5 px-2.5 py-2'} ${isActive ? 'bg-brand-soft text-brand font-bold' : 'text-gray-600 hover:bg-gray-50'}`}>
                <i.icon className={collapsed ? 'w-[18px] h-[18px]' : 'w-4 h-4'} />
                {!collapsed && i.label}
                {i.to === '/approval' && inbox > 0 && (collapsed
                  ? <span className="absolute top-0.5 right-1 bg-brand text-white text-[9px] font-bold rounded-full px-1 min-w-[15px] text-center leading-[15px]">{inbox}</span>
                  : <span className="ml-auto bg-brand text-white text-[10px] font-bold rounded-full px-1.5 min-w-[18px] text-center">{inbox}</span>)}
              </NavLink>
            ))}
          </div>
        ))}
      </aside>
      <div className="min-w-0">
        <header className="h-[66px] bg-white/95 backdrop-blur border-b border-line flex items-center justify-between px-5 sticky top-0 z-20">
          <div><div className="text-[17px] font-extrabold">{title}</div>{subtitle && <div className="text-[10.5px] text-muted">{subtitle}</div>}</div>
          <div className="flex items-center gap-2">
            {actions}
            <NotificationBell />
            <select className="input" value={businessId} onChange={(e) => setBusinessId(Number(e.target.value))}>
              {(user?.role === 'super_admin' || user?.role === 'hr_admin' || businesses.length > 1) && <option value={0}>Semua Bisnis</option>}
              {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <div className="text-right leading-tight px-2"><div className="text-xs font-bold">{user?.name}</div><div className="text-[10px] text-muted">{user?.role}</div></div>
            <button className="btn" title="Keluar" onClick={() => { logout(); nav('/login') }}><LogOut className="w-3.5 h-3.5" /></button>
          </div>
        </header>
        <main className="p-[18px]">{children}</main>
      </div>
    </div>
  )
}

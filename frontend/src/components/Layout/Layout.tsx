import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { LogOut, Menu, MoreVertical, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import { navGroups } from './nav'
import { useAuthStore } from '../../store/auth'
import { useBusinessStore } from '../../store/business'
import { getApprovalCount, getMe } from '../../services/api'
import BrandLogo from '../BrandLogo'
import ThemeToggle from '../ThemeToggle'
import NotificationBell from './NotificationBell'

export default function Layout({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  const { user, logout, can, token, setAuth } = useAuthStore()
  const { businessId, setBusinessId, businesses, refresh } = useBusinessStore()
  const nav = useNavigate()
  const { pathname } = useLocation()

  const [inbox, setInbox] = useState(0)
  // desktop: collapsed = icons only (remembered per browser). Phone/tablet: the sidebar is a drawer.
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('sidebar_collapsed') === '1' } catch { return false } })
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem('sidebar_collapsed', c ? '0' : '1') } catch { /* ignore */ } return !c })
  const [drawer, setDrawer] = useState(false)
  const [menu, setMenu] = useState(false) // header overflow menu on small screens

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
  useEffect(() => { setDrawer(false); setMenu(false) }, [pathname])
  useEffect(() => {
    if (!drawer) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawer(false) }
    document.addEventListener('keydown', h)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', h); document.body.style.overflow = '' }
  }, [drawer])

  const showAll = user?.role === 'super_admin' || user?.role === 'hr_admin' || businesses.length > 1
  const bizSelect = (
    <select className="input max-w-full" aria-label="Pilih bisnis" value={businessId} onChange={(e) => setBusinessId(Number(e.target.value))}>
      {showAll && <option value={0}>Semua Bisnis</option>}
      {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select>
  )
  const doLogout = () => { logout(); nav('/login') }
  // the drawer is always full width; "collapsed" only applies from lg up
  const slim = collapsed

  return (
    <div className={`lg:grid min-h-screen lg:transition-[grid-template-columns] lg:duration-200 ${slim ? 'lg:grid-cols-[64px_1fr]' : 'lg:grid-cols-[248px_1fr]'}`}>
      {drawer && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setDrawer(false)} aria-hidden="true" />}
      <aside id="sidebar" aria-label="Menu utama"
        className={`bg-panel border-r border-line overflow-y-auto overflow-x-hidden p-3 ${slim ? 'lg:p-2' : ''}
          fixed inset-y-0 left-0 z-50 w-[272px] max-w-[85vw] transition-transform duration-200 ${drawer ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}
          lg:sticky lg:top-0 lg:h-screen lg:w-auto lg:max-w-none lg:translate-x-0 lg:shadow-none lg:z-auto`}>
        <div className={`flex items-center pt-1 pb-4 gap-2.5 px-2 ${slim ? 'lg:flex-col lg:gap-2 lg:px-0' : ''}`}>
          <BrandLogo size={slim ? 36 : 42} />
          <div className={`flex-1 min-w-0 ${slim ? 'lg:hidden' : ''}`}>
            <b className="text-base tracking-[.08em] text-danger">CORE</b>
            <span className="block text-[9.5px] text-muted truncate tracking-[.015em]">Business Operations Platform</span>
          </div>
          <button onClick={toggle} className="hidden lg:block p-1.5 rounded-lg text-muted hover:bg-sunken shrink-0" title={slim ? 'Tampilkan menu' : 'Sembunyikan menu'} aria-label={slim ? 'Tampilkan menu' : 'Sembunyikan menu'}>
            {slim ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
          <button onClick={() => setDrawer(false)} className="lg:hidden p-2 rounded-lg text-muted hover:bg-sunken shrink-0" aria-label="Tutup menu"><X className="w-4 h-4" /></button>
        </div>
        {navGroups.map((g) => (
          <div key={g.title} className={slim ? 'mb-3.5 lg:mb-2 lg:pb-2 lg:border-b lg:border-line/60 lg:last:border-0' : 'mb-3.5'}>
            <div className={`text-[10.5px] tracking-[.12em] uppercase text-muted/80 font-extrabold px-2.5 pb-1.5 ${slim ? 'lg:hidden' : ''}`}>{g.title}</div>
            {g.items.filter((i) => !i.perm || can(i.perm)).map((i) => (
              <NavLink key={i.to} to={i.to} end={i.to === '/'} title={slim ? i.label : undefined}
                className={({ isActive }) => `relative flex items-center rounded-[9px] text-[13px] gap-2.5 px-2.5 py-2.5 lg:py-2 ${slim ? 'lg:justify-center lg:h-9 lg:mb-0.5 lg:px-0 lg:py-0' : ''} ${isActive ? 'bg-brand-soft text-brand font-bold' : 'text-ink/75 hover:bg-sunken hover:text-brand'}`}>
                <i.icon className={`w-4 h-4 shrink-0 ${slim ? 'lg:w-[18px] lg:h-[18px]' : ''}`} />
                <span className={slim ? 'lg:hidden' : ''}>{i.label}</span>
                {i.to === '/approval' && inbox > 0 && (
                  <span className={`ml-auto bg-brand text-on-brand text-[10px] font-bold rounded-full px-1.5 min-w-[18px] text-center ${slim ? 'lg:absolute lg:top-0.5 lg:right-1 lg:ml-0 lg:px-1 lg:min-w-[15px] lg:text-[9px] lg:leading-[15px]' : ''}`}>{inbox}</span>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </aside>

      <div className="min-w-0">
        <header className="min-h-[58px] lg:min-h-[66px] bg-panel/95 backdrop-blur border-b border-line flex items-center gap-2 px-3 sm:px-5 py-2 sticky top-0 z-30">
          <button className="btn !px-2.5 lg:hidden shrink-0" onClick={() => setDrawer(true)} aria-label="Buka menu" aria-controls="sidebar" aria-expanded={drawer}><Menu className="w-4 h-4" /></button>
          <div className="min-w-0 flex-1">
            <div className="text-[17px] font-bold leading-tight truncate">{title}</div>
            {subtitle && <div className="text-[11.5px] text-muted truncate">{subtitle}</div>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden sm:flex items-center gap-2">{actions}</div>
            <NotificationBell />
            <div className="hidden md:block">{bizSelect}</div>
            <ThemeToggle className="hidden md:inline-flex" />
            <div className="hidden md:block text-right leading-tight px-2 max-w-[160px]"><div className="text-xs font-bold truncate">{user?.name}</div><div className="text-[10px] text-muted">{user?.role}</div></div>
            <button className="btn hidden md:inline-flex" title="Keluar" aria-label="Keluar" onClick={doLogout}><LogOut className="w-3.5 h-3.5" /></button>
            <div className="relative md:hidden">
              <button className="btn !px-2.5" onClick={() => setMenu((m) => !m)} aria-label="Menu akun" aria-expanded={menu}><MoreVertical className="w-4 h-4" /></button>
              {menu && (
                <div className="absolute right-0 mt-2 w-[min(300px,calc(100vw-1.5rem))] bg-panel border border-line rounded-xl shadow-2xl p-3 space-y-3 z-40">
                  <div className="leading-tight"><div className="text-xs font-bold">{user?.name}</div><div className="text-[10px] text-muted">{user?.role}</div></div>
                  <label className="block text-[11px] font-semibold text-muted">Bisnis<div className="mt-1 text-ink">{bizSelect}</div></label>
                  <div className="flex items-center gap-2"><ThemeToggle /><span className="text-[11px] text-muted">Tema</span><button className="btn ml-auto" onClick={doLogout}><LogOut className="w-3.5 h-3.5 inline mr-1" />Keluar</button></div>
                </div>
              )}
            </div>
          </div>
        </header>
        {actions && <div className="sm:hidden flex flex-wrap gap-2 px-3 pt-3">{actions}</div>}
        <main className="p-3 sm:p-[18px]">{children}</main>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { getDevAccounts } from '../services/api'
import type { DevAccount, User } from '../types'

export const ROLE_LABEL: Record<User['role'], string> = { super_admin: 'Super Admin', hr_admin: 'HR Admin', manager: 'Manager', employee: 'Karyawan' }
const ROLE_ORDER: User['role'][] = ['super_admin', 'hr_admin', 'manager', 'employee']
const TONE: Record<User['role'], string> = { super_admin: 'bg-brand-soft text-brand', hr_admin: 'bg-violet-soft text-violet', manager: 'bg-info-soft text-info', employee: 'bg-gray-100 text-gray-600' }
const initials = (n: string) => n.split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase()

// Loads the quick-login accounts. Resolves to null when the backend does not offer them (DEV_LOGIN off) —
// callers then render nothing, so a production build never shows this.
export function useDevAccounts(): DevAccount[] | null {
  const [accounts, setAccounts] = useState<DevAccount[] | null>(null)
  useEffect(() => { getDevAccounts().then((r) => setAccounts(r.data)).catch(() => setAccounts(null)) }, [])
  return accounts
}

// Click-to-sign-in list (login page).
export default function DevAccountPicker({ accounts, onPick, busyId, error }: { accounts: DevAccount[]; onPick: (a: DevAccount) => void; busyId: number | null; error?: string }) {
  const [q, setQ] = useState('')
  const filtered = accounts.filter((a) => `${a.name} ${a.email} ${a.nik} ${a.position}`.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="card p-4 w-full">
      <div className="flex items-center justify-between mb-2">
        <div><div className="font-bold text-sm">Pilih akun</div><div className="text-[11px] text-muted">Klik untuk masuk tanpa mengetik password</div></div>
        <span className="text-[10px] font-bold bg-warn-soft text-warn rounded-full px-2 py-0.5 whitespace-nowrap">MODE PENGEMBANGAN</span>
      </div>
      <div className="relative mb-2">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
        <input className="input w-full !pl-8" placeholder="Cari nama, NIK, jabatan…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <div className="text-xs text-brand bg-brand-soft rounded-lg px-3 py-2 mb-2">{error}</div>}
      <div className="max-h-[420px] overflow-auto space-y-3 pr-1">
        {ROLE_ORDER.map((role) => {
          const list = filtered.filter((a) => a.role === role)
          if (!list.length) return null
          return (
            <div key={role}>
              <div className="text-[10px] font-extrabold tracking-widest uppercase text-gray-400 mb-1">{ROLE_LABEL[role]} ({list.length})</div>
              <div className="space-y-1">
                {list.map((a) => (
                  <button key={a.id} type="button" disabled={busyId !== null} onClick={() => onPick(a)}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-line text-left hover:border-brand hover:bg-brand-soft/40 disabled:opacity-60">
                    <span className={`w-8 h-8 rounded-full grid place-items-center text-[11px] font-bold shrink-0 ${TONE[a.role]}`}>{initials(a.name)}</span>
                    <span className="min-w-0 flex-1">
                      <b className="block text-xs leading-tight truncate">{a.name}</b>
                      <span className="block text-[10.5px] text-muted truncate">{[a.position, a.nik, a.businesses?.join(', ')].filter(Boolean).join(' · ') || a.email}</span>
                    </span>
                    {busyId === a.id && <span className="text-[10px] text-muted">Masuk…</span>}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
        {!filtered.length && <div className="text-center text-xs text-muted py-6">Tidak ada akun yang cocok</div>}
      </div>
    </div>
  )
}

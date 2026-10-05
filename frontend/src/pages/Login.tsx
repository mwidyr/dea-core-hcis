import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { devLogin, login } from '../services/api'
import { useAuthStore } from '../store/auth'
import PasswordInput from '../components/ui/PasswordInput'
import DevAccountPicker, { useDevAccounts } from '../components/DevAccountPicker'
import type { DevAccount } from '../types'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const setAuth = useAuthStore((s) => s.setAuth)
  const devAccounts = useDevAccounts() // null unless the backend runs with DEV_LOGIN=true
  const nav = useNavigate()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const { data } = await login(email, password)
      setAuth(data.user, data.token)
      nav('/')
    } catch (err: any) {
      setError(err.response?.data?.error || 'Gagal masuk')
    } finally { setLoading(false) }
  }

  const pick = async (a: DevAccount) => {
    setBusyId(a.id); setError('')
    try {
      localStorage.removeItem('business_id') // each account starts from its own business context
      const { data } = await devLogin(a.id)
      setAuth(data.user, data.token)
      nav('/')
    } catch (err: any) {
      setError(err.response?.data?.error || 'Gagal masuk sebagai akun ini')
    } finally { setBusyId(null) }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-surface p-4">
      <div className={`w-full ${devAccounts?.length ? 'max-w-3xl grid md:grid-cols-[360px_1fr] gap-4 items-start' : 'max-w-sm'}`}>
        <form onSubmit={submit} className="card p-7 w-full space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-brand text-white grid place-items-center font-black">C</div>
            <div><b>CORE</b><div className="text-[11px] text-muted">Business Operations Platform</div></div>
          </div>
          <label className="block text-xs font-semibold">Email<input className="input w-full mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
          <label className="block text-xs font-semibold">Password<div className="mt-1"><PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} required /></div></label>
          {error && !devAccounts?.length && <div className="text-xs text-brand bg-brand-soft rounded-lg px-3 py-2">{error}</div>}
          <button className="btn-primary w-full py-2.5" disabled={loading}>{loading ? 'Memproses…' : 'Masuk'}</button>
          {error && !!devAccounts?.length && <div className="text-xs text-brand bg-brand-soft rounded-lg px-3 py-2">{error}</div>}
        </form>
        {!!devAccounts?.length && <DevAccountPicker accounts={devAccounts} onPick={pick} busyId={busyId} />}
      </div>
    </div>
  )
}

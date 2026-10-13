import { useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, CheckCircle2, LogIn, LogOut, MapPin, MapPinOff, RefreshCw, SwitchCamera, XCircle } from 'lucide-react'
import PasswordInput from '../components/ui/PasswordInput'
import { publicClock, publicTap, type TapResult } from '../services/api'
import { ROLE_LABEL, useDevAccounts } from '../components/DevAccountPicker'
import type { DevAccount, User } from '../types'

// Public attendance page — no login session. The employee enters NIK/email + password and taps in or out.
// The clock follows SERVER time (offset measured on load), so what is shown is what gets recorded.

type Fix = { lat: number; lng: number; accuracy: number }
type Cam = { state: 'starting' | 'live' | 'error'; message?: string }
const MAX_EDGE = 1280 // the server shrinks to this anyway
type Geo = { state: 'locating' | 'ok' | 'denied' | 'unavailable'; fix?: Fix }
const TZ = 'Asia/Jakarta'

export default function Absen() {
  const [offset, setOffset] = useState(0) // server ms − local ms
  const [now, setNow] = useState(Date.now())
  const [geo, setGeo] = useState<Geo>({ state: 'locating' })
  const [identifier, setIdentifier] = useState(() => { try { return localStorage.getItem('absen_identifier') || '' } catch { return '' } })
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'in' | 'out' | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string; data?: TapResult; name?: string } | null>(null)
  const devAccounts = useDevAccounts() // null unless the backend runs with DEV_LOGIN=true
  const [devUser, setDevUser] = useState<DevAccount | null>(null) // picked test account → tap without a password
  const fix = useRef<Fix | undefined>()
  // camera: a photo is required for every tap. The server burns time, place and name into it.
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const [cam, setCam] = useState<Cam>({ state: 'starting' })
  const [facing, setFacing] = useState<'user' | 'environment'>('user')
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null)
  const clearTimer = useRef<number | undefined>()

  useEffect(() => { document.title = 'Absensi — CORE' }, [])

  // server clock offset (re-synced every 5 minutes)
  useEffect(() => {
    const sync = () => { const t0 = Date.now(); publicClock().then((r) => setOffset(r.data.ms + (Date.now() - t0) / 2 - Date.now())).catch(() => {}) }
    sync()
    const id = setInterval(sync, 300000)
    return () => clearInterval(id)
  }, [])
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(id) }, [])

  // live GPS
  useEffect(() => {
    if (!navigator.geolocation) { setGeo({ state: 'unavailable' }); return }
    const id = navigator.geolocation.watchPosition(
      (p) => { fix.current = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }; setGeo({ state: 'ok', fix: fix.current }) },
      (e) => setGeo({ state: e.code === 1 ? 'denied' : 'unavailable' }),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  const stopCam = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null }
  const startCam = async (mode: 'user' | 'environment') => {
    stopCam()
    setCam({ state: 'starting' })
    if (!navigator.mediaDevices?.getUserMedia) {
      setCam({ state: 'error', message: window.isSecureContext ? 'Browser ini tidak mendukung kamera.' : 'Kamera hanya dapat dipakai lewat HTTPS. Buka halaman ini dengan alamat https://.' })
      return
    }
    try {
      const st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: mode }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false })
      stream.current = st
      if (video.current) { video.current.srcObject = st; await video.current.play().catch(() => {}) }
      setCam({ state: 'live' })
    } catch (e: any) {
      const denied = e?.name === 'NotAllowedError' || e?.name === 'SecurityError'
      setCam({ state: 'error', message: denied ? 'Akses kamera ditolak. Izinkan kamera pada pengaturan browser (ikon gembok di address bar), lalu coba lagi.' : e?.name === 'NotFoundError' ? 'Kamera tidak ditemukan pada perangkat ini.' : 'Kamera tidak dapat dibuka. Tutup aplikasi lain yang memakai kamera lalu coba lagi.' })
    }
  }
  useEffect(() => { startCam(facing); return stopCam }, [])
  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url) }, [shot])

  const switchCam = () => { const next = facing === 'user' ? 'environment' : 'user'; setFacing(next); startCam(next) }
  const capture = () => {
    const v = video.current
    if (!v || !v.videoWidth) return
    const k = Math.min(1, MAX_EDGE / Math.max(v.videoWidth, v.videoHeight))
    const cv = document.createElement('canvas')
    cv.width = Math.round(v.videoWidth * k); cv.height = Math.round(v.videoHeight * k)
    cv.getContext('2d')!.drawImage(v, 0, 0, cv.width, cv.height) // not mirrored: the stored photo shows the scene as it is
    cv.toBlob((b) => {
      if (!b) { setResult({ ok: false, text: 'Gagal mengambil foto, coba lagi.' }); return }
      setShot({ blob: b, url: URL.createObjectURL(b) }); stopCam(); setCam({ state: 'starting' })
    }, 'image/jpeg', 0.85)
  }
  const retake = () => { setShot(null); startCam(facing) }

  const t = new Date(now + offset)
  const clock = t.toLocaleTimeString('en-GB', { timeZone: TZ, hour12: false })
  const date = t.toLocaleDateString('id-ID', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  const tap = async (action: 'in' | 'out') => {
    if (!shot) { setResult({ ok: false, text: 'Ambil foto terlebih dahulu sebelum Tap In/Out.' }); return }
    if (!devUser && (!identifier.trim() || !password)) { setResult({ ok: false, text: 'Isi NIK/email dan password terlebih dahulu.' }); return }
    window.clearTimeout(clearTimer.current)
    setBusy(action); setResult(null)
    if (!devUser) { try { localStorage.setItem('absen_identifier', identifier.trim()) } catch { /* private mode */ } }
    try {
      const f = fix.current
      const who = devUser ? { dev_user_id: devUser.id } : { identifier: identifier.trim(), password }
      const { data } = await publicTap({ ...who, action, lat: f?.lat, lng: f?.lng, accuracy: f?.accuracy }, shot.blob)
      setResult({ ok: true, text: data.message, data })
      setPassword('')
      setShot(null); startCam(facing) // every tap needs its own fresh photo
      clearTimer.current = window.setTimeout(() => setResult(null), 15000)
    } catch (e: any) {
      setResult({ ok: false, text: e.response?.data?.error || 'Tidak dapat terhubung ke server', name: e.response?.data?.name })
      setPassword('')
    } finally { setBusy(null) }
  }

  const geoLabel = geo.state === 'ok' ? `Lokasi terdeteksi · akurasi ±${Math.round(geo.fix!.accuracy)} m` : geo.state === 'locating' ? 'Mendeteksi lokasi…' : geo.state === 'denied' ? 'Akses lokasi ditolak — izinkan lokasi pada browser' : 'Lokasi tidak tersedia pada perangkat ini'

  return (
    <div className="min-h-screen bg-surface grid place-items-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2.5 mb-5">
          <div className="w-9 h-9 rounded-[10px] bg-brand text-white grid place-items-center font-black">C</div>
          <div><b className="text-[15px]">CORE</b><span className="block text-[10px] text-muted">Absensi Karyawan</span></div>
        </div>

        <div className="card p-6">
          <div className="text-center mb-5">
            <div className="text-5xl font-extrabold tracking-tight tabular-nums" aria-label="Jam sekarang">{clock}</div>
            <div className="text-sm text-muted mt-1">{date}</div>
            <div className="text-[10px] text-muted mt-0.5">WIB · mengikuti waktu server</div>
          </div>

          <div className={`flex items-center gap-2 text-xs rounded-lg px-3 py-2 mb-4 ${geo.state === 'ok' ? 'bg-ok-soft text-ok' : geo.state === 'locating' ? 'bg-gray-100 text-muted' : 'bg-warn-soft text-warn'}`}>
            {geo.state === 'ok' ? <MapPin className="w-4 h-4 shrink-0" /> : <MapPinOff className="w-4 h-4 shrink-0" />}<span>{geoLabel}</span>
          </div>

          <div className="mb-4">
            <div className="relative rounded-xl overflow-hidden bg-black aspect-[4/3] grid place-items-center">
              <video ref={video} playsInline muted autoPlay className={`absolute inset-0 w-full h-full object-cover ${facing === 'user' ? '-scale-x-100' : ''} ${shot || cam.state !== 'live' ? 'invisible' : ''}`} />
              {shot && <img src={shot.url} alt="Foto absensi" className={`absolute inset-0 w-full h-full object-cover ${facing === 'user' ? '-scale-x-100' : ''}`} />}
              {!shot && cam.state === 'starting' && <span className="text-xs text-white/80">Membuka kamera…</span>}
              {!shot && cam.state === 'error' && (
                <div className="px-5 text-center text-xs text-white/90"><CameraOff className="w-6 h-6 mx-auto mb-2" />{cam.message}</div>
              )}
            </div>
            <div className="flex gap-2 mt-2">
              {shot ? (
                <button type="button" onClick={retake} className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border border-line text-xs font-semibold hover:bg-gray-50"><RefreshCw className="w-3.5 h-3.5" />Foto Ulang</button>
              ) : cam.state === 'error' ? (
                <button type="button" onClick={() => startCam(facing)} className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border border-line text-xs font-semibold hover:bg-gray-50"><RefreshCw className="w-3.5 h-3.5" />Coba Lagi</button>
              ) : (
                <>
                  <button type="button" disabled={cam.state !== 'live'} onClick={capture} className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-gray-900 text-white text-xs font-semibold disabled:opacity-40"><Camera className="w-3.5 h-3.5" />Ambil Foto</button>
                  <button type="button" onClick={switchCam} className="px-3 py-2 rounded-lg border border-line text-xs font-semibold hover:bg-gray-50" title={facing === 'user' ? 'Pakai kamera belakang' : 'Pakai kamera depan'}><SwitchCamera className="w-4 h-4" /></button>
                </>
              )}
            </div>
            <p className="text-[10.5px] text-muted mt-1.5">Foto wajib untuk setiap Tap In/Out. Jam, lokasi, dan nama ditempel otomatis di foto oleh server.</p>
          </div>

          <form className="space-y-3" onSubmit={(e) => e.preventDefault()}>
            {!!devAccounts?.length && (
              <label className="block text-xs font-semibold">Pilih akun <span className="ml-1 text-[9px] font-bold bg-warn-soft text-warn rounded-full px-1.5 py-0.5 align-middle">MODE PENGEMBANGAN</span>
                <select className="input w-full mt-1" value={devUser?.id ?? ''} onChange={(e) => {
                  const a = devAccounts.find((x) => x.id === Number(e.target.value)) ?? null
                  setDevUser(a); setPassword(''); setResult(null)
                  if (a) setIdentifier(a.nik || a.email)
                }}>
                  <option value="">— isi NIK/email &amp; password manual —</option>
                  {(['super_admin', 'hr_admin', 'manager', 'employee'] as User['role'][]).map((role) => {
                    const list = devAccounts.filter((a) => a.role === role && a.has_employee)
                    return list.length ? <optgroup key={role} label={ROLE_LABEL[role]}>{list.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.nik}{a.position ? ` · ${a.position}` : ''}</option>)}</optgroup> : null
                  })}
                </select>
              </label>
            )}
            <label className="block text-xs font-semibold">NIK atau Email
              <input className="input w-full mt-1" value={identifier} onChange={(e) => { setIdentifier(e.target.value); setDevUser(null) }} autoComplete="username" placeholder="mis. DEA-0011 atau nama@perusahaan.com" autoCapitalize="none" />
            </label>
            <label className="block text-xs font-semibold">Password
              <div className="mt-1"><PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" disabled={!!devUser} placeholder={devUser ? 'tidak perlu password (akun uji)' : ''} /></div>
            </label>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <button type="button" disabled={!!busy || !shot} onClick={() => tap('in')} className="flex items-center justify-center gap-2 py-3 rounded-xl bg-ok text-white font-bold text-sm hover:opacity-90 disabled:opacity-60">
                <LogIn className="w-4 h-4" />{busy === 'in' ? 'Memproses…' : 'Tap In'}
              </button>
              <button type="button" disabled={!!busy || !shot} onClick={() => tap('out')} className="flex items-center justify-center gap-2 py-3 rounded-xl bg-brand text-white font-bold text-sm hover:opacity-90 disabled:opacity-60">
                <LogOut className="w-4 h-4" />{busy === 'out' ? 'Memproses…' : 'Tap Out'}
              </button>
            </div>
          </form>

          {result && (
            <div role="status" className={`mt-4 rounded-xl p-4 text-sm ${result.ok ? 'bg-ok-soft text-ok' : 'bg-brand-soft text-brand'}`}>
              <div className="flex items-start gap-2">
                {result.ok ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <XCircle className="w-5 h-5 shrink-0" />}
                <div className="min-w-0">
                  {(result.data?.name || result.name) && <div className="font-extrabold text-gray-900">{result.data?.name || result.name}{result.data?.nik && <span className="font-normal text-muted"> · {result.data.nik}</span>}</div>}
                  <div className="font-semibold">{result.text}</div>
                  {result.data && (
                    <div className="text-xs text-gray-600 mt-1 space-y-0.5">
                      <div>Pukul <b>{new Date(result.data.time).toLocaleTimeString('en-GB', { timeZone: TZ, hour12: false })}</b> · {result.data.status}{result.data.position ? ` · ${result.data.position}` : ''}</div>
                      {result.data.location && <div>Lokasi: {result.data.location}{result.data.distance !== undefined && result.data.distance !== null ? ` (${result.data.distance} m dari titik)` : ''}</div>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
        <p className="text-center text-[10px] text-muted mt-4">Gunakan akun Anda sendiri. Lokasi (GPS) dicatat saat absen.</p>
      </div>
    </div>
  )
}

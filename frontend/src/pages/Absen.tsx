import BrandLogo from '../components/BrandLogo'
import ThemeToggle from '../components/ThemeToggle'
import { useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, CheckCircle2, Clock, LogIn, LogOut, MapPin, MapPinOff, RefreshCw, SwitchCamera, XCircle } from 'lucide-react'
import PasswordInput from '../components/ui/PasswordInput'
import { publicClock, publicMoveTomorrow, publicTap, type DaySummary, type OutsideInfo, type TapResult } from '../services/api'
import Modal from '../components/ui/Modal'
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
  const [result, setResult] = useState<{ ok: boolean; text: string; data?: TapResult; name?: string; pending?: boolean } | null>(null)
  const [outside, setOutside] = useState<{ action: 'in' | 'out'; info: OutsideInfo } | null>(null) // asking to send a tap from outside the radius for approval
  const [reason, setReason] = useState('')
  const [moved, setMoved] = useState<Record<number, string>>({}) // result of "Pindahkan ke besok" per task
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

  const tap = async (action: 'in' | 'out', confirmOutside = false) => {
    if (!shot) { setResult({ ok: false, text: 'Ambil foto terlebih dahulu sebelum Tap In/Out.' }); return }
    if (!devUser && (!identifier.trim() || !password)) { setResult({ ok: false, text: 'Isi NIK/email dan password terlebih dahulu.' }); return }
    window.clearTimeout(clearTimer.current)
    setBusy(action); setResult(null)
    if (!devUser) { try { localStorage.setItem('absen_identifier', identifier.trim()) } catch { /* private mode */ } }
    try {
      const f = fix.current
      const who = devUser ? { dev_user_id: devUser.id } : { identifier: identifier.trim(), password }
      const { data } = await publicTap({ ...who, action, lat: f?.lat, lng: f?.lng, accuracy: f?.accuracy, ...(confirmOutside ? { confirm_outside: 1 as const, reason: reason.trim() } : {}) }, shot.blob)
      setResult({ ok: true, text: data.message, data, pending: !!data.pending_location })
      setPassword(''); setOutside(null); setReason(''); setMoved({})
      setShot(null); startCam(facing) // every tap needs its own fresh photo
      // a clock-out keeps its summary on screen until the employee closes it; other results clear themselves
      if (!(data.action === 'out' && data.summary)) clearTimer.current = window.setTimeout(() => setResult(null), 15000)
    } catch (e: any) {
      const body = e.response?.data
      if (e.response?.status === 409 && body?.needs_confirm) { setOutside({ action, info: body as OutsideInfo }); return } // keep the photo and the password: only a confirmation is missing
      setResult({ ok: false, text: e.response?.data?.error || 'Tidak dapat terhubung ke server', name: e.response?.data?.name })
      setPassword('')
    } finally { setBusy(null) }
  }

  const moveTask = async (id: number) => {
    const token = result?.data?.summary_token
    if (!token) return
    try { const { data } = await publicMoveTomorrow(token, id); setMoved((m) => ({ ...m, [id]: data.message })) }
    catch (e: any) { setMoved((m) => ({ ...m, [id]: e.response?.data?.error || 'Gagal memindahkan tugas' })) }
  }
  const closeResult = () => { window.clearTimeout(clearTimer.current); setResult(null); setMoved({}) }

  const geoLabel = geo.state === 'ok' ? `Lokasi terdeteksi · akurasi ±${Math.round(geo.fix!.accuracy)} m` : geo.state === 'locating' ? 'Mendeteksi lokasi…' : geo.state === 'denied' ? 'Akses lokasi ditolak — izinkan lokasi pada browser' : 'Lokasi tidak tersedia pada perangkat ini'

  return (
    <div className="min-h-screen bg-surface grid place-items-center p-3 sm:p-4 relative">
      <ThemeToggle className="absolute top-3 right-3" />
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2.5 mb-5">
          <BrandLogo size={36} />
          <div><b className="text-[15px]">CORE</b><span className="block text-[10px] text-muted">Absensi Karyawan</span></div>
        </div>

        <div className="card p-6">
          <div className="text-center mb-5">
            <div className="text-5xl font-extrabold tracking-tight tabular-nums" aria-label="Jam sekarang">{clock}</div>
            <div className="text-sm text-muted mt-1">{date}</div>
            <div className="text-[10px] text-muted mt-0.5">WIB · mengikuti waktu server</div>
          </div>

          <div className={`flex items-center gap-2 text-xs rounded-lg px-3 py-2 mb-4 ${geo.state === 'ok' ? 'bg-ok-soft text-ok' : geo.state === 'locating' ? 'bg-tint text-muted' : 'bg-warn-soft text-warn'}`}>
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
                <button type="button" onClick={retake} className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border border-line text-xs font-semibold hover:bg-sunken"><RefreshCw className="w-3.5 h-3.5" />Foto Ulang</button>
              ) : cam.state === 'error' ? (
                <button type="button" onClick={() => startCam(facing)} className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border border-line text-xs font-semibold hover:bg-sunken"><RefreshCw className="w-3.5 h-3.5" />Coba Lagi</button>
              ) : (
                <>
                  <button type="button" disabled={cam.state !== 'live'} onClick={capture} className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-brand text-on-brand text-xs font-semibold disabled:opacity-40"><Camera className="w-3.5 h-3.5" />Ambil Foto</button>
                  <button type="button" onClick={switchCam} className="px-3 py-2 rounded-lg border border-line text-xs font-semibold hover:bg-sunken" title={facing === 'user' ? 'Pakai kamera belakang' : 'Pakai kamera depan'}><SwitchCamera className="w-4 h-4" /></button>
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
              <button type="button" disabled={!!busy || !shot} onClick={() => tap('in')} className="flex items-center justify-center gap-2 py-3 rounded-xl bg-ok text-on-brand font-bold text-sm hover:opacity-90 disabled:opacity-60">
                <LogIn className="w-4 h-4" />{busy === 'in' ? 'Memproses…' : 'Tap In'}
              </button>
              <button type="button" disabled={!!busy || !shot} onClick={() => tap('out')} className="flex items-center justify-center gap-2 py-3 rounded-xl bg-danger text-on-brand font-bold text-sm hover:opacity-90 disabled:opacity-60">
                <LogOut className="w-4 h-4" />{busy === 'out' ? 'Memproses…' : 'Tap Out'}
              </button>
            </div>
          </form>

          {result && (
            <div role="status" className={`mt-4 rounded-xl p-4 text-sm ${result.pending ? 'bg-warn-soft text-warn' : result.ok ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>
              <div className="flex items-start gap-2">
                {result.pending ? <Clock className="w-5 h-5 shrink-0" /> : result.ok ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <XCircle className="w-5 h-5 shrink-0" />}
                <div className="min-w-0">
                  {(result.data?.name || result.name) && <div className="font-extrabold text-ink">{result.data?.name || result.name}{result.data?.nik && <span className="font-normal text-muted"> · {result.data.nik}</span>}</div>}
                  <div className="font-semibold">{result.text}</div>
                  {result.data && (
                    <div className="text-xs text-ink/80 mt-1 space-y-0.5">
                      <div>Pukul <b>{new Date(result.data.time).toLocaleTimeString('en-GB', { timeZone: TZ, hour12: false })}</b> · {result.data.status}{result.data.position ? ` · ${result.data.position}` : ''}</div>
                      {result.data.location && <div>Lokasi: {result.data.location}{result.data.distance !== undefined && result.data.distance !== null ? ` (${result.data.distance} m dari titik)` : ''}</div>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          {result?.data?.summary && <SummaryPanel s={result.data.summary} moved={moved} onMove={moveTask} onClose={closeResult} canMove={!!result.data.summary_token} />}
        </div>
        <p className="text-center text-[10px] text-muted mt-4">Gunakan akun Anda sendiri. Lokasi (GPS) dicatat saat absen.</p>
      </div>

      <Modal open={!!outside} onClose={() => setOutside(null)} title="Di Luar Lokasi Kerja">
        {outside && (
          <div className="space-y-3 text-xs">
            <div className="bg-warn-soft text-warn rounded-lg px-3 py-2.5"><b>Anda berada {outside.info.distance} m dari {outside.info.location}</b> (batas radius {outside.info.radius_m} m).</div>
            <p>Absen dari luar lokasi tidak langsung dihitung. Tap {outside.action === 'in' ? 'In' : 'Out'} Anda dikirim ke atasan untuk disetujui, dan statusnya <b>Menunggu Approval Lokasi</b> sampai diputuskan. Bila ditolak, absen ini dibatalkan.</p>
            <label className="block font-semibold">Alasan <span className="font-normal text-muted">(opsional, mis. meeting di klien)</span>
              <textarea className="input w-full mt-1 font-normal" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
            <div className="flex justify-end gap-2">
              <button className="btn" onClick={() => setOutside(null)}>Batal</button>
              <button className="btn-primary" disabled={!!busy} onClick={() => tap(outside.action, true)}>{busy ? 'Mengirim…' : 'Kirim untuk Approval'}</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

// What was done today, what is still open and what could move to the next working day (shown after Tap Out).
function SummaryPanel({ s, moved, onMove, onClose, canMove }: { s: DaySummary; moved: Record<number, string>; onMove: (id: number) => void; onClose: () => void; canMove: boolean }) {
  const next = new Date(s.next_workday + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })
  const Row = ({ t, move }: { t: DaySummary['done'][number]; move?: boolean }) => (
    <li className="flex items-start gap-2 py-1.5 border-b border-line last:border-0">
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-ink break-words">{t.title}</div>
        <div className="text-[11px] text-muted">{t.project || 'Non project'}{t.due ? ` · deadline ${t.due}` : ''} · {Math.round(t.progress)}%{t.timeliness_label ? ` · ${t.timeliness_label}` : ''}</div>
        {t.changes && t.changes.length > 0 && <div className="text-[11px] text-ink/70">{t.changes.join(' · ')}</div>}
        {moved[t.id] && <div className="text-[11px] text-info mt-0.5">{moved[t.id]}</div>}
      </div>
      {move && canMove && t.movable && !moved[t.id] && <button className="btn !px-2 !py-1 whitespace-nowrap" onClick={() => onMove(t.id)}>Pindahkan ke besok</button>}
    </li>
  )
  const Block = ({ title, items, move, empty }: { title: string; items: DaySummary['done']; move?: boolean; empty: string }) => (
    <div className="mt-3"><div className="text-[10.5px] font-bold uppercase tracking-wide text-muted mb-0.5">{title} ({items.length})</div>
      {items.length ? <ul>{items.map((t) => <Row key={t.id} t={t} move={move} />)}</ul> : <div className="text-[11.5px] text-muted">{empty}</div>}</div>
  )
  return (
    <div className="mt-4 rounded-xl border border-line p-4 text-xs" role="region" aria-label="Ringkasan hari ini">
      <div className="flex items-center justify-between gap-2">
        <div><div className="text-sm font-extrabold">Ringkasan Hari Ini</div><div className="text-[11px] text-muted">Laporan {new Date(s.date + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })} · pekerjaan setelah Tap Out masuk laporan hari kerja berikutnya</div></div>
        <button className="btn" onClick={onClose}>Selesai</button>
      </div>
      <Block title="Selesai" items={s.done} empty="Belum ada tugas yang selesai hari ini" />
      <Block title="Dikerjakan" items={s.worked} empty="Tidak ada pembaruan progres tugas hari ini" />
      <Block title={`Belum selesai · perlu perhatian ${next}`} items={s.unfinished} move empty="Tidak ada tugas yang perlu dipindahkan" />
      <p className="text-[10.5px] text-muted mt-3">"Pindahkan ke besok" memindahkan tanggal mulai tugas ke {next}. Deadline yang jatuh sebelum itu dikirim ke atasan sebagai pengajuan perubahan deadline.</p>
    </div>
  )
}

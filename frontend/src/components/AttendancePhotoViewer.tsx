import { useEffect, useState } from 'react'
import Modal from './ui/Modal'
import { fetchAttendancePhotoBlob } from '../services/api'

// Shows the stamped tap-in / tap-out photo(s) of one attendance record. Photos need the auth header, so they are fetched as blobs.
export default function AttendancePhotoViewer({ recordId, name, hasIn, hasOut, onClose }: { recordId: number; name: string; hasIn: boolean; hasOut: boolean; onClose: () => void }) {
  const [kind, setKind] = useState<'in' | 'out'>(hasIn ? 'in' : 'out')
  const [url, setUrl] = useState('')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true, made = ''
    setUrl(''); setFailed(false)
    fetchAttendancePhotoBlob(recordId, kind)
      .then((r) => { if (alive) { made = URL.createObjectURL(r.data); setUrl(made) } })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false; if (made) URL.revokeObjectURL(made) }
  }, [recordId, kind])
  const tab = (k: 'in' | 'out', label: string, on: boolean) => (
    <button key={k} disabled={!on} onClick={() => setKind(k)}
      className={`px-3 py-1.5 rounded-lg border text-xs font-semibold disabled:opacity-40 ${kind === k ? 'border-brand bg-brand-soft text-brand' : 'border-line hover:bg-sunken'}`}>{label}</button>
  )
  return (
    <Modal open onClose={onClose} title={`Foto Absensi — ${name}`} size="lg">
      <div className="flex gap-2 mb-3">{tab('in', 'Foto Check-in', hasIn)}{tab('out', 'Foto Check-out', hasOut)}</div>
      <div className="bg-sunken rounded-lg grid place-items-center min-h-[16rem] overflow-hidden">
        {url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={`Foto ${kind === 'in' ? 'check-in' : 'check-out'} ${name}`} className="max-h-[65vh] w-auto" /></a>
          : <span className="text-xs text-muted">{failed ? 'Foto tidak tersedia' : 'Memuat foto…'}</span>}
      </div>
    </Modal>
  )
}

import { useRef, useState } from 'react'
import { Camera, Trash2, User as UserIcon } from 'lucide-react'
import Avatar from '../ui/Avatar'
import { deleteEmployeeAvatar, uploadEmployeeAvatar } from '../../services/api'
import { useAuthStore } from '../../store/auth'
import { errMsg } from '../../utils/format'

// The employee's photo (portrait frame) with change / remove buttons for the employee themself, HR admin and super admin.
export default function EmployeePhoto({ empId, name, version, size = 120, onChanged }: { empId: number; name: string; version?: number; size?: number; onChanged?: (version: number) => void }) {
  const user = useAuthStore((s) => s.user)
  const allowed = ['super_admin', 'hr_admin'].includes(user?.role ?? '') || user?.employee_id === empId
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [local, setLocal] = useState<number | undefined>(undefined) // version after an upload on this screen
  const v = local ?? version

  const pick = async (f?: File) => {
    if (!f) return
    setBusy(true); setMsg('')
    try { const r = await uploadEmployeeAvatar(empId, f); setLocal(r.data.avatar); onChanged?.(r.data.avatar) } catch (e: any) { setMsg(errMsg(e, 'Gagal mengunggah foto')) } finally { setBusy(false); if (input.current) input.current.value = '' }
  }
  const remove = async () => {
    if (!confirm(`Hapus foto ${name}?`)) return
    setBusy(true); setMsg('')
    try { await deleteEmployeeAvatar(empId); setLocal(0); onChanged?.(0) } catch (e: any) { setMsg(errMsg(e, 'Gagal menghapus foto')) } finally { setBusy(false) }
  }
  return (
    <div className="shrink-0 text-center" style={{ width: size }}>
      {v ? <Avatar empId={empId} name={name} version={v} size={size} square /> : (
        <div className="grid place-items-center rounded-lg border-2 border-dashed border-line bg-sunken text-muted" style={{ width: size, height: size * 1.2 }}><UserIcon style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={1.4} /></div>
      )}
      {allowed && (
        <div className="mt-1.5 flex flex-col gap-1">
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          <button type="button" className="btn !text-[11px] !py-1" disabled={busy} onClick={() => input.current?.click()}><Camera className="w-3 h-3 inline mr-1" />{v ? 'Ganti foto' : 'Unggah foto'}</button>
          {!!v && <button type="button" className="text-[11px] text-danger hover:underline" disabled={busy} onClick={remove}><Trash2 className="w-3 h-3 inline mr-0.5" />Hapus</button>}
        </div>
      )}
      {msg && <div className="text-[10.5px] text-danger mt-1">{msg}</div>}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import Badge from '../ui/Badge'
import { addPlacement, getEmployee, getPositions, removePlacement } from '../../services/api'
import { errMsg } from '../../utils/format'
import type { Employee, Position } from '../../types'

// Additional placements: an employee may work in several businesses, but holds ONE position per business.
export default function Placements({ empId, primaryBusinessId, businesses }: { empId: number; primaryBusinessId: number; businesses: { id: number; name: string }[] }) {
  const [list, setList] = useState<Employee['placements']>([])
  const [bizId, setBizId] = useState(0)
  const [positions, setPositions] = useState<Position[]>([])
  const [posId, setPosId] = useState(0)
  const [error, setError] = useState('')
  const reload = () => getEmployee(empId).then((r) => setList(r.data.placements ?? []))
  useEffect(() => { reload() }, [empId])
  useEffect(() => { setPosId(0); if (bizId) getPositions({ business_id: bizId }).then((r) => setPositions(r.data)); else setPositions([]) }, [bizId])

  const used = new Set([primaryBusinessId, ...(list ?? []).map((p) => p.business?.id ?? 0)])
  const free = businesses.filter((b) => !used.has(b.id))
  const add = async () => {
    setError('')
    if (!bizId || !posId) return setError('Pilih bisnis dan jabatan')
    try { await addPlacement(empId, bizId, posId); setBizId(0); await reload() } catch (e: any) { setError(errMsg(e, 'Gagal menambah penempatan')) }
  }
  const del = async (id: number) => { if (confirm('Hapus penempatan ini?')) { await removePlacement(empId, id); reload() } }
  const extra = (list ?? []).filter((p) => !p.is_primary)

  return (
    <div>
      {extra.map((p) => (
        <div key={p.id} className="flex items-center gap-2 border border-line rounded-lg px-2 py-1.5 mb-1">
          <Badge tone="blue">{p.business?.name}</Badge><span className="flex-1">{p.position?.title}</span>
          <button type="button" className="p-0.5 text-danger" title="Hapus" onClick={() => del(p.id)}><X className="w-3.5 h-3.5" /></button>
        </div>
      ))}
      {!extra.length && <p className="text-muted mb-1">Belum ada penempatan di bisnis lain.</p>}
      {free.length > 0 && (
        <div className="flex gap-2 items-center mt-1">
          <select className="input" value={bizId} onChange={(e) => setBizId(Number(e.target.value))}><option value={0}>— Bisnis —</option>{free.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          <select className="input flex-1 min-w-0" disabled={!bizId} value={posId} onChange={(e) => setPosId(Number(e.target.value))}>
            <option value={0}>{bizId ? '— Jabatan —' : 'Pilih bisnis dulu'}</option>{positions.map((p) => <option key={p.id} value={p.id} disabled={p.holder !== 'Vacant'}>{p.title}{p.holder !== 'Vacant' ? ` (terisi: ${p.holder})` : ''}</option>)}
          </select>
          <button type="button" className="btn" onClick={add}><Plus className="w-3 h-3 inline mr-1" />Tambah</button>
        </div>
      )}
      {error && <div className="text-danger bg-danger-soft rounded-lg px-3 py-2 mt-2">{error}</div>}
    </div>
  )
}

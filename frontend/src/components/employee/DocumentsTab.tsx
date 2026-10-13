import { useEffect, useState } from 'react'
import { Upload } from 'lucide-react'
import DocGallery from './DocGallery'
import { deleteEmployeeDocument, getEmployeeContracts, getEmployeeDocuments, uploadEmployeeDocument } from '../../services/api'
import { errMsg, fmt } from '../../utils/format'
import type { EmployeeContract, EmployeeDocument } from '../../types'

const DOC_SUGGESTIONS = ['Foto KTP', 'Foto KK', 'Foto NPWP', 'Foto Ijazah', 'Foto Lain-lain', 'Kontrak']
const MAX_FILE = 10 * 1024 * 1024

// All photos / documents of one employee: list, delete, and upload more (optionally attached to one contract).
export default function DocumentsTab({ empId, canEdit, onChanged }: { empId: number; canEdit: boolean; onChanged?: () => void }) {
  const [docs, setDocs] = useState<EmployeeDocument[]>([])
  const [contracts, setContracts] = useState<EmployeeContract[]>([])
  const [label, setLabel] = useState('')
  const [contractId, setContractId] = useState(0)
  const [files, setFiles] = useState<File[]>([])
  const [fileKey, setFileKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = () => { getEmployeeDocuments(empId).then((r) => setDocs(r.data)); getEmployeeContracts(empId).then((r) => setContracts(r.data)) }
  useEffect(() => { load() }, [empId])

  const contractName = (id?: number | null) => {
    const i = contracts.findIndex((c) => c.id === id)
    return i < 0 ? '' : `Kontrak ke-${contracts.length - i}`
  }
  const upload = async () => {
    setError('')
    if (!label.trim()) return setError('Isi jenis foto/dokumen (mis. Foto KTP)')
    if (!files.length) return setError('Pilih file terlebih dahulu')
    const big = files.find((f) => f.size > MAX_FILE)
    if (big) return setError(`"${big.name}" lebih dari 10 MB`)
    setBusy(true)
    const failed: string[] = []
    for (const f of files) {
      try { await uploadEmployeeDocument(empId, label.trim(), f, contractId || null) } catch (e: any) { failed.push(`${f.name}: ${errMsg(e, 'gagal')}`) }
    }
    setBusy(false)
    if (failed.length) setError(`Tidak terunggah — ${failed.join('; ')}`)
    else { setLabel(''); setFiles([]); setFileKey((k) => k + 1) }
    load(); onChanged?.()
  }
  const remove = async (d: EmployeeDocument) => {
    if (!confirm(`Hapus "${d.label}"?`)) return
    await deleteEmployeeDocument(empId, d.id)
    setDocs((x) => x.filter((y) => y.id !== d.id)); onChanged?.()
  }

  return (
    <div className="text-xs space-y-4">
      {canEdit && (
        <div className="border border-line rounded-lg p-3">
          <div className="font-bold mb-2">Tambah Foto / Dokumen <span className="font-normal text-muted">(JPG/PNG/WEBP/PDF, maks 10 MB per file)</span></div>
          <datalist id="doc-labels">{DOC_SUGGESTIONS.map((d) => <option key={d} value={d} />)}</datalist>
          <div className="flex flex-wrap gap-2 items-center">
            <input className="input w-48" list="doc-labels" placeholder="Foto apa? (mis. Foto KTP)" value={label} onChange={(e) => setLabel(e.target.value)} />
            <select className="input" value={contractId} onChange={(e) => setContractId(Number(e.target.value))} title="Kaitkan ke kontrak (opsional)">
              <option value={0}>Tidak terkait kontrak</option>
              {contracts.map((c, i) => <option key={c.id} value={c.id}>Kontrak ke-{contracts.length - i} · {fmt(c.start_date)}{c.number ? ` · ${c.number}` : ''}</option>)}
            </select>
            <input key={fileKey} className="input flex-1 min-w-[12rem] file:mr-2 file:border-0 file:bg-gray-100 file:rounded file:px-2 file:py-1" type="file" multiple accept="image/*,application/pdf" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
            <button type="button" className="btn-primary" disabled={busy} onClick={upload}><Upload className="w-3.5 h-3.5 inline mr-1" />{busy ? 'Mengunggah…' : 'Unggah'}</button>
          </div>
          {error && <div className="text-brand bg-brand-soft rounded-lg px-3 py-2 mt-2">{error}</div>}
        </div>
      )}
      <DocGallery empId={empId} docs={docs} onDelete={canEdit ? remove : undefined} labelOf={(d) => (d.contract_id ? `${d.label} · ${contractName(d.contract_id)}` : d.label)} />
    </div>
  )
}

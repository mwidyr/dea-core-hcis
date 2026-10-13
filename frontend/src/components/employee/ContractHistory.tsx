import { useEffect, useRef, useState } from 'react'
import { FileText, Pencil, Plus, Trash2 } from 'lucide-react'
import Badge from '../ui/Badge'
import Modal from '../ui/Modal'
import { deleteEmployeeContract, getEmployeeContracts, saveEmployeeContract, uploadEmployeeDocument } from '../../services/api'
import { daysLeft, day, errMsg, fmtLong, iso } from '../../utils/format'
import type { EmployeeContract } from '../../types'

type Draft = { id?: number; number: string; start: string; end: string; note: string }
const MAX_FILE = 10 * 1024 * 1024

// Every contract period of one employee: add / edit / delete, and attach any number of documents to each one.
export default function ContractHistory({ empId, canEdit, onChanged }: { empId: number; canEdit: boolean; onChanged: () => void }) {
  const [list, setList] = useState<EmployeeContract[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const upTo = useRef<number | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = () => getEmployeeContracts(empId).then((r) => setList(r.data))
  useEffect(() => { load() }, [empId])
  const changed = async () => { await load(); onChanged() }

  const save = async () => {
    if (!draft) return
    setError('')
    if (!draft.start) return setError('Tanggal mulai wajib diisi')
    if (draft.end && draft.end < draft.start) return setError('Tanggal berakhir tidak boleh sebelum tanggal mulai')
    setBusy(true)
    try {
      await saveEmployeeContract(empId, { id: draft.id, number: draft.number, start_date: iso(draft.start), end_date: iso(draft.end), note: draft.note })
      setDraft(null); await changed()
    } catch (e: any) { setError(errMsg(e, 'Gagal menyimpan kontrak')) } finally { setBusy(false) }
  }
  const remove = async (c: EmployeeContract) => {
    if (!confirm(`Hapus kontrak ${c.number || fmtLong(c.start_date)}?${c.doc_count ? `\n\n${c.doc_count} dokumen tetap tersimpan di tab Foto & Dokumen.` : ''}`)) return
    try { await deleteEmployeeContract(empId, c.id); await changed() } catch (e: any) { alert(errMsg(e, 'Gagal menghapus kontrak')) }
  }
  const attach = async (files: FileList | null) => {
    const id = upTo.current
    if (!files?.length || !id) return
    const failed: string[] = []
    for (const f of Array.from(files)) {
      if (f.size > MAX_FILE) { failed.push(`${f.name} (lebih dari 10 MB)`); continue }
      try { await uploadEmployeeDocument(empId, 'Kontrak', f, id) } catch (e: any) { failed.push(`${f.name} (${errMsg(e, 'gagal')})`) }
    }
    if (fileInput.current) fileInput.current.value = ''
    if (failed.length) alert(`Tidak terunggah:\n${failed.join('\n')}`)
    await changed()
  }

  return (
    <div className="space-y-2">
      <input ref={fileInput} type="file" multiple hidden accept="image/*,application/pdf" onChange={(e) => attach(e.target.files)} />
      {list.map((c, i) => {
        const dl = daysLeft(c.end_date)
        const current = i === 0
        return (
          <div key={c.id} className={`border rounded-lg px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 ${current ? 'border-brand/40 bg-brand-soft/40' : 'border-line'}`}>
            <div className="min-w-0 flex-1">
              <div className="font-bold">Kontrak ke-{list.length - i}{c.number ? ` · ${c.number}` : ''} {current && <Badge tone="blue">Saat ini</Badge>}</div>
              <div className="text-muted">{fmtLong(c.start_date)} s.d. {c.end_date ? fmtLong(c.end_date) : 'tanpa batas / belum ditentukan'}
                {c.end_date && dl !== null && <> <Badge tone={dl < 0 ? 'gray' : dl <= 30 ? 'red' : 'amber'}>{dl < 0 ? 'berakhir' : `${dl} hari lagi`}</Badge></>}</div>
              {c.note && <div className="text-muted">{c.note}</div>}
            </div>
            <span className="inline-flex items-center gap-1 text-muted"><FileText className="w-3.5 h-3.5" />{c.doc_count ?? 0} dokumen</span>
            {canEdit && <div className="flex gap-1">
              <button type="button" className="btn" onClick={() => { upTo.current = c.id; fileInput.current?.click() }}><Plus className="w-3 h-3 inline mr-1" />Dokumen</button>
              <button type="button" className="btn" title="Ubah" onClick={() => { setError(''); setDraft({ id: c.id, number: c.number, start: day(c.start_date), end: day(c.end_date), note: c.note }) }}><Pencil className="w-3.5 h-3.5" /></button>
              <button type="button" className="btn text-brand" title="Hapus" onClick={() => remove(c)}><Trash2 className="w-3.5 h-3.5" /></button>
            </div>}
          </div>
        )
      })}
      {!list.length && <p className="text-muted">Belum ada riwayat kontrak. Karyawan tetap tidak wajib memilikinya.</p>}
      {canEdit && <button type="button" className="btn" onClick={() => { setError(''); setDraft({ number: '', start: '', end: '', note: '' }) }}><Plus className="w-3 h-3 inline mr-1" />Tambah Kontrak</button>}

      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Ubah Kontrak' : 'Tambah Kontrak'}>
        {draft && (
          <div className="space-y-3 text-xs">
            <label className="block font-semibold">Nomor / referensi kontrak<input className="input w-full mt-1 font-normal" value={draft.number} onChange={(e) => setDraft({ ...draft, number: e.target.value })} placeholder="opsional" /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block font-semibold">Mulai<input className="input w-full mt-1 font-normal" type="date" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} /></label>
              <label className="block font-semibold">Berakhir<input className="input w-full mt-1 font-normal" type="date" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} /></label>
            </div>
            <label className="block font-semibold">Catatan<textarea className="input w-full mt-1 font-normal" rows={2} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></label>
            {error && <div className="text-brand bg-brand-soft rounded-lg px-3 py-2">{error}</div>}
            <div className="flex justify-end gap-2"><button className="btn" onClick={() => setDraft(null)}>Batal</button><button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Menyimpan…' : 'Simpan'}</button></div>
          </div>
        )}
      </Modal>
    </div>
  )
}

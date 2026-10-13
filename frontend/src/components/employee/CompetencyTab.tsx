import { useEffect, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import Badge from '../ui/Badge'
import Modal from '../ui/Modal'
import { deleteEmployeeCompetency, getEmployeeCompetencies, saveEmployeeCompetency } from '../../services/api'
import { errMsg } from '../../utils/format'
import type { EmployeeCompetency } from '../../types'

const KINDS = ['Pendidikan', 'Sertifikasi', 'Pelatihan', 'Pengalaman Kerja', 'Skill'] as const
const kindTone = { Pendidikan: 'blue', Sertifikasi: 'green', Pelatihan: 'amber', 'Pengalaman Kerja': 'purple', Skill: 'gray' } as const
type Draft = { id?: number; kind: string; name: string; institution: string; start_year: string; end_year: string; cert_no: string; note: string }
const blank = (): Draft => ({ kind: 'Pendidikan', name: '', institution: '', start_year: '', end_year: '', cert_no: '', note: '' })
const period = (c: EmployeeCompetency) => (c.start_year || c.end_year ? `${c.start_year || '?'} – ${c.end_year || 'sekarang'}` : '-')

export default function CompetencyTab({ empId, canEdit }: { empId: number; canEdit: boolean }) {
  const [list, setList] = useState<EmployeeCompetency[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = () => getEmployeeCompetencies(empId).then((r) => setList(r.data))
  useEffect(() => { load() }, [empId])

  const save = async () => {
    if (!draft) return
    setError('')
    if (!draft.name.trim()) return setError('Nama wajib diisi')
    const s = Number(draft.start_year) || 0, e = Number(draft.end_year) || 0
    if (s && e && e < s) return setError('Tahun selesai tidak boleh sebelum tahun mulai')
    setBusy(true)
    try {
      await saveEmployeeCompetency(empId, { id: draft.id, kind: draft.kind, name: draft.name.trim(), institution: draft.institution, start_year: s, end_year: e, cert_no: draft.cert_no, note: draft.note })
      setDraft(null); await load()
    } catch (err: any) { setError(errMsg(err, 'Gagal menyimpan')) } finally { setBusy(false) }
  }
  const remove = async (c: EmployeeCompetency) => {
    if (!confirm(`Hapus "${c.name}" dari riwayat kompetensi?`)) return
    try { await deleteEmployeeCompetency(empId, c.id); await load() } catch (e: any) { alert(errMsg(e, 'Gagal menghapus')) }
  }
  const edit = (c: EmployeeCompetency) => { setError(''); setDraft({ id: c.id, kind: c.kind, name: c.name, institution: c.institution, start_year: c.start_year ? String(c.start_year) : '', end_year: c.end_year ? String(c.end_year) : '', cert_no: c.cert_no, note: c.note }) }

  return (
    <div className="text-xs">
      <div className="flex items-center justify-between mb-2">
        <div className="text-muted">Pendidikan, sertifikasi, pelatihan, pengalaman kerja, dan skill karyawan.</div>
        {canEdit && <button className="btn-primary" onClick={() => { setError(''); setDraft(blank()) }}><Plus className="w-3.5 h-3.5 inline mr-1" />Tambah</button>}
      </div>
      <div className="border border-line rounded-lg overflow-auto">
        <table className="w-full">
          <thead><tr>{['Jenis', 'Nama', 'Institusi / Penyelenggara', 'Periode', 'No. Sertifikat', 'Catatan', ''].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id}>
                <td className="td"><Badge tone={kindTone[c.kind as keyof typeof kindTone] ?? 'gray'}>{c.kind}</Badge></td>
                <td className="td"><b>{c.name}</b></td>
                <td className="td">{c.institution || '-'}</td>
                <td className="td whitespace-nowrap">{period(c)}</td>
                <td className="td">{c.cert_no || '-'}</td>
                <td className="td text-muted">{c.note || '-'}</td>
                <td className="td whitespace-nowrap">{canEdit && <>
                  <button className="btn mr-1" title="Ubah" onClick={() => edit(c)}><Pencil className="w-3.5 h-3.5" /></button>
                  <button className="btn text-danger" title="Hapus" onClick={() => remove(c)}><Trash2 className="w-3.5 h-3.5" /></button>
                </>}</td>
              </tr>
            ))}
            {!list.length && <tr><td className="td text-center text-muted" colSpan={7}>Belum ada riwayat kompetensi</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Ubah Kompetensi' : 'Tambah Kompetensi'}>
        {draft && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block font-semibold">Jenis<select className="input w-full mt-1 font-normal" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
              <label className="block font-semibold">Nama<input className="input w-full mt-1 font-normal" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="mis. S1 Teknik Informatika" /></label>
            </div>
            <label className="block font-semibold">Institusi / penyelenggara<input className="input w-full mt-1 font-normal" value={draft.institution} onChange={(e) => setDraft({ ...draft, institution: e.target.value })} /></label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="block font-semibold">Tahun mulai<input className="input w-full mt-1 font-normal" type="number" min={1950} max={2100} value={draft.start_year} onChange={(e) => setDraft({ ...draft, start_year: e.target.value })} /></label>
              <label className="block font-semibold">Tahun selesai<input className="input w-full mt-1 font-normal" type="number" min={1950} max={2100} value={draft.end_year} onChange={(e) => setDraft({ ...draft, end_year: e.target.value })} placeholder="kosong = berjalan" /></label>
              <label className="block font-semibold">No. sertifikat<input className="input w-full mt-1 font-normal" value={draft.cert_no} onChange={(e) => setDraft({ ...draft, cert_no: e.target.value })} /></label>
            </div>
            <label className="block font-semibold">Catatan<textarea className="input w-full mt-1 font-normal" rows={2} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></label>
            {error && <div className="text-danger bg-danger-soft rounded-lg px-3 py-2">{error}</div>}
            <div className="flex justify-end gap-2"><button className="btn" onClick={() => setDraft(null)}>Batal</button><button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Menyimpan…' : 'Simpan'}</button></div>
          </div>
        )}
      </Modal>
    </div>
  )
}

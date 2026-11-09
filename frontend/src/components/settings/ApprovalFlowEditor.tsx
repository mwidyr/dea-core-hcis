import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react'
import Badge from '../ui/Badge'
import Modal from '../ui/Modal'
import { deleteApprovalFlow, getApprovalFlows, getBusinesses, getPositions, saveApprovalFlow } from '../../services/api'
import { errMsg } from '../../utils/format'
import type { ApprovalFlow, Business, FlowStep, FlowType, Position } from '../../types'

const KINDS: { id: FlowStep['kind']; label: string }[] = [
  { id: 'direct_manager', label: 'Atasan langsung' },
  { id: 'position', label: 'Jabatan tertentu' },
  { id: 'hr', label: 'HR' },
  { id: 'hr_superior', label: 'Atasan HR' },
]

const empty = (type: string): ApprovalFlow => ({ name: '', request_type: type, business_id: null, is_active: true, steps: [{ kind: 'direct_manager', approver_position_id: null }], requester_position_ids: [] })

// Editor of sequential approval flows per request type (HR admin / super admin).
export default function ApprovalFlowEditor() {
  const [flows, setFlows] = useState<ApprovalFlow[]>([])
  const [types, setTypes] = useState<FlowType[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [edit, setEdit] = useState<ApprovalFlow | null>(null)
  const [error, setError] = useState('')
  const [loadErr, setLoadErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => getApprovalFlows().then((r) => { setFlows(r.data.data); setTypes(r.data.types); setLoadErr('') }).catch((e) => setLoadErr(errMsg(e, 'Gagal memuat flow approval')))
  useEffect(() => {
    load()
    getPositions().then((r) => setPositions(r.data)).catch(() => setPositions([]))
    getBusinesses().then((r) => setBusinesses(r.data)).catch(() => setBusinesses([]))
  }, [])

  const bizCode = (id: number) => businesses.find((b) => b.id === id)?.code ?? ''
  const posLabel = (id: number | null) => { const p = positions.find((x) => x.id === id); return p ? `${p.title}${bizCode(p.business_id) ? ` (${bizCode(p.business_id)})` : ''}` : '—' }
  const stepText = (s: FlowStep) => (s.kind === 'position' ? (s.position_title || posLabel(s.approver_position_id)) : KINDS.find((k) => k.id === s.kind)?.label ?? s.kind)
  const chainText = (steps: FlowStep[]) => steps.map((s, i) => `${i + 1}. ${stepText(s)}`).join('  →  ')
  const typeLabel = (k: string) => types.find((t) => t.key === k)?.label ?? k

  const grouped = useMemo(() => types.map((t) => ({ type: t, list: flows.filter((f) => f.request_type === t.key) })), [types, flows])

  const set = (patch: Partial<ApprovalFlow>) => edit && setEdit({ ...edit, ...patch })
  const setStep = (i: number, patch: Partial<FlowStep>) => edit && set({ steps: edit.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  const move = (i: number, d: number) => {
    if (!edit) return
    const j = i + d
    if (j < 0 || j >= edit.steps.length) return
    const steps = [...edit.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]]
    set({ steps })
  }
  const save = async () => {
    if (!edit) return
    setError(''); setBusy(true)
    try {
      await saveApprovalFlow({ ...edit, steps: edit.steps.map((s) => ({ kind: s.kind, approver_position_id: s.kind === 'position' ? s.approver_position_id : null })) })
      setEdit(null); load()
    } catch (e) { setError(errMsg(e, 'Gagal menyimpan flow')) } finally { setBusy(false) }
  }
  const remove = async (f: ApprovalFlow) => {
    if (!f.id || !confirm(`Hapus flow "${f.name}"?\n\nPengajuan yang sedang berjalan tetap memakai alurnya sendiri. Jika tidak ada flow untuk jenis ini, pengajuan baru kembali ke atasan langsung (n+1).`)) return
    try { await deleteApprovalFlow(f.id); load() } catch (e) { alert(errMsg(e, 'Gagal menghapus')) }
  }

  const preview = edit ? chainText(edit.steps) : ''
  const addable = positions.filter((p) => !edit?.requester_position_ids.includes(p.id))

  return (
    <div className="text-xs space-y-4 max-w-4xl">
      <p className="text-muted">
        Alur persetujuan bersifat <b className="text-ink">berjenjang</b>: pengajuan berpindah ke langkah berikutnya setelah langkah sebelumnya menyetujui. Langkah yang tidak dapat ditentukan
        (jabatan kosong, pemegang jabatan tanpa akun) atau yang jatuh ke pemohon / orang yang sudah ada di alur akan dilewati. Bila semua langkah terlewati, pengajuan diarahkan ke HR lalu Super Admin.
        Jenis tanpa flow memakai atasan langsung (n+1). Pengajuan yang sedang berjalan tidak berubah saat flow diubah.
      </p>
      {loadErr && <div className="text-danger bg-danger-soft rounded-lg px-3 py-2">{loadErr}</div>}
      {grouped.map(({ type, list }) => (
        <section key={type.key} className="border border-line rounded-lg">
          <header className="flex items-center justify-between px-3 py-2 border-b border-line bg-sunken/60">
            <div className="font-bold">{type.label}</div>
            <button className="btn" onClick={() => { setError(''); setEdit(empty(type.key)) }}><Plus className="w-3 h-3 inline mr-1" />Tambah flow</button>
          </header>
          {!list.length && <div className="px-3 py-3 text-muted">Belum ada flow: pengajuan memakai atasan langsung (n+1).</div>}
          {list.map((f) => (
            <div key={f.id} className="px-3 py-2 border-b border-line last:border-b-0 flex items-start gap-3">
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold">{f.name}</span>
                  {f.is_default && <Badge tone="blue">Default</Badge>}
                  {!f.is_active && <Badge tone="gray">Nonaktif</Badge>}
                  {f.business_id != null && <Badge tone="purple">{bizCode(f.business_id) || `Bisnis ${f.business_id}`}</Badge>}
                  {f.requester_position_ids.length > 0 && <Badge tone="amber">Pemohon: {(f.requester_titles?.length ? f.requester_titles : f.requester_position_ids.map(posLabel)).join(', ')}</Badge>}
                </div>
                <div className="text-muted">{chainText(f.steps)}</div>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button className="btn" onClick={() => { setError(''); setEdit({ ...f }) }}>Edit</button>
                <button className="btn text-danger" onClick={() => remove(f)}>Hapus</button>
              </div>
            </div>
          ))}
        </section>
      ))}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit Flow Approval' : 'Tambah Flow Approval'} size="lg">
        {edit && (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block font-semibold">Nama flow<input className="input w-full mt-1" value={edit.name} onChange={(e) => set({ name: e.target.value })} placeholder="mis. Izin staf Finance" /></label>
              <label className="block font-semibold">Jenis pengajuan
                <select className="input w-full mt-1" value={edit.request_type} onChange={(e) => set({ request_type: e.target.value })}>{types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>
              <label className="block font-semibold">Bisnis<select className="input w-full mt-1" value={edit.business_id ?? ''} onChange={(e) => set({ business_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Semua bisnis</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
              <label className="flex items-center gap-2 font-semibold self-end pb-2"><input type="checkbox" checked={edit.is_active} onChange={(e) => set({ is_active: e.target.checked })} />Aktif</label>
            </div>

            <div>
              <div className="font-semibold mb-1">Langkah persetujuan (berurutan)</div>
              <div className="space-y-1.5">
                {edit.steps.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 border border-line rounded-lg px-2 py-1.5">
                    <span className="w-5 h-5 rounded-full bg-brand text-on-brand text-[10px] font-bold grid place-items-center shrink-0">{i + 1}</span>
                    <select className="input" value={s.kind} onChange={(e) => setStep(i, { kind: e.target.value as FlowStep['kind'], approver_position_id: null })}>{KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select>
                    {s.kind === 'position' && (
                      <select className="input flex-1 min-w-0" value={s.approver_position_id ?? ''} onChange={(e) => setStep(i, { approver_position_id: e.target.value ? Number(e.target.value) : null })}>
                        <option value="">Pilih jabatan…</option>{positions.map((p) => <option key={p.id} value={p.id}>{posLabel(p.id)}{p.holder ? ` — ${p.holder}` : ' — (kosong)'}</option>)}</select>
                    )}
                    <span className="flex-1" />
                    <button type="button" className="p-1 disabled:opacity-30" aria-label="Naikkan" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="w-3.5 h-3.5" /></button>
                    <button type="button" className="p-1 disabled:opacity-30" aria-label="Turunkan" disabled={i === edit.steps.length - 1} onClick={() => move(i, 1)}><ArrowDown className="w-3.5 h-3.5" /></button>
                    <button type="button" className="p-1 text-danger disabled:opacity-30" aria-label="Hapus langkah" disabled={edit.steps.length === 1} onClick={() => set({ steps: edit.steps.filter((_, j) => j !== i) })}><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
              </div>
              <button type="button" className="btn mt-1.5" onClick={() => set({ steps: [...edit.steps, { kind: 'hr', approver_position_id: null }] })}><Plus className="w-3 h-3 inline mr-1" />Tambah langkah</button>
              <div className="text-muted mt-1">Atasan HR = atasan langsung dari approver HR; bila tidak ada, Super Admin.</div>
            </div>

            <div>
              <div className="font-semibold mb-1">Berlaku untuk jabatan pemohon <span className="font-normal text-muted">(opsional; kosong = semua jabatan)</span></div>
              <div className="flex flex-wrap gap-1.5 mb-1.5">
                {edit.requester_position_ids.map((id) => (
                  <span key={id} className="inline-flex items-center gap-1 border border-line rounded-full pl-2 pr-1 py-0.5">{posLabel(id)}
                    <button type="button" aria-label="Hapus" onClick={() => set({ requester_position_ids: edit.requester_position_ids.filter((x) => x !== id) })}><X className="w-3 h-3" /></button></span>
                ))}
              </div>
              <select className="input w-full" value="" onChange={(e) => e.target.value && set({ requester_position_ids: [...edit.requester_position_ids, Number(e.target.value)] })}>
                <option value="">Tambah jabatan pemohon…</option>{addable.map((p) => <option key={p.id} value={p.id}>{posLabel(p.id)}</option>)}</select>
              <div className="text-muted mt-1">Flow yang lebih spesifik (jenis + jabatan pemohon) didahulukan dari flow umum jenis yang sama.</div>
            </div>

            <div className="border border-line rounded-lg p-3 bg-sunken/60">
              <div className="font-bold mb-1">Pratinjau</div>
              <div>{typeLabel(edit.request_type)}{edit.requester_position_ids.length ? ` · pemohon ${edit.requester_position_ids.map(posLabel).join(', ')}` : ''}</div>
              <div className="font-semibold mt-0.5">Pemohon  →  {preview}</div>
            </div>

            {error && <div className="text-danger bg-danger-soft rounded-lg px-3 py-2">{error}</div>}
            <div className="flex justify-end gap-2"><button className="btn" onClick={() => setEdit(null)}>Batal</button><button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Menyimpan…' : 'Simpan'}</button></div>
          </div>
        )}
      </Modal>
    </div>
  )
}

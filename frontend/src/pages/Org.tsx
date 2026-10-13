import { useEffect, useMemo, useRef, useState } from 'react'
import { Maximize2, Minus, Plus, ZoomIn } from 'lucide-react'
import Layout from '../components/Layout/Layout'
import Tabs from '../components/ui/Tabs'
import Badge from '../components/ui/Badge'
import Modal from '../components/ui/Modal'
import DataTable from '../components/ui/DataTable'
import { useAuthStore } from '../store/auth'
import { bizParams, useBusinessStore } from '../store/business'
import { deleteBusiness, deleteLocation, deletePosition, deleteUnit, getLocations, getPositions, getUnits, saveBusiness, saveLocation, savePosition, saveUnit } from '../services/api'
import type { Business, Location, OrgUnit, Position } from '../types'

type Tab = 'businesses' | 'units' | 'positions' | 'locations' | 'chart'
// Order = seniority; the org chart puts each class on its own aligned row in this order.
const LEVEL_CLASSES = ['Direksi', 'General Manager / Business Head', 'Manager / Head', 'Supervisor', 'Coordinator / Team Lead', 'Staff', 'Non Staff', 'Magang']

export default function Org() {
  const { businessId, businesses, refresh } = useBusinessStore()
  const canEdit = useAuthStore((s) => s.can)('org.manage')
  const [tab, setTab] = useState<Tab>('units')
  const [units, setUnits] = useState<OrgUnit[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [edit, setEdit] = useState<{ kind: Tab; data: any } | null>(null)
  const [error, setError] = useState('')

  const load = () => {
    const p = bizParams(businessId)
    getUnits(p).then((r) => setUnits(r.data))
    getPositions(p).then((r) => setPositions(r.data))
    getLocations(p).then((r) => setLocations(r.data))
  }
  useEffect(load, [businessId])

  const bizName = (id: number) => businesses.find((b) => b.id === id)?.name ?? ''
  const unitName = (id: number | null) => units.find((u) => u.id === id)?.name ?? '-'
  const posTitle = (id: number | null) => positions.find((p) => p.id === id)?.title ?? '-'
  // a business is picked in the header → new data is locked to it; "Semua Bisnis" → must choose
  const bizLocked = businessId !== 0
  const visibleBusinesses = bizLocked ? businesses.filter((b) => b.id === businessId) : businesses

  const remove = async (kind: Tab, id: number) => {
    if (!confirm(kind === 'businesses' ? 'Hapus bisnis ini beserta unit, jabatan, dan lokasinya?' : 'Hapus data ini?')) return
    try {
      await (kind === 'businesses' ? deleteBusiness(id) : kind === 'units' ? deleteUnit(id) : kind === 'positions' ? deletePosition(id) : deleteLocation(id))
      kind === 'businesses' ? await refresh() : null
      load()
    } catch (e: any) { alert(e.response?.data?.error || 'Gagal menghapus') }
  }

  const addNew = (kind: Tab) => {
    const base = { business_id: bizLocked ? businessId : 0 }
    setError('')
    setEdit({ kind, data: kind === 'businesses' ? { name: '', code: '' } : kind === 'units' ? { ...base, level: 1, type_name: '', name: '' } : kind === 'positions' ? { ...base, title: '', level_class: 'Staff' } : { ...base, name: '', type_name: 'Office', city: '' } })
  }

  const submit = async () => {
    if (!edit) return
    const d = edit.data
    if (edit.kind !== 'businesses' && !d.business_id) { setError('Pilih bisnis terlebih dahulu'); return }
    try {
      await (edit.kind === 'businesses' ? saveBusiness(d) : edit.kind === 'units' ? saveUnit(d) : edit.kind === 'positions' ? savePosition(d) : saveLocation(d))
      if (edit.kind === 'businesses') await refresh()
      setEdit(null); load()
    } catch (e: any) { setError(e.response?.data?.error || 'Gagal menyimpan') }
  }

  const f = (k: string, v: any) => setEdit((e) => e && { ...e, data: { ...e.data, [k]: v } })
  const bizUnits = units.filter((u) => u.business_id === edit?.data.business_id)
  const bizPositions = positions.filter((p) => p.business_id === edit?.data.business_id && p.id !== edit?.data.id)
  const addBtn = (kind: Tab, label: string) => canEdit && <button className="btn-primary" onClick={() => addNew(kind)}><Plus className="w-3.5 h-3.5 inline mr-1" />{label}</button>
  const titles: Record<Tab, string> = { businesses: 'Bisnis', units: 'Unit', positions: 'Jabatan', locations: 'Lokasi', chart: '' }

  return (
    <Layout title="Setup Organisasi Multi-Bisnis" subtitle="Bisnis, struktur L1–L10, jabatan, lokasi kerja, dan bagan organisasi">
      <div className="card p-4">
        <Tabs tabs={[{ id: 'businesses', label: `Bisnis (${visibleBusinesses.length})` }, { id: 'units', label: `Unit Organisasi (${units.length})` }, { id: 'positions', label: `Jabatan (${positions.length})` }, { id: 'locations', label: `Lokasi Kerja (${locations.length})` }, { id: 'chart', label: 'Bagan Organisasi' }]} value={tab} onChange={setTab} />

        {tab === 'businesses' && (
          <DataTable data={visibleBusinesses} rowKey={(b) => b.id} searchPlaceholder="Cari kode atau nama bisnis…"
            searchText={(b) => `${b.code} ${b.name}`} actions={bizLocked ? undefined : addBtn('businesses', 'Bisnis')}
            columns={[
              { head: 'Kode', render: (b) => <Badge tone="blue">{b.code}</Badge> },
              { head: 'Nama Bisnis', render: (b) => <b>{b.name}</b> },
              { head: 'Unit', render: (b) => units.filter((u) => u.business_id === b.id).length },
              { head: 'Jabatan', render: (b) => positions.filter((p) => p.business_id === b.id).length },
              { head: 'Lokasi', render: (b) => locations.filter((l) => l.business_id === b.id).length },
              { head: 'Status', render: () => <Badge tone="green">Aktif</Badge> },
              { head: 'Aksi', render: (b) => canEdit && <Actions onEdit={() => { setError(''); setEdit({ kind: 'businesses', data: { id: b.id, name: b.name, code: b.code } }) }} onDelete={() => remove('businesses', b.id)} /> },
            ]} />
        )}
        {tab === 'units' && (
          <DataTable data={units} rowKey={(u) => u.id} searchPlaceholder="Cari unit, jenis, induk, bisnis…" actions={addBtn('units', 'Unit')}
            searchText={(u) => `L${u.level} ${u.type_name} ${u.name} ${u.parent?.name ?? ''} ${bizName(u.business_id)}`}
            columns={[
              { head: 'Level', render: (u) => <Badge tone="blue">L{u.level}</Badge> },
              { head: 'Jenis', render: (u) => u.type_name },
              { head: 'Unit', render: (u) => <b>{u.name}</b> },
              { head: 'Induk', render: (u) => u.parent?.name ?? '-' },
              { head: 'Bisnis', render: (u) => bizName(u.business_id) },
              { head: 'Status', render: () => <Badge tone="green">Aktif</Badge> },
              { head: 'Aksi', render: (u) => canEdit && <Actions onEdit={() => { setError(''); setEdit({ kind: 'units', data: { ...u, parent: undefined } }) }} onDelete={() => remove('units', u.id)} /> },
            ]} />
        )}
        {tab === 'positions' && (
          <DataTable data={positions} rowKey={(p) => p.id} searchPlaceholder="Cari jabatan, unit, level, pemegang…" actions={addBtn('positions', 'Jabatan')}
            searchText={(p) => `${p.title} ${unitName(p.unit_id)} ${p.level_class} ${posTitle(p.reports_to_id)} ${p.holder ?? ''} ${bizName(p.business_id)}`}
            columns={[
              { head: 'Jabatan', render: (p) => <b>{p.title}</b> },
              { head: 'Unit', render: (p) => unitName(p.unit_id) },
              { head: 'Level Posisi', render: (p) => p.level_class },
              { head: 'Melapor ke (n+1)', render: (p) => posTitle(p.reports_to_id) },
              { head: 'Pemegang', render: (p) => p.holder === 'Vacant' ? <Badge tone="amber">Vacant</Badge> : p.holder },
              { head: 'Bisnis', render: (p) => bizName(p.business_id) },
              { head: 'Aksi', render: (p) => canEdit && <Actions onEdit={() => { setError(''); setEdit({ kind: 'positions', data: { ...p, unit: undefined, holder: undefined } }) }} onDelete={() => remove('positions', p.id)} /> },
            ]} />
        )}
        {tab === 'locations' && (
          <DataTable data={locations} rowKey={(l) => l.id} searchPlaceholder="Cari lokasi, jenis, kota…" actions={addBtn('locations', 'Lokasi')}
            searchText={(l) => `${l.name} ${l.type_name} ${l.city} ${bizName(l.business_id)}`}
            columns={[
              { head: 'Lokasi', render: (l) => <b>{l.name}</b> },
              { head: 'Jenis', render: (l) => l.type_name },
              { head: 'Kota', render: (l) => l.city },
              { head: 'Koordinat / Radius', render: (l) => l.latitude !== null && l.longitude !== null ? <span className="text-[11px]">{l.latitude.toFixed(5)}, {l.longitude.toFixed(5)} · {l.radius_m} m</span> : <Badge tone="amber">Belum diatur</Badge> },
              { head: 'Bisnis', render: (l) => bizName(l.business_id) },
              { head: 'Status', render: () => <Badge tone="green">Aktif</Badge> },
              { head: 'Aksi', render: (l) => canEdit && <Actions onEdit={() => { setError(''); setEdit({ kind: 'locations', data: l }) }} onDelete={() => remove('locations', l.id)} /> },
            ]} />
        )}
        {tab === 'chart' && <OrgChart positions={positions} businesses={businesses} />}
      </div>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={`${edit?.data.id ? 'Ubah' : 'Tambah'} ${edit ? titles[edit.kind] : ''}`}>
        {edit && (
          <div className="space-y-3 text-xs">
            {edit.kind !== 'businesses' && (
              <Field label={bizLocked || edit.data.id ? 'Bisnis (terkunci)' : 'Bisnis'}>
                <select className="input w-full disabled:bg-gray-100" disabled={bizLocked || !!edit.data.id} value={edit.data.business_id || ''}
                  onChange={(e) => setEdit((x) => x && { ...x, data: { ...x.data, business_id: Number(e.target.value), unit_id: null, parent_id: null, reports_to_id: null } })}>
                  <option value="">— Pilih bisnis —</option>
                  {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
            )}
            {edit.kind === 'businesses' && <>
              <Field label="Nama Bisnis"><input className="input w-full" value={edit.data.name} onChange={(e) => f('name', e.target.value)} autoFocus /></Field>
              <Field label="Kode (2–10 huruf/angka, unik)"><input className="input w-full uppercase" maxLength={10} value={edit.data.code} onChange={(e) => f('code', e.target.value.toUpperCase())} /></Field>
              {!edit.data.id && <p className="text-muted text-[11px]">Unit L1 “Management” dibuat otomatis; lanjutkan menambah unit, jabatan, dan lokasi di tab masing-masing.</p>}
            </>}
            {edit.kind === 'units' && <>
              <Field label="Level (1–10)"><input className="input w-full" type="number" min={1} max={10} value={edit.data.level} onChange={(e) => f('level', Number(e.target.value))} /></Field>
              <Field label="Jenis (Fungsi / Bagian / Business Unit …)"><input className="input w-full" value={edit.data.type_name} onChange={(e) => f('type_name', e.target.value)} /></Field>
              <Field label="Nama Unit"><input className="input w-full" value={edit.data.name} onChange={(e) => f('name', e.target.value)} /></Field>
              <Field label="Unit Induk"><select className="input w-full" value={edit.data.parent_id ?? ''} onChange={(e) => f('parent_id', e.target.value ? Number(e.target.value) : null)}><option value="">— (root)</option>{bizUnits.filter((u) => u.id !== edit.data.id).map((u) => <option key={u.id} value={u.id}>L{u.level} {u.name}</option>)}</select></Field>
            </>}
            {edit.kind === 'positions' && <>
              <Field label="Nama Jabatan"><input className="input w-full" value={edit.data.title} onChange={(e) => f('title', e.target.value)} /></Field>
              <Field label="Unit"><select className="input w-full" value={edit.data.unit_id ?? ''} onChange={(e) => f('unit_id', e.target.value ? Number(e.target.value) : null)}><option value="">—</option>{bizUnits.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
              <Field label="Level Posisi"><select className="input w-full" value={edit.data.level_class} onChange={(e) => f('level_class', e.target.value)}>{LEVEL_CLASSES.map((l) => <option key={l}>{l}</option>)}</select></Field>
              <Field label="Melapor ke (atasan n+1)"><select className="input w-full" value={edit.data.reports_to_id ?? ''} onChange={(e) => f('reports_to_id', e.target.value ? Number(e.target.value) : null)}><option value="">—</option>{bizPositions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></Field>
            </>}
            {edit.kind === 'locations' && <>
              <Field label="Nama Lokasi"><input className="input w-full" value={edit.data.name} onChange={(e) => f('name', e.target.value)} /></Field>
              <Field label="Jenis"><input className="input w-full" value={edit.data.type_name} onChange={(e) => f('type_name', e.target.value)} /></Field>
              <Field label="Kota"><input className="input w-full" value={edit.data.city} onChange={(e) => f('city', e.target.value)} /></Field>
              <div className="border border-line rounded-lg p-3 space-y-2 bg-gray-50/60">
                <div className="font-semibold">Titik absensi GPS</div>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Latitude"><input className="input w-full" type="number" step="any" value={edit.data.latitude ?? ''} onChange={(e) => f('latitude', e.target.value === '' ? null : Number(e.target.value))} /></Field>
                  <Field label="Longitude"><input className="input w-full" type="number" step="any" value={edit.data.longitude ?? ''} onChange={(e) => f('longitude', e.target.value === '' ? null : Number(e.target.value))} /></Field>
                  <Field label="Radius (m)"><input className="input w-full" type="number" min={20} value={edit.data.radius_m ?? 100} onChange={(e) => f('radius_m', Number(e.target.value))} /></Field>
                </div>
                <button type="button" className="btn" onClick={() => navigator.geolocation?.getCurrentPosition((p) => setEdit((x) => x && { ...x, data: { ...x.data, latitude: +p.coords.latitude.toFixed(6), longitude: +p.coords.longitude.toFixed(6) } }), () => setError('Tidak dapat membaca lokasi perangkat; isi koordinat manual.'), { enableHighAccuracy: true, timeout: 15000 })}>Gunakan lokasi saya saat ini</button>
                <p className="text-muted text-[11px]">Karyawan hanya dapat absen bila berada dalam radius ini dari titik. Buka perangkat di lokasi kerja lalu klik tombol di atas, atau salin koordinat dari peta.</p>
              </div>
            </>}
            {error && <div className="text-brand bg-brand-soft rounded-lg px-3 py-2">{error}</div>}
            <div className="flex justify-end gap-2 pt-2"><button className="btn" onClick={() => setEdit(null)}>Batal</button><button className="btn-primary" onClick={submit}>Simpan</button></div>
          </div>
        )}
      </Modal>
    </Layout>
  )
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="block font-semibold">{label}<div className="mt-1 font-normal">{children}</div></label>
const Actions = ({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) => (
  <div className="flex gap-1.5 justify-end"><button className="btn" onClick={onEdit}>Edit</button><button className="btn text-brand" onClick={onDelete}>Hapus</button></div>
)
function OrgChart({ positions, businesses }: { positions: Position[]; businesses: Business[] }) {
  const [zoom, setZoom] = useState(0.85)
  const [resetKey, setResetKey] = useState(0)
  const step = (d: number) => setZoom((z) => Math.min(1.4, Math.max(0.3, +(z + d).toFixed(2))))

  // one chart per business, in business order; businesses without positions are skipped
  const groups = businesses
    .map((b) => ({ biz: b, positions: positions.filter((p) => p.business_id === b.id) }))
    .filter((g) => g.positions.length > 0)

  if (!groups.length) return <div className="text-center text-muted text-xs py-8">Belum ada data</div>
  return (
    <div>
      <div className="flex items-center justify-end gap-1.5 mb-3">
        <button className="btn" onClick={() => step(-0.1)} title="Perkecil"><Minus className="w-3 h-3" /></button>
        <span className="text-xs w-10 text-center text-muted">{Math.round(zoom * 100)}%</span>
        <button className="btn" onClick={() => step(0.1)} title="Perbesar"><ZoomIn className="w-3 h-3" /></button>
        <button className="btn" onClick={() => { setZoom(0.85); setResetKey((k) => k + 1) }} title="Reset & pusatkan"><Maximize2 className="w-3 h-3" /></button>
      </div>
      <div className="space-y-8">
        {groups.map((g) => <BusinessChart key={g.biz.id} biz={g.biz} positions={g.positions} zoom={zoom} resetKey={resetKey} />)}
      </div>
    </div>
  )
}

// ---- org chart: one row per level class so positions of the same level line up on a guide line ----
const NODE_W = 170, NODE_H = 76, SLOT = 196, ROW = 128, GUTTER = 150, PAD = 24
const levelRank = (cls: string) => { const i = LEVEL_CLASSES.indexOf(cls); return i < 0 ? LEVEL_CLASSES.indexOf('Staff') : i }

interface Placed { p: Position; x: number; row: number }

// Tidy-tree layout: x from leaf order (parent centred over its children), row from the level class.
// A child never sits on or above its parent's row, so an unusual reporting line is pushed down a row instead.
function layoutChart(positions: Position[]) {
  const ids = new Set(positions.map((p) => p.id))
  const kidsOf = new Map<number, Position[]>()
  positions.forEach((p) => { if (p.reports_to_id && ids.has(p.reports_to_id)) kidsOf.set(p.reports_to_id, [...(kidsOf.get(p.reports_to_id) ?? []), p]) })
  const roots = positions.filter((p) => !p.reports_to_id || !ids.has(p.reports_to_id))
  const tiers = new Map<number, number>() // position id → level tier
  const placed = new Map<number, Placed>()
  let slot = 0
  const walk = (p: Position, parentTier: number, seen: Set<number>): number => {
    const tier = Math.max(levelRank(p.level_class), parentTier + 1)
    tiers.set(p.id, tier)
    const next = new Set(seen).add(p.id)
    const kids = (kidsOf.get(p.id) ?? []).filter((k) => !next.has(k.id))
    let x: number
    if (!kids.length) x = slot++
    else { const xs = kids.map((k) => walk(k, tier, next)); x = (xs[0] + xs[xs.length - 1]) / 2 }
    placed.set(p.id, { p, x, row: 0 })
    return x
  }
  roots.forEach((r) => walk(r, -1, new Set()))
  const usedTiers = [...new Set(tiers.values())].sort((a, b) => a - b)
  placed.forEach((v) => { v.row = usedTiers.indexOf(tiers.get(v.p.id)!) })
  return { placed, rows: usedTiers.map((t) => LEVEL_CLASSES[Math.min(t, LEVEL_CLASSES.length - 1)]), slots: Math.max(slot, 1), kidsOf }
}

function BusinessChart({ biz, positions, zoom, resetKey }: { biz: Business; positions: Position[]; zoom: number; resetKey: number }) {
  const box = useRef<HTMLDivElement>(null)
  // keep the root centred in view whenever data/zoom changes
  useEffect(() => {
    const t = setTimeout(() => { const el = box.current; if (el) { el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2; el.scrollTop = 0 } }, 0)
    return () => clearTimeout(t)
  }, [positions, zoom, resetKey])

  const { placed, rows, slots, kidsOf } = useMemo(() => layoutChart(positions), [positions])
  const vacant = positions.filter((p) => p.holder === 'Vacant').length
  const width = slots * SLOT + PAD * 2, height = rows.length * ROW + PAD
  const cx = (x: number) => PAD + x * SLOT + SLOT / 2
  const top = (row: number) => PAD / 2 + row * ROW

  // elbow connectors parent → each child
  const links: string[] = []
  placed.forEach(({ p, x, row }) => (kidsOf.get(p.id) ?? []).forEach((k) => {
    const c = placed.get(k.id)
    if (!c) return
    const px = cx(x), py = top(row) + NODE_H, ky = top(c.row), my = py + 16
    links.push(`M${px} ${py} V${my} H${cx(c.x)} V${ky}`)
  }))

  return (
    <section className="border border-line rounded-xl overflow-hidden bg-white shadow-card">
      <div className="flex items-center justify-between px-4 py-2.5 bg-brand-soft border-b border-line">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-lg bg-brand text-white grid place-items-center text-[11px] font-black">{biz.code}</span>
          <div><div className="text-sm font-extrabold">{biz.name}</div><div className="text-[10.5px] text-muted">Bagan struktur organisasi</div></div>
        </div>
        <div className="flex gap-1.5 text-[10.5px]">
          <Badge tone="blue">{positions.length} jabatan</Badge>
          <Badge tone="green">{positions.length - vacant} terisi</Badge>
          {vacant > 0 && <Badge tone="amber">{vacant} vacant</Badge>}
        </div>
      </div>
      <div ref={box} className="overflow-auto bg-gray-50/50 py-3 max-h-[70vh]">
        <div className="flex w-max min-w-full" style={{ zoom }}>
          {/* level labels stay visible while scrolling sideways */}
          <div className="sticky left-0 z-20 shrink-0 bg-white/95 border-r border-line" style={{ width: GUTTER, height }}>
            {rows.map((r, i) => (
              <div key={r} className="absolute left-0 right-0 px-3 flex items-center text-[10.5px] font-bold text-muted leading-tight" style={{ top: top(i), height: NODE_H }}>{r}</div>
            ))}
          </div>
          <div className="relative" style={{ width, height }}>
            <svg className="absolute inset-0 pointer-events-none" width={width} height={height}>
              {rows.map((_, i) => <line key={i} x1={0} x2={width} y1={top(i) + NODE_H / 2} y2={top(i) + NODE_H / 2} stroke="#d9dce1" strokeDasharray="4 5" />)}
              {links.map((d, i) => <path key={i} d={d} fill="none" stroke="#c5cad1" strokeWidth={1.2} strokeLinejoin="round" />)}
            </svg>
            {[...placed.values()].map(({ p, x, row }) => (
              <div key={p.id} className="org-node !block !max-w-none text-center overflow-hidden" style={{ position: 'absolute', left: cx(x) - NODE_W / 2, top: top(row), width: NODE_W, height: NODE_H }}>
                <div className="text-xs font-bold leading-tight line-clamp-2">{p.title}</div>
                <div className={`text-[10.5px] mt-0.5 truncate ${p.holder === 'Vacant' ? 'text-warn font-semibold' : 'text-muted'}`}>{p.holder}</div>
                <div className="text-[9.5px] text-gray-400 truncate">{p.unit?.name}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

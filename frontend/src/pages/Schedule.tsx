import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FileDown, Paperclip, Plus, X } from 'lucide-react'
import Layout from '../components/Layout/Layout'
import Badge from '../components/ui/Badge'
import DataTable from '../components/ui/DataTable'
import DateField, { clearHolidayCache } from '../components/ui/DateField'
import Modal from '../components/ui/Modal'
import RosterSchedule from '../components/RosterSchedule'
import Tabs from '../components/ui/Tabs'
import FileThumbs from '../components/ui/FileThumbs'
import ApprovalPreview from '../components/approval/ApprovalPreview'
import ApprovalChain from '../components/approval/ApprovalChain'
import ApprovalTimeline, { stepKind, stepLabel } from '../components/approval/ApprovalTimeline'
import { exportApprovalSlip } from '../utils/pdf'
import { bizParams, useBusinessStore } from '../store/business'
import { approveRequest, rejectRequest, getApproval, fetchRosterAttachmentBlob, getRosterAttachments, cancelRosterAdjustment, createRosterAdjustment, previewRosterAdjustment, getApprovers, getRosterAdjustments, createHoliday, deleteHoliday, deleteRoster, deleteWorkCalendar, getEmployeeOptions, getHolidays, getLocations, getRosters, getWorkCalendars, saveRoster, saveWorkCalendar, setRosterEmployees, updateHoliday } from '../services/api'
import { useAuthStore } from '../store/auth'
import type { ApprovalRequest, FileItem, Employee, Holiday, Location, PreviewStep, Roster, RosterAdjustment, RosterAdjustmentDay, RosterAdjustmentPreview, WorkCalendar } from '../types'

type Tab = 'holidays' | 'calendar' | 'roster' | 'schedule' | 'adjust'
const fmt = (d: string) => new Date(d).toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
const day = (d: string) => d.slice(0, 10)
const isWeekend = (d: string) => [0, 6].includes(new Date(day(d) + 'T00:00:00').getDay())

export default function Schedule() {
  const { businessId, businesses } = useBusinessStore()
  const [params] = useSearchParams()
  const [tab, setTab] = useState<Tab>(params.get('tab') === 'adjust' ? 'adjust' : 'holidays')
  const [year, setYear] = useState(new Date().getFullYear())
  const [list, setList] = useState<Holiday[]>([])
  const [canManage, setCanManage] = useState(false)
  const [scope, setScope] = useState('')   // '' all | 'national' | 'biz:<id>' | location id
  const [cat, setCat] = useState('')       // '' all | category
  const [applyTo, setApplyTo] = useState('') // '' all | kind
  const [locs, setLocs] = useState<Location[]>([])
  const [edit, setEdit] = useState<any>(null)
  const [error, setError] = useState('')

  const load = () => { clearHolidayCache(); return getHolidays({ ...bizParams(businessId), year }).then((r) => { setList(r.data.data); setCanManage(r.data.can_manage) }) }
  useEffect(() => { load() }, [businessId, year])
  useEffect(() => { getLocations().then((r) => setLocs(r.data)).catch(() => {}) }, [])

  const bizName = (id: number | null) => businesses.find((b) => b.id === id)?.name ?? '-'
  const locLabel = (l: Location) => `${l.name} (${bizName(l.business_id)})`
  const catLabel: Record<string, string> = { libur_nasional: 'Libur Nasional', cuti_bersama: 'Cuti Bersama', libur_perusahaan: 'Libur Perusahaan' }
  const kindLabel: Record<string, string> = { semua: 'Semua', non_roster: 'Non Roster', roster: 'Roster (keterangan)' }
  const matchScope = (h: Holiday) => scope === '' || (scope === 'national' ? h.business_id === null && h.location_id === null : scope.startsWith('biz:') ? h.business_id === Number(scope.slice(4)) && h.location_id === null : h.location_id === Number(scope))
  const rows = list.filter((h) => matchScope(h) && (cat === '' || h.category === cat) && (applyTo === '' || (h.kind || 'semua') === applyTo))
  const counted = (h: Holiday) => !isWeekend(h.date)

  const openNew = () => { setError(''); setEdit({ date: '', end_date: '', name: '', scope: 'national', business_id: null, location_id: null, category: 'libur_nasional', kind: 'semua' }) }
  const openEdit = (h: Holiday) => { setError(''); setEdit({ id: h.id, date: day(h.date), name: h.name, scope: h.location_id ? 'location' : h.business_id ? 'business' : 'national', business_id: h.business_id, location_id: h.location_id, category: h.category || (h.deducts_leave ? 'cuti_bersama' : 'libur_nasional'), kind: h.kind || 'semua' }) }
  const save = async () => {
    setError('')
    if (!edit.date) return setError('Tanggal wajib diisi')
    if (!edit.name.trim()) return setError('Nama hari libur wajib diisi')
    if (edit.end_date && edit.end_date < edit.date) return setError('Tanggal akhir tidak boleh sebelum tanggal mulai')
    if (edit.scope === 'location' && !edit.location_id) return setError('Pilih Lokasi Kerja')
    const body = { date: `${edit.date}T00:00:00+07:00`, end_date: edit.end_date ? `${edit.end_date}T00:00:00+07:00` : null, name: edit.name,
      business_id: edit.scope === 'business' ? edit.business_id : null, location_id: edit.scope === 'location' ? edit.location_id : null,
      category: edit.category, kind: edit.kind, deducts_leave: edit.category === 'cuti_bersama' }
    try {
      if (edit.id) await updateHoliday(edit.id, body)
      else { const r = await createHoliday(body); if (r.data.duplicates_skipped) alert(`${r.data.created} hari libur ditambahkan, ${r.data.duplicates_skipped} tanggal dilewati karena sudah ada.`) }
      setEdit(null); load()
    } catch (e: any) { setError(e.response?.data?.error || 'Gagal menyimpan') }
  }
  const remove = async (h: Holiday) => {
    if (!confirm(`Hapus "${h.name}" (${fmt(h.date)})?${h.deducts_leave ? '\n\nSaldo cuti semua karyawan akan bertambah kembali 1 hari.' : ''}`)) return
    try { await deleteHoliday(h.id); load() } catch (e: any) { alert(e.response?.data?.error || 'Gagal menghapus') }
  }

  const deductCount = list.filter((h) => h.deducts_leave && counted(h)).length

  return (
    <Layout title="Setup Waktu Kerja" subtitle="Hari libur nasional / per lokasi, kalender kerja, dan roster">
      <div className="card p-4">
        <Tabs tabs={[{ id: 'holidays', label: `Hari Libur (${list.length})` }, { id: 'calendar', label: 'Kalender Kerja' }, { id: 'roster', label: 'Roster' }, { id: 'schedule', label: 'Jadwal Roster' }, { id: 'adjust', label: 'Penyesuaian Roster' }]} value={tab} onChange={setTab} />

        {tab === 'holidays' && <>
          <div className="grid md:grid-cols-2 gap-3 mb-3 text-xs">
            <div className="rounded-lg border border-line p-3"><Badge tone="green">Libur biasa — tidak potong cuti</Badge><p className="text-muted mt-1.5">Libur Nasional / Libur Perusahaan. Karyawan Non Roster berstatus Libur, saldo cuti tidak berkurang. Hari ini tidak dihitung bila jatuh di tengah pengajuan cuti. Anggota roster tetap mengikuti pola Kerja/OFF; nama libur hanya tampil sebagai keterangan.</p></div>
            <div className="rounded-lg border border-line p-3"><Badge tone="amber">Cuti bersama — potong cuti</Badge><p className="text-muted mt-1.5">Karyawan libur, tetapi <b>saldo cuti tahunan karyawan Non Roster berkurang 1 hari</b> per hari kerja ({deductCount} hari di {year}). Tidak dihitung lagi pada pengajuan cuti agar tidak terpotong dua kali. Anggota roster tidak dipotong.</p></div>
          </div>
          <DataTable data={rows} rowKey={(h) => h.id} searchPlaceholder="Cari nama hari libur…" searchText={(h) => `${h.name} ${h.location_name ?? ''} ${h.business_name ?? ''}`}
            filters={<>
              <select className="input" value={year} onChange={(e) => setYear(Number(e.target.value))}>{[year - 1, year, year + 1].filter((v, i, a) => a.indexOf(v) === i).map((y) => <option key={y}>{y}</option>)}</select>
              <select className="input" value={scope} onChange={(e) => setScope(e.target.value)}><option value="">Semua Cakupan</option><option value="national">Nasional</option>{locs.map((l) => <option key={l.id} value={l.id}>{locLabel(l)}</option>)}</select>
              <select className="input" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Semua Kategori</option>{Object.entries(catLabel).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
              <select className="input" value={applyTo} onChange={(e) => setApplyTo(e.target.value)}><option value="">Semua Berlaku Untuk</option><option value="semua">Semua</option><option value="non_roster">Non Roster</option><option value="roster">Roster</option></select>
            </>}
            actions={canManage ? <button className="btn-primary" onClick={openNew}><Plus className="w-3.5 h-3.5 inline mr-1" />Hari Libur</button> : undefined}
            empty="Belum ada hari libur untuk tahun ini"
            columns={[
              { head: 'Tanggal', render: (h) => <span>{fmt(h.date)}{isWeekend(h.date) && <span className="text-muted"> (akhir pekan)</span>}</span> },
              { head: 'Nama', render: (h) => <b>{h.name}</b> },
              { head: 'Cakupan', render: (h) => h.location_id ? <Badge tone="purple">{h.location_name || 'Lokasi'}</Badge> : h.business_id === null ? <Badge tone="blue">Nasional</Badge> : <Badge tone="purple">{bizName(h.business_id)} (seluruh bisnis)</Badge> },
              { head: 'Kategori', render: (h) => h.deducts_leave ? <Badge tone="amber">{catLabel.cuti_bersama}</Badge> : <Badge tone="green">{catLabel[h.category] ?? catLabel.libur_nasional}</Badge> },
              { head: 'Berlaku untuk', render: (h) => <Badge tone={h.kind === 'roster' ? 'purple' : 'gray'}>{kindLabel[h.kind || 'semua']}</Badge> },
              { head: 'Aksi', render: (h) => canManage && <div className="flex gap-1.5"><button className="btn" onClick={() => openEdit(h)}>Edit</button><button className="btn text-danger" onClick={() => remove(h)}>Hapus</button></div> },
            ]} />
          {!canManage && <p className="text-[11px] text-muted mt-2">Hari libur hanya dapat diubah oleh Super Admin atau HR Admin.</p>}
        </>}

        {tab === 'calendar' && <Calendars />}
        {tab === 'roster' && <Rosters />}
        {tab === 'schedule' && <RosterSchedule />}
        {tab === 'adjust' && <Adjustments />}
      </div>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Ubah Hari Libur' : 'Tambah Hari Libur'}>
        {edit && (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block font-semibold">{edit.id ? 'Tanggal' : 'Tanggal mulai'}<div className="mt-1 font-normal"><DateField value={edit.date} businessId={locs.find((l) => l.id === edit.location_id)?.business_id ?? edit.business_id ?? 'national'} locationId={edit.location_id} onChange={(v) => setEdit({ ...edit, date: v })} /></div></label>
              {!edit.id && <label className="block font-semibold">Sampai tanggal <span className="font-normal text-muted">(opsional)</span><div className="mt-1 font-normal"><DateField value={edit.end_date} min={edit.date} businessId={locs.find((l) => l.id === edit.location_id)?.business_id ?? edit.business_id ?? 'national'} locationId={edit.location_id} onChange={(v) => setEdit({ ...edit, end_date: v })} /></div></label>}
            </div>
            <label className="block font-semibold">Nama hari libur<input className="input w-full mt-1" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="mis. Hari Kemerdekaan RI, Cuti Bersama Idul Fitri" /></label>
            <label className="block font-semibold">Cakupan
              <select className="input w-full mt-1" value={edit.scope} onChange={(e) => setEdit({ ...edit, scope: e.target.value, location_id: null })}>
                <option value="national">Nasional — berlaku untuk semua lokasi</option><option value="location">Lokasi Kerja tertentu</option>
                {edit.scope === 'business' && <option value="business">Seluruh bisnis {bizName(edit.business_id)} (data lama)</option>}
              </select></label>
            {edit.scope === 'location' && <label className="block font-semibold">Lokasi Kerja
              <select className="input w-full mt-1" value={edit.location_id ?? ''} onChange={(e) => setEdit({ ...edit, location_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Pilih lokasi…</option>{locs.map((l) => <option key={l.id} value={l.id}>{locLabel(l)}</option>)}
              </select></label>}
            <label className="block font-semibold">Kategori
              <select className="input w-full mt-1" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}>
                {Object.entries(catLabel).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
              <div className="font-normal text-muted mt-1">{edit.category === 'cuti_bersama' ? 'Cuti Bersama memotong saldo cuti tahunan karyawan Non Roster 1 hari per hari kerja.' : 'Tidak memotong saldo cuti.'}</div></label>
            <div>
              <div className="font-semibold mb-1">Berlaku untuk</div>
              {[['semua', 'Semua', 'Non Roster berstatus Libur; anggota roster mendapat keterangan.'], ['non_roster', 'Non Roster', 'Hanya karyawan Non Roster yang berstatus Libur.'], ['roster', 'Roster', 'Roster = hanya keterangan di jadwal. Status Kerja/OFF anggota roster tidak berubah.']].map(([v, t, d]) => (
                <label key={v} className={`flex gap-2 items-start border rounded-lg p-2 mb-1.5 cursor-pointer ${edit.kind === v ? 'border-brand bg-brand-soft' : 'border-line'}`}>
                  <input type="radio" className="mt-0.5" checked={edit.kind === v} onChange={() => setEdit({ ...edit, kind: v })} /><span><b>{t}</b><div className="text-muted">{d}</div></span>
                </label>
              ))}
            </div>
            {error && <div className="text-danger bg-danger-soft rounded-lg px-3 py-2">{error}</div>}
            <div className="flex justify-end gap-2"><button className="btn" onClick={() => setEdit(null)}>Batal</button><button className="btn-primary" onClick={save}>Simpan</button></div>
          </div>
        )}
      </Modal>
    </Layout>
  )
}

// ---------------------------------------------------------------- Kalender Kerja
const DAYS = [['1', 'Sen'], ['2', 'Sel'], ['3', 'Rab'], ['4', 'Kam'], ['5', 'Jum'], ['6', 'Sab'], ['0', 'Min']]
const dayNames = (wd: string) => DAYS.filter(([n]) => wd.split(',').includes(n)).map(([, l]) => l).join(', ')
const err = (e: any, f: string) => e.response?.data?.error || f

function Calendars() {
  const { businessId, businesses } = useBusinessStore()
  const [list, setList] = useState<WorkCalendar[]>([])
  const [can, setCan] = useState(false)
  const [edit, setEdit] = useState<any>(null)
  const [error, setError] = useState('')
  const load = () => getWorkCalendars(bizParams(businessId)).then((r) => { setList(r.data.data); setCan(r.data.can_manage) })
  useEffect(() => { load() }, [businessId])
  const bizName = (id: number) => businesses.find((b) => b.id === id)?.name ?? ''
  const locked = businessId !== 0

  const openNew = () => { setError(''); setEdit({ business_id: locked ? businessId : 0, name: '', work_days: '1,2,3,4,5', start_time: '08:00', end_time: '17:00', break_start: '12:00', break_end: '13:00', tolerance_min: 10, require_gps: true, is_default: false, is_active: true }) }
  const save = async () => {
    setError('')
    if (!edit.business_id) return setError('Pilih bisnis')
    if (!edit.name.trim()) return setError('Nama kalender wajib diisi')
    try { await saveWorkCalendar(edit); setEdit(null); load() } catch (e: any) { setError(err(e, 'Gagal menyimpan')) }
  }
  const remove = async (c: WorkCalendar) => {
    if (!confirm(`Hapus kalender "${c.name}"? Karyawan yang memakainya kembali ke kalender default.`)) return
    try { await deleteWorkCalendar(c.id); load() } catch (e: any) { alert(err(e, 'Gagal menghapus')) }
  }
  const toggleDay = (n: string) => { const cur = edit.work_days.split(',').filter(Boolean); setEdit({ ...edit, work_days: (cur.includes(n) ? cur.filter((x: string) => x !== n) : [...cur, n]).join(',') }) }

  return (
    <>
      <DataTable data={list} rowKey={(c) => c.id} searchPlaceholder="Cari kalender…" searchText={(c) => `${c.name} ${bizName(c.business_id)}`}
        actions={can ? <button className="btn-primary" onClick={openNew}><Plus className="w-3.5 h-3.5 inline mr-1" />Kalender</button> : undefined}
        columns={[
          { head: 'Nama Kalender', render: (c) => <div><b>{c.name}</b>{c.is_default && <> <Badge tone="blue">Default</Badge></>}</div> },
          { head: 'Berlaku Untuk', render: (c) => <div>{bizName(c.business_id)}<div className="text-muted text-[11px]">{c.employee_count ?? 0} karyawan</div></div> },
          { head: 'Hari Kerja', render: (c) => dayNames(c.work_days) },
          { head: 'Jam Kerja', render: (c) => `${c.start_time} – ${c.end_time}` },
          { head: 'Istirahat', render: (c) => (c.break_start && c.break_end ? `${c.break_start} – ${c.break_end}` : '-') },
          { head: 'Toleransi', render: (c) => `${c.tolerance_min} menit` },
          { head: 'Kebijakan', render: (c) => (c.require_gps ? <Badge tone="green">GPS wajib</Badge> : <Badge>Tanpa GPS</Badge>) },
          { head: 'Status', render: (c) => (c.is_active ? <Badge tone="green">Aktif</Badge> : <Badge>Nonaktif</Badge>) },
          { head: 'Aksi', render: (c) => can && <div className="flex gap-1.5"><button className="btn" onClick={() => { setError(''); setEdit({ ...c }) }}>Edit</button>{!c.is_default && <button className="btn text-danger" onClick={() => remove(c)}>Hapus</button>}</div> },
        ]} />
      <p className="text-[11px] text-muted mt-2">Karyawan tanpa kalender sendiri memakai kalender <b>Default</b> bisnisnya. Kalender dipilih per karyawan di form Karyawan; karyawan roster memakai jadwal roster.</p>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Ubah Kalender Kerja' : 'Tambah Kalender Kerja'}>
        {edit && (
          <div className="space-y-3 text-xs">
            <label className="block font-semibold">{locked || edit.id ? 'Bisnis (terkunci)' : 'Bisnis'}
              <select className="input w-full mt-1 disabled:bg-tint" disabled={locked || !!edit.id} value={edit.business_id || ''} onChange={(e) => setEdit({ ...edit, business_id: Number(e.target.value) })}><option value="">— Pilih bisnis —</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
            <label className="block font-semibold">Nama kalender<input className="input w-full mt-1" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="mis. Kantor Reguler, Toko 6 Hari" /></label>
            <div><div className="font-semibold mb-1">Hari kerja</div><div className="flex gap-1.5 flex-wrap">{DAYS.map(([n, l]) => <button type="button" key={n} onClick={() => toggleDay(n)} className={`px-3 py-1.5 rounded-lg border font-semibold ${edit.work_days.split(',').includes(n) ? 'bg-brand text-on-brand border-brand' : 'border-line text-muted'}`}>{l}</button>)}</div></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block font-semibold">Jam masuk<input className="input w-full mt-1" type="time" value={edit.start_time} onChange={(e) => setEdit({ ...edit, start_time: e.target.value })} /></label>
              <label className="block font-semibold">Jam pulang<input className="input w-full mt-1" type="time" value={edit.end_time} onChange={(e) => setEdit({ ...edit, end_time: e.target.value })} /></label>
              <label className="block font-semibold">Istirahat mulai<input className="input w-full mt-1" type="time" value={edit.break_start} onChange={(e) => setEdit({ ...edit, break_start: e.target.value })} /></label>
              <label className="block font-semibold">Istirahat selesai<input className="input w-full mt-1" type="time" value={edit.break_end} onChange={(e) => setEdit({ ...edit, break_end: e.target.value })} /></label>
            </div>
            <label className="block font-semibold">Toleransi keterlambatan (menit)<input className="input w-full mt-1" type="number" min={0} max={240} value={edit.tolerance_min} onChange={(e) => setEdit({ ...edit, tolerance_min: Number(e.target.value) })} /></label>
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={edit.require_gps} onChange={(e) => setEdit({ ...edit, require_gps: e.target.checked })} />Wajib GPS (absen hanya di radius lokasi kerja)</label>
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={edit.is_default} onChange={(e) => setEdit({ ...edit, is_default: e.target.checked })} />Jadikan kalender default bisnis ini</label>
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} />Aktif</label>
            {error && <div className="text-danger bg-danger-soft rounded-lg px-3 py-2">{error}</div>}
            <div className="flex justify-end gap-2"><button className="btn" onClick={() => setEdit(null)}>Batal</button><button className="btn-primary" onClick={save}>Simpan</button></div>
          </div>
        )}
      </Modal>
    </>
  )
}

// ---------------------------------------------------------------- Roster
// same cycle rule as the backend (rosterWorking)
const dayMs = 864e5
const working = (r: Pick<Roster, 'work_units' | 'off_units' | 'unit' | 'start_cycle'>, d: Date) => {
  const mult = r.unit === 'minggu' ? 7 : 1
  const cycle = (r.work_units + r.off_units) * mult
  if (cycle <= 0 || !r.start_cycle) return false
  const days = Math.round((new Date(d.toDateString()).getTime() - new Date(r.start_cycle.slice(0, 10) + 'T00:00:00').getTime()) / dayMs)
  return (((days % cycle) + cycle) % cycle) < r.work_units * mult
}

// "Sedang kerja · libur berikutnya 26 Okt – 8 Nov" — makes the OFF schedule visible while it is being set up
function cycleHint(r: Pick<Roster, 'work_units' | 'off_units' | 'unit' | 'start_cycle'>) {
  const f = (d: Date) => d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })
  const today = new Date(new Date().toDateString())
  const now = working(r, today)
  let d = new Date(today)
  for (let i = 0; i < 400 && working(r, d) === now; i++) d = new Date(d.getTime() + dayMs) // end of the current block
  if (now) { // working now → next OFF block starts at d
    let e = new Date(d); for (let i = 0; i < 400 && !working(r, e); i++) e = new Date(e.getTime() + dayMs)
    return `Sedang kerja · libur berikutnya ${f(d)} – ${f(new Date(e.getTime() - dayMs))}`
  }
  return `Sedang libur sampai ${f(new Date(d.getTime() - dayMs))} · kerja lagi ${f(d)}`
}

function RosterPreview({ r }: { r: Roster }) {
  const start = r.start_cycle ? new Date(r.start_cycle.slice(0, 10) + 'T00:00:00') : new Date()
  const cycleDays = Math.max(1, (r.work_units + r.off_units) * (r.unit === 'minggu' ? 7 : 1))
  const total = Math.min(Math.max(cycleDays, 14) + 7, 84) // at least the full cycle, shown in weeks
  const lead = (start.getDay() + 6) % 7
  const cells = [...Array(lead).fill(null), ...Array.from({ length: total }, (_, i) => new Date(start.getTime() + i * dayMs))]
  return (
    <div>
      <div className="font-semibold mb-1">Preview siklus <span className="font-normal text-muted">(mulai {start.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })})</span></div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[10px]">
        {['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((d) => <div key={d} className="font-bold text-muted">{d}</div>)}
        {cells.map((d, i) => d ? <div key={i} className={`py-1 rounded ${working(r, d) ? 'bg-ok-soft text-ok font-bold' : 'bg-tint text-muted'}`} title={d.toDateString()}>{d.getDate()}</div> : <div key={i} />)}
      </div>
      <div className="flex gap-3 mt-1 text-[10.5px] text-muted"><span><i className="inline-block w-2 h-2 rounded bg-ok mr-1" />Kerja</span><span><i className="inline-block w-2 h-2 rounded bg-line mr-1" />OFF</span></div>
    </div>
  )
}

function Rosters() {
  const { businessId, businesses } = useBusinessStore()
  const [list, setList] = useState<Roster[]>([])
  const user = useAuthStore((st) => st.user)
  const [can, setCan] = useState(false)
  const [canAssign, setCanAssign] = useState(false)
  const [locations, setLocations] = useState<Location[]>([])
  const [edit, setEdit] = useState<any>(null)
  const [error, setError] = useState('')
  const [assign, setAssign] = useState<{ roster: Roster; emps: Employee[]; starts: Record<number, string>; q: string } | null>(null)
  const [assignError, setAssignError] = useState('')
  const locked = businessId !== 0
  const load = () => { getRosters(bizParams(businessId)).then((r) => { setList(r.data.data); setCan(r.data.can_manage); setCanAssign(r.data.can_assign) }); getLocations(bizParams(businessId)).then((r) => setLocations(r.data)) }
  useEffect(() => { load() }, [businessId])
  const bizName = (id: number) => businesses.find((b) => b.id === id)?.name ?? ''
  const locName = (id: number | null) => locations.find((l) => l.id === id)?.name ?? '-'

  const openNew = () => { setError(''); setEdit({ business_id: locked ? businessId : 0, name: '', work_units: 6, off_units: 2, unit: 'hari', location_id: null, start_time: '07:00', end_time: '16:00', break_start: '12:00', break_end: '13:00', tolerance_min: 10, require_gps: true, start_cycle: '', is_active: true }) }
  const save = async () => {
    setError('')
    if (!edit.business_id) return setError('Pilih bisnis')
    if (!edit.name.trim()) return setError('Nama roster wajib diisi')
    if (!edit.start_cycle) return setError('Start cycle wajib diisi')
    try { await saveRoster({ ...edit, start_cycle: `${edit.start_cycle.slice(0, 10)}T00:00:00+07:00` }); setEdit(null); load() } catch (e: any) { setError(err(e, 'Gagal menyimpan')) }
  }
  const remove = async (r: Roster) => { if (confirm(`Hapus roster "${r.name}"? Anggotanya kembali ke kalender kerja.`)) { try { await deleteRoster(r.id); load() } catch (e: any) { alert(err(e, 'Gagal menghapus')) } } }
  // Only HR admin / super admin assign roster members (the button is hidden for everyone else).
  const openAssign = async (r: Roster) => {
    const res = await getEmployeeOptions({ business_id: r.business_id })
    const emps = res.data ?? []
    const starts: Record<number, string> = {}
    ;(r.members ?? []).forEach((m) => { if (emps.some((e) => e.id === m.employee_id)) starts[m.employee_id] = m.start_cycle.slice(0, 10) })
    setAssignError(''); setAssign({ roster: r, emps, starts, q: '' })
  }
  const saveAssign = async () => {
    if (!assign) return
    const members = Object.entries(assign.starts).map(([id, start]) => ({ employee_id: Number(id), start_cycle: start ? `${start}T00:00:00+07:00` : '' }))
    if (members.some((m) => !m.start_cycle)) return setAssignError('Isi tanggal mulai siklus untuk setiap karyawan yang dipilih')
    try { await setRosterEmployees(assign.roster.id, members); setAssign(null); load() } catch (e: any) { setAssignError(err(e, 'Gagal menyimpan anggota')) }
  }
  const bizLocations = locations.filter((l) => l.business_id === edit?.business_id)

  return (
    <>
      <DataTable data={list} rowKey={(r) => r.id} searchPlaceholder="Cari roster…" searchText={(r) => `${r.name} ${r.pattern} ${bizName(r.business_id)}`}
        actions={can ? <button className="btn-primary" onClick={openNew}><Plus className="w-3.5 h-3.5 inline mr-1" />Roster</button> : undefined}
        empty="Belum ada roster. Karyawan memakai kalender kerja."
        columns={[
          { head: 'Nama Roster', render: (r) => <div><b>{r.name}</b><div className="text-muted text-[11px]">{bizName(r.business_id)}</div></div> },
          { head: 'Pola', render: (r) => <Badge tone="purple">{r.pattern}</Badge> },
          { head: 'Lokasi', render: (r) => locName(r.location_id) },
          { head: 'Jam Kerja', render: (r) => `${r.start_time} – ${r.end_time}` },
          { head: 'Start Default', render: (r) => new Date(r.start_cycle).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) },
          { head: 'Karyawan', render: (r) => `${r.employee_count ?? 0} orang` },
          { head: 'Status', render: (r) => (r.is_active ? <Badge tone="green">Aktif</Badge> : <Badge>Nonaktif</Badge>) },
          { head: 'Aksi', render: (r) => can && <div className="flex gap-1.5 whitespace-nowrap">{canAssign && <button className="btn" onClick={() => openAssign(r)}>Karyawan</button>}{can && <button className="btn" onClick={() => { setError(''); setEdit({ ...r, start_cycle: r.start_cycle.slice(0, 10) }) }}>Edit</button>}{can && <button className="btn text-danger" onClick={() => remove(r)}>Hapus</button>}</div> },
        ]} />
      <p className="text-[11px] text-muted mt-2">Roster menggantikan kalender kerja bagi anggotanya; satu karyawan hanya mengikuti satu roster. <b>Jadwal libur ditentukan per karyawan lewat start cycle-nya</b> sehingga kru bisa bergantian. Libur nasional tidak menghentikan roster, dan cuti bersama tidak memotong saldo anggota roster. Pergeseran jadwal diajukan di tab Penyesuaian Roster.</p>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Ubah Roster' : 'Tambah Roster'}>
        {edit && (
          <div className="space-y-3 text-xs">
            <label className="block font-semibold">{locked || edit.id ? 'Bisnis (terkunci)' : 'Bisnis'}
              <select className="input w-full mt-1 disabled:bg-tint" disabled={locked || !!edit.id} value={edit.business_id || ''} onChange={(e) => setEdit({ ...edit, business_id: Number(e.target.value), location_id: null })}><option value="">— Pilih bisnis —</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
            <label className="block font-semibold">Nama roster<input className="input w-full mt-1" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="mis. Site Banjarmasin 6:2" /></label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="block font-semibold">Kerja<input className="input w-full mt-1" type="number" min={1} max={60} value={edit.work_units} onChange={(e) => setEdit({ ...edit, work_units: Number(e.target.value) })} /></label>
              <label className="block font-semibold">Libur<input className="input w-full mt-1" type="number" min={0} max={60} value={edit.off_units} onChange={(e) => setEdit({ ...edit, off_units: Number(e.target.value) })} /></label>
              <label className="block font-semibold">Satuan<select className="input w-full mt-1" value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })}><option value="hari">hari</option><option value="minggu">minggu</option></select></label>
            </div>
            <label className="block font-semibold">Start cycle default <span className="font-normal text-muted">(usulan untuk anggota baru; tiap karyawan punya start cycle sendiri)</span><div className="mt-1 font-normal"><DateField value={edit.start_cycle} businessId={edit.business_id || 0} onChange={(v) => setEdit({ ...edit, start_cycle: v })} /></div></label>
            <label className="block font-semibold">Lokasi kerja<select className="input w-full mt-1" value={edit.location_id ?? ''} onChange={(e) => setEdit({ ...edit, location_id: e.target.value ? Number(e.target.value) : null })}><option value="">— Lokasi karyawan masing-masing —</option>{bizLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block font-semibold">Jam masuk<input className="input w-full mt-1" type="time" value={edit.start_time} onChange={(e) => setEdit({ ...edit, start_time: e.target.value })} /></label>
              <label className="block font-semibold">Jam pulang<input className="input w-full mt-1" type="time" value={edit.end_time} onChange={(e) => setEdit({ ...edit, end_time: e.target.value })} /></label>
              <label className="block font-semibold">Istirahat mulai<input className="input w-full mt-1" type="time" value={edit.break_start} onChange={(e) => setEdit({ ...edit, break_start: e.target.value })} /></label>
              <label className="block font-semibold">Istirahat selesai<input className="input w-full mt-1" type="time" value={edit.break_end} onChange={(e) => setEdit({ ...edit, break_end: e.target.value })} /></label>
            </div>
            <label className="block font-semibold">Toleransi keterlambatan (menit)<input className="input w-full mt-1" type="number" min={0} max={240} value={edit.tolerance_min} onChange={(e) => setEdit({ ...edit, tolerance_min: Number(e.target.value) })} /></label>
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={edit.require_gps} onChange={(e) => setEdit({ ...edit, require_gps: e.target.checked })} />Wajib GPS</label>
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} />Aktif</label>
            {edit.start_cycle && edit.work_units > 0 && <RosterPreview r={edit} />}
            {error && <div className="text-danger bg-danger-soft rounded-lg px-3 py-2">{error}</div>}
            <div className="flex justify-end gap-2"><button className="btn" onClick={() => setEdit(null)}>Batal</button><button className="btn-primary" onClick={save}>Simpan</button></div>
          </div>
        )}
      </Modal>

      <Modal open={!!assign} onClose={() => setAssign(null)} title={`Karyawan & Jadwal Libur — ${assign?.roster.name ?? ''}`}>
        {assign && (
          <div className="space-y-3 text-xs">
            <p className="text-muted">Centang karyawan yang mengikuti roster <b>{assign.roster.pattern}</b>, lalu isi <b>tanggal pertama siklus kerjanya</b>. Dari situ jadwal kerja dan libur (OFF) karyawan dihitung otomatis — isi tanggal yang berbeda agar kru bergantian. {!can && 'Anda hanya melihat bawahan langsung Anda.'}</p>
            <input className="input w-full" placeholder="Cari nama / NIK…" value={assign.q} onChange={(e) => setAssign({ ...assign, q: e.target.value })} />
            <div className="max-h-80 overflow-auto border border-line rounded-lg divide-y divide-line">
              {assign.emps.filter((e) => `${e.name} ${e.nik ?? ''}`.toLowerCase().includes(assign.q.toLowerCase())).map((e) => {
                const on = e.id in assign.starts
                const other = list.find((r) => r.id !== assign.roster.id && r.employee_ids?.includes(e.id))
                const start = assign.starts[e.id]
                return (
                  <div key={e.id} className="px-3 py-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={on} onChange={() => { const n = { ...assign.starts }; if (on) delete n[e.id]; else n[e.id] = assign.roster.start_cycle.slice(0, 10); setAssign({ ...assign, starts: n }) }} />
                      <span className="flex-1"><b>{e.name}</b> <span className="text-muted">{e.nik} · {e.position?.title ?? '-'}</span></span>
                      {other && <Badge tone="amber">pindah dari {other.name}</Badge>}
                    </label>
                    {on && (
                      <div className="mt-2 ml-6 grid grid-cols-[170px_1fr] gap-3 items-center">
                        <div><div className="text-[10.5px] text-muted mb-0.5">Mulai siklus kerja</div><DateField value={start} businessId={assign.roster.business_id} onChange={(v) => setAssign({ ...assign, starts: { ...assign.starts, [e.id]: v } })} /></div>
                        <div className="text-[11px] text-muted">{start ? cycleHint({ ...assign.roster, start_cycle: start }) : 'Pilih tanggal mulai'}</div>
                      </div>
                    )}
                  </div>
                )
              })}
              {!assign.emps.length && <div className="px-3 py-6 text-center text-muted">Tidak ada karyawan yang dapat Anda atur.</div>}
            </div>
            {assignError && <div className="text-danger bg-danger-soft rounded-lg px-3 py-2">{assignError}</div>}
            <div className="flex items-center justify-between"><span className="text-muted">{Object.keys(assign.starts).length} dipilih</span><div className="flex gap-2"><button className="btn" onClick={() => setAssign(null)}>Batal</button><button className="btn-primary" onClick={saveAssign}>Simpan</button></div></div>
          </div>
        )}
      </Modal>
    </>
  )
}

// ---------------------------------------------------------------- Penyesuaian Roster
const adjTone = { 'Pending Approval': 'amber', Disetujui: 'green', Ditolak: 'red', Dibatalkan: 'gray' } as const
const fd = (d: string) => new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })

const MAX_FILE = 10 * 1024 * 1024

function Adjustments() {
  const { businessId } = useBusinessStore()
  const [list, setList] = useState<RosterAdjustment[]>([])
  const [form, setForm] = useState(false)
  const [detail, setDetail] = useState<RosterAdjustment | null>(null)
  const [decision, setDecision] = useState<{ row: RosterAdjustment; approve: boolean; note: string } | null>(null)
  const [decisionError, setDecisionError] = useState('')
  const [params, setParams] = useSearchParams()
  const load = () => getRosterAdjustments().then((r) => setList(r.data))
  useEffect(() => { load() }, [businessId])
  // deep link from an activity row: /schedule?tab=adjust&open=<id>
  useEffect(() => {
    const o = Number(params.get('open'))
    if (!o) return
    const r = list.find((x) => x.id === o)
    if (r) { setDetail(r); setParams({}, { replace: true }) }
  }, [params, list])
  const cancel = async (a: RosterAdjustment) => { if (confirm('Batalkan pengajuan ini?')) { try { await cancelRosterAdjustment(a.id); setDetail(null); load() } catch (e: any) { alert(err(e, 'Gagal membatalkan')) } } }
  const submitDecision = async () => {
    if (!decision) return
    if (!decision.approve && !decision.note.trim()) return setDecisionError('Alasan penolakan wajib diisi')
    try { await (decision.approve ? approveRequest : rejectRequest)(decision.row.approval_id!, decision.note); setDecision(null); setDetail(null); setDecisionError(''); load() } catch (e: any) { setDecisionError(err(e, 'Gagal memproses')); load() }
  }
  const askDecision = (row: RosterAdjustment, approve: boolean) => { setDecisionError(''); setDecision({ row, approve, note: '' }) }
  return (
    <>
      <p className="text-xs text-muted mb-3">Menggeser jadwal seorang anggota roster pada rentang tanggal tertentu — mis. menunda libur karena proyek (jadikan <b>Kerja</b>) atau memajukan libur (jadikan <b>Libur</b>). Pengajuan disetujui otomatis oleh atasan sesuai alur persetujuan; setelah disetujui jadwal otomatis berubah, pola dasar tetap.</p>
      <DataTable data={list} rowKey={(a) => a.id} searchPlaceholder="Cari karyawan, alasan…" searchText={(a) => `${a.employee_name} ${a.reason} ${a.status}`} empty="Belum ada pengajuan penyesuaian"
        actions={<button className="btn-primary" onClick={() => setForm(true)}><Plus className="w-3.5 h-3.5 inline mr-1" />Ajukan Penyesuaian</button>}
        columns={[
          { head: 'Karyawan', render: (a) => <div><b>{a.employee_name}</b><div className="text-muted text-[11px]">{a.unit_name}</div></div> },
          { head: 'Tanggal', render: (a) => adjPeriod(a) },
          { head: 'Menjadi', render: (a) => <AdjDaysSummary a={a} /> },
          { head: 'Alasan', render: (a) => <span className="line-clamp-2">{a.reason}</span> },
          { head: 'Status', render: (a) => <div><Badge tone={adjTone[a.status]}>{a.status === 'Pending Approval' ? 'Menunggu Persetujuan' : a.status}</Badge>{a.waiting_for && <div className="text-[10.5px] text-muted mt-0.5">oleh {a.waiting_for}</div>}</div> },
          { head: 'Alur Persetujuan', render: (a) => <ApprovalChain chain={a.chain} /> },
          { head: 'Aksi', render: (a) => (
            <div className="flex gap-1.5 whitespace-nowrap">
              <button className="btn" onClick={() => setDetail(a)}>Detail</button>
              {a.can_approve && a.approval_id && <>
                <button className="btn-primary" onClick={() => askDecision(a, true)}>Setujui</button>
                <button className="btn text-danger" onClick={() => askDecision(a, false)}>Tolak</button>
              </>}
              {a.can_cancel && <button className="btn text-danger" onClick={() => cancel(a)}>Batalkan</button>}
            </div>) },
        ]} />
      {form && <AdjustmentForm businessId={businessId} onClose={() => setForm(false)} onSaved={() => { setForm(false); load() }} />}
      {detail && <AdjustmentDetail row={detail} onClose={() => setDetail(null)} onCancel={() => cancel(detail)} onDecide={(approve) => askDecision(detail, approve)} />}
      <Modal open={!!decision} onClose={() => setDecision(null)} title={decision?.approve ? 'Setujui Pengajuan' : 'Tolak Pengajuan'}>
        {decision && (
          <div className="space-y-3 text-xs">
            <div className="bg-sunken rounded-lg p-3"><b>Penyesuaian Roster — {decision.row.employee_name}</b><div className="text-muted mt-0.5">{adjDaysText(decision.row)} · {decision.row.reason}</div></div>
            {decision.row.attachment_count > 0 && <div><div className="font-bold mb-1">Lampiran</div><AdjustmentFiles id={decision.row.id} /></div>}
            <label className="block font-semibold">Catatan {decision.approve ? '(opsional)' : '(wajib)'}<textarea className="input w-full mt-1" rows={3} value={decision.note} onChange={(e) => setDecision({ ...decision, note: e.target.value })} /></label>
            {decisionError && <div className="text-danger bg-danger-soft rounded-lg px-3 py-2">{decisionError}</div>}
            <div className="flex justify-end gap-2"><button className="btn" onClick={() => setDecision(null)}>Batal</button><button className={decision.approve ? 'btn-primary' : 'btn-primary !bg-brand !border-brand'} onClick={submitDecision}>{decision.approve ? 'Setujui' : 'Tolak'}</button></div>
          </div>
        )}
      </Modal>
    </>
  )
}

const dayKind = (k: string) => (k === 'kerja' ? 'Kerja' : 'Libur')
const adjDaysList = (a: RosterAdjustment): RosterAdjustmentDay[] => (a.days?.length ? a.days : [{ date: a.start_date.slice(0, 10), kind: a.kind === 'kerja' ? 'kerja' : 'off', is_compensation: false }])
const adjDaysText = (a: RosterAdjustment) => adjDaysList(a).map((d) => `${fd(d.date)} ${dayKind(d.kind)}${d.is_compensation ? ' (pengganti)' : ''}`).join(', ')
function AdjDaysSummary({ a }: { a: RosterAdjustment }) {
  const ds = adjDaysList(a)
  const kerja = ds.filter((d) => d.kind === 'kerja').length
  const comp = ds.filter((d) => d.is_compensation).length
  return (
    <div className="space-y-0.5">
      <div className="flex flex-wrap gap-1">{kerja > 0 && <Badge tone="green">{kerja} Kerja</Badge>}{ds.length - kerja > 0 && <Badge>{ds.length - kerja} Libur</Badge>}{comp > 0 && <Badge tone="amber">{comp} pengganti</Badge>}</div>
    </div>
  )
}
const adjPeriod = (a: RosterAdjustment) => (a.start_date.slice(0, 10) === a.end_date.slice(0, 10) ? fd(a.start_date) : `${fd(a.start_date)} – ${fd(a.end_date)}`)

function AdjustmentFiles({ id }: { id: number }) {
  const [items, setItems] = useState<FileItem[]>([])
  useEffect(() => { getRosterAttachments(id).then((r) => setItems(r.data.map((a) => ({ ...a, label: a.file_name })))).catch(() => {}) }, [id])
  return <FileThumbs items={items} fetchBlob={(aid) => fetchRosterAttachmentBlob(id, aid).then((r) => r.data)} empty="Tidak ada lampiran." />
}

function AdjustmentDetail({ row, onClose, onCancel, onDecide }: { row: RosterAdjustment; onClose: () => void; onCancel: () => void; onDecide: (approve: boolean) => void }) {
  const [ap, setAp] = useState<ApprovalRequest | null>(null)
  const [apError, setApError] = useState('')
  useEffect(() => {
    if (!row.approval_id) { setApError('Alur persetujuan tidak tersedia untuk pengajuan ini.'); return }
    getApproval(row.approval_id).then((r) => setAp(r.data)).catch((e) => setApError(err(e, 'Alur persetujuan tidak dapat dimuat.')))
  }, [row.approval_id])
  const pdf = () => exportApprovalSlip({
    title: 'Formulir Persetujuan Penyesuaian Roster',
    requester: { name: row.employee_name, nik: row.employee_nik, position: row.position_name, unit: row.unit_name },
    details: [['Jenis', 'Penyesuaian Roster'], ['Periode', adjPeriod(row)], ...adjDaysList(row).map((d, i): [string, string] => [`Tanggal ${i + 1}`, `${fd(d.date)} → ${d.kind === 'kerja' ? 'Hari Kerja' : 'Hari Libur'}${d.is_compensation ? ' (hari pengganti)' : ''}`]), ['Alasan', row.reason], ['Catatan', row.note || '-']],
    status: row.status,
    steps: ap ? ap.steps.map((s) => ({ level: s.level, approver: s.approver_name, kind: stepKind[s.kind], status: stepLabel(s.status), at: s.acted_at ?? undefined, note: s.note }))
      : (row.chain ?? []).map((s) => ({ level: s.level, approver: s.name, kind: stepKind[s.kind], status: stepLabel(s.status) })),
    filename: `persetujuan-roster-${row.id}.pdf`,
  })
  return (
    <Modal open onClose={onClose} title={`Penyesuaian Roster — ${row.employee_name}`}>
      <div className="space-y-4 text-xs">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[['Karyawan', `${row.employee_name}${row.unit_name ? ` (${row.unit_name})` : ''}`], ['Periode', adjPeriod(row)], ['Kompensasi', row.compensate ? 'Ya' : 'Tidak'], ['Status', row.status], ['Alasan', row.reason], ['Catatan', row.note || '-'], ['Diajukan', row.created_at ? new Date(row.created_at).toLocaleString('id-ID') : '-']].map(([k, v]) => (
            <div key={k}><dt className="text-muted text-[10.5px]">{k}</dt><dd className="font-semibold">{v}</dd></div>
          ))}
        </dl>
        <div>
          <div className="font-bold mb-1.5">Tanggal ({adjDaysList(row).length})</div>
          <div className="flex flex-wrap gap-1.5">{adjDaysList(row).map((d) => (
            <span key={d.date} className={`border rounded-lg px-2 py-1 ${d.is_compensation ? 'border-amber-400 bg-amber-50' : 'border-line bg-sunken'}`}><b>{fd(d.date)}</b> → {dayKind(d.kind)}{d.is_compensation && <span className="text-muted"> · pengganti</span>}</span>
          ))}</div>
        </div>
        <div><div className="font-bold mb-1.5">Lampiran <span className="font-normal text-muted">(opsional)</span></div><AdjustmentFiles id={row.id} /></div>
        <div>
          <div className="font-bold mb-1.5">Alur Persetujuan</div>
          {ap ? <ApprovalTimeline steps={ap.steps} /> : apError ? <p className="text-danger bg-danger-soft rounded-lg px-3 py-2">{apError}</p> : <p className="text-muted">Memuat…</p>}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn" onClick={onClose}>Tutup</button>
          {row.status === 'Disetujui' && <button className="btn" onClick={pdf}><FileDown className="w-3.5 h-3.5 inline mr-1" />Unduh PDF</button>}
          {row.can_approve && row.approval_id && <><button className="btn-primary" onClick={() => onDecide(true)}>Setujui</button><button className="btn text-danger" onClick={() => onDecide(false)}>Tolak</button></>}
          {row.can_cancel && <button className="btn text-danger" onClick={onCancel}>Batalkan</button>}
        </div>
      </div>
    </Modal>
  )
}

function AdjustmentForm({ businessId, onClose, onSaved }: { businessId: number; onClose: () => void; onSaved: () => void }) {
  const user = useAuthStore((st) => st.user)
  const isSched = ['super_admin', 'hr_admin'].includes(user?.role ?? '') // the server decides
  const [people, setPeople] = useState<Employee[]>([])
  const [rosters, setRosters] = useState<Roster[]>([])
  const [employeeId, setEmployeeId] = useState(0)
  const [rows, setRows] = useState<{ date: string; kind: 'kerja' | 'off' }[]>([{ date: '', kind: 'kerja' }])
  const [compensate, setCompensate] = useState(false)
  const [comp, setComp] = useState<string[]>([])
  const [compEdited, setCompEdited] = useState(false)
  const [preview, setPreview] = useState<RosterAdjustmentPreview | null>(null)
  const [reason, setReason] = useState('')
  const [chain, setChain] = useState<PreviewStep[]>([])
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([getRosters(bizParams(businessId)), getEmployeeOptions({ ...bizParams(businessId), scope: 'team' })]).then(([rr, er]) => {
      setRosters(rr.data.data)
      const members = new Set(rr.data.data.flatMap((r) => r.employee_ids ?? []))
      // roster members I may file for: myself, my direct reports; schedule managers: everyone
      setPeople((er.data ?? []).filter((e) => members.has(e.id) && (isSched || rr.data.can_manage || e.id === user?.employee_id || e.manager_id === user?.employee_id)))
    })
  }, [])
  useEffect(() => { if (employeeId) getApprovers(employeeId, { request: 'roster' }).then((r) => setChain(r.data.chain)).catch(() => setChain([])) }, [employeeId])
  const onPick = (list: FileList | null) => {
    if (!list) return
    const next = [...files]
    for (const f of Array.from(list)) {
      if (f.size > MAX_FILE) { setError(`"${f.name}" lebih dari 10 MB`); continue }
      if (next.length < 10) next.push(f)
    }
    setFiles(next)
  }
  const roster = rosters.find((r) => r.employee_ids?.includes(employeeId))
  const biz = people.find((p) => p.id === employeeId)?.business_id ?? 0
  const filled = rows.filter((r) => r.date)
  const filledKey = filled.map((r) => `${r.date}:${r.kind}`).join('|')
  const setRow = (i: number, patch: Partial<{ date: string; kind: 'kerja' | 'off' }>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  // the server computes N (days that change the cycle total) and suggests the compensating dates
  useEffect(() => {
    if (!employeeId || !filled.length) { setPreview(null); return }
    const t = setTimeout(() => {
      previewRosterAdjustment(employeeId, filled).then((r) => {
        setPreview(r.data)
        if (compensate && (!compEdited || comp.length !== r.data.n)) { setComp(r.data.suggested); setCompEdited(false) }
      }).catch(() => setPreview(null))
    }, 300)
    return () => clearTimeout(t)
  }, [employeeId, filledKey, compensate])
  const n = preview?.n ?? 0
  const compKind = preview?.kind || 'off'

  const submit = async () => {
    setError('')
    if (!employeeId) return setError('Pilih karyawan')
    if (!filled.length) return setError('Isi minimal satu tanggal')
    if (new Set(filled.map((r) => r.date)).size !== filled.length) return setError('Ada tanggal yang terisi lebih dari sekali')
    if (!reason.trim()) return setError('Alasan wajib diisi')
    const useComp = compensate && n > 0
    if (useComp && (comp.length !== n || comp.some((c) => !c))) return setError(`Isi ${n} tanggal pengganti`)
    const days = [...filled.map((r) => ({ ...r, is_compensation: false })), ...(useComp ? comp.map((d) => ({ date: d, kind: compKind, is_compensation: true })) : [])]
    setBusy(true)
    try { await createRosterAdjustment({ employee_id: employeeId, days: JSON.stringify(days), compensate: useComp ? 'true' : 'false', reason, note }, files); onSaved() } catch (e: any) { setError(err(e, 'Gagal mengajukan')) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="Ajukan Penyesuaian Jadwal Roster">
      <div className="space-y-3 text-xs">
        <label className="block font-semibold">Karyawan roster <span className="font-normal text-muted">(diri sendiri atau bawahan langsung)</span>
          <select className="input w-full mt-1" value={employeeId || ''} onChange={(e) => setEmployeeId(Number(e.target.value))}>
            <option value="">— Pilih karyawan —</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === user?.employee_id ? ' (saya)' : ''}</option>)}
          </select></label>
        {!people.length && <p className="text-muted">Tidak ada anggota roster yang dapat Anda ajukan. Karyawan harus lebih dulu dimasukkan ke roster.</p>}
        {roster && <p className="text-muted">Roster: <b>{roster.name}</b> ({roster.pattern})</p>}
        <div>
          <div className="font-semibold mb-1">Tanggal yang disesuaikan <span className="font-normal text-muted">(boleh tidak berurutan, maks 60)</span></div>
          {rows.map((r, i) => {
            const pd = preview?.days.find((d) => d.date === r.date)
            return (
              <div key={i} className="flex flex-wrap items-center gap-2 mb-1.5">
                <div className="w-44"><DateField value={r.date} businessId={biz} onChange={(v) => setRow(i, { date: v })} /></div>
                <div className="inline-flex rounded-lg border border-line overflow-hidden">
                  {(['kerja', 'off'] as const).map((k) => <button key={k} type="button" className={`px-2.5 py-1.5 ${r.kind === k ? 'bg-brand text-white font-bold' : 'bg-white'}`} onClick={() => setRow(i, { kind: k })}>{k === 'kerja' ? 'Kerja' : 'OFF'}</button>)}
                </div>
                {pd && <span className="text-muted">pola: {dayKind(pd.pattern)}{pd.changed ? '' : ' (tidak berubah)'}</span>}
                {rows.length > 1 && <button type="button" className="p-0.5" title="Hapus tanggal" onClick={() => setRows(rows.filter((_, j) => j !== i))}><X className="w-3.5 h-3.5" /></button>}
              </div>
            )
          })}
          <button type="button" className="btn" disabled={rows.length >= 60} onClick={() => setRows([...rows, { date: '', kind: rows[rows.length - 1]?.kind ?? 'kerja' }])}><Plus className="w-3 h-3 inline mr-1" />Tambah tanggal</button>
        </div>
        <div className="border border-line rounded-lg p-3 space-y-2">
          <label className="flex gap-2 items-start cursor-pointer font-semibold"><input type="checkbox" className="mt-0.5" checked={compensate} onChange={(e) => { setCompensate(e.target.checked); setCompEdited(false) }} /><span>Kompensasi hari libur (opsional)</span></label>
          <p className="text-muted">{n > 0 && preview?.kind === 'off'
            ? `Hari kerja ekstra ${n} hari akan diganti ${n} hari libur setelahnya agar total siklus tetap ${roster ? (roster.work_units + roster.off_units) * (roster.unit === 'minggu' ? 7 : 1) : ''} hari. Tanggal pengganti dapat diubah.`
            : n > 0 ? `Hari libur ekstra ${n} hari akan diganti ${n} hari kerja setelahnya agar total siklus tetap utuh. Tanggal pengganti dapat diubah.`
            : 'Bila hari kerja ekstra ditambahkan (atau libur ekstra), hari pengganti dihitung otomatis agar total siklus tetap sama. Tanggal pengganti dapat diubah.'}</p>
          {compensate && n === 0 && filled.length > 0 && <p className="text-muted">Tidak ada perubahan total siklus pada tanggal di atas, tidak perlu hari pengganti.</p>}
          {compensate && n > 0 && (
            <div className="space-y-1.5">
              <div className="font-semibold">Tanggal pengganti ({n} hari {compKind === 'off' ? 'libur (OFF)' : 'kerja'})</div>
              {comp.map((c, i) => <div key={i} className="w-44"><DateField value={c} businessId={biz} onChange={(v) => { setComp(comp.map((x, j) => (j === i ? v : x))); setCompEdited(true) }} /></div>)}
            </div>
          )}
        </div>
        <label className="block font-semibold">Alasan<textarea className="input w-full mt-1" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. proyek belum selesai, pengganti rekan yang sakit" /></label>
        <label className="block font-semibold">Catatan <span className="font-normal text-muted">(opsional)</span><textarea className="input w-full mt-1" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="keterangan tambahan untuk approver" /></label>
        <div>
          <div className="font-semibold mb-1">Lampiran <span className="font-normal text-muted">(opsional)</span></div>
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-2 border border-line rounded-lg px-2 py-1 mb-1"><Paperclip className="w-3 h-3 text-muted" /><span className="flex-1 truncate">{f.name}</span><span className="text-muted">{Math.max(1, Math.round(f.size / 1024))} KB</span>
              <button type="button" className="p-0.5" onClick={() => setFiles(files.filter((_, j) => j !== i))}><X className="w-3.5 h-3.5" /></button></div>
          ))}
          <label className="btn inline-block cursor-pointer"><Plus className="w-3 h-3 inline mr-1" />Lampirkan file<input type="file" multiple className="hidden" accept="image/*,application/pdf" onChange={(e) => { onPick(e.target.files); e.target.value = '' }} /></label>
          <span className="text-muted ml-2">JPG/PNG/WEBP/PDF, maks 10 MB per file</span>
        </div>
        <ApprovalPreview chain={chain} />
        {error && <div className="text-danger bg-danger-soft rounded-lg px-3 py-2">{error}</div>}
        <div className="flex justify-end gap-2"><button className="btn" onClick={onClose}>Batal</button><button className="btn-primary" disabled={busy} onClick={submit}>{busy ? 'Mengirim…' : 'Ajukan'}</button></div>
      </div>
    </Modal>
  )
}

import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import Layout from '../components/Layout/Layout'
import Badge from '../components/ui/Badge'
import DataTable from '../components/ui/DataTable'
import DateField, { clearHolidayCache } from '../components/ui/DateField'
import Modal from '../components/ui/Modal'
import Tabs from '../components/ui/Tabs'
import { bizParams, useBusinessStore } from '../store/business'
import { cancelRosterAdjustment, createRosterAdjustment, getApprovers, getRosterAdjustments, createHoliday, deleteHoliday, deleteRoster, deleteWorkCalendar, getEmployees, getHolidays, getLocations, getRosters, getWorkCalendars, saveRoster, saveWorkCalendar, setRosterEmployees, updateHoliday } from '../services/api'
import { useAuthStore } from '../store/auth'
import type { Employee, Holiday, Location, Person, Roster, RosterAdjustment, WorkCalendar } from '../types'

type Tab = 'holidays' | 'calendar' | 'roster' | 'adjust'
const fmt = (d: string) => new Date(d).toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
const day = (d: string) => d.slice(0, 10)
const isWeekend = (d: string) => [0, 6].includes(new Date(day(d) + 'T00:00:00').getDay())

export default function Schedule() {
  const { businessId, businesses } = useBusinessStore()
  const [tab, setTab] = useState<Tab>('holidays')
  const [year, setYear] = useState(new Date().getFullYear())
  const [list, setList] = useState<Holiday[]>([])
  const [canManage, setCanManage] = useState(false)
  const [scope, setScope] = useState('')   // '' all | 'national' | business id
  const [kind, setKind] = useState('')     // '' all | 'free' | 'deduct'
  const [edit, setEdit] = useState<any>(null)
  const [error, setError] = useState('')

  const load = () => { clearHolidayCache(); return getHolidays({ ...bizParams(businessId), year }).then((r) => { setList(r.data.data); setCanManage(r.data.can_manage) }) }
  useEffect(() => { load() }, [businessId, year])

  const bizName = (id: number | null) => (id === null ? 'Nasional (semua bisnis)' : businesses.find((b) => b.id === id)?.name ?? '-')
  const rows = list.filter((h) => (scope === '' || (scope === 'national' ? h.business_id === null : h.business_id === Number(scope))) && (kind === '' || (kind === 'deduct') === h.deducts_leave))
  const counted = (h: Holiday) => !isWeekend(h.date)

  const openNew = () => { setError(''); setEdit({ date: '', end_date: '', name: '', business_id: null, deducts_leave: false }) } // default = nasional; choose a business for organisation-only holidays
  const openEdit = (h: Holiday) => { setError(''); setEdit({ id: h.id, date: day(h.date), name: h.name, business_id: h.business_id, deducts_leave: h.deducts_leave }) }
  const save = async () => {
    setError('')
    if (!edit.date) return setError('Tanggal wajib diisi')
    if (!edit.name.trim()) return setError('Nama hari libur wajib diisi')
    if (edit.end_date && edit.end_date < edit.date) return setError('Tanggal akhir tidak boleh sebelum tanggal mulai')
    const body = { date: `${edit.date}T00:00:00+07:00`, end_date: edit.end_date ? `${edit.end_date}T00:00:00+07:00` : null, name: edit.name, business_id: edit.business_id, deducts_leave: edit.deducts_leave }
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
    <Layout title="Setup Waktu Kerja" subtitle="Hari libur nasional / organisasi, kalender kerja, dan roster">
      <div className="card p-4">
        <Tabs tabs={[{ id: 'holidays', label: `Hari Libur (${list.length})` }, { id: 'calendar', label: 'Kalender Kerja' }, { id: 'roster', label: 'Roster' }, { id: 'adjust', label: 'Penyesuaian Roster' }]} value={tab} onChange={setTab} />

        {tab === 'holidays' && <>
          <div className="grid md:grid-cols-2 gap-3 mb-3 text-xs">
            <div className="rounded-lg border border-line p-3"><Badge tone="green">Libur biasa — tidak potong cuti</Badge><p className="text-muted mt-1.5">Hari libur nasional / kantor. Karyawan libur, saldo cuti tidak berkurang. Hari ini tidak dihitung bila jatuh di tengah pengajuan cuti.</p></div>
            <div className="rounded-lg border border-line p-3"><Badge tone="amber">Cuti bersama — potong cuti</Badge><p className="text-muted mt-1.5">Karyawan libur, tetapi <b>saldo cuti tahunan semua karyawan berkurang 1 hari</b> per hari kerja ({deductCount} hari di {year}). Tidak dihitung lagi pada pengajuan cuti agar tidak terpotong dua kali.</p></div>
          </div>
          <DataTable data={rows} rowKey={(h) => h.id} searchPlaceholder="Cari nama hari libur…" searchText={(h) => `${h.name} ${bizName(h.business_id)}`}
            filters={<>
              <select className="input" value={year} onChange={(e) => setYear(Number(e.target.value))}>{[year - 1, year, year + 1].filter((v, i, a) => a.indexOf(v) === i).map((y) => <option key={y}>{y}</option>)}</select>
              <select className="input" value={scope} onChange={(e) => setScope(e.target.value)}><option value="">Semua Cakupan</option><option value="national">Nasional</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
              <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Semua Jenis</option><option value="free">Tidak potong cuti</option><option value="deduct">Potong cuti</option></select>
            </>}
            actions={canManage ? <button className="btn-primary" onClick={openNew}><Plus className="w-3.5 h-3.5 inline mr-1" />Hari Libur</button> : undefined}
            empty="Belum ada hari libur untuk tahun ini"
            columns={[
              { head: 'Tanggal', render: (h) => <span>{fmt(h.date)}{isWeekend(h.date) && <span className="text-muted"> (akhir pekan)</span>}</span> },
              { head: 'Nama', render: (h) => <b>{h.name}</b> },
              { head: 'Cakupan', render: (h) => h.business_id === null ? <Badge tone="blue">Nasional</Badge> : <Badge tone="purple">{bizName(h.business_id)}</Badge> },
              { head: 'Jenis', render: (h) => h.deducts_leave ? <Badge tone="amber">Potong cuti</Badge> : <Badge tone="green">Tidak potong cuti</Badge> },
              { head: 'Aksi', render: (h) => canManage && <div className="flex gap-1.5"><button className="btn" onClick={() => openEdit(h)}>Edit</button><button className="btn text-brand" onClick={() => remove(h)}>Hapus</button></div> },
            ]} />
          {!canManage && <p className="text-[11px] text-muted mt-2">Hari libur hanya dapat diubah oleh Super Admin atau pejabat L1/L2.</p>}
        </>}

        {tab === 'calendar' && <Calendars />}
        {tab === 'roster' && <Rosters />}
        {tab === 'adjust' && <Adjustments />}
      </div>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Ubah Hari Libur' : 'Tambah Hari Libur'}>
        {edit && (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <label className="block font-semibold">{edit.id ? 'Tanggal' : 'Tanggal mulai'}<div className="mt-1 font-normal"><DateField value={edit.date} businessId={edit.business_id ?? 'national'} onChange={(v) => setEdit({ ...edit, date: v })} /></div></label>
              {!edit.id && <label className="block font-semibold">Sampai tanggal <span className="font-normal text-muted">(opsional)</span><div className="mt-1 font-normal"><DateField value={edit.end_date} min={edit.date} businessId={edit.business_id ?? 'national'} onChange={(v) => setEdit({ ...edit, end_date: v })} /></div></label>}
            </div>
            <label className="block font-semibold">Nama hari libur<input className="input w-full mt-1" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="mis. Hari Kemerdekaan RI, Cuti Bersama Idul Fitri" /></label>
            <label className="block font-semibold">Cakupan
              <select className="input w-full mt-1" value={edit.business_id ?? ''} onChange={(e) => setEdit({ ...edit, business_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Nasional — berlaku untuk semua bisnis</option>{businesses.map((b) => <option key={b.id} value={b.id}>Hanya {b.name}</option>)}
              </select></label>
            <div>
              <div className="font-semibold mb-1">Jenis</div>
              {[[false, 'Libur biasa — tidak potong cuti', 'Saldo cuti tidak berubah.'], [true, 'Cuti bersama — potong cuti', 'Mengurangi saldo cuti tahunan semua karyawan 1 hari per hari kerja.']].map(([v, t, d]) => (
                <label key={t as string} className={`flex gap-2 items-start border rounded-lg p-2 mb-1.5 cursor-pointer ${edit.deducts_leave === v ? 'border-brand bg-brand-soft' : 'border-line'}`}>
                  <input type="radio" className="mt-0.5" checked={edit.deducts_leave === v} onChange={() => setEdit({ ...edit, deducts_leave: v })} /><span><b>{t as string}</b><div className="text-muted">{d as string}</div></span>
                </label>
              ))}
            </div>
            {error && <div className="text-brand bg-brand-soft rounded-lg px-3 py-2">{error}</div>}
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
          { head: 'Aksi', render: (c) => can && <div className="flex gap-1.5"><button className="btn" onClick={() => { setError(''); setEdit({ ...c }) }}>Edit</button>{!c.is_default && <button className="btn text-brand" onClick={() => remove(c)}>Hapus</button>}</div> },
        ]} />
      <p className="text-[11px] text-muted mt-2">Karyawan tanpa kalender sendiri memakai kalender <b>Default</b> bisnisnya. Kalender dipilih per karyawan di form Karyawan; karyawan roster memakai jadwal roster.</p>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Ubah Kalender Kerja' : 'Tambah Kalender Kerja'}>
        {edit && (
          <div className="space-y-3 text-xs">
            <label className="block font-semibold">{locked || edit.id ? 'Bisnis (terkunci)' : 'Bisnis'}
              <select className="input w-full mt-1 disabled:bg-gray-100" disabled={locked || !!edit.id} value={edit.business_id || ''} onChange={(e) => setEdit({ ...edit, business_id: Number(e.target.value) })}><option value="">— Pilih bisnis —</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
            <label className="block font-semibold">Nama kalender<input className="input w-full mt-1" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="mis. Kantor Reguler, Toko 6 Hari" /></label>
            <div><div className="font-semibold mb-1">Hari kerja</div><div className="flex gap-1.5 flex-wrap">{DAYS.map(([n, l]) => <button type="button" key={n} onClick={() => toggleDay(n)} className={`px-3 py-1.5 rounded-lg border font-semibold ${edit.work_days.split(',').includes(n) ? 'bg-brand text-white border-brand' : 'border-line text-muted'}`}>{l}</button>)}</div></div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block font-semibold">Jam masuk<input className="input w-full mt-1" type="time" value={edit.start_time} onChange={(e) => setEdit({ ...edit, start_time: e.target.value })} /></label>
              <label className="block font-semibold">Jam pulang<input className="input w-full mt-1" type="time" value={edit.end_time} onChange={(e) => setEdit({ ...edit, end_time: e.target.value })} /></label>
              <label className="block font-semibold">Istirahat mulai<input className="input w-full mt-1" type="time" value={edit.break_start} onChange={(e) => setEdit({ ...edit, break_start: e.target.value })} /></label>
              <label className="block font-semibold">Istirahat selesai<input className="input w-full mt-1" type="time" value={edit.break_end} onChange={(e) => setEdit({ ...edit, break_end: e.target.value })} /></label>
            </div>
            <label className="block font-semibold">Toleransi keterlambatan (menit)<input className="input w-full mt-1" type="number" min={0} max={240} value={edit.tolerance_min} onChange={(e) => setEdit({ ...edit, tolerance_min: Number(e.target.value) })} /></label>
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={edit.require_gps} onChange={(e) => setEdit({ ...edit, require_gps: e.target.checked })} />Wajib GPS (absen hanya di radius lokasi kerja)</label>
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={edit.is_default} onChange={(e) => setEdit({ ...edit, is_default: e.target.checked })} />Jadikan kalender default bisnis ini</label>
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} />Aktif</label>
            {error && <div className="text-brand bg-brand-soft rounded-lg px-3 py-2">{error}</div>}
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
        {cells.map((d, i) => d ? <div key={i} className={`py-1 rounded ${working(r, d) ? 'bg-ok-soft text-ok font-bold' : 'bg-gray-100 text-muted'}`} title={d.toDateString()}>{d.getDate()}</div> : <div key={i} />)}
      </div>
      <div className="flex gap-3 mt-1 text-[10.5px] text-muted"><span><i className="inline-block w-2 h-2 rounded bg-ok mr-1" />Kerja</span><span><i className="inline-block w-2 h-2 rounded bg-gray-300 mr-1" />OFF</span></div>
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
  // Who can I schedule? Admin / HR / L1-L2: everyone in the business. A direct superior: only their direct reports.
  const openAssign = async (r: Roster) => {
    const res = await getEmployees({ business_id: r.business_id, status: 'Aktif', page_size: 1000 })
    const all = res.data.data ?? []
    const emps = can ? all : all.filter((e) => e.manager_id === user?.employee_id)
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
          { head: 'Aksi', render: (r) => (can || canAssign) && <div className="flex gap-1.5 whitespace-nowrap">{(can || canAssign) && <button className="btn" onClick={() => openAssign(r)}>Karyawan</button>}{can && <button className="btn" onClick={() => { setError(''); setEdit({ ...r, start_cycle: r.start_cycle.slice(0, 10) }) }}>Edit</button>}{can && <button className="btn text-brand" onClick={() => remove(r)}>Hapus</button>}</div> },
        ]} />
      <p className="text-[11px] text-muted mt-2">Roster menggantikan kalender kerja bagi anggotanya; satu karyawan hanya mengikuti satu roster. <b>Jadwal libur ditentukan per karyawan lewat start cycle-nya</b> sehingga kru bisa bergantian. Libur nasional tidak menghentikan roster, dan cuti bersama tidak memotong saldo anggota roster. Pergeseran jadwal diajukan di tab Penyesuaian Roster.</p>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Ubah Roster' : 'Tambah Roster'}>
        {edit && (
          <div className="space-y-3 text-xs">
            <label className="block font-semibold">{locked || edit.id ? 'Bisnis (terkunci)' : 'Bisnis'}
              <select className="input w-full mt-1 disabled:bg-gray-100" disabled={locked || !!edit.id} value={edit.business_id || ''} onChange={(e) => setEdit({ ...edit, business_id: Number(e.target.value), location_id: null })}><option value="">— Pilih bisnis —</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
            <label className="block font-semibold">Nama roster<input className="input w-full mt-1" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="mis. Site Banjarmasin 6:2" /></label>
            <div className="grid grid-cols-3 gap-3">
              <label className="block font-semibold">Kerja<input className="input w-full mt-1" type="number" min={1} max={60} value={edit.work_units} onChange={(e) => setEdit({ ...edit, work_units: Number(e.target.value) })} /></label>
              <label className="block font-semibold">Libur<input className="input w-full mt-1" type="number" min={0} max={60} value={edit.off_units} onChange={(e) => setEdit({ ...edit, off_units: Number(e.target.value) })} /></label>
              <label className="block font-semibold">Satuan<select className="input w-full mt-1" value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })}><option value="hari">hari</option><option value="minggu">minggu</option></select></label>
            </div>
            <label className="block font-semibold">Start cycle default <span className="font-normal text-muted">(usulan untuk anggota baru; tiap karyawan punya start cycle sendiri)</span><div className="mt-1 font-normal"><DateField value={edit.start_cycle} businessId={edit.business_id || 0} onChange={(v) => setEdit({ ...edit, start_cycle: v })} /></div></label>
            <label className="block font-semibold">Lokasi kerja<select className="input w-full mt-1" value={edit.location_id ?? ''} onChange={(e) => setEdit({ ...edit, location_id: e.target.value ? Number(e.target.value) : null })}><option value="">— Lokasi karyawan masing-masing —</option>{bizLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block font-semibold">Jam masuk<input className="input w-full mt-1" type="time" value={edit.start_time} onChange={(e) => setEdit({ ...edit, start_time: e.target.value })} /></label>
              <label className="block font-semibold">Jam pulang<input className="input w-full mt-1" type="time" value={edit.end_time} onChange={(e) => setEdit({ ...edit, end_time: e.target.value })} /></label>
              <label className="block font-semibold">Istirahat mulai<input className="input w-full mt-1" type="time" value={edit.break_start} onChange={(e) => setEdit({ ...edit, break_start: e.target.value })} /></label>
              <label className="block font-semibold">Istirahat selesai<input className="input w-full mt-1" type="time" value={edit.break_end} onChange={(e) => setEdit({ ...edit, break_end: e.target.value })} /></label>
            </div>
            <label className="block font-semibold">Toleransi keterlambatan (menit)<input className="input w-full mt-1" type="number" min={0} max={240} value={edit.tolerance_min} onChange={(e) => setEdit({ ...edit, tolerance_min: Number(e.target.value) })} /></label>
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={edit.require_gps} onChange={(e) => setEdit({ ...edit, require_gps: e.target.checked })} />Wajib GPS</label>
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} />Aktif</label>
            {edit.start_cycle && edit.work_units > 0 && <RosterPreview r={edit} />}
            {error && <div className="text-brand bg-brand-soft rounded-lg px-3 py-2">{error}</div>}
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
            {assignError && <div className="text-brand bg-brand-soft rounded-lg px-3 py-2">{assignError}</div>}
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

function Adjustments() {
  const { businessId } = useBusinessStore()
  const [list, setList] = useState<RosterAdjustment[]>([])
  const [form, setForm] = useState(false)
  const load = () => getRosterAdjustments().then((r) => setList(r.data))
  useEffect(() => { load() }, [businessId])
  return (
    <>
      <p className="text-xs text-muted mb-3">Menggeser jadwal seorang anggota roster pada rentang tanggal tertentu — mis. menunda libur karena proyek (jadikan <b>Kerja</b>) atau memajukan libur (jadikan <b>Libur</b>). Pengajuan disetujui atasan (n+1) atau approver yang ditugaskan; setelah disetujui jadwal otomatis berubah, pola dasar tetap.</p>
      <DataTable data={list} rowKey={(a) => a.id} searchPlaceholder="Cari karyawan, alasan…" searchText={(a) => `${a.employee_name} ${a.reason} ${a.status}`} empty="Belum ada pengajuan penyesuaian"
        actions={<button className="btn-primary" onClick={() => setForm(true)}><Plus className="w-3.5 h-3.5 inline mr-1" />Ajukan Penyesuaian</button>}
        columns={[
          { head: 'Karyawan', render: (a) => <div><b>{a.employee_name}</b><div className="text-muted text-[11px]">{a.unit_name}</div></div> },
          { head: 'Tanggal', render: (a) => (a.start_date.slice(0, 10) === a.end_date.slice(0, 10) ? fd(a.start_date) : `${fd(a.start_date)} – ${fd(a.end_date)}`) },
          { head: 'Menjadi', render: (a) => (a.kind === 'kerja' ? <Badge tone="green">Hari Kerja</Badge> : <Badge>Hari Libur</Badge>) },
          { head: 'Alasan', render: (a) => a.reason },
          { head: 'Status', render: (a) => <div><Badge tone={adjTone[a.status]}>{a.status === 'Pending Approval' ? 'Menunggu Persetujuan' : a.status}</Badge>{a.waiting_for && <div className="text-[10.5px] text-muted mt-0.5">oleh {a.waiting_for}</div>}</div> },
          { head: 'Aksi', render: (a) => a.can_cancel && <button className="btn text-brand" onClick={async () => { if (confirm('Batalkan pengajuan ini?')) { try { await cancelRosterAdjustment(a.id); load() } catch (e: any) { alert(err(e, 'Gagal membatalkan')) } } }}>Batalkan</button> },
        ]} />
      {form && <AdjustmentForm businessId={businessId} onClose={() => setForm(false)} onSaved={() => { setForm(false); load() }} />}
    </>
  )
}

function AdjustmentForm({ businessId, onClose, onSaved }: { businessId: number; onClose: () => void; onSaved: () => void }) {
  const user = useAuthStore((st) => st.user)
  const isSched = ['super_admin', 'hr_admin'].includes(user?.role ?? '') // L1/L2 are also allowed server-side; the server decides
  const [people, setPeople] = useState<Employee[]>([])
  const [rosters, setRosters] = useState<Roster[]>([])
  const [employeeId, setEmployeeId] = useState(0)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [kind, setKind] = useState<'kerja' | 'off'>('kerja')
  const [reason, setReason] = useState('')
  const [nplus, setNplus] = useState<Person[]>([])
  const [cands, setCands] = useState<Person[]>([])
  const [assigned, setAssigned] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([getRosters(bizParams(businessId)), getEmployees({ ...bizParams(businessId), status: 'Aktif', page_size: 1000 })]).then(([rr, er]) => {
      setRosters(rr.data.data)
      const members = new Set(rr.data.data.flatMap((r) => r.employee_ids ?? []))
      // roster members I may file for: myself, my direct reports; schedule managers: everyone
      setPeople((er.data.data ?? []).filter((e) => members.has(e.id) && (isSched || rr.data.can_manage || e.id === user?.employee_id || e.manager_id === user?.employee_id)))
    })
  }, [])
  useEffect(() => { if (employeeId) { setAssigned(0); getApprovers(employeeId).then((r) => { setNplus(r.data.nplus1); setCands(r.data.candidates) }) } }, [employeeId])
  const assignedPerson = cands.find((c) => c.user_id === assigned)
  const roster = rosters.find((r) => r.employee_ids?.includes(employeeId))
  const biz = people.find((p) => p.id === employeeId)?.business_id ?? 0

  const submit = async () => {
    setError('')
    if (!employeeId) return setError('Pilih karyawan')
    if (!start || !end) return setError('Isi tanggal mulai dan selesai')
    if (end < start) return setError('Tanggal selesai tidak boleh sebelum tanggal mulai')
    if (!reason.trim()) return setError('Alasan wajib diisi')
    setBusy(true)
    try { await createRosterAdjustment({ employee_id: employeeId, start_date: start, end_date: end, kind, reason, assigned_user_id: assigned || null }); onSaved() } catch (e: any) { setError(err(e, 'Gagal mengajukan')) } finally { setBusy(false) }
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
        <div className="grid grid-cols-2 gap-3">
          <label className="block font-semibold">Tanggal mulai<div className="mt-1 font-normal"><DateField value={start} businessId={biz} onChange={(v) => { setStart(v); if (!end || end < v) setEnd(v) }} /></div></label>
          <label className="block font-semibold">Tanggal selesai<div className="mt-1 font-normal"><DateField value={end} min={start} businessId={biz} onChange={setEnd} /></div></label>
        </div>
        <div>
          <div className="font-semibold mb-1">Pada tanggal tersebut karyawan menjadi</div>
          {([['kerja', 'Hari KERJA', 'mis. menunda libur karena proyek'], ['off', 'Hari LIBUR', 'mis. memajukan libur / tukar jadwal']] as const).map(([v, t, d]) => (
            <label key={v} className={`flex gap-2 items-start border rounded-lg p-2 mb-1.5 cursor-pointer ${kind === v ? 'border-brand bg-brand-soft' : 'border-line'}`}><input type="radio" className="mt-0.5" checked={kind === v} onChange={() => setKind(v)} /><span><b>{t}</b><div className="text-muted">{d}</div></span></label>
          ))}
        </div>
        <label className="block font-semibold">Alasan<textarea className="input w-full mt-1" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. proyek belum selesai, pengganti rekan yang sakit" /></label>
        <div className="border border-line rounded-lg p-3 bg-gray-50/60 space-y-2">
          <div className="font-bold">Persetujuan</div>
          {assigned ? <div className="text-ok bg-ok-soft rounded px-2 py-1.5">Hanya <b>{assignedPerson?.name}</b> yang menyetujui. Atasan (n+1) tidak diperlukan.</div> : <div>Atasan langsung (n+1): <b>{nplus.length ? nplus.map((p) => p.name).join(' → ') : '—'}</b></div>}
          <label className="block font-semibold">Tugaskan ke approver lain <span className="font-normal text-muted">(opsional)</span>
            <select className="input w-full mt-1" value={assigned} onChange={(e) => setAssigned(Number(e.target.value))}><option value={0}>— Tidak, gunakan atasan (n+1) —</option>{cands.map((c) => <option key={c.user_id} value={c.user_id}>{c.name} ({c.role})</option>)}</select></label>
        </div>
        {error && <div className="text-brand bg-brand-soft rounded-lg px-3 py-2">{error}</div>}
        <div className="flex justify-end gap-2"><button className="btn" onClick={onClose}>Batal</button><button className="btn-primary" disabled={busy} onClick={submit}>{busy ? 'Mengirim…' : 'Ajukan'}</button></div>
      </div>
    </Modal>
  )
}

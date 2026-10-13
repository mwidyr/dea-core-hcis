import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import Badge from './ui/Badge'
import DataTable from './ui/DataTable'
import { bizParams, useBusinessStore } from '../store/business'
import { getRosterSchedule } from '../services/api'
import type { RosterDayRow, RosterScheduleData } from '../types'

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const DOW = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']
const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const short = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })
const MAX_NAMES = 4 // names listed per calendar cell before "+N"

// Employees that follow a roster, with their roster dates: a list (windows of work / off) and a month calendar (names per date).
export default function RosterSchedule() {
  const { businessId } = useBusinessStore()
  const [month, setMonth] = useState(() => ym(new Date()))
  const [rosterId, setRosterId] = useState(0)
  const [locationId, setLocationId] = useState(0)
  const [view, setView] = useState<'list' | 'calendar'>('list')
  const [data, setData] = useState<RosterScheduleData | null>(null)
  const [error, setError] = useState('')
  const [pick, setPick] = useState<number | null>(null) // calendar day opened in the detail panel

  useEffect(() => {
    setError('')
    getRosterSchedule({ month, roster_id: rosterId || undefined, location_id: locationId || undefined, ...bizParams(businessId) })
      .then((r) => setData(r.data)).catch(() => setError('Gagal memuat jadwal roster'))
  }, [month, rosterId, locationId, businessId])
  useEffect(() => setPick(null), [month, rosterId, locationId, view])

  const [yy, mm] = month.split('-').map(Number)
  const step = (n: number) => setMonth(ym(new Date(yy, mm - 1 + n, 1)))
  const locations = useMemo(() => {
    const m = new Map<number, string>()
    data?.rosters.forEach((r) => { if (r.location_id) m.set(r.location_id, r.location_name) })
    return [...m.entries()]
  }, [data])

  const rows = data?.employees ?? []
  const first = new Date(yy, mm - 1, 1)
  const lead = (first.getDay() + 6) % 7
  const total = data?.days_in_month ?? new Date(yy, mm, 0).getDate()
  const todayKey = ym(new Date()) === month ? new Date().getDate() : 0
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)]
  while (cells.length % 7) cells.push(null)
  const onDay = (d: number) => rows.filter((r) => r.days[d - 1] === 'kerja')
  const offDay = (d: number) => rows.filter((r) => r.days[d - 1] !== 'kerja')

  const statusTone = { kerja: 'green', off: 'gray', libur: 'amber' } as const
  const statusText = { kerja: 'Kerja', off: 'OFF', libur: 'Libur' } as const

  return (
    <div className="text-xs">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex items-center gap-1">
          <button className="btn !px-2" onClick={() => step(-1)} aria-label="Bulan sebelumnya"><ChevronLeft className="w-3.5 h-3.5" /></button>
          <div className="w-36 text-center font-bold text-[13px]">{MONTHS[mm - 1]} {yy}</div>
          <button className="btn !px-2" onClick={() => step(1)} aria-label="Bulan berikutnya"><ChevronRight className="w-3.5 h-3.5" /></button>
          <button className="btn" onClick={() => setMonth(ym(new Date()))}>Bulan ini</button>
        </div>
        <select className="input" value={rosterId} onChange={(e) => setRosterId(Number(e.target.value))}><option value={0}>Semua Roster</option>{data?.rosters.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
        <select className="input" value={locationId} onChange={(e) => setLocationId(Number(e.target.value))}><option value={0}>Semua Lokasi</option>{locations.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
        <div className="ml-auto flex gap-1 p-1 rounded-lg bg-tint">
          {(['list', 'calendar'] as const).map((v) => <button key={v} onClick={() => setView(v)} className={`px-3 py-1 rounded-md font-semibold ${view === v ? 'bg-panel shadow-sm text-brand' : 'text-muted'}`}>{v === 'list' ? 'Daftar' : 'Kalender'}</button>)}
        </div>
      </div>
      {error && <div className="text-danger bg-danger-soft rounded-lg px-3 py-2 mb-3">{error}</div>}

      {view === 'list' && (
        <DataTable data={rows} rowKey={(r: RosterDayRow) => r.employee_id} searchPlaceholder="Cari karyawan, roster, lokasi…" empty="Tidak ada karyawan yang mengikuti roster"
          defaultSort={(a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' })}
          searchText={(r) => `${r.name} ${r.nik} ${r.roster_name} ${r.location_name} ${r.business_name}`}
          columns={[
            { head: 'Karyawan', sortValue: (r) => r.name, render: (r) => <div><b>{r.name}</b><div className="text-muted text-[11px]">{r.nik} · {r.business_name}</div></div> },
            { head: 'Roster', sortValue: (r) => r.roster_name, render: (r) => <div><b>{r.roster_name}</b><div className="text-muted text-[11px]">{r.pattern}</div></div> },
            { head: 'Lokasi', sortValue: (r) => r.location_name, render: (r) => r.location_name || '-' },
            { head: 'Start Cycle', sortValue: (r) => r.start_cycle, render: (r) => short(r.start_cycle) },
            { head: `Jadwal ${MONTHS[mm - 1]}`, render: (r) => (
              <div className="flex flex-wrap gap-1 min-w-[220px]">
                {r.windows.map((w, i) => (
                  <span key={i} className={`px-1.5 py-0.5 rounded-md text-[10.5px] font-semibold whitespace-nowrap ${w.status === 'kerja' ? 'bg-ok-soft text-ok' : w.status === 'off' ? 'bg-tint text-muted' : 'bg-warn-soft text-warn'}`}>
                    {statusText[w.status]} {w.from === w.to ? short(w.from) : `${short(w.from)} – ${short(w.to)}`}
                  </span>
                ))}
              </div>) },
            { head: 'OFF (hari)', sortValue: (r) => r.days.filter((d) => d !== 'kerja').length, render: (r) => r.days.filter((d) => d !== 'kerja').length },
          ]} />
      )}

      {view === 'calendar' && (
        <div className="grid lg:grid-cols-[1fr_280px] gap-3 items-start">
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="grid grid-cols-7 gap-px bg-line border border-line rounded-t-lg overflow-hidden text-center text-[10px] font-bold text-muted">
                {DOW.map((d, i) => <div key={d} className={`bg-sunken py-1.5 ${i >= 5 ? 'text-danger/70' : ''}`}>{d}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-px bg-line border border-t-0 border-line rounded-b-lg overflow-hidden">
                {cells.map((d, i) => {
                  if (!d) return <div key={i} className="bg-sunken/60 min-h-[92px]" />
                  const on = onDay(d)
                  const off = offDay(d)
                  const shown = on.slice(0, MAX_NAMES)
                  return (
                    <button key={i} onClick={() => setPick(d)} className={`bg-panel min-h-[92px] p-1 text-left align-top hover:bg-sunken ${pick === d ? 'ring-2 ring-inset ring-brand' : ''}`}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className={`text-[10.5px] font-bold ${d === todayKey ? 'bg-brand text-on-brand rounded-full w-5 h-5 grid place-items-center' : (i % 7 >= 5 ? 'text-danger/70' : 'text-muted')}`}>{d}</span>
                        {off.length > 0 && <span className="text-[9px] font-bold text-muted">OFF {off.length}</span>}
                      </div>
                      {shown.map((r) => <div key={r.employee_id} className={`truncate text-[10px] leading-4 px-1 rounded ${r.adjusted.includes(d) ? 'bg-info-soft text-info' : 'bg-ok-soft text-ok'}`}>{r.name.split(' ')[0]}</div>)}
                      {on.length > MAX_NAMES && <div className="text-[9.5px] text-muted px-1">+{on.length - MAX_NAMES} lainnya</div>}
                    </button>
                  )
                })}
              </div>
              <div className="flex flex-wrap gap-3 mt-2 text-[10.5px] text-muted">
                <span><i className="inline-block w-2.5 h-2.5 rounded bg-ok-soft border border-ok/40 mr-1 align-middle" />Nama = jadwal kerja roster pada tanggal itu</span>
                <span><i className="inline-block w-2.5 h-2.5 rounded bg-info-soft border border-info/40 mr-1 align-middle" />Disesuaikan (Penyesuaian Roster)</span>
                <span>OFF n = jumlah karyawan roster yang libur</span>
              </div>
            </div>
          </div>
          <div className="border border-line rounded-lg p-3 lg:sticky lg:top-20">
            {pick ? (
              <>
                <div className="font-bold mb-2">{pick} {MONTHS[mm - 1]} {yy}</div>
                <div className="text-[10.5px] font-bold text-muted mb-1">KERJA ({onDay(pick).length})</div>
                <div className="space-y-1 mb-3">{onDay(pick).map((r) => <div key={r.employee_id} className="flex items-center justify-between gap-2"><span className="truncate">{r.name}</span><Badge tone="green">{r.roster_name}</Badge></div>)}{!onDay(pick).length && <div className="text-muted">Tidak ada</div>}</div>
                <div className="text-[10.5px] font-bold text-muted mb-1">OFF / LIBUR ({offDay(pick).length})</div>
                <div className="space-y-1">{offDay(pick).map((r) => <div key={r.employee_id} className="flex items-center justify-between gap-2"><span className="truncate">{r.name}</span><Badge tone={statusTone[r.days[pick - 1]]}>{statusText[r.days[pick - 1]]}</Badge></div>)}{!offDay(pick).length && <div className="text-muted">Tidak ada</div>}</div>
              </>
            ) : <div className="text-muted">Pilih tanggal pada kalender untuk melihat siapa yang kerja dan siapa yang OFF.</div>}
          </div>
        </div>
      )}
    </div>
  )
}

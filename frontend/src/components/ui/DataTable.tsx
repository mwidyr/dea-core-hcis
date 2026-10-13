import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react'
import Pagination, { rowsPerPage } from './Pagination'

export interface Column<T> {
  head: string; render: (row: T) => ReactNode; className?: string
  /** makes the header clickable (asc → desc → default order); empty values (null/undefined/'') always sort last */
  sortValue?: (row: T) => string | number | null | undefined
}
type Sort = { col: string; dir: 'asc' | 'desc' } | null

const isEmpty = (v: unknown) => v === null || v === undefined || v === ''
const cmp = (a: string | number, b: string | number) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'id', { sensitivity: 'base', numeric: true }))

interface Props<T> {
  columns: Column<T>[]
  data: T[]
  /** text the search box matches against (all searchable fields joined) */
  searchText: (row: T) => string
  searchPlaceholder?: string
  /** extra filter controls rendered next to the search box */
  filters?: ReactNode
  /** buttons shown at the right end of the toolbar (e.g. “+ Tambah”) */
  actions?: ReactNode
  rowKey: (row: T) => string | number
  empty?: string
  /** order used while no header is selected (default: the order of `data`); give it the name column to get A–Z */
  defaultSort?: (a: T, b: T) => number
}

// Client-side table: search + sortable headers + page size (10 / 20 / custom / semua) + first/prev/next/last.
export default function DataTable<T>({ columns, data, searchText, searchPlaceholder = 'Cari…', filters, actions, rowKey, empty = 'Belum ada data', defaultSort }: Props<T>) {
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [sort, setSort] = useState<Sort>(null)

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? data.filter((r) => searchText(r).toLowerCase().includes(s)) : data
  }, [data, q])

  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.head === sort.col)
    if (!col?.sortValue || !sort) return defaultSort ? [...filtered].sort(defaultSort) : filtered
    const val = col.sortValue, sign = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const x = val(a), y = val(b)
      if (isEmpty(x) || isEmpty(y)) return isEmpty(x) && isEmpty(y) ? 0 : isEmpty(x) ? 1 : -1 // empties last, either direction
      return sign * cmp(x as string | number, y as string | number)
    })
  }, [filtered, sort, columns, defaultSort])
  const toggleSort = (head: string) => setSort((s) => (s?.col !== head ? { col: head, dir: 'asc' } : s.dir === 'asc' ? { col: head, dir: 'desc' } : null))

  const per = rowsPerPage(pageSize, sorted.length)
  const last = Math.max(1, Math.ceil(sorted.length / per))
  useEffect(() => { if (page > last) setPage(last) }, [page, last])
  useEffect(() => setPage(1), [q, pageSize, sort])

  const rows = sorted.slice((page - 1) * per, page * per)

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input !pl-8 w-64" placeholder={searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {filters}
        {actions && <div className="ml-auto flex gap-2">{actions}</div>}
      </div>
      <div className="border border-line rounded-lg overflow-auto">
        <table className="w-full">
          <thead><tr>{columns.map((c) => {
            if (!c.sortValue) return <th key={c.head} className="th">{c.head}</th>
            const on = sort?.col === c.head
            return (
              <th key={c.head} className="th" aria-sort={on ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button type="button" className="inline-flex items-center gap-1 font-[inherit] uppercase tracking-[inherit] hover:text-brand" onClick={() => toggleSort(c.head)} title="Urutkan">
                  {c.head}{on ? (sort!.dir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                </button>
              </th>
            )
          })}</tr></thead>
          <tbody>
            {rows.map((r) => <tr key={rowKey(r)}>{columns.map((c) => <td key={c.head} className={`td ${c.className ?? ''}`}>{c.render(r)}</td>)}</tr>)}
            {!rows.length && <tr><td className="td text-center text-muted" colSpan={columns.length}>{q ? 'Tidak ada hasil pencarian' : empty}</td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={pageSize} total={sorted.length} onPage={setPage} onPageSize={setPageSize} />
    </div>
  )
}

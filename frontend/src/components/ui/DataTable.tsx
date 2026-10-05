import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import Pagination from './Pagination'

export interface Column<T> { head: string; render: (row: T) => ReactNode; className?: string }

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
}

// Client-side table: search + page size (10 / 20 / custom) + first/prev/next/last.
export default function DataTable<T>({ columns, data, searchText, searchPlaceholder = 'Cari…', filters, actions, rowKey, empty = 'Belum ada data' }: Props<T>) {
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? data.filter((r) => searchText(r).toLowerCase().includes(s)) : data
  }, [data, q])

  const last = Math.max(1, Math.ceil(filtered.length / pageSize))
  useEffect(() => { if (page > last) setPage(last) }, [page, last])
  useEffect(() => setPage(1), [q, pageSize])

  const rows = filtered.slice((page - 1) * pageSize, page * pageSize)

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
          <thead><tr>{columns.map((c) => <th key={c.head} className="th">{c.head}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => <tr key={rowKey(r)}>{columns.map((c) => <td key={c.head} className={`td ${c.className ?? ''}`}>{c.render(r)}</td>)}</tr>)}
            {!rows.length && <tr><td className="td text-center text-muted" colSpan={columns.length}>{q ? 'Tidak ada hasil pencarian' : empty}</td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={pageSize} total={filtered.length} onPage={setPage} onPageSize={setPageSize} />
    </div>
  )
}

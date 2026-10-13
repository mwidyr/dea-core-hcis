// Small formatting helpers shared by the employee pages.
export const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '-')
export const fmtLong = (d?: string | null) => (d ? new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '-')
/** "2020-06-01T07:00:00+07:00" → "2020-06-01" (value of an <input type=date>) */
export const day = (d?: string | null) => (d ? d.slice(0, 10) : '')
/** date input value → what the Go backend parses into time.Time */
export const iso = (d?: string | null) => (d ? `${d}T00:00:00+07:00` : null)
export const tenure = (d?: string | null) => {
  if (!d) return '-'
  const m = Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / (30.44 * 864e5)))
  return `${Math.floor(m / 12)} th ${m % 12} bln`
}
export const daysLeft = (d?: string | null) => (d ? Math.ceil((new Date(d).getTime() - Date.now()) / 864e5) : null)
export const errMsg = (e: any, fallback: string) => e?.response?.data?.error || fallback

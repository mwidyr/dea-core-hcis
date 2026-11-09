import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// One place that builds the PDFs (reports, dashboard): CORE navy header, summary lines, any number of tables, footer on every page.
const NAVY: [number, number, number] = [23, 50, 77]

export interface PdfTable { title?: string; columns: string[]; rows: (string | number | null | undefined)[][]; empty?: string }

export interface PdfOptions {
  title: string
  subtitle?: string
  summary?: [string, string | number][]
  tables: PdfTable[]
  filename: string
  orientation?: 'portrait' | 'landscape'
}

export function exportPdf(o: PdfOptions) {
  const wide = o.orientation ?? (o.tables.some((t) => t.columns.length > 7) ? 'landscape' : 'portrait')
  const doc = new jsPDF({ orientation: wide, unit: 'pt', format: 'a4' })
  const footer = () => {
    doc.setFontSize(8); doc.setTextColor(140)
    doc.text(`Dicetak ${new Date().toLocaleString('id-ID')} · CORE HCIS`, 40, doc.internal.pageSize.getHeight() - 20)
  }
  doc.setFontSize(14); doc.setTextColor(23, 50, 77); doc.text(o.title, 40, 40)
  let y = 40
  if (o.subtitle) { doc.setFontSize(9); doc.setTextColor(110); doc.text(o.subtitle, 40, (y += 16)) }
  doc.setFontSize(9); doc.setTextColor(60)
  ;(o.summary ?? []).forEach(([k, v]) => doc.text(`${k}: ${v}`, 40, (y += 12)))
  y += 12
  o.tables.forEach((t) => {
    if (t.title) {
      if (y > doc.internal.pageSize.getHeight() - 90) { doc.addPage(); y = 40 }
      doc.setFontSize(11); doc.setTextColor(23, 50, 77); doc.text(t.title, 40, y + 4); y += 10
    }
    autoTable(doc, {
      startY: y, head: [t.columns], body: t.rows.length ? t.rows.map((r) => r.map((c) => String(c ?? ''))) : [[{ content: t.empty ?? 'Tidak ada data', colSpan: t.columns.length, styles: { halign: 'center', textColor: 140 } } as never]],
      styles: { fontSize: 7.5, cellPadding: 3 }, headStyles: { fillColor: NAVY }, margin: { left: 40, right: 40 }, didDrawPage: footer,
    })
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 22
  })
  if (!o.tables.length) footer()
  doc.save(o.filename)
}

export interface ApprovalSlip {
  title: string                                  // e.g. "Formulir Persetujuan Cuti & Izin"
  requester: { name: string; nik?: string; position?: string; unit?: string }
  details: [string, string][]                    // Jenis, Periode, Durasi, Alasan, ...
  status: string
  steps: { level: number; approver: string; kind: string; status: string; at?: string; note?: string }[]
  filename: string
}

const fmtDt = (d?: string) => (d ? new Date(d).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

// One-page approval slip: requester (incl. NIK and position), what was asked, final status, the approval steps and a signature column per party.
export function exportApprovalSlip(o: ApprovalSlip) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight()
  doc.setFillColor(...NAVY); doc.rect(0, 0, W, 54, 'F')
  doc.setTextColor(255); doc.setFontSize(15); doc.text(o.title, 40, 34)
  doc.setFontSize(8); doc.text('CORE HCIS', W - 40, 34, { align: 'right' })

  const kv: [string, string][] = [
    ['Nama Pemohon', o.requester.name], ['NIK', o.requester.nik || '-'], ['Jabatan', o.requester.position || '-'],
    ...(o.requester.unit ? [['Unit', o.requester.unit] as [string, string]] : []),
    ...o.details, ['Status', o.status],
  ]
  autoTable(doc, {
    startY: 72, body: kv, theme: 'plain', styles: { fontSize: 9, cellPadding: 3 }, margin: { left: 40, right: 40 },
    columnStyles: { 0: { fontStyle: 'bold', textColor: [90, 90, 90], cellWidth: 110 } },
  })
  let y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 200) + 18
  doc.setFontSize(11); doc.setTextColor(...NAVY); doc.text('Langkah Persetujuan', 40, y)
  autoTable(doc, {
    startY: y + 6, head: [['Level', 'Approver', 'Jenis', 'Status', 'Waktu', 'Catatan']],
    body: o.steps.length ? o.steps.map((s) => [String(s.level), s.approver, s.kind, s.status, fmtDt(s.at), s.note ?? '']) : [[{ content: 'Belum ada langkah persetujuan', colSpan: 6, styles: { halign: 'center', textColor: 140 } } as never]],
    styles: { fontSize: 8.5, cellPadding: 3 }, headStyles: { fillColor: NAVY }, margin: { left: 40, right: 40 },
  })
  y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 30

  // signature column per party: the requester first, then each approver in order
  const parties = [{ role: 'Pemohon', name: o.requester.name, sub: '' }, ...o.steps.map((s) => ({ role: `Approver ${s.level}`, name: s.approver, sub: s.status === 'Disetujui' || s.status === 'Ditolak' ? `${s.status}${s.at ? ' ' + fmtDt(s.at) : ''}` : '' }))]
  const perRow = 4, colW = (W - 80) / perRow
  if (y + Math.ceil(parties.length / perRow) * 110 > H - 40) { doc.addPage(); y = 60 } // keep the signature block together
  parties.forEach((p, i) => {
    const row = Math.floor(i / perRow), x = 40 + (i % perRow) * colW
    const top = y + row * 110
    doc.setFontSize(8.5); doc.setTextColor(90); doc.text(p.role, x + colW / 2, top, { align: 'center' })
    doc.setDrawColor(150); doc.line(x + 12, top + 70, x + colW - 12, top + 70)
    doc.setTextColor(30); doc.text(p.name, x + colW / 2, top + 83, { align: 'center', maxWidth: colW - 16 })
    if (p.sub) { doc.setFontSize(7); doc.setTextColor(120); doc.text(p.sub, x + colW / 2, top + 94, { align: 'center', maxWidth: colW - 16 }) }
  })
  doc.setFontSize(8); doc.setTextColor(140)
  doc.text(`Dicetak ${new Date().toLocaleString('id-ID')} · CORE HCIS`, 40, H - 20)
  doc.save(o.filename)
}

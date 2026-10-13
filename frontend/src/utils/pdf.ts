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

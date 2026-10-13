import { useEffect, useState } from 'react'
import FileThumbs from '../ui/FileThumbs'
import { fetchEmployeeDocumentBlob, getEmployeeDocuments } from '../../services/api'
import type { EmployeeDocument } from '../../types'

// Thumbnails of an employee's uploaded documents. Pass `docs` to control the list from outside, else it loads its own.
export default function DocGallery({ empId, docs, onDelete, labelOf }: {
  empId: number; docs?: EmployeeDocument[]; onDelete?: (d: EmployeeDocument) => void; labelOf?: (d: EmployeeDocument) => string
}) {
  const [own, setOwn] = useState<EmployeeDocument[]>([])
  useEffect(() => { if (!docs) getEmployeeDocuments(empId).then((r) => setOwn(r.data)) }, [empId, docs])
  const list = docs ?? own
  const items = labelOf ? list.map((d) => ({ ...d, label: labelOf(d) })) : list
  return <FileThumbs items={items} fetchBlob={(id) => fetchEmployeeDocumentBlob(empId, id).then((r) => r.data)} empty="Belum ada foto/dokumen." onDelete={onDelete ? (f) => onDelete(list.find((d) => d.id === f.id)!) : undefined} />
}

import { useEffect, useRef, useState } from 'react'
import { Cloud, CloudAlert, CloudUpload, FileText, Trash2 } from 'lucide-react'
import type { FileItem } from '../../types'

const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

// Thumbnails for uploaded files. Files need the auth header, so each is fetched as a blob.
export default function FileThumbs({ items, fetchBlob, onDelete, empty = 'Belum ada file.' }: {
  items: FileItem[]; fetchBlob: (id: number) => Promise<Blob>; onDelete?: (f: FileItem) => void; empty?: string
}) {
  if (!items.length) return <p className="text-xs text-muted">{empty}</p>
  return <div className="grid grid-cols-3 gap-2">{items.map((f) => <Thumb key={f.id} file={f} fetchBlob={fetchBlob} onDelete={onDelete} />)}</div>
}

function Thumb({ file, fetchBlob, onDelete }: { file: FileItem; fetchBlob: (id: number) => Promise<Blob>; onDelete?: (f: FileItem) => void }) {
  const [url, setUrl] = useState('')
  const ref = useRef('')
  useEffect(() => {
    let alive = true
    fetchBlob(file.id).then((b) => { if (alive) { ref.current = URL.createObjectURL(b); setUrl(ref.current) } }).catch(() => {})
    return () => { alive = false; if (ref.current) URL.revokeObjectURL(ref.current) }
  }, [file.id])
  const isImg = file.mime_type.startsWith('image/')
  return (
    <div className="border border-line rounded-lg overflow-hidden bg-white relative group">
      <a href={url || undefined} target="_blank" rel="noreferrer" className="block h-24 bg-gray-50 grid place-items-center">
        {isImg && url ? <img src={url} alt={file.label} className="w-full h-full object-cover" /> : <FileText className="w-7 h-7 text-muted" />}
      </a>
      <div className="px-2 py-1.5">
        <div className="text-[11px] font-bold truncate" title={file.label}>{file.label}</div>
        <div className="text-[10px] text-muted truncate">{file.file_name} · {kb(file.size)}</div>
        {file.drive_status && <div className={`text-[10px] flex items-center gap-1 mt-0.5 ${file.drive_status === 'synced' ? 'text-ok' : file.drive_status === 'failed' ? 'text-brand' : 'text-muted'}`} title={file.drive_error || ''}>
          {file.drive_status === 'synced' ? <Cloud className="w-3 h-3" /> : file.drive_status === 'failed' ? <CloudAlert className="w-3 h-3" /> : <CloudUpload className="w-3 h-3" />}
          {file.drive_status === 'synced' ? 'Tersimpan di Drive' : file.drive_status === 'failed' ? 'Gagal ke Drive' : 'Menunggu ke Drive'}</div>}
      </div>
      {onDelete && <button className="absolute top-1 right-1 bg-white/90 border border-line rounded p-1 text-brand opacity-0 group-hover:opacity-100" title="Hapus" onClick={() => onDelete(file)}><Trash2 className="w-3 h-3" /></button>}
    </div>
  )
}

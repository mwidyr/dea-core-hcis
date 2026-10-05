import { type ReactNode, useEffect, useRef } from 'react'
import { X } from 'lucide-react'

// Escape closes only the top-most open modal (dialogs can be stacked, e.g. a confirm dialog over a detail dialog).
const stack: symbol[] = []

export default function Modal({ open, onClose, title, children, size = 'md' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; size?: 'md' | 'lg' | 'xl' }) {
  const id = useRef(Symbol('modal'))
  const closeRef = useRef(onClose) // keep the stack order stable: re-registering on every render would move a lower modal to the top
  closeRef.current = onClose
  useEffect(() => {
    if (!open) return
    const me = id.current
    stack.push(me)
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && stack[stack.length - 1] === me) closeRef.current() }
    document.addEventListener('keydown', h)
    return () => { document.removeEventListener('keydown', h); const i = stack.indexOf(me); if (i >= 0) stack.splice(i, 1) }
  }, [open])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={`relative bg-white rounded-2xl shadow-2xl w-full ${{ md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size]} max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-line">
          <h2 className="text-sm font-bold">{title}</h2>
          <button onClick={onClose} className="p-1 text-muted hover:bg-gray-100 rounded-lg"><X className="w-4 h-4" /></button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}

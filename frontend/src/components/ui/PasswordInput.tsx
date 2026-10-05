import { useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'

// Password field with a show/hide (eye) toggle. Use this for every password input.
export default function PasswordInput({ className = '', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input {...props} type={show ? 'text' : 'password'} className={`input w-full pr-9 ${className}`} />
      <button type="button" tabIndex={-1} onClick={() => setShow((s) => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-gray-700"
        title={show ? 'Sembunyikan password' : 'Tampilkan password'} aria-label={show ? 'Sembunyikan password' : 'Tampilkan password'}>
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  )
}

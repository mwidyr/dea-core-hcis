import { create } from 'zustand'
import type { User } from '../types'

interface AuthState {
  user: User | null
  token: string | null
  setAuth: (user: User, token: string) => void
  logout: () => void
  can: (perm: string) => boolean
}

const savedUser = localStorage.getItem('user')

export const useAuthStore = create<AuthState>((set, get) => ({
  can: (perm) => get().user?.role === 'super_admin' || !!get().user?.permissions?.includes(perm),
  user: savedUser ? JSON.parse(savedUser) : null,
  token: localStorage.getItem('token'),
  setAuth: (user, token) => {
    localStorage.setItem('user', JSON.stringify(user))
    localStorage.setItem('token', token)
    set({ user, token })
  },
  logout: () => {
    localStorage.removeItem('user')
    localStorage.removeItem('token')
    localStorage.removeItem('business_id')
    set({ user: null, token: null })
  },
}))

import { create } from 'zustand'
import { getBusinesses } from '../services/api'
import type { Business } from '../types'

// Global business context ("Semua Bisnis" = 0). Every list page reads businessId and
// sends it as ?business_id=; the backend re-checks it against the user's permitted businesses.
interface BusinessState {
  businessId: number
  setBusinessId: (id: number) => void
  businesses: Business[]
  /** reload the permitted business list (call after adding/renaming/deleting one) */
  refresh: () => Promise<void>
}

export const useBusinessStore = create<BusinessState>((set, get) => ({
  businessId: Number(localStorage.getItem('business_id') || 0),
  setBusinessId: (id) => {
    localStorage.setItem('business_id', String(id))
    set({ businessId: id })
  },
  businesses: [],
  refresh: async () => {
    const { data } = await getBusinesses()
    set({ businesses: data })
    const { businessId, setBusinessId } = get()
    // selected business no longer exists / not permitted → fall back
    if (businessId !== 0 && !data.some((b) => b.id === businessId)) setBusinessId(0)
    if (businessId === 0 && data.length === 1) setBusinessId(data[0].id)
  },
}))

export const bizParams = (businessId: number) => (businessId ? { business_id: businessId } : {})

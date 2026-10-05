import Layout from '../components/Layout/Layout'
import { navGroups } from '../components/Layout/nav'
import { useLocation } from 'react-router-dom'

// Stub for modules scheduled in later phases (see docs/development-plan.md).
export default function Placeholder() {
  const { pathname } = useLocation()
  const item = navGroups.flatMap((g) => g.items).find((i) => i.to === pathname)
  return (
    <Layout title={item?.label ?? 'Halaman'} subtitle="Modul belum tersedia">
      <div className="card p-8 text-center text-sm text-muted">
        Modul <b className="text-gray-800">{item?.label}</b> dijadwalkan pada <b>Phase {item?.phase}</b>.
      </div>
    </Layout>
  )
}

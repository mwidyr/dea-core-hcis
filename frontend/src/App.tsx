import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useAuthStore } from './store/auth'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Org from './pages/Org'
import Employees from './pages/Employees'
import Placeholder from './pages/Placeholder'
import Leave from './pages/Leave'
import Approvals from './pages/Approvals'
import Settings from './pages/Settings'
import Contracts from './pages/Contracts'
import Schedule from './pages/Schedule'
import Absen from './pages/Absen'
import Attendance from './pages/Attendance'
import Tasks from './pages/Tasks'
import Projects from './pages/Projects'
import ProjectDetail from './pages/ProjectDetail'
import Kpi from './pages/Kpi'
import Reports from './pages/Reports'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token)
  return token ? <>{children}</> : <Navigate to="/login" replace />
}

const later: string[] = []

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/absen" element={<Absen />} />
        <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
        <Route path="/org" element={<PrivateRoute><Org /></PrivateRoute>} />
        <Route path="/employees" element={<PrivateRoute><Employees /></PrivateRoute>} />
        <Route path="/attendance" element={<PrivateRoute><Attendance /></PrivateRoute>} />
        <Route path="/tasks" element={<PrivateRoute><Tasks /></PrivateRoute>} />
        <Route path="/projects" element={<PrivateRoute><Projects /></PrivateRoute>} />
        <Route path="/projects/:id" element={<PrivateRoute><ProjectDetail /></PrivateRoute>} />
        <Route path="/reports" element={<PrivateRoute><Reports /></PrivateRoute>} />
        <Route path="/kpi" element={<PrivateRoute><Kpi /></PrivateRoute>} />
        <Route path="/leave" element={<PrivateRoute><Leave /></PrivateRoute>} />
        <Route path="/approval" element={<PrivateRoute><Approvals mode="inbox" /></PrivateRoute>} />
        <Route path="/approval-history" element={<PrivateRoute><Approvals mode="history" /></PrivateRoute>} />
        <Route path="/settings" element={<PrivateRoute><Settings /></PrivateRoute>} />
        <Route path="/schedule" element={<PrivateRoute><Schedule /></PrivateRoute>} />
        <Route path="/contracts" element={<PrivateRoute><Contracts /></PrivateRoute>} />
        {later.map((p) => <Route key={p} path={p} element={<PrivateRoute><Placeholder /></PrivateRoute>} />)}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

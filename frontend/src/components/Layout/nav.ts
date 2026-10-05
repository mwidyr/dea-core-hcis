import { LayoutDashboard, Building2, Users, Clock, CalendarOff, ListChecks, FolderKanban, CheckSquare, FileBarChart, Settings, FileText, Target, Inbox, CalendarCog, type LucideIcon } from 'lucide-react'

export interface NavItem { to: string; label: string; icon: LucideIcon; phase: number; perm?: string }
export interface NavGroup { title: string; items: NavItem[] }

// Mirrors the prototype's sidebar groups. `phase` = development phase in docs/development-plan.md.
export const navGroups: NavGroup[] = [
  { title: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, phase: 7 }] },
  { title: 'Organisasi', items: [
    { to: '/org', label: 'Setup Organisasi', icon: Building2, phase: 1 },
    { to: '/employees', label: 'Karyawan', icon: Users, phase: 2 },
    { to: '/contracts', label: 'Kontrak & Dokumen', icon: FileText, phase: 2 },
  ] },
  { title: 'Kehadiran', items: [
    { to: '/attendance', label: 'Absensi', icon: Clock, phase: 3 },
    { to: '/leave', label: 'Cuti & Izin', icon: CalendarOff, phase: 3 },
    { to: '/schedule', label: 'Setup Waktu Kerja', icon: CalendarCog, phase: 3 },
  ] },
  { title: 'Pekerjaan', items: [
    { to: '/tasks', label: 'Tugas', icon: ListChecks, phase: 5 },
    { to: '/projects', label: 'Proyek', icon: FolderKanban, phase: 5 },
    { to: '/kpi', label: 'KPI & Scorecard', icon: Target, phase: 6 },
  ] },
  { title: 'Kontrol', items: [
    { to: '/approval', label: 'Approval Saya', icon: CheckSquare, phase: 4 },
    { to: '/approval-history', label: 'Riwayat Approval', icon: Inbox, phase: 4 },
    { to: '/reports', label: 'Laporan', icon: FileBarChart, phase: 7, perm: 'reports.view' },
  ] },
  { title: 'Pengaturan', items: [{ to: '/settings', label: 'User, Workflow & Master', icon: Settings, phase: 1 }] },
]

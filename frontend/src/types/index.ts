export interface Business { id: number; code: string; name: string }
export interface User {
  id: number; email: string; name: string
  role: 'super_admin' | 'hr_admin' | 'manager' | 'employee'
  employee_id: number | null
  businesses: Business[]
  permissions?: string[]
}
export interface OrgUnit { id: number; business_id: number; level: number; type_name: string; name: string; parent_id: number | null; is_active: boolean; parent?: OrgUnit }
export interface Position { id: number; business_id: number; title: string; unit_id: number | null; level_class: string; reports_to_id: number | null; unit?: OrgUnit; holder?: string }
export interface Location { id: number; business_id: number; name: string; type_name: string; city: string; latitude: number | null; longitude: number | null; radius_m: number; is_active: boolean }
export interface Placement { id: number; is_primary: boolean; position?: Position; business?: Business }
export interface Employee {
  id: number; business_id: number; name: string; email: string; nik?: string; work_calendar_id?: number | null
  position_id: number | null; unit_id: number | null; manager_id: number | null
  phone?: string; birth_place?: string; birth_date?: string | null
  employee_type: string; contract_start?: string | null; contract_end: string | null; join_date: string | null
  status: 'Aktif' | 'Suspend' | 'Tidak Bekerja'; status_note?: string; is_active: boolean; location_id?: number | null
  position?: Position; unit?: OrgUnit; location?: Location; business?: Business; placements?: Placement[]
}
export interface EmployeeDocument { id: number; employee_id: number; label: string; file_name: string; mime_type: string; size: number; drive_status: string; created_at: string }

export interface LeaveType { id: number; name: string; category: 'cuti' | 'izin' | 'sakit'; default_days: number; deducts_balance: boolean; requires_attachment: boolean; is_active: boolean }
export interface LeaveRow {
  id: number; employee_id: number; employee_name: string; unit_name: string; business_name: string
  type_id: number; type_name: string; category: string
  start_date: string; end_date: string; days: number; back_date: string; reason: string
  status: 'Pending Approval' | 'Disetujui' | 'Ditolak' | 'Dibatalkan'; time_state: string; approval_id: number | null
  attachment_count: number; waiting_for: string; can_decide: boolean; can_cancel: boolean
}
export interface LeaveBalanceRow { employee_id: number; name: string; unit_name: string; business_name: string; business_id: number; year: number; initial: number; added: number; used: number; pending: number; collective: number; remaining: number; expiry: string; can_grant: boolean }
export interface LeaveSummary { active: number; off: number; cuti: number; izin: number; sakit: number; working: number; pending: number }
export interface ApprovalStep { id: number; level: number; approver_user_id: number; approver_name: string; kind: 'n+1' | 'assigned' | 'fallback'; status: string; acted_by_name: string; acted_at: string | null; note: string }
export interface ApprovalRequest {
  id: number; business_id: number; request_type: string; ref_id: number; title: string; summary: string
  status: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled'; requester_name: string; created_at: string; decided_at: string | null
  decision_note: string; current_level: number; steps: ApprovalStep[]
}
export interface Person { user_id: number; name: string; role?: string }
export interface AppUser { id: number; email: string; name: string; role: User['role']; employee_id: number | null; employee_name: string; is_active: boolean; businesses: Business[] }
export interface AuditRow { id: number; user_name: string; action: string; entity: string; entity_id: string; created_at: string }
export interface Holiday { id: number; date: string; name: string; business_id: number | null; deducts_leave: boolean }
export interface FileItem { id: number; label: string; file_name: string; mime_type: string; size: number; drive_status?: string; drive_error?: string }
export interface LeaveCalc { days: number; skipped: { date: string; name: string; deducts_leave: boolean }[]; error?: string }

export interface WorkCalendar { id: number; business_id: number; name: string; work_days: string; start_time: string; end_time: string; break_start: string; break_end: string; tolerance_min: number; require_gps: boolean; is_default: boolean; is_active: boolean; employee_count?: number }
export interface Roster { id: number; business_id: number; name: string; work_units: number; off_units: number; unit: 'hari' | 'minggu'; location_id: number | null; start_time: string; end_time: string; break_start: string; break_end: string; tolerance_min: number; require_gps: boolean; start_cycle: string; is_active: boolean; pattern?: string; employee_count?: number; employee_ids?: number[]; members?: { employee_id: number; start_cycle: string }[] }
export type AttStatus = 'Hadir' | 'Terlambat' | 'Belum Absen' | 'Tidak Hadir' | 'Cuti' | 'Izin' | 'Sakit' | 'OFF' | 'Libur' | 'Terjadwal'
export interface AttRow {
  employee_id: number; name: string; nik: string; unit_name: string; business_name: string; location_name: string; pattern: string; policy: string
  sched_status: string; schedule: string; holiday: string; status: AttStatus; leave_type: string; check_in: string | null; check_out: string | null
  late_minutes: number; early_leave_minutes: number; work_minutes: number; worked_on_off_day: boolean; in_location: string; in_distance: number | null; out_distance: number | null; source: string; note: string
}
export interface AttSummary { kerja?: number; hadir?: number; izin?: number; sakit?: number; belum?: number; terlambat?: number; kerja_hari_libur?: number; nonkerja?: number; cuti?: number; off?: number; libur?: number }
export interface RecapRow { employee_id: number; name: string; nik: string; unit_name: string; business_name: string; location_name: string; work_days: number; present: number; late: number; absent: number; cuti: number; izin: number; sakit: number; worked_off: number; off: number; holiday: number; work_minutes: number; rate: number }
export interface ShiftRow { adjusted?: boolean; employee_id: number; name: string; nik: string; business_name: string; location_name: string; policy: string; pattern: string; schedule_name: string; today: string; today_state: string; tomorrow: string; tomorrow_state: string }
export interface ManualRow { id: number; employee_id: number; employee_name: string; unit_name: string; date: string; check_in: string; check_out: string; reason: string; status: 'Pending Approval' | 'Disetujui' | 'Ditolak' | 'Dibatalkan'; waiting_for: string; can_cancel: boolean; approval_id: number | null }
export interface RosterAdjustment { id: number; employee_id: number; employee_name: string; unit_name: string; start_date: string; end_date: string; kind: 'kerja' | 'off'; reason: string; status: 'Pending Approval' | 'Disetujui' | 'Ditolak' | 'Dibatalkan'; waiting_for: string; can_cancel: boolean; approval_id: number | null }
export interface AppNotification { id: number; kind: string; title: string; body: string; link: string; read_at: string | null; created_at: string }
export interface RosterWindow { is_roster: boolean; has_request?: boolean; window?: { in_off: boolean; off_start: string; off_end: string; leave_from: string; days_until_off: number } }
export interface DevAccount { id: number; name: string; email: string; role: User['role']; nik: string; position: string; businesses: string[] | null; has_employee: boolean }

export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done'
export interface TaskMember { employee_id: number; name: string; role: 'member' | 'watcher' }
export interface TaskRow {
  id: number; business_id: number; project_id: number | null; parent_id: number | null; title: string; description: string
  priority: 'normal' | 'tinggi'; assigner_id: number | null; pic_id: number; unit_id: number | null
  status: TaskStatus; own_status: TaskStatus; start_date: string | null; due_date: string | null; weight: number | null
  require_result: boolean; requires_approval: boolean; approval_levels: number; approver_user_id: number | null; approval_id: number | null
  completed_at: string | null; assigner_name: string; pic_name: string; unit_name: string; project_name: string; parent_title: string
  progress: number; is_parent: boolean; kids_total: number; kids_done: number; overdue: boolean; members: TaskMember[]
  attachment_count: number; comment_count: number; waiting_for: string; can_manage: boolean; can_work: boolean; depth: number
  kpi_id: number | null; kpi_title: string
}
export interface TaskDetailData {
  task: TaskRow; children: TaskRow[]; ancestors: { id: number; title: string }[]
  comments: { id: number; user_name: string; body: string; created_at: string }[]
  attachments: { id: number; file_name: string; mime_type: string; size: number }[]
}
export interface TaskSummary { total?: number; parents?: number; subtasks?: number; open?: number; done?: number; overdue?: number; review?: number }
export interface Assignee { id: number; name: string; business_id: number; unit_id: number | null; unit_name: string; nik: string }
export interface Project {
  id: number; business_id: number; name: string; description: string; owner_id: number; owner_name: string
  start_date: string | null; end_date: string | null; status: 'Aktif' | 'Ditunda' | 'Selesai' | 'Dibatalkan'
  progress: number; top_level: number; subtasks: number; open: number; done: number; overdue: number; weighted: boolean; can_manage: boolean
}
export interface CurvePoint { date: string; plan: number; actual: number | null }

export type KpiStatus = 'Good' | 'Attention' | 'Critical'
export interface KpiSettings { weight_kpi: number; weight_task: number; weight_attendance: number; company_target: number; good_min: number; attention_min: number }
export interface KpiItem {
  id: number; business_id: number; employee_id: number; employee_name: string; unit_name: string; period_key: string; title: string
  metric: 'manual' | 'tasks_on_time'; unit: string; direction: 'higher' | 'lower'; target: number; actual: number; weight: number
  dept_kpi_id: number | null; dept_objective: string; actual_value: number; score: number; status: KpiStatus
  linked_tasks: number; linked_done: number; auto: boolean; can_edit?: boolean
}
export interface DeptKpi {
  id: number; business_id: number; unit_id: number; unit_name: string; period_key: string; objective: string; unit: string
  direction: 'higher' | 'lower'; target: number; actual: number; source: 'manual' | 'team_score'; weight: number
  actual_value: number; score: number; status: KpiStatus; team_size: number
}
export interface EmpScore {
  employee_id: number; name: string; nik: string; unit_id: number | null; unit_name: string; business_name: string
  kpi_score: number | null; task_score: number | null; attendance_score: number | null; final_score: number | null; status: KpiStatus | ''; rank: number
  items: KpiItem[]; tasks: { total: number; done: number; on_time: number; overdue: number }
  attendance: { required: number; present: number; late: number; absent: number; leave: number }
}
export interface ScoreTaskRow { id: number; title: string; due_date: string | null; status: string; completed_at: string | null; on_time: boolean; counted: boolean }

export interface KpiClose { id: number; period_key: string; status: 'closed' | 'open'; auto: boolean; closed_at: string; closed_by: string; employees: number; average_score: number | null; company_score: number | null }
export interface KpiHistoryRow { period_key: string; label: string; kpi_score: number | null; task_score: number | null; attendance_score: number | null; final_score: number | null; status: KpiStatus | ''; rank: number }
export interface RecurringTask {
  id: number; business_id: number; business_name: string; title: string; description: string; priority: 'normal' | 'tinggi'; pic_id: number; pic_name: string
  assigner_id: number | null; frequency: 'daily' | 'weekly' | 'monthly'; weekday: number; day_of_month: number; due_after_days: number
  start_date: string; end_date: string | null; kpi_title: string; require_result: boolean; requires_approval: boolean; approval_levels: number
  approver_user_id: number | null; active: boolean; last_generated: string | null; next_date: string | null; generated: number; can_manage: boolean
}

export interface PermDef { key: string; label: string; group: string; hint?: string; locked?: boolean }
export interface ReportData { type: string; title: string; subtitle: string; columns: string[]; rows: (string | number)[][]; summary: string[][]; can_export: boolean }
export interface DashboardData {
  scope: string
  people: { active: number; tetap: number; kontrak: number; expiring: number; vacant: number }
  attendance: { scheduled: number; present: number; late: number; leave: number; absent: number; trend: { date: string; label: string; present: number; late: number; leave: number; absent: number }[] }
  tasks: { status: Record<string, number>; overdue: number; due_week: number; weekly: { label: string; created: number; completed: number }[] }
  me: { open_tasks: number; overdue_tasks: number; pending_approvals: number }
  pending_leave: number
  on_leave: { name: string; type: string; until: string }[]
  projects: { active: number; top: { id: number; name: string; owner: string; progress: number; overdue: number; end: string }[] }
  kpi: { period: string; average: number; scored: number; good: number; attention: number; critical: number; top: PerfRow[]; bottom: PerfRow[]; settings: KpiSettings; closed: boolean }
}
export interface PerfRow { name: string; unit: string; score: number; status: KpiStatus }

export interface DriveStatusData {
  enabled: boolean; configured: boolean; connected: boolean; email?: string; source?: 'app' | 'env'; connected_at?: string; scope: string; custom_root: boolean
  redirect_url: string; structure: string; root_url?: string
  counts: { tab: string; pending: number; synced: number; failed: number }[]
  failures: { tab: string; id: number; file_name: string; error: string; attempts: number }[]
  last_run: { at: string; synced: number; failed: number; error: string }
}

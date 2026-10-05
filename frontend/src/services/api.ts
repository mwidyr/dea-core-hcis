import axios from 'axios'
import type { DriveStatusData, DashboardData, PermDef, ReportData, KpiClose, KpiHistoryRow, RecurringTask, DeptKpi, EmpScore, KpiItem, KpiSettings, ScoreTaskRow, Assignee, CurvePoint, Project, TaskDetailData, TaskRow, TaskSummary, DevAccount, AppNotification, RosterWindow, RosterAdjustment, AttRow, AttSummary, ManualRow, RecapRow, Roster, ShiftRow, WorkCalendar, Holiday, LeaveCalc, AppUser, ApprovalRequest, AuditRow, Business, Employee, EmployeeDocument, LeaveBalanceRow, LeaveRow, LeaveSummary, LeaveType, Person, Location, OrgUnit, Position, User } from '../types'

// VITE_API_URL points at a backend on another domain; default is the Vite-proxied /api.
const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !err.config?.url?.includes('/auth/login') && !err.config?.url?.includes('/public/')) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  },
)

// Auth
export const login = (email: string, password: string) =>
  api.post<{ token: string; user: User }>('/auth/login', { email, password })
// Local development only: the backend serves these when started with DEV_LOGIN=true (404 otherwise → the UI hides the picker).
export const getDevAccounts = () => api.get<DevAccount[]>('/dev/accounts')
export const devLogin = (user_id: number) => api.post<{ token: string; user: User }>('/dev/login', { user_id })
export const getMe = () => api.get<User>('/auth/me')
export const changePassword = (old_password: string, new_password: string) =>
  api.put('/auth/password', { old_password, new_password })

// Business / Org
export const getBusinesses = () => api.get<Business[]>('/businesses')
export const saveBusiness = (d: Partial<Business>) => (d.id ? api.put(`/businesses/${d.id}`, d) : api.post('/businesses', d))
export const deleteBusiness = (id: number) => api.delete(`/businesses/${id}`)
export const getUnits = (params?: object) => api.get<OrgUnit[]>('/org/units', { params })
export const saveUnit = (d: Partial<OrgUnit>) => (d.id ? api.put(`/org/units/${d.id}`, d) : api.post('/org/units', d))
export const deleteUnit = (id: number) => api.delete(`/org/units/${id}`)
export const getPositions = (params?: object) => api.get<Position[]>('/org/positions', { params })
export const savePosition = (d: Partial<Position>) => (d.id ? api.put(`/org/positions/${d.id}`, d) : api.post('/org/positions', d))
export const deletePosition = (id: number) => api.delete(`/org/positions/${id}`)
export const getLocations = (params?: object) => api.get<Location[]>('/org/locations', { params })
export const saveLocation = (d: Partial<Location>) => (d.id ? api.put(`/org/locations/${d.id}`, d) : api.post('/org/locations', d))
export const deleteLocation = (id: number) => api.delete(`/org/locations/${id}`)

// Employees
export const getEmployees = (params?: object) =>
  api.get<{ data: Employee[]; total: number; page: number; page_size: number; stats: { active: number; tetap: number; kontrak: number; multi: number; expiring: number } }>('/employees', { params })
export const getEmployee = (id: number) => api.get<Employee>(`/employees/${id}`)
export const saveEmployee = (d: Partial<Employee>) => (d.id ? api.put(`/employees/${d.id}`, d) : api.post('/employees', d))
export const deleteEmployee = (id: number) => api.delete(`/employees/${id}`)
export const setEmployeeStatus = (id: number, status: string, note: string) => api.patch(`/employees/${id}/status`, { status, note })
export const getEmployeeDocuments = (id: number) => api.get<EmployeeDocument[]>(`/employees/${id}/documents`)
export const uploadEmployeeDocument = (id: number, label: string, file: File) => {
  const f = new FormData()
  f.append('label', label)
  f.append('file', file)
  return api.post<EmployeeDocument>(`/employees/${id}/documents`, f)
}
export const deleteEmployeeDocument = (id: number, docId: number) => api.delete(`/employees/${id}/documents/${docId}`)
// files need the auth header, so they are fetched as blobs (an <img src> can't send it)
export const fetchEmployeeDocumentBlob = (id: number, docId: number) =>
  api.get<Blob>(`/employees/${id}/documents/${docId}/file`, { responseType: 'blob' })
export const getExpiringContracts = (days = 30) => api.get<Employee[]>('/employees/contract-expiring', { params: { days } })

// Leave
export const getLeaveTypes = () => api.get<LeaveType[]>('/leave/types')
export const saveLeaveType = (d: Partial<LeaveType>) => (d.id ? api.put(`/leave/types/${d.id}`, d) : api.post('/leave/types', d))
export const getLeaveRequests = (params?: object) => api.get<LeaveRow[]>('/leave/requests', { params })
// multipart: fields + files[]
export const createLeaveRequest = (d: Record<string, string | number | null | undefined>, files: File[]) => {
  const f = new FormData()
  Object.entries(d).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== '') f.append(k, String(v)) })
  files.forEach((file) => f.append('files', file))
  return api.post('/leave/requests', f)
}
export const getLeaveCalc = (employeeId: number, start: string, end: string, typeId?: number) => api.get<LeaveCalc>('/leave/calc', { params: { employee_id: employeeId, start_date: start, end_date: end, type_id: typeId } })
// roster members only: current/next OFF block and the earliest day annual leave may start (right after it)
export const getRosterWindow = (employeeId?: number) => api.get<RosterWindow>('/leave/roster-window', { params: { employee_id: employeeId } })
export const getNotifications = () => api.get<{ data: AppNotification[]; unread: number }>('/notifications')
export const markNotificationRead = (id: number) => api.post(`/notifications/${id}/read`)
export const markAllNotificationsRead = () => api.post('/notifications/read-all')
export const grantLeave = (employeeId: number, d: { year: number; days: number; reason: string }) => api.post(`/leave/balances/${employeeId}/grant`, d)
export const getLeaveAttachments = (id: number) => api.get<{ id: number; file_name: string; mime_type: string; size: number }[]>(`/leave/requests/${id}/attachments`)
export const uploadLeaveAttachment = (id: number, file: File) => { const f = new FormData(); f.append('file', file); return api.post(`/leave/requests/${id}/attachments`, f) }
export const deleteLeaveAttachment = (id: number, aid: number) => api.delete(`/leave/requests/${id}/attachments/${aid}`)
export const fetchLeaveAttachmentBlob = (id: number, aid: number) => api.get<Blob>(`/leave/requests/${id}/attachments/${aid}/file`, { responseType: 'blob' })
export const getApproval = (id: number) => api.get<ApprovalRequest>(`/approvals/${id}`)

// Holidays (national = business_id null)
export const getHolidays = (params?: object) => api.get<{ data: Holiday[]; can_manage: boolean }>('/holidays', { params })
export const createHoliday = (d: object) => api.post<{ created: number; duplicates_skipped: number }>('/holidays', d)
export const updateHoliday = (id: number, d: object) => api.put(`/holidays/${id}`, d)
export const deleteHoliday = (id: number) => api.delete(`/holidays/${id}`)

// Multi-business placements
export const addPlacement = (employeeId: number, business_id: number, position_id: number) => api.post(`/employees/${employeeId}/placements`, { business_id, position_id })
export const removePlacement = (employeeId: number, placementId: number) => api.delete(`/employees/${employeeId}/placements/${placementId}`)
export const cancelLeaveRequest = (id: number) => api.post(`/leave/requests/${id}/cancel`)
export const getLeaveBalances = (params?: object) => api.get<LeaveBalanceRow[]>('/leave/balances', { params })
export const adjustLeaveBalance = (employeeId: number, d: { year: number; initial: number; added: number }) => api.put(`/leave/balances/${employeeId}`, d)
export const getLeaveSummary = (params?: object) => api.get<LeaveSummary>('/leave/summary', { params })

// Approval
export const getApprovers = (employeeId?: number) => api.get<{ nplus1: Person[]; candidates: Person[] }>('/approvers', { params: { employee_id: employeeId } })
export const getApprovalInbox = (params?: object) => api.get<ApprovalRequest[]>('/approvals/inbox', { params })
export const getApprovalCount = () => api.get<{ inbox: number }>('/approvals/count')
export const getApprovalHistory = (params?: object) => api.get<ApprovalRequest[]>('/approvals/history', { params })
export const getMyApprovalRequests = () => api.get<ApprovalRequest[]>('/approvals/mine')
export const approveRequest = (id: number, note: string) => api.post(`/approvals/${id}/approve`, { note })
export const rejectRequest = (id: number, note: string) => api.post(`/approvals/${id}/reject`, { note })

// Users, audit, document checklist
export const getUsers = () => api.get<AppUser[]>('/users')
export const createUser = (d: object) => api.post('/users', d)
export const updateUser = (id: number, d: object) => api.put(`/users/${id}`, d)
export const getAudit = (params?: object) => api.get<{ data: AuditRow[]; total: number }>('/audit', { params })
export const getDocLabels = (params?: object) => api.get<Record<string, string[]>>('/employees/doc-labels', { params })

// Work calendars, rosters
export const getWorkCalendars = (params?: object) => api.get<{ data: WorkCalendar[]; can_manage: boolean }>('/work-calendars', { params })
export const saveWorkCalendar = (d: Partial<WorkCalendar>) => (d.id ? api.put(`/work-calendars/${d.id}`, d) : api.post('/work-calendars', d))
export const deleteWorkCalendar = (id: number) => api.delete(`/work-calendars/${id}`)
export const getRosters = (params?: object) => api.get<{ data: Roster[]; can_manage: boolean; can_assign: boolean }>('/rosters', { params })
export const saveRoster = (d: Partial<Roster>) => (d.id ? api.put(`/rosters/${d.id}`, d) : api.post('/rosters', d))
export const deleteRoster = (id: number) => api.delete(`/rosters/${id}`)
// members carry THEIR OWN cycle start (the first work day of that employee's cycle)
export const setRosterEmployees = (id: number, members: { employee_id: number; start_cycle: string }[]) => api.put(`/rosters/${id}/employees`, { members })
export const getRosterAdjustments = () => api.get<RosterAdjustment[]>('/roster-adjustments')
export const createRosterAdjustment = (d: object) => api.post('/roster-adjustments', d)
export const cancelRosterAdjustment = (id: number) => api.post(`/roster-adjustments/${id}/cancel`)

// Attendance (in-app views). The public tap page uses publicClock / publicTap below (no session).
export const getAttendanceDaily = (params?: object) => api.get<{ rows: AttRow[]; summary: AttSummary }>('/attendance/daily', { params })
export const getAttendanceRecap = (params?: object) => api.get<{ rows: RecapRow[] }>('/attendance/recap', { params })
export const getAttendanceSchedule = (params?: object) => api.get<{ rows: ShiftRow[] }>('/attendance/schedule', { params })
export const getManualAttendance = (params?: object) => api.get<ManualRow[]>('/attendance/manual', { params })
export const createManualAttendance = (d: object) => api.post('/attendance/manual', d)
export const cancelManualAttendance = (id: number) => api.post(`/attendance/manual/${id}/cancel`)

export interface TapResult { action: 'in' | 'out'; time: string; status: string; message: string; name: string; nik: string; position?: string; location?: string; distance?: number; late_minutes?: number; work_minutes?: number; schedule?: string }
export const publicClock = () => api.get<{ ms: number }>('/public/clock')
export const publicTap = (d: { identifier?: string; password?: string; dev_user_id?: number; action: 'in' | 'out'; lat?: number; lng?: number; accuracy?: number }) => api.post<TapResult>('/public/attendance', d)

// Tasks
export const getTasks = (params?: object) => api.get<{ data: TaskRow[]; summary: TaskSummary }>('/tasks', { params })
export const getTask = (id: number) => api.get<TaskDetailData>(`/tasks/${id}`)
export const getTaskAssignees = () => api.get<Assignee[]>('/tasks/assignees')
export const createTask = (d: object) => api.post<TaskRow>('/tasks', d)
export const updateTask = (id: number, d: object) => api.put<TaskRow>(`/tasks/${id}`, d)
export const deleteTask = (id: number) => api.delete(`/tasks/${id}`)
export const setTaskStatus = (id: number, status: 'todo' | 'in_progress') => api.post(`/tasks/${id}/status`, { status })
export const completeTask = (id: number, note: string) => api.post<{ status: string }>(`/tasks/${id}/complete`, { note })
export const cancelTaskCompletion = (id: number) => api.post(`/tasks/${id}/cancel-completion`)
export const reopenTask = (id: number, note: string) => api.post(`/tasks/${id}/reopen`, { note })
export const addTaskComment = (id: number, body: string) => api.post(`/tasks/${id}/comments`, { body })
export const uploadTaskAttachment = (id: number, file: File) => { const f = new FormData(); f.append('file', file); return api.post(`/tasks/${id}/attachments`, f) }
export const deleteTaskAttachment = (id: number, aid: number) => api.delete(`/tasks/${id}/attachments/${aid}`)
export const getTaskAttachments = (id: number) => api.get<{ id: number; file_name: string; mime_type: string; size: number }[]>(`/tasks/${id}/attachments`)
export const fetchTaskAttachmentBlob = (id: number, aid: number) => api.get<Blob>(`/tasks/${id}/attachments/${aid}/file`, { responseType: 'blob' })

// Projects
export const getProjects = (params?: object) => api.get<{ data: Project[]; summary: Record<string, number>; can_create: boolean }>('/projects', { params })
export const getProject = (id: number) => api.get<{ project: Project; top_level: TaskRow[]; weight_sum: number }>(`/projects/${id}`)
export const createProject = (d: object) => api.post<Project>('/projects', d)
export const updateProject = (id: number, d: object) => api.put<Project>(`/projects/${id}`, d)
export const deleteProject = (id: number) => api.delete(`/projects/${id}`)
export const setProjectWeights = (id: number, weights: { task_id: number; weight: number | null }[]) => api.put(`/projects/${id}/weights`, { weights })
export const getProjectCurve = (id: number) => api.get<{ ok: boolean; points: CurvePoint[]; progress: number; plan_now: number; actual_now: number; deviation: number }>(`/projects/${id}/curve`)
export const getProjectDocuments = (id: number) => api.get<{ id: number; label: string; file_name: string; mime_type: string; size: number }[]>(`/projects/${id}/documents`)
export const uploadProjectDocument = (id: number, label: string, file: File) => { const f = new FormData(); f.append('label', label); f.append('file', file); return api.post(`/projects/${id}/documents`, f) }
export const deleteProjectDocument = (id: number, did: number) => api.delete(`/projects/${id}/documents/${did}`)
export const fetchProjectDocumentBlob = (id: number, did: number) => api.get<Blob>(`/projects/${id}/documents/${did}/file`, { responseType: 'blob' })

// KPI & performance
export const getKpiSettings = () => api.get<KpiSettings>('/kpi/settings')
export const saveKpiSettings = (d: KpiSettings) => api.put<KpiSettings>('/kpi/settings', d)
export const getScorecard = (params: object) => api.get<{ period: string; rows: EmpScore[]; settings: KpiSettings; closed: KpiClose | null; summary: { average: number; good: number; attention: number; critical: number; no_data: number } }>('/kpi/scorecard', { params })
export const getScorecardDetail = (id: number, period: string) => api.get<{ period: string; score: EmpScore; tasks: ScoreTaskRow[]; settings: KpiSettings; closed?: KpiClose | null }>(`/kpi/scorecard/${id}`, { params: { period } })
export const getKpiItems = (params: object) => api.get<{ data: KpiItem[]; period: string; can_assign: boolean; closed: KpiClose | null }>('/kpi/items', { params })
export const createKpiItem = (d: object) => api.post<KpiItem>('/kpi/items', d)
export const updateKpiItem = (id: number, d: object) => api.put<KpiItem>(`/kpi/items/${id}`, d)
export const deleteKpiItem = (id: number) => api.delete(`/kpi/items/${id}`)
export const getKpiTaskOptions = (employeeId: number) => api.get<{ id: number; title: string; period_key: string; period: string }[]>('/kpi/task-options', { params: { employee_id: employeeId } })
export const getDeptKpis = (params: object) => api.get<{ data: DeptKpi[]; period: string; can_manage: boolean; closed: KpiClose | null; settings: KpiSettings; summary: { company_score: number | null; company_target: number; best: { unit_name: string; score: number } | null; attention: number } }>('/kpi/departments', { params })
export const createDeptKpi = (d: object) => api.post('/kpi/departments', d)
export const updateDeptKpi = (id: number, d: object) => api.put(`/kpi/departments/${id}`, d)
export const deleteDeptKpi = (id: number) => api.delete(`/kpi/departments/${id}`)

export default api

export const getKpiPeriods = () => api.get<{ data: (KpiClose & { label: string })[]; grace_days: number }>('/kpi/periods')
export const closeKpiPeriod = (period_key: string) => api.post<KpiClose>('/kpi/periods/close', { period_key })
export const reopenKpiPeriod = (period_key: string) => api.post('/kpi/periods/reopen', { period_key })
export const getKpiHistory = (employeeId: number) => api.get<{ data: KpiHistoryRow[] }>(`/kpi/history/${employeeId}`)
export const getRecurringTasks = () => api.get<{ data: RecurringTask[] }>('/recurring-tasks')
export const createRecurringTask = (d: object) => api.post<RecurringTask>('/recurring-tasks', d)
export const updateRecurringTask = (id: number, d: object) => api.put<RecurringTask>(`/recurring-tasks/${id}`, d)
export const deleteRecurringTask = (id: number) => api.delete(`/recurring-tasks/${id}`)

export const getDashboard = (params: object) => api.get<DashboardData>('/dashboard', { params })
export const getReport = (type: string, params: object) => api.get<ReportData>(`/reports/${type}`, { params })
export const downloadReportXlsx = async (type: string, params: object) => {
  const r = await api.get(`/reports/${type}`, { params: { ...params, format: 'xlsx' }, responseType: 'blob' })
  const url = URL.createObjectURL(r.data as Blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `laporan-${type}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
export const getRolePermissions = () => api.get<{ permissions: PermDef[]; roles: Record<string, string[]>; role_list: string[] }>('/roles/permissions')
export const setRolePermissions = (role: string, permissions: string[]) => api.put<{ permissions: string[] }>(`/roles/permissions/${role}`, { permissions })
export const resetRolePermissions = (role: string) => api.post<{ permissions: string[] }>(`/roles/permissions/${role}/reset`)

export const getDriveStatus = () => api.get<DriveStatusData>('/drive/status')
export const getDriveConnectUrl = () => api.get<{ url: string }>('/drive/connect')
export const disconnectDrive = () => api.post('/drive/disconnect')
export const syncDriveNow = () => api.post<{ synced: number; failed: number }>('/drive/sync')
export const retryDriveFailed = () => api.post<{ requeued: number }>('/drive/retry')

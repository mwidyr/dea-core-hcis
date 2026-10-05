package models

import "time"

// Business is one legal/operating entity under the platform (DEA Global, DGN Parts, ...).
type Business struct {
	ID       uint   `gorm:"primaryKey" json:"id"`
	Code     string `gorm:"uniqueIndex;size:10" json:"code"`
	Name     string `gorm:"uniqueIndex" json:"name"`
	IsActive bool   `gorm:"default:true" json:"is_active"`
}

// OrgUnit is a node of the L1–L10 organisation tree of a business.
type OrgUnit struct {
	ID         uint     `gorm:"primaryKey" json:"id"`
	BusinessID uint     `gorm:"index" json:"business_id"`
	Level      int      `json:"level"`     // 1..10
	TypeName   string   `json:"type_name"` // Fungsi, Bagian, Business Unit, ...
	Name       string   `json:"name"`
	ParentID   *uint    `gorm:"index" json:"parent_id"`
	IsActive   bool     `gorm:"default:true" json:"is_active"`
	Parent     *OrgUnit `gorm:"foreignKey:ParentID" json:"parent,omitempty"`
}

// Position (jabatan). ReportsToID is the structural n+1 line used by approval.
type Position struct {
	ID          uint     `gorm:"primaryKey" json:"id"`
	BusinessID  uint     `gorm:"index" json:"business_id"`
	Title       string   `json:"title"`
	UnitID      *uint    `gorm:"index" json:"unit_id"`
	LevelClass  string   `json:"level_class"` // Direksi, Manager / Head, Staff, ...
	ReportsToID *uint    `gorm:"index" json:"reports_to_id"`
	Unit        *OrgUnit `gorm:"foreignKey:UnitID" json:"unit,omitempty"`
}

type Location struct {
	ID         uint     `gorm:"primaryKey" json:"id"`
	BusinessID uint     `gorm:"index" json:"business_id"`
	Name       string   `json:"name"`
	TypeName   string   `json:"type_name"`
	City       string   `json:"city"`
	Latitude   *float64 `json:"latitude"` // for GPS attendance (Phase 3)
	Longitude  *float64 `json:"longitude"`
	RadiusM    int      `gorm:"default:100" json:"radius_m"`
	IsActive   bool     `gorm:"default:true" json:"is_active"`
}

type Employee struct {
	ID             uint       `gorm:"primaryKey" json:"id"`
	BusinessID     uint       `gorm:"index" json:"business_id"` // primary placement business
	Name           string     `gorm:"index" json:"name"`
	NIK            string     `gorm:"index" json:"nik"` // employee number; usable as the attendance login
	Email          string     `json:"email"`
	Phone          string     `json:"phone"`
	PositionID     *uint      `gorm:"index" json:"position_id"` // primary placement
	UnitID         *uint      `gorm:"index" json:"unit_id"`
	LocationID     *uint      `json:"location_id"`
	WorkCalendarID *uint      `json:"work_calendar_id"`        // nil = business default calendar
	ManagerID      *uint      `gorm:"index" json:"manager_id"` // n+1, derived from position tree
	EmployeeType   string     `json:"employee_type"`           // Tetap | Kontrak
	ContractStart  *time.Time `json:"contract_start"`
	ContractEnd    *time.Time `json:"contract_end"`
	JoinDate       *time.Time `json:"join_date"`
	BirthPlace     string     `json:"birth_place"`
	BirthDate      *time.Time `json:"birth_date"`
	// Status: Aktif | Suspend | Tidak Bekerja. IsActive mirrors Status == "Aktif".
	Status     string              `gorm:"default:Aktif" json:"status"`
	StatusNote string              `json:"status_note"`
	IsActive   bool                `gorm:"default:true" json:"is_active"`
	Position   *Position           `gorm:"foreignKey:PositionID" json:"position,omitempty"`
	Unit       *OrgUnit            `gorm:"foreignKey:UnitID" json:"unit,omitempty"`
	Location   *Location           `gorm:"foreignKey:LocationID" json:"location,omitempty"`
	Business   *Business           `gorm:"foreignKey:BusinessID" json:"business,omitempty"`
	Placements []EmployeePlacement `json:"placements,omitempty"`
}

// EmployeeDocument is an uploaded photo/scan (KTP, KK, other…). Label is free text so
// any number of document kinds can be added. DriveStatus: pending → synced | failed (Phase 8).
type EmployeeDocument struct {
	ID          uint   `gorm:"primaryKey" json:"id"`
	EmployeeID  uint   `gorm:"index" json:"employee_id"`
	Label       string `json:"label"`
	FileName    string `json:"file_name"`
	MimeType    string `json:"mime_type"`
	Size        int64  `json:"size"`
	LocalPath   string `json:"-"`
	DriveFileID string `json:"drive_file_id"`
	DriveStatus string `gorm:"default:pending" json:"drive_status"`
	DriveMeta
	CreatedAt time.Time `json:"created_at"`
}

// EmployeePlacement supports multi-placement ("Penempatan Tambahan").
type EmployeePlacement struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	EmployeeID uint      `gorm:"uniqueIndex:idx_emp_biz" json:"employee_id"` // one position per business per employee
	BusinessID uint      `gorm:"uniqueIndex:idx_emp_biz" json:"business_id"`
	PositionID uint      `json:"position_id"`
	IsPrimary  bool      `json:"is_primary"`
	Position   *Position `gorm:"foreignKey:PositionID" json:"position,omitempty"`
	Business   *Business `gorm:"foreignKey:BusinessID" json:"business,omitempty"`
}

// User is a login account. Role: super_admin | hr_admin | manager | employee.
type User struct {
	ID           uint   `gorm:"primaryKey" json:"id"`
	Email        string `gorm:"uniqueIndex" json:"email"`
	PasswordHash string `json:"-"`
	Name         string `json:"name"`
	Role         string `json:"role"`
	EmployeeID   *uint  `gorm:"index" json:"employee_id"`
	IsActive     bool   `gorm:"default:true" json:"is_active"`
	// Businesses the user may switch to. super_admin/hr_admin see all regardless.
	Businesses []Business `gorm:"many2many:user_businesses" json:"businesses,omitempty"`
}

type AuditLog struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    uint      `json:"user_id"`
	Action    string    `json:"action"`
	Entity    string    `json:"entity"`
	EntityID  string    `json:"entity_id"`
	CreatedAt time.Time `json:"created_at"`
}

// ---- Approval engine (Phase 4) ----

// ApprovalRequest is one thing awaiting a decision (a leave request, …). RequestType + RefID
// point at the business object; the module registers a hook that applies the outcome.
type ApprovalRequest struct {
	ID                  uint           `gorm:"primaryKey" json:"id"`
	BusinessID          uint           `gorm:"index" json:"business_id"`
	RequestType         string         `gorm:"index" json:"request_type"` // leave | attendance_manual | task | employee_change | roster
	RefID               uint           `json:"ref_id"`
	RequesterEmployeeID *uint          `json:"requester_employee_id"`
	RequesterUserID     uint           `gorm:"index" json:"requester_user_id"`
	Title               string         `json:"title"`
	Summary             string         `json:"summary"`
	Status              string         `gorm:"index" json:"status"` // Pending | Approved | Rejected | Cancelled
	AssignedUserID      *uint          `json:"assigned_user_id"`    // set → this approver decides alone, n+1 is skipped
	CurrentLevel        int            `json:"current_level"`
	DecisionNote        string         `json:"decision_note"`
	CreatedAt           time.Time      `json:"created_at"`
	DecidedAt           *time.Time     `json:"decided_at"`
	Steps               []ApprovalStep `gorm:"foreignKey:RequestID" json:"steps,omitempty"`
	RequesterName       string         `gorm:"-" json:"requester_name"`
}

type ApprovalStep struct {
	ID             uint       `gorm:"primaryKey" json:"id"`
	RequestID      uint       `gorm:"index" json:"request_id"`
	Level          int        `json:"level"`
	ApproverUserID uint       `gorm:"index" json:"approver_user_id"`
	Kind           string     `json:"kind"`   // n+1 | assigned | fallback
	Status         string     `json:"status"` // Pending | Waiting | Approved | Rejected
	ActedByUserID  *uint      `json:"acted_by_user_id"`
	ActedAt        *time.Time `json:"acted_at"`
	Note           string     `json:"note"`
	ApproverName   string     `gorm:"-" json:"approver_name"`
	ActedByName    string     `gorm:"-" json:"acted_by_name"`
}

// ---- Leave (Phase 3) ----

type LeaveType struct {
	ID                 uint   `gorm:"primaryKey" json:"id"`
	Name               string `gorm:"uniqueIndex" json:"name"`
	Category           string `json:"category"` // cuti | izin | sakit
	DefaultDays        int    `json:"default_days"`
	DeductsBalance     bool   `json:"deducts_balance"`
	RequiresAttachment bool   `json:"requires_attachment"` // e.g. surat dokter for Sakit
	IsActive           bool   `gorm:"default:true" json:"is_active"`
}

// LeaveBalance: remaining = Initial + Added - Used - (pending requests, computed).
type LeaveBalance struct {
	ID         uint `gorm:"primaryKey" json:"id"`
	EmployeeID uint `gorm:"uniqueIndex:idx_leave_bal" json:"employee_id"`
	Year       int  `gorm:"uniqueIndex:idx_leave_bal" json:"year"`
	Initial    int  `json:"initial"`
	Added      int  `json:"added"`
	Used       int  `json:"used"`
}

type LeaveRequest struct {
	ID         uint       `gorm:"primaryKey" json:"id"`
	EmployeeID uint       `gorm:"index" json:"employee_id"`
	BusinessID uint       `gorm:"index" json:"business_id"`
	TypeID     uint       `json:"type_id"`
	StartDate  time.Time  `json:"start_date"`
	EndDate    time.Time  `json:"end_date"`
	Days       int        `json:"days"` // working days (Mon–Fri); holiday calendar joins in Phase 3 schedule
	Reason     string     `json:"reason"`
	Status     string     `gorm:"index" json:"status"` // Pending Approval | Disetujui | Ditolak | Dibatalkan
	ApprovalID *uint      `json:"approval_id"`
	CreatedAt  time.Time  `json:"created_at"`
	Employee   *Employee  `gorm:"foreignKey:EmployeeID" json:"employee,omitempty"`
	Type       *LeaveType `gorm:"foreignKey:TypeID" json:"type,omitempty"`
}

// LeaveAttachment: supporting document for a leave/izin/sakit request (validated by the approver).
type LeaveAttachment struct {
	ID             uint   `gorm:"primaryKey" json:"id"`
	LeaveRequestID uint   `gorm:"index" json:"leave_request_id"`
	FileName       string `json:"file_name"`
	MimeType       string `json:"mime_type"`
	Size           int64  `json:"size"`
	LocalPath      string `json:"-"`
	DriveFileID    string `json:"drive_file_id"`
	DriveStatus    string `gorm:"default:pending" json:"drive_status"`
	DriveMeta
	CreatedAt time.Time `json:"created_at"`
}

// LeaveGrant records extra leave days given by a superior (adds to LeaveBalance.Added).
type LeaveGrant struct {
	ID              uint      `gorm:"primaryKey" json:"id"`
	EmployeeID      uint      `gorm:"index" json:"employee_id"`
	Year            int       `json:"year"`
	Days            int       `json:"days"`
	Reason          string    `json:"reason"`
	GrantedByUserID uint      `json:"granted_by_user_id"`
	CreatedAt       time.Time `json:"created_at"`
}

// Holiday: BusinessID nil = national (all businesses), otherwise given by that organisation.
// DeductsLeave=false → plain day off; true → "cuti bersama": a day off that is deducted from
// every employee's annual leave balance. Either way the day is not counted again in leave requests.
type Holiday struct {
	ID              uint      `gorm:"primaryKey" json:"id"`
	Date            time.Time `gorm:"index" json:"date"`
	Name            string    `json:"name"`
	BusinessID      *uint     `gorm:"index" json:"business_id"`
	DeductsLeave    bool      `json:"deducts_leave"`
	CreatedByUserID uint      `json:"created_by_user_id"`
	CreatedAt       time.Time `json:"created_at"`
}

// ---- Work schedule & attendance (Phase 3) ----

// WorkCalendar = regular office schedule ("Kalender Kerja"). WorkDays is "1,2,3,4,5" (0 = Sunday).
type WorkCalendar struct {
	ID           uint   `gorm:"primaryKey" json:"id"`
	BusinessID   uint   `gorm:"index" json:"business_id"`
	Name         string `json:"name"`
	WorkDays     string `json:"work_days"`
	StartTime    string `json:"start_time"` // HH:MM
	EndTime      string `json:"end_time"`
	BreakStart   string `json:"break_start"`
	BreakEnd     string `json:"break_end"`
	ToleranceMin int    `json:"tolerance_min"` // late only after start + tolerance
	RequireGPS   bool   `json:"require_gps"`
	IsDefault    bool   `json:"is_default"` // applies to employees without their own calendar or roster
	IsActive     bool   `gorm:"default:true" json:"is_active"`
}

// Roster = cycle pattern: WorkUnits on / OffUnits off, in days or weeks, starting at StartCycle.
type Roster struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	BusinessID   uint      `gorm:"index" json:"business_id"`
	Name         string    `json:"name"`
	WorkUnits    int       `json:"work_units"`
	OffUnits     int       `json:"off_units"`
	Unit         string    `json:"unit"` // hari | minggu
	LocationID   *uint     `json:"location_id"`
	StartTime    string    `json:"start_time"`
	EndTime      string    `json:"end_time"`
	BreakStart   string    `json:"break_start"`
	BreakEnd     string    `json:"break_end"`
	ToleranceMin int       `json:"tolerance_min"`
	RequireGPS   bool      `json:"require_gps"`
	StartCycle   time.Time `json:"start_cycle"`
	IsActive     bool      `gorm:"default:true" json:"is_active"`
}

// RosterAssignment: an employee follows at most one roster (it overrides the calendar).
type RosterAssignment struct {
	ID         uint `gorm:"primaryKey" json:"id"`
	RosterID   uint `gorm:"index" json:"roster_id"`
	EmployeeID uint `gorm:"uniqueIndex" json:"employee_id"`
	// first work day of THIS employee\'s cycle — crews rotate, so each member has their own start (nil = roster default)
	StartCycle *time.Time `json:"start_cycle"`
}

// AttendanceRecord: one row per employee per day (tap in / tap out). Leave days have no row —
// they are derived from approved leave, so cancelling leave corrects attendance automatically.
type AttendanceRecord struct {
	ID                uint       `gorm:"primaryKey" json:"id"`
	EmployeeID        uint       `gorm:"uniqueIndex:idx_att_emp_date" json:"employee_id"`
	Date              time.Time  `gorm:"uniqueIndex:idx_att_emp_date" json:"date"`
	BusinessID        uint       `gorm:"index" json:"business_id"`
	CheckInAt         *time.Time `json:"check_in_at"`
	CheckOutAt        *time.Time `json:"check_out_at"`
	InLat             *float64   `json:"in_lat"`
	InLng             *float64   `json:"in_lng"`
	InAccuracy        *float64   `json:"in_accuracy"`
	OutLat            *float64   `json:"out_lat"`
	OutLng            *float64   `json:"out_lng"`
	OutAccuracy       *float64   `json:"out_accuracy"`
	InLocationID      *uint      `json:"in_location_id"`
	OutLocationID     *uint      `json:"out_location_id"`
	InDistance        *int       `json:"in_distance"`
	OutDistance       *int       `json:"out_distance"`
	LateMinutes       int        `json:"late_minutes"`
	EarlyLeaveMinutes int        `json:"early_leave_minutes"`
	WorkMinutes       int        `json:"work_minutes"`
	WorkedOnOffDay    bool       `json:"worked_on_off_day"` // "Kerja Hari Libur": tapped in on a holiday / off day
	Source            string     `json:"source"`            // kiosk | manual
	Note              string     `json:"note"`
	IP                string     `json:"ip"`
}

// ManualAttendance: request to correct/add a missed tap, approved through the approval engine.
type ManualAttendance struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	EmployeeID uint      `gorm:"index" json:"employee_id"`
	BusinessID uint      `gorm:"index" json:"business_id"`
	Date       time.Time `json:"date"`
	CheckIn    string    `json:"check_in"`  // HH:MM
	CheckOut   string    `json:"check_out"` // HH:MM
	Reason     string    `json:"reason"`
	Status     string    `gorm:"index" json:"status"` // Pending Approval | Disetujui | Ditolak | Dibatalkan
	ApprovalID *uint     `json:"approval_id"`
	CreatedAt  time.Time `json:"created_at"`
}

// RosterAdjustment shifts a roster member's schedule for a date range (e.g. postpone the off block because
// of a project, or swap). It needs approval; once approved it overrides the roster pattern on those days.
type RosterAdjustment struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	EmployeeID uint      `gorm:"index" json:"employee_id"`
	BusinessID uint      `gorm:"index" json:"business_id"`
	StartDate  time.Time `json:"start_date"`
	EndDate    time.Time `json:"end_date"`
	Kind       string    `json:"kind"` // kerja | off — what those days become
	Reason     string    `json:"reason"`
	Status     string    `gorm:"index" json:"status"` // Pending Approval | Disetujui | Ditolak | Dibatalkan
	ApprovalID *uint     `json:"approval_id"`
	CreatedAt  time.Time `json:"created_at"`
}

// Notification: in-app message for one user (bell in the header). RefKey makes generated reminders idempotent:
// the same (user, ref_key) is never created twice, so a job can run as often as it likes.
type Notification struct {
	ID        uint       `gorm:"primaryKey" json:"id"`
	UserID    uint       `gorm:"index;uniqueIndex:idx_notif_ref" json:"user_id"`
	Kind      string     `json:"kind"`
	Title     string     `json:"title"`
	Body      string     `json:"body"`
	Link      string     `json:"link"`
	RefKey    *string    `gorm:"uniqueIndex:idx_notif_ref" json:"-"`
	ReadAt    *time.Time `json:"read_at"`
	CreatedAt time.Time  `gorm:"index" json:"created_at"`
}

// ---- Projects & tasks (Phase 5) ----

type Project struct {
	ID              uint       `gorm:"primaryKey" json:"id"`
	BusinessID      uint       `gorm:"index" json:"business_id"`
	Name            string     `json:"name"`
	Description     string     `json:"description"`
	OwnerID         uint       `gorm:"index" json:"owner_id"` // employee in charge
	StartDate       *time.Time `json:"start_date"`
	EndDate         *time.Time `json:"end_date"`
	Status          string     `json:"status"` // Aktif | Ditunda | Selesai | Dibatalkan
	CreatedByUserID uint       `json:"created_by_user_id"`
	CreatedAt       time.Time  `json:"created_at"`
}

type ProjectDocument struct {
	ID          uint   `gorm:"primaryKey" json:"id"`
	ProjectID   uint   `gorm:"index" json:"project_id"`
	Label       string `json:"label"`
	FileName    string `json:"file_name"`
	MimeType    string `json:"mime_type"`
	Size        int64  `json:"size"`
	LocalPath   string `json:"-"`
	DriveFileID string `json:"drive_file_id"`
	DriveStatus string `gorm:"default:pending" json:"drive_status"`
	DriveMeta
	CreatedAt time.Time `json:"created_at"`
}

// Task: one PIC (person in charge) + optional members and watchers. A task with sub-tasks is a "parent": its
// progress is the average progress of its children (4 sub-tasks, 1 done → 25%) and its status is derived.
// A leaf is 100% when done, else 0%. Completing a leaf can require attached results and an approval.
type Task struct {
	ID               uint       `gorm:"primaryKey" json:"id"`
	BusinessID       uint       `gorm:"index" json:"business_id"`
	ProjectID        *uint      `gorm:"index" json:"project_id"`
	ParentID         *uint      `gorm:"index" json:"parent_id"`
	KPIID            *uint      `gorm:"index" json:"kpi_id"`                                 // KPI item this task counts toward (employee KPI of metric tasks_on_time)
	RecurringID      *uint      `gorm:"uniqueIndex:idx_task_occurrence" json:"recurring_id"` // template that generated this task
	OccurrenceDate   *time.Time `gorm:"uniqueIndex:idx_task_occurrence" json:"occurrence_date"`
	Title            string     `json:"title"`
	Description      string     `json:"description"`
	Priority         string     `json:"priority"`    // normal | tinggi
	AssignerID       *uint      `json:"assigner_id"` // who gave the instruction (employee)
	PICID            uint       `gorm:"index" json:"pic_id"`
	UnitID           *uint      `json:"unit_id"`
	Status           string     `gorm:"index" json:"status"` // todo | in_progress | review | done (leaf tasks; parents are derived)
	StartDate        *time.Time `json:"start_date"`
	DueDate          *time.Time `json:"due_date"`
	Weight           *float64   `json:"weight"`            // "bobot" of a top-level project task (Kurva-S / project progress)
	RequireResult    bool       `json:"require_result"`    // PIC must attach the result before completing
	RequiresApproval bool       `json:"requires_approval"` // completion goes through approval before the task is closed
	ApprovalLevels   int        `json:"approval_levels"`   // 1–3 n+1 levels
	ApproverUserID   *uint      `json:"approver_user_id"`  // optional fixed approver instead of the PIC's superiors
	ApprovalID       *uint      `json:"approval_id"`
	CompletedAt      *time.Time `json:"completed_at"`
	CreatedByUserID  uint       `json:"created_by_user_id"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

// TaskMember: Role is "member" or "watcher" (pengamat — can follow progress/results without being PIC or member).
type TaskMember struct {
	ID         uint   `gorm:"primaryKey" json:"id"`
	TaskID     uint   `gorm:"uniqueIndex:idx_task_member" json:"task_id"`
	EmployeeID uint   `gorm:"uniqueIndex:idx_task_member" json:"employee_id"`
	Role       string `json:"role"`
}

type TaskAttachment struct {
	ID          uint   `gorm:"primaryKey" json:"id"`
	TaskID      uint   `gorm:"index" json:"task_id"`
	FileName    string `json:"file_name"`
	MimeType    string `json:"mime_type"`
	Size        int64  `json:"size"`
	LocalPath   string `json:"-"`
	DriveFileID string `json:"drive_file_id"`
	DriveStatus string `gorm:"default:pending" json:"drive_status"`
	DriveMeta
	CreatedAt time.Time `json:"created_at"`
}

type TaskComment struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	TaskID    uint      `gorm:"index" json:"task_id"`
	UserID    uint      `json:"user_id"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"created_at"`
	UserName  string    `gorm:"-" json:"user_name"`
}

// ---- KPI & performance (Phase 6) ----

// KPISettings is a single row: how the employee's final score is composed and what counts as good.
type KPISettings struct {
	ID               uint    `gorm:"primaryKey" json:"id"`
	WeightKPI        float64 `json:"weight_kpi"`        // default 50
	WeightTask       float64 `json:"weight_task"`       // default 30
	WeightAttendance float64 `json:"weight_attendance"` // default 20
	CompanyTarget    float64 `json:"company_target"`    // % — target of the company KPI
	GoodMin          float64 `json:"good_min"`          // score >= → Good
	AttentionMin     float64 `json:"attention_min"`     // score >= → Attention, below → Critical
}

// DeptKPI: a department's (org unit's) objective for a period, derived from the company objective.
// PeriodKey is "2026-10" (monthly) or "2026-Q4" (quarterly).
type DeptKPI struct {
	ID              uint    `gorm:"primaryKey" json:"id"`
	BusinessID      uint    `gorm:"index" json:"business_id"`
	UnitID          uint    `gorm:"index" json:"unit_id"`
	PeriodKey       string  `gorm:"index" json:"period_key"`
	Objective       string  `json:"objective"`
	Unit            string  `json:"unit"`      // measurement unit shown next to the numbers, e.g. "%" or "laporan"
	Direction       string  `json:"direction"` // higher | lower is better
	Target          float64 `json:"target"`
	Actual          float64 `json:"actual"` // used when Source = manual
	Source          string  `json:"source"` // manual | team_score (average final score of the unit's employees)
	Weight          float64 `json:"weight"`
	CreatedByUserID uint    `json:"created_by_user_id"`
}

// EmployeeKPI: one KPI item assigned to an employee for a period. Metric "tasks_on_time" counts the linked tasks
// (Task.KPIID) that were completed on time inside the period — the actual is calculated from the work itself.
type EmployeeKPI struct {
	ID              uint    `gorm:"primaryKey" json:"id"`
	BusinessID      uint    `gorm:"index" json:"business_id"`
	EmployeeID      uint    `gorm:"index" json:"employee_id"`
	PeriodKey       string  `gorm:"index" json:"period_key"`
	Title           string  `json:"title"`
	Metric          string  `json:"metric"` // manual | tasks_on_time
	Unit            string  `json:"unit"`
	Direction       string  `json:"direction"`
	Target          float64 `json:"target"`
	Actual          float64 `json:"actual"` // manual metric only
	Weight          float64 `json:"weight"`
	DeptKPIID       *uint   `json:"dept_kpi_id"`
	CreatedByUserID uint    `json:"created_by_user_id"`
}

// RecurringTask is a template ("Rutin") that generates one ordinary task per occurrence (see jobs.go).
// Frequency: daily (Mon–Fri) | weekly (Weekday 0=Sunday..6) | monthly (DayOfMonth 1–28, 0 = last day).
type RecurringTask struct {
	ID               uint       `gorm:"primaryKey" json:"id"`
	BusinessID       uint       `gorm:"index" json:"business_id"`
	Title            string     `json:"title"`
	Description      string     `json:"description"`
	Priority         string     `json:"priority"`
	PICID            uint       `gorm:"index" json:"pic_id"`
	AssignerID       *uint      `json:"assigner_id"`
	UnitID           *uint      `json:"unit_id"`
	Frequency        string     `json:"frequency"`
	Weekday          int        `json:"weekday"`
	DayOfMonth       int        `json:"day_of_month"`
	DueAfterDays     int        `json:"due_after_days"` // deadline = occurrence date + this many days
	StartDate        time.Time  `json:"start_date"`     // first possible occurrence
	EndDate          *time.Time `json:"end_date"`
	KPITitle         string     `json:"kpi_title"` // link generated tasks to the PIC's auto KPI item with this title (same period)
	RequireResult    bool       `json:"require_result"`
	RequiresApproval bool       `json:"requires_approval"`
	ApprovalLevels   int        `json:"approval_levels"`
	ApproverUserID   *uint      `json:"approver_user_id"`
	Active           bool       `json:"active"`
	LastGenerated    *time.Time `json:"last_generated"`
	CreatedByUserID  uint       `json:"created_by_user_id"`
	CreatedAt        time.Time  `json:"created_at"`
}

// KPIPeriodClose marks a KPI period as closed (scores frozen in KPISnapshot / KPIDeptSnapshot).
// Status "open" = it was reopened by HR; the auto-close job never touches a period that already has a row.
type KPIPeriodClose struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	PeriodKey    string    `gorm:"uniqueIndex" json:"period_key"`
	Status       string    `json:"status"` // closed | open
	Auto         bool      `json:"auto"`
	ClosedAt     time.Time `json:"closed_at"`
	ClosedByUser *uint     `json:"closed_by_user_id"`
	Employees    int       `json:"employees"`
	AverageScore *float64  `json:"average_score"`
	CompanyScore *float64  `json:"company_score"`
	SettingsJSON string    `gorm:"type:text" json:"-"` // weights/thresholds used
	ClosedByName string    `gorm:"-" json:"closed_by"`
}

// KPISnapshot: one employee's frozen scorecard for a closed period. Data = {"score": empScore, "tasks": [...]}.
type KPISnapshot struct {
	ID         uint     `gorm:"primaryKey" json:"id"`
	PeriodKey  string   `gorm:"uniqueIndex:idx_kpi_snap" json:"period_key"`
	EmployeeID uint     `gorm:"uniqueIndex:idx_kpi_snap" json:"employee_id"`
	BusinessID uint     `gorm:"index" json:"business_id"`
	KPI        *float64 `json:"kpi_score"`
	Task       *float64 `json:"task_score"`
	Att        *float64 `json:"attendance_score"`
	Final      *float64 `json:"final_score"`
	Status     string   `json:"status"`
	Rank       int      `json:"rank"`
	Data       string   `gorm:"type:text" json:"-"`
}

// KPIDeptSnapshot: a frozen department KPI row (Data = deptView JSON).
type KPIDeptSnapshot struct {
	ID         uint   `gorm:"primaryKey" json:"id"`
	PeriodKey  string `gorm:"index" json:"period_key"`
	BusinessID uint   `gorm:"index" json:"business_id"`
	Data       string `gorm:"type:text" json:"-"`
}

// GORM's naming turns the "KPI" prefix into "kp_i..." for these two, so the names are pinned.
func (KPIPeriodClose) TableName() string  { return "kpi_period_closes" }
func (KPIDeptSnapshot) TableName() string { return "kpi_dept_snapshots" }

// DriveMeta is embedded in every uploaded-file model (employee documents, leave attachments, task attachments,
// project documents) next to DriveFileID / DriveStatus: pending → synced | failed.
type DriveMeta struct {
	DriveURL      string     `json:"drive_url"`
	DriveError    string     `json:"drive_error"`
	DriveAttempts int        `gorm:"default:0" json:"-"`
	DriveSyncedAt *time.Time `json:"drive_synced_at"`
	DriveNextTry  *time.Time `json:"-"`
}

// DriveSetting is the single row holding the OAuth connection (refresh token encrypted, see handlers/drive.go).
type DriveSetting struct {
	ID           uint      `gorm:"primaryKey"`
	RefreshToken string    `json:"-"`
	Email        string    `json:"email"`
	Scope        string    `json:"scope"`
	ConnectedAt  time.Time `json:"connected_at"`
	RootFolderID string    `json:"root_folder_id"`
}

// DriveFolder caches the Drive folder id of a path like "b3/Karyawan/2026" so folders are looked up once.
type DriveFolder struct {
	ID       uint   `gorm:"primaryKey"`
	PathKey  string `gorm:"uniqueIndex"`
	FolderID string
}

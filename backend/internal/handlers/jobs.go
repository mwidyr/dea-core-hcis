package handlers

import (
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm/clause"
)

// ---- background jobs (hourly, all idempotent) ----

func userOfEmployee(empID uint) uint {
	var u models.User
	if database.DB.Select("id").Where("employee_id = ? AND is_active = true", empID).Limit(1).Find(&u).Error != nil {
		return 0
	}
	return u.ID
}

var (
	dueLeadDays     = []int{3, 1, 0} // remind the PIC this many days before the deadline (0 = on the day)
	overdueAfterDay = []int{1, 3, 7} // remind the PIC (and whoever gave the instruction) this many days after
)

// RunTaskReminders notifies PICs about approaching / missed deadlines of open leaf tasks.
// Tasks waiting for approval (review) or done are skipped.
func RunTaskReminders() int {
	var ts []models.Task
	database.DB.Where(`status NOT IN ('done','review') AND due_date IS NOT NULL AND due_date >= ? AND due_date <= ?
		AND NOT EXISTS (SELECT 1 FROM tasks c WHERE c.parent_id = tasks.id)`, today().AddDate(0, 0, -8), today().AddDate(0, 0, 4)).Find(&ts)
	created := 0
	now := today()
	for _, t := range ts {
		due := day(*t.DueDate)
		diff := int(math.Round(due.Sub(now).Hours() / 24)) // >0 before the deadline, <0 after
		link := fmt.Sprintf("/tasks?open=%d", t.ID)
		ds := due.Format("2006-01-02")
		for _, lead := range dueLeadDays {
			if diff != lead {
				continue
			}
			when := fmt.Sprintf("%d hari lagi", lead)
			switch lead {
			case 0:
				when = "hari ini"
			case 1:
				when = "besok"
			}
			if pu := userOfEmployee(t.PICID); pu != 0 {
				if notify(pu, "task_due", "Deadline "+when+": "+t.Title, "Jatuh tempo "+fmtShort(due)+". Selesaikan dan laporkan hasilnya.", link, fmt.Sprintf("task-due:%d:%s:%d", t.ID, ds, lead)) {
					created++
				}
			}
		}
		for _, late := range overdueAfterDay {
			if diff != -late {
				continue
			}
			title := fmt.Sprintf("Terlambat %d hari: %s", late, t.Title)
			body := "Deadline " + fmtShort(due) + " sudah lewat dan tugas belum selesai."
			key := fmt.Sprintf("task-late:%d:%s:%d", t.ID, ds, late)
			targets := []uint{userOfEmployee(t.PICID)}
			if t.AssignerID != nil && *t.AssignerID != t.PICID {
				targets = append(targets, userOfEmployee(*t.AssignerID))
			}
			for _, u := range targets {
				if u != 0 && notify(u, "task_overdue", title, body, link, key) {
					created++
				}
			}
		}
	}
	return created
}

func occursOn(r models.RecurringTask, d time.Time) bool {
	switch r.Frequency {
	case "daily":
		return d.Weekday() != time.Saturday && d.Weekday() != time.Sunday
	case "weekly":
		return int(d.Weekday()) == r.Weekday
	case "monthly":
		if r.DayOfMonth == 0 {
			return d.AddDate(0, 0, 1).Day() == 1
		}
		return d.Day() == r.DayOfMonth
	}
	return false
}

func linkRecurringKPI(r models.RecurringTask, due time.Time) *uint {
	if strings.TrimSpace(r.KPITitle) == "" {
		return nil
	}
	month := due.Format("2006-01")
	quarter := fmt.Sprintf("%d-Q%d", due.Year(), (int(due.Month())-1)/3+1)
	var k models.EmployeeKPI
	if database.DB.Where("employee_id = ? AND metric = 'tasks_on_time' AND lower(title) = lower(?) AND period_key IN ?", r.PICID, strings.TrimSpace(r.KPITitle), []string{month, quarter}).
		Order("period_key DESC").Limit(1).Find(&k).Error != nil || k.ID == 0 {
		return nil
	}
	return &k.ID
}

// GenerateRecurringTasks creates the tasks that are due today (plus occurrences missed while the server was down,
// at most 31 days back). The unique (recurring_id, occurrence_date) index makes it safe to run repeatedly.
func GenerateRecurringTasks() int {
	var rs []models.RecurringTask
	database.DB.Where("active = true").Find(&rs)
	now := today()
	created := 0
	for _, r := range rs {
		var pic models.Employee
		if database.DB.Select("id, status, unit_id, business_id").Limit(1).Find(&pic, r.PICID).Error != nil || pic.ID == 0 || pic.Status != "Aktif" {
			continue
		}
		from := day(r.StartDate)
		if r.LastGenerated != nil && day(*r.LastGenerated).AddDate(0, 0, 1).After(from) {
			from = day(*r.LastGenerated).AddDate(0, 0, 1)
		}
		if floor := now.AddDate(0, 0, -31); from.Before(floor) {
			from = floor
		}
		to := now
		if r.EndDate != nil && day(*r.EndDate).Before(to) {
			to = day(*r.EndDate)
		}
		for d := from; !d.After(to); d = d.AddDate(0, 0, 1) {
			if !occursOn(r, d) {
				continue
			}
			due := d.AddDate(0, 0, r.DueAfterDays)
			occ, start := d, d
			t := models.Task{BusinessID: r.BusinessID, Title: r.Title, Description: r.Description, Priority: r.Priority, AssignerID: r.AssignerID, PICID: r.PICID,
				UnitID: r.UnitID, Status: "todo", StartDate: &start, DueDate: &due, RequireResult: r.RequireResult, RequiresApproval: r.RequiresApproval,
				ApprovalLevels: r.ApprovalLevels, ApproverUserID: r.ApproverUserID, CreatedByUserID: r.CreatedByUserID, RecurringID: &r.ID, OccurrenceDate: &occ,
				KPIID: linkRecurringKPI(r, due)}
			res := database.DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&t)
			if res.RowsAffected > 0 {
				created++
				if pu := userOfEmployee(r.PICID); pu != 0 {
					notify(pu, "task_assigned", "Tugas rutin: "+t.Title, "Dibuat otomatis · deadline "+fmtShort(due), fmt.Sprintf("/tasks?open=%d", t.ID), "")
				}
			}
		}
		last := to
		database.DB.Model(&models.RecurringTask{}).Where("id = ?", r.ID).Update("last_generated", last)
	}
	return created
}

// RunAllJobs runs every periodic check and reports what it did.
func RunAllJobs() map[string]int {
	return map[string]int{
		"roster_reminders": RunRosterReminders(),
		"recurring_tasks":  GenerateRecurringTasks(),
		"task_reminders":   RunTaskReminders(),
		"kpi_closed":       AutoCloseKPIPeriods(),
	}
}

// ---- recurring task templates ----

type recurringInput struct {
	Title            string `json:"title"`
	Description      string `json:"description"`
	Priority         string `json:"priority"`
	PICID            uint   `json:"pic_id"`
	AssignerID       *uint  `json:"assigner_id"`
	UnitID           *uint  `json:"unit_id"`
	Frequency        string `json:"frequency"`
	Weekday          int    `json:"weekday"`
	DayOfMonth       int    `json:"day_of_month"`
	DueAfterDays     int    `json:"due_after_days"`
	StartDate        string `json:"start_date"`
	EndDate          string `json:"end_date"`
	KPITitle         string `json:"kpi_title"`
	RequireResult    bool   `json:"require_result"`
	RequiresApproval *bool  `json:"requires_approval"`
	ApprovalLevels   int    `json:"approval_levels"`
	ApproverUserID   *uint  `json:"approver_user_id"`
	Active           *bool  `json:"active"`
}

type recurringView struct {
	models.RecurringTask
	PICName      string     `json:"pic_name"`
	BusinessName string     `json:"business_name"`
	NextDate     *time.Time `json:"next_date"`
	Generated    int64      `json:"generated"`
	CanManage    bool       `json:"can_manage"`
}

func canManageRecurring(c *gin.Context, r models.RecurringTask) bool {
	if isGroupLevel(c) || r.CreatedByUserID == uid(c) {
		return true
	}
	me := myEmployeeID(c)
	return me != nil && inDownline(*me, r.PICID)
}

func nextOccurrence(r models.RecurringTask) *time.Time {
	d := today()
	if r.LastGenerated != nil && !day(*r.LastGenerated).Before(d) {
		d = day(*r.LastGenerated).AddDate(0, 0, 1)
	}
	if day(r.StartDate).After(d) {
		d = day(r.StartDate)
	}
	for i := 0; i < 400; i++ {
		if r.EndDate != nil && d.After(day(*r.EndDate)) {
			return nil
		}
		if occursOn(r, d) {
			x := d
			return &x
		}
		d = d.AddDate(0, 0, 1)
	}
	return nil
}

func ListRecurringTasks(c *gin.Context) {
	q := scopeBusiness(c, database.DB.Model(&models.RecurringTask{}), "recurring_tasks.business_id")
	if !isGroupLevel(c) {
		me := myEmployeeID(c)
		if me == nil {
			q = q.Where("recurring_tasks.created_by_user_id = ?", uid(c))
		} else {
			q = q.Where("recurring_tasks.created_by_user_id = ? OR recurring_tasks.pic_id = ? OR recurring_tasks.pic_id IN "+downlineSQL, uid(c), *me, *me)
		}
	}
	var rs []models.RecurringTask
	q.Order("recurring_tasks.id DESC").Limit(500).Find(&rs)
	out := make([]recurringView, 0, len(rs))
	for _, r := range rs {
		v := recurringView{RecurringTask: r, CanManage: canManageRecurring(c, r)}
		var e models.Employee
		database.DB.Select("id, name").Limit(1).Find(&e, r.PICID)
		v.PICName = e.Name
		var b models.Business
		database.DB.Select("id, name").Limit(1).Find(&b, r.BusinessID)
		v.BusinessName = b.Name
		database.DB.Model(&models.Task{}).Where("recurring_id = ?", r.ID).Count(&v.Generated)
		if r.Active {
			v.NextDate = nextOccurrence(r)
		}
		out = append(out, v)
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func fillRecurring(c *gin.Context, in recurringInput, r *models.RecurringTask, isNew bool) string {
	if strings.TrimSpace(in.Title) == "" {
		return "nama tugas rutin wajib diisi"
	}
	r.Title, r.Description = strings.TrimSpace(in.Title), in.Description
	r.Priority = "normal"
	if in.Priority == "tinggi" {
		r.Priority = "tinggi"
	}
	switch in.Frequency {
	case "daily", "weekly", "monthly":
		r.Frequency = in.Frequency
	default:
		return "frekuensi harus harian, mingguan, atau bulanan"
	}
	if r.Frequency == "weekly" && (in.Weekday < 0 || in.Weekday > 6) {
		return "hari tidak valid"
	}
	if r.Frequency == "monthly" && (in.DayOfMonth < 0 || in.DayOfMonth > 28) {
		return "tanggal bulanan 1–28 (0 = akhir bulan)"
	}
	if in.DueAfterDays < 0 || in.DueAfterDays > 90 {
		return "deadline maksimal 90 hari setelah tugas dibuat"
	}
	r.Weekday, r.DayOfMonth, r.DueAfterDays = in.Weekday, in.DayOfMonth, in.DueAfterDays
	start, ok := parseDate(in.StartDate)
	if !ok {
		return "tanggal mulai wajib diisi"
	}
	if isNew && start.Before(today()) {
		return "tanggal mulai tidak boleh di masa lalu"
	}
	r.StartDate = start
	end, ok2 := parseOptDate(in.EndDate)
	if !ok2 {
		return "format tanggal berakhir tidak valid"
	}
	if end != nil && end.Before(start) {
		return "tanggal berakhir tidak boleh sebelum tanggal mulai"
	}
	r.EndDate = end
	var pic models.Employee
	if database.DB.Limit(1).Find(&pic, in.PICID).Error != nil || pic.ID == 0 || pic.Status != "Aktif" {
		return "PIC tidak ditemukan atau tidak aktif"
	}
	me := myEmployeeID(c)
	if !isGroupLevel(c) && !(me != nil && (*me == pic.ID || inDownline(*me, pic.ID))) {
		return "Anda hanya dapat membuat tugas rutin untuk diri sendiri atau bawahan Anda"
	}
	if ids := allowedBusinessIDs(c); ids != nil {
		okb := false
		for _, b := range ids {
			if b == pic.BusinessID {
				okb = true
			}
		}
		if !okb {
			return "PIC di luar bisnis yang boleh Anda akses"
		}
	}
	r.PICID, r.BusinessID = pic.ID, pic.BusinessID
	r.AssignerID = in.AssignerID
	if r.AssignerID == nil && me != nil && *me != pic.ID {
		r.AssignerID = me
	}
	r.UnitID = in.UnitID
	if r.UnitID == nil {
		r.UnitID = pic.UnitID
	}
	r.KPITitle = strings.TrimSpace(in.KPITitle)
	r.RequireResult = in.RequireResult
	r.RequiresApproval = true
	if in.RequiresApproval != nil {
		r.RequiresApproval = *in.RequiresApproval
	}
	r.ApprovalLevels = in.ApprovalLevels
	if r.ApprovalLevels < 1 {
		r.ApprovalLevels = 1
	}
	if r.ApprovalLevels > 3 {
		return "jenjang approval maksimal 3"
	}
	r.ApproverUserID = in.ApproverUserID
	if in.Active != nil {
		r.Active = *in.Active
	} else if isNew {
		r.Active = true
	}
	return ""
}

func CreateRecurringTask(c *gin.Context) {
	var in recurringInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "data tidak valid"})
		return
	}
	r := models.RecurringTask{CreatedByUserID: uid(c)}
	if msg := fillRecurring(c, in, &r, true); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	database.DB.Create(&r)
	audit(c, "create", "recurring_task", r.ID)
	GenerateRecurringTasks() // an occurrence dated today appears immediately
	c.JSON(http.StatusOK, r)
}

func loadRecurring(c *gin.Context) (models.RecurringTask, bool) {
	var r models.RecurringTask
	if database.DB.Limit(1).Find(&r, paramID(c)).Error != nil || r.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "tugas rutin tidak ditemukan"})
		return r, false
	}
	if !canManageRecurring(c, r) {
		c.JSON(http.StatusForbidden, gin.H{"error": "tidak berwenang mengubah tugas rutin ini"})
		return r, false
	}
	return r, true
}

func UpdateRecurringTask(c *gin.Context) {
	r, ok := loadRecurring(c)
	if !ok {
		return
	}
	var in recurringInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "data tidak valid"})
		return
	}
	if msg := fillRecurring(c, in, &r, false); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	database.DB.Save(&r)
	audit(c, "update", "recurring_task", r.ID)
	GenerateRecurringTasks()
	c.JSON(http.StatusOK, r)
}

// DeleteRecurringTask removes the template; tasks it already generated stay (they just lose the link).
func DeleteRecurringTask(c *gin.Context) {
	r, ok := loadRecurring(c)
	if !ok {
		return
	}
	database.DB.Model(&models.Task{}).Where("recurring_id = ?", r.ID).Updates(map[string]any{"recurring_id": nil, "occurrence_date": nil})
	database.DB.Delete(&r)
	audit(c, "delete", "recurring_task", r.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

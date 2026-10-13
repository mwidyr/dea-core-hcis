package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
)

// ---- activity feed ("Aktivitas Hari Ini"): audit log rows turned into readable lines ----

type activityItem struct {
	ID    uint      `json:"id"`
	At    time.Time `json:"at"`
	Time  string    `json:"time"` // HH:MM WIB
	Actor string    `json:"actor"`
	Title string    `json:"title"`
	Desc  string    `json:"desc"`
	Tone  string    `json:"tone"` // ok | warn | danger | info | muted
	Link  string    `json:"link"`
}

// listActivity: audit rows for what the caller may see — everything for group-level roles without a business filter,
// otherwise the actions of the people in their scope (themselves and their reports); personal = only their own actions.
func listActivity(c *gin.Context, personal bool, date *time.Time, limit, offset int) ([]activityItem, int64) {
	db := database.DB.Table("audit_logs a").Joins("LEFT JOIN users u ON u.id = a.user_id")
	switch {
	case personal:
		db = db.Where("a.user_id = ?", uid(c))
	case isGroupLevel(c) && c.Query("business_id") == "":
		// everything
	default:
		sub := employeeScope(c, database.DB.Model(&models.Employee{})).Select("employees.id")
		db = db.Where("u.employee_id IN (?) OR a.user_id = ?", sub, uid(c))
	}
	if date != nil {
		from := day(*date)
		db = db.Where("a.created_at >= ? AND a.created_at < ?", from, from.AddDate(0, 0, 1))
	}
	var total int64
	db.Count(&total)
	var rows []struct {
		ID        uint
		UserName  string
		Action    string
		Entity    string
		EntityID  string
		CreatedAt time.Time
	}
	db.Select("a.id, u.name AS user_name, a.action, a.entity, a.entity_id, a.created_at").Order("a.id DESC").Limit(limit).Offset(offset).Scan(&rows)

	// batch lookups for the things the rows point at
	ids := map[string][]uint{}
	niks := []string{}
	for _, r := range rows {
		if n, err := strconv.Atoi(r.EntityID); err == nil && n > 0 {
			ids[r.Entity] = append(ids[r.Entity], uint(n))
		}
		if r.Entity == "attendance" {
			niks = append(niks, r.EntityID)
		}
	}
	taskTitle, apTitle, leaveTitle, projName, empName, nikName := map[uint]string{}, map[uint]string{}, map[uint]string{}, map[uint]string{}, map[uint]string{}, map[string]string{}
	if v := ids["task"]; len(v) > 0 {
		var ts []models.Task
		database.DB.Select("id, title").Where("id IN ?", v).Find(&ts)
		for _, t := range ts {
			taskTitle[t.ID] = t.Title
		}
	}
	if v := ids["approval_request"]; len(v) > 0 {
		var ars []models.ApprovalRequest
		database.DB.Select("id, title").Where("id IN ?", v).Find(&ars)
		for _, a := range ars {
			apTitle[a.ID] = a.Title
		}
	}
	if v := ids["leave_request"]; len(v) > 0 {
		var ls []models.LeaveRequest
		database.DB.Preload("Employee").Preload("Type").Where("id IN ?", v).Find(&ls)
		for _, l := range ls {
			name, tn := "", ""
			if l.Employee != nil {
				name = l.Employee.Name
			}
			if l.Type != nil {
				tn = l.Type.Name
			}
			leaveTitle[l.ID] = strings.TrimSpace(tn + " — " + name)
		}
	}
	if v := ids["project"]; len(v) > 0 {
		var ps []models.Project
		database.DB.Select("id, name").Where("id IN ?", v).Find(&ps)
		for _, p := range ps {
			projName[p.ID] = p.Name
		}
	}
	if v := ids["employee"]; len(v) > 0 {
		var es []models.Employee
		database.DB.Select("id, name").Where("id IN ?", v).Find(&es)
		for _, e := range es {
			empName[e.ID] = e.Name
		}
	}
	if len(niks) > 0 {
		var es []models.Employee
		database.DB.Select("nik, name").Where("nik IN ?", niks).Find(&es)
		for _, e := range es {
			nikName[e.NIK] = e.Name
		}
	}

	out := make([]activityItem, 0, len(rows))
	for _, r := range rows {
		n, _ := strconv.Atoi(r.EntityID)
		id := uint(n)
		it := activityItem{ID: r.ID, At: r.CreatedAt, Time: r.CreatedAt.In(jkt).Format("15:04"), Actor: r.UserName, Tone: "info"}
		describeActivity(&it, r.Action, r.Entity, r.EntityID, id, taskTitle, apTitle, leaveTitle, projName, empName, nikName)
		out = append(out, it)
	}
	return out, total
}

func describeActivity(it *activityItem, action, entity, entityID string, id uint, tasks, aps, leaves, projects, emps map[uint]string, niks map[string]string) {
	taskLink := fmt.Sprintf("/tasks?open=%d", id)
	switch {
	case entity == "task":
		it.Desc, it.Link = tasks[id], taskLink
		switch {
		case action == "create":
			it.Title = "Tugas dibuat"
		case action == "update":
			it.Title = "Tugas diperbarui"
		case action == "complete":
			it.Title, it.Tone = "Tugas diselesaikan / diajukan approval", "ok"
		case action == "cancel_completion":
			it.Title, it.Tone = "Penyelesaian tugas ditarik", "warn"
		case action == "reopen":
			it.Title, it.Tone = "Tugas dibuka kembali", "warn"
		case action == "delete":
			it.Title, it.Tone, it.Link = "Tugas dihapus", "danger", "/tasks"
		case action == "progress":
			it.Title = "Progress tugas diperbarui"
		case action == "deadline_request":
			it.Title, it.Tone = "Pengajuan perubahan deadline", "warn"
		case action == "deadline_request_cancel":
			it.Title, it.Tone = "Pengajuan deadline dibatalkan", "muted"
		case strings.HasPrefix(action, "status:"):
			it.Title = "Status tugas → " + statusText(strings.TrimPrefix(action, "status:"))
		default:
			it.Title = "Tugas: " + action
		}
	case entity == "approval_request":
		it.Desc, it.Link = aps[id], "/approval-history"
		if action == "approve" {
			it.Title, it.Tone = "Approval disetujui", "ok"
		} else {
			it.Title, it.Tone = "Approval ditolak", "danger"
		}
	case entity == "leave_request":
		it.Desc, it.Link = leaves[id], "/leave"
		if action == "cancel" {
			it.Title, it.Tone = "Pengajuan cuti/izin dibatalkan", "muted"
		} else {
			it.Title, it.Tone = "Pengajuan cuti/izin baru", "warn"
		}
	case entity == "manual_attendance":
		it.Title, it.Link, it.Tone = map[string]string{"create": "Pengajuan absensi manual", "cancel": "Pengajuan absensi manual dibatalkan"}[action], "/attendance", "warn"
	case entity == "roster_adjustment":
		it.Title, it.Link, it.Tone = map[string]string{"create": "Pengajuan penyesuaian roster", "cancel": "Penyesuaian roster dibatalkan"}[action], "/schedule", "warn"
	case entity == "attendance":
		it.Desc, it.Link = niks[entityID], "/attendance"
		if action == "tap_out" {
			it.Title = "Tap Out"
		} else {
			it.Title, it.Tone = "Tap In", "ok"
		}
	case entity == "employee":
		it.Desc, it.Link = emps[id], fmt.Sprintf("/employees/%d", id)
		switch {
		case strings.HasPrefix(action, "status:"):
			it.Title, it.Tone = "Status karyawan → "+strings.TrimPrefix(action, "status:"), "warn"
		case action == "delete":
			it.Title, it.Tone, it.Link = "Karyawan dihapus", "danger", "/employees"
		default:
			it.Title = "Data karyawan diperbarui"
		}
	case entity == "employee_contract", entity == "employee_competency", entity == "employee_document":
		it.Title, it.Link = "Data karyawan diperbarui ("+strings.TrimPrefix(entity, "employee_")+")", "/employees"
	case entity == "project" || entity == "project_document":
		it.Desc, it.Link = projects[id], fmt.Sprintf("/projects/%d", id)
		it.Title = map[string]string{"create": "Proyek dibuat", "update": "Proyek diperbarui", "delete": "Proyek dihapus", "weights": "Bobot proyek diatur", "upload": "Dokumen proyek diunggah"}[action]
		if entity == "project_document" {
			it.Link = "/projects"
		}
	case strings.HasPrefix(entity, "kpi_period"):
		it.Title, it.Link, it.Tone = map[string]string{"close": "Periode KPI ditutup", "reopen": "Periode KPI dibuka kembali"}[action], "/kpi", "warn"
	case strings.HasPrefix(entity, "report:"):
		it.Title, it.Desc, it.Link = "Laporan diekspor", strings.TrimPrefix(entity, "report:"), "/reports"
	case entity == "leave_balance":
		it.Title, it.Link = "Saldo cuti disesuaikan", "/leave"
	case entity == "user" || strings.HasPrefix(entity, "role_permissions"):
		it.Title, it.Link = "Pengaturan user/hak akses diubah", "/settings"
	}
	if it.Title == "" { // anything else (setup organisasi, kalender, KPI, …): a generic readable line
		it.Title = strings.ToUpper(action[:1]) + action[1:] + " " + strings.ReplaceAll(entity, "_", " ")
	}
	if strings.HasPrefix(action, "grant:") {
		it.Title, it.Desc = "Cuti ditambahkan ("+strings.TrimPrefix(action, "grant:")+" hari)", ""
	}
}

// DashboardActivity: GET /dashboard/activity?date=YYYY-MM-DD&page=1&page_size=50&scope=me|team (no date = all days).
func DashboardActivity(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 200 {
		size = 50
	}
	var date *time.Time
	if v := c.Query("date"); v != "" {
		if d, ok := parseDate(v); ok {
			date = &d
		}
	}
	items, total := listActivity(c, c.Query("scope") == "me", date, size, (page-1)*size)
	c.JSON(http.StatusOK, gin.H{"data": items, "total": total, "page": page, "page_size": size})
}

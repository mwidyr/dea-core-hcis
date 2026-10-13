package handlers

import (
	"fmt"
	"time"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"gorm.io/gorm"
)

// ---- ketepatan (timeliness) ----
//
//	Done                       → Selesai (tepat waktu / terlambat, from the completion date vs the deadline)
//	To Do and its start date has been reached → Terlambat Mulai
//	In Progress or Review and past the deadline → Overdue
//	anything still before its deadline → On Track        (Review follows the same rules as In Progress)

const (
	tmLateStart  = "late_start"
	tmOverdue    = "overdue"
	tmOnTrack    = "on_track"
	tmDoneOnTime = "done_on_time"
	tmDoneLate   = "done_late"
	tmNone       = ""
)

var timelinessLabel = map[string]string{
	tmLateStart: "Terlambat Mulai", tmOverdue: "Overdue", tmOnTrack: "On Track", tmDoneOnTime: "Selesai Tepat Waktu", tmDoneLate: "Selesai Terlambat",
}

// taskTimeliness takes the EFFECTIVE status (derived for parents) and today's date.
func taskTimeliness(status string, start, due, completedAt *time.Time, now time.Time) string {
	now = day(now)
	switch status {
	case "done":
		if due == nil || completedAt == nil {
			return tmDoneOnTime
		}
		if day(*completedAt).After(day(*due)) {
			return tmDoneLate
		}
		return tmDoneOnTime
	case "todo":
		if start != nil && !day(*start).After(now) {
			return tmLateStart
		}
		if start == nil && due != nil && day(*due).Before(now) {
			return tmOverdue
		}
	case "in_progress", "review":
		if due != nil && day(*due).Before(now) {
			return tmOverdue
		}
	}
	if due == nil && start == nil {
		return tmNone
	}
	return tmOnTrack
}

// ---- org helpers ----

// uplineIDs lists every superior of an employee, from the direct manager up to the top of the chain.
func uplineIDs(empID uint) []uint {
	var ids []uint
	database.DB.Raw(`WITH RECURSIVE u AS (
		SELECT manager_id AS id FROM employees WHERE id = ? AND manager_id IS NOT NULL
		UNION SELECT e.manager_id FROM employees e JOIN u ON e.id = u.id WHERE e.manager_id IS NOT NULL)
		SELECT id FROM u`, empID).Scan(&ids)
	return ids
}

// inUpline: is `target` somewhere above `me` in the reporting line?
func inUpline(me, target uint) bool {
	for _, id := range uplineIDs(me) {
		if id == target {
			return true
		}
	}
	return false
}

type unitAt struct {
	Level int    `json:"level"`
	Name  string `json:"name"`
}

// unitChains maps unit id → its ancestors from the root down to the unit itself (for grouping "per level").
func unitChains() map[uint][]unitAt {
	var us []models.OrgUnit
	database.DB.Select("id, parent_id, level, name").Find(&us)
	byID := map[uint]models.OrgUnit{}
	for _, u := range us {
		byID[u.ID] = u
	}
	out := map[uint][]unitAt{}
	for _, u := range us {
		var chain []unitAt
		for cur, i := u, 0; i < 12; i++ {
			chain = append([]unitAt{{cur.Level, cur.Name}}, chain...)
			if cur.ParentID == nil {
				break
			}
			p, ok := byID[*cur.ParentID]
			if !ok {
				break
			}
			cur = p
		}
		out[u.ID] = chain
	}
	return out
}

// ---- history ----

func histDate(t *time.Time) string {
	if t == nil {
		return ""
	}
	return day(*t).Format("2006-01-02")
}

// logTask writes one change-log row ("Riwayat perubahan").
func logTask(tx *gorm.DB, taskID, userID uint, field, oldV, newV, note string) {
	if oldV == newV && note == "" {
		return
	}
	tx.Create(&models.TaskHistory{TaskID: taskID, UserID: userID, Field: field, OldValue: oldV, NewValue: newV, Note: note})
}

func ftoa(p *float64) string {
	if p == nil {
		return ""
	}
	return fmt.Sprintf("%g", *p)
}

var statusLabels = map[string]string{"todo": "To Do", "in_progress": "In Progress", "review": "Menunggu Approval", "done": "Selesai"}

func statusText(s string) string {
	if l, ok := statusLabels[s]; ok {
		return l
	}
	return s
}

// lastActor: the user who took the latest decision on an approval request (0 = nobody yet).
func lastActor(tx *gorm.DB, requestID uint) uint {
	var s models.ApprovalStep
	if tx.Where("request_id = ? AND acted_by_user_id IS NOT NULL", requestID).Order("level DESC").Limit(1).Find(&s).Error == nil && s.ActedByUserID != nil {
		return *s.ActedByUserID
	}
	return 0
}

func empLabel(tx *gorm.DB, id *uint) string {
	if id == nil {
		return ""
	}
	var e models.Employee
	tx.Select("id", "name").Limit(1).Find(&e, *id)
	return e.Name
}

func prio(p string) string {
	if p == "tinggi" {
		return "Tinggi"
	}
	return "Normal"
}

func boolText(b bool) string {
	if b {
		return "Ya"
	}
	return "Tidak"
}

// logTaskChanges writes one history row per field that an edit changed.
func logTaskChanges(tx *gorm.DB, userID uint, a, b models.Task) {
	if a.Title != b.Title {
		logTask(tx, b.ID, userID, "title", a.Title, b.Title, "")
	}
	if a.Description != b.Description {
		logTask(tx, b.ID, userID, "description", "", "diubah", "")
	}
	if a.Priority != b.Priority {
		logTask(tx, b.ID, userID, "priority", prio(a.Priority), prio(b.Priority), "")
	}
	if a.PICID != b.PICID {
		pa, pb := a.PICID, b.PICID
		logTask(tx, b.ID, userID, "pic", empLabel(tx, &pa), empLabel(tx, &pb), "")
	}
	if ptrU(a.AssignerID) != ptrU(b.AssignerID) {
		logTask(tx, b.ID, userID, "assigner", empLabel(tx, a.AssignerID), empLabel(tx, b.AssignerID), "")
	}
	if histDate(a.StartDate) != histDate(b.StartDate) {
		logTask(tx, b.ID, userID, "start_date", histDate(a.StartDate), histDate(b.StartDate), "")
	}
	if histDate(a.DueDate) != histDate(b.DueDate) {
		logTask(tx, b.ID, userID, "due_date", histDate(a.DueDate), histDate(b.DueDate), "diubah langsung oleh atasan/pemberi tugas")
	}
	if ftoa(a.Weight) != ftoa(b.Weight) {
		logTask(tx, b.ID, userID, "weight", ftoa(a.Weight), ftoa(b.Weight), "")
	}
	if a.RequireResult != b.RequireResult {
		logTask(tx, b.ID, userID, "require_result", boolText(a.RequireResult), boolText(b.RequireResult), "")
	}
	if a.RequiresApproval != b.RequiresApproval {
		logTask(tx, b.ID, userID, "requires_approval", boolText(a.RequiresApproval), boolText(b.RequiresApproval), "")
	}
	if ptrU(a.ProjectID) != ptrU(b.ProjectID) {
		logTask(tx, b.ID, userID, "project", fmt.Sprint(ptrU(a.ProjectID)), fmt.Sprint(ptrU(b.ProjectID)), "")
	}
}

func ptrU(p *uint) uint {
	if p == nil {
		return 0
	}
	return *p
}

// maxApprovalLevels: how many superior levels a task's completion approval may climb for this PIC —
// all the way to the top of their reporting line (at least 1: with no superior the request falls back to HR).
func maxApprovalLevels(picID uint) int {
	if n := len(uplineIDs(picID)); n > 1 {
		return n
	}
	return 1
}

const hardMaxApprovalLevels = 10

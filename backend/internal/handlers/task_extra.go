package handlers

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/dea-core/hcis/backend/internal/approval"
	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func init() { approval.Hooks["task_deadline"] = taskDeadlineHook }

// SetTaskProgress sets the manual progress (0–100) of a task WITHOUT sub tasks (sub tasks included).
// A parent's progress is always calculated from its children.
func SetTaskProgress(c *gin.Context) {
	t, ok := loadTask(c)
	if !ok {
		return
	}
	var in struct {
		Progress *int   `json:"progress"`
		Note     string `json:"note"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.Progress == nil || *in.Progress < 0 || *in.Progress > 100 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "progress harus berupa angka 0–100"})
		return
	}
	if r := rolesOn(c, t); !r.Manager && !r.PIC {
		c.JSON(http.StatusForbidden, gin.H{"error": "hanya PIC atau pemberi tugas yang dapat mengubah progress"})
		return
	}
	if calcFor(t.BusinessID).isParent(t.ID) {
		c.JSON(http.StatusConflict, gin.H{"error": "progress tugas induk dihitung dari sub tugasnya"})
		return
	}
	if t.Status == "review" || t.Status == "done" {
		c.JSON(http.StatusConflict, gin.H{"error": "tugas sudah diajukan/ditutup; batalkan penyelesaian atau buka kembali dulu"})
		return
	}
	newP := *in.Progress
	oldP := t.ProgressPct
	upd := map[string]any{"progress_pct": newP}
	prev := t.Status
	if newP > 0 && t.Status == "todo" { // working on it means it has started
		upd["status"] = "in_progress"
		if t.ActualStart == nil {
			upd["actual_start"] = time.Now()
		}
	}
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		logTask(tx, t.ID, uid(c), "progress", fmt.Sprintf("%d%%", oldP), fmt.Sprintf("%d%%", newP), in.Note)
		if _, started := upd["status"]; started {
			logTask(tx, t.ID, uid(c), "status", statusText(prev), statusText("in_progress"), "otomatis saat progress diisi")
		}
		return tx.Model(&models.Task{}).Where("id = ?", t.ID).Updates(upd).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	audit(c, "progress", "task", t.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true, "progress": newP})
}

// ---- deadline change request ----

// RequestDeadlineChange: the PIC asks for a new deadline with a note; it only changes once the approver approves.
func RequestDeadlineChange(c *gin.Context) {
	t, ok := loadTask(c)
	if !ok {
		return
	}
	var in struct {
		NewDue string `json:"new_due"`
		Note   string `json:"note"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "data tidak valid"})
		return
	}
	if !rolesOn(c, t).PIC {
		c.JSON(http.StatusForbidden, gin.H{"error": "hanya PIC yang mengajukan perubahan deadline; atasan/pemberi tugas dapat mengubahnya langsung lewat Ubah Tugas"})
		return
	}
	newDue, okd := parseDate(in.NewDue)
	if !okd {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tanggal deadline baru tidak valid"})
		return
	}
	note := strings.TrimSpace(in.Note)
	if note == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "catatan/alasan perubahan deadline wajib diisi"})
		return
	}
	if calcFor(t.BusinessID).isParent(t.ID) {
		c.JSON(http.StatusConflict, gin.H{"error": "deadline tugas induk diatur lewat Ubah Tugas atau pada sub tugasnya"})
		return
	}
	if t.Status == "done" || t.Status == "review" {
		c.JSON(http.StatusConflict, gin.H{"error": "tugas sudah diajukan atau selesai"})
		return
	}
	if t.StartDate != nil && day(newDue).Before(day(*t.StartDate)) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "deadline baru tidak boleh sebelum tanggal mulai"})
		return
	}
	if t.DueDate != nil && day(newDue).Equal(day(*t.DueDate)) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "deadline baru sama dengan deadline saat ini"})
		return
	}
	var pending int64
	database.DB.Model(&models.TaskDeadlineRequest{}).Where("task_id = ? AND status = 'Pending Approval'", t.ID).Count(&pending)
	if pending > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "sudah ada pengajuan perubahan deadline yang menunggu approval"})
		return
	}
	var req models.TaskDeadlineRequest
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		var e error
		req, e = createDeadlineRequest(tx, t, newDue, note, uid(c))
		return e
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var step models.ApprovalStep
	if database.DB.Where("request_id = ? AND status = 'Pending'", *req.ApprovalID).Limit(1).Find(&step).Error == nil && step.ID != 0 {
		notify(step.ApproverUserID, "approval_request", "Pengajuan perubahan deadline", t.Title+" — "+note, "/approval", fmt.Sprintf("task-deadline:%d", req.ID))
	}
	audit(c, "deadline_request", "task", t.ID)
	c.JSON(http.StatusOK, req)
}

// createDeadlineRequest files the request + its approval and writes the history row. actor = the user doing it.
func createDeadlineRequest(tx *gorm.DB, t models.Task, newDue time.Time, note string, actor uint) (models.TaskDeadlineRequest, error) {
	var picUser models.User
	tx.Where("employee_id = ? AND is_active = true", t.PICID).Limit(1).Find(&picUser)
	requester := picUser.ID
	if requester == 0 {
		requester = actor
	}
	req := models.TaskDeadlineRequest{TaskID: t.ID, RequestedBy: requester, OldDue: t.DueDate, NewDue: day(newDue), Note: note, Status: "Pending Approval"}
	if err := tx.Create(&req).Error; err != nil {
		return req, err
	}
	var assigned *uint
	if t.ApproverUserID != nil && *t.ApproverUserID != requester {
		assigned = t.ApproverUserID
	}
	summary := fmt.Sprintf("%s → %s · %s", orDash(histDate(t.DueDate)), day(newDue).Format("2006-01-02"), note)
	ar, err := approval.Submit(tx, approval.SubmitInput{Type: "task_deadline", RefID: req.ID, BusinessID: t.BusinessID, RequesterEmployeeID: &t.PICID, RequesterUserID: requester,
		Title: "Perubahan Deadline — " + t.Title, Summary: summary, AssignedUserID: assigned, Levels: t.ApprovalLevels})
	if err != nil {
		return req, err
	}
	req.ApprovalID = &ar.ID
	if err := tx.Save(&req).Error; err != nil {
		return req, err
	}
	logTask(tx, t.ID, actor, "deadline_request", histDate(t.DueDate), day(newDue).Format("2006-01-02"), "pengajuan perubahan deadline: "+note)
	return req, nil
}

func orDash(s string) string {
	if s == "" {
		return "–"
	}
	return s
}

// CancelDeadlineRequest withdraws the pending request (by the PIC / requester).
func CancelDeadlineRequest(c *gin.Context) {
	t, ok := loadTask(c)
	if !ok {
		return
	}
	var req models.TaskDeadlineRequest
	if database.DB.Where("task_id = ? AND status = 'Pending Approval'", t.ID).Order("id DESC").Limit(1).Find(&req).Error != nil || req.ID == 0 || req.ApprovalID == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "tidak ada pengajuan deadline yang menunggu"})
		return
	}
	r := rolesOn(c, t)
	if !r.PIC && !r.Manager {
		c.JSON(http.StatusForbidden, gin.H{"error": "tidak berwenang"})
		return
	}
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		_, e := approval.Cancel(tx, *req.ApprovalID, req.RequestedBy)
		return e
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	audit(c, "deadline_request_cancel", "task", t.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// taskDeadlineHook applies the decision: approved → the task's deadline becomes the requested date.
func taskDeadlineHook(tx *gorm.DB, ar *models.ApprovalRequest, outcome string) error {
	var req models.TaskDeadlineRequest
	if err := tx.First(&req, ar.RefID).Error; err != nil {
		return err
	}
	var t models.Task
	if err := tx.First(&t, req.TaskID).Error; err != nil {
		return err
	}
	actor := lastActor(tx, ar.ID)
	var pu models.User
	tx.Where("employee_id = ? AND is_active = true", t.PICID).Limit(1).Find(&pu)
	link := fmt.Sprintf("/tasks?open=%d", t.ID)
	switch outcome {
	case approval.Approved:
		oldDue := histDate(t.DueDate)
		nd := req.NewDue
		t.DueDate = &nd
		req.Status = "Disetujui"
		if err := tx.Save(&t).Error; err != nil {
			return err
		}
		logTask(tx, t.ID, actor, "due_date", oldDue, histDate(&nd), "perubahan deadline disetujui: "+req.Note)
		if pu.ID != 0 {
			notify(pu.ID, "task_deadline", "Perubahan deadline disetujui", t.Title+" → "+fmtShort(nd), link, fmt.Sprintf("task-deadline-ok:%d", req.ID))
		}
	case approval.Rejected:
		req.Status = "Ditolak"
		logTask(tx, t.ID, actor, "deadline_request", histDate(t.DueDate), histDate(&req.NewDue), "pengajuan deadline ditolak: "+ar.DecisionNote)
		if pu.ID != 0 {
			notify(pu.ID, "task_deadline", "Perubahan deadline ditolak", t.Title+" — "+ar.DecisionNote, link, fmt.Sprintf("task-deadline-no:%d", req.ID))
		}
	case approval.Cancelled:
		req.Status = "Dibatalkan"
		logTask(tx, t.ID, ar.RequesterUserID, "deadline_request", histDate(t.DueDate), histDate(&req.NewDue), "pengajuan deadline dibatalkan")
	}
	return tx.Save(&req).Error
}

// taskExtras are the parts of GET /tasks/:id that sit beside the task itself: change history and deadline requests.
func taskExtras(t models.Task) (history []models.TaskHistory, requests []models.TaskDeadlineRequest) {
	history = []models.TaskHistory{}
	database.DB.Where("task_id = ?", t.ID).Order("id DESC").Limit(500).Find(&history)
	requests = []models.TaskDeadlineRequest{}
	database.DB.Where("task_id = ?", t.ID).Order("id DESC").Limit(20).Find(&requests)
	names := map[uint]string{}
	var us []models.User
	database.DB.Select("id, name").Find(&us)
	for _, u := range us {
		names[u.ID] = u.Name
	}
	for i := range history {
		history[i].UserName = names[history[i].UserID]
		if history[i].UserID == 0 {
			history[i].UserName = "Sistem"
		}
	}
	waiting := map[uint]string{}
	for i := range requests {
		requests[i].UserName = names[requests[i].RequestedBy]
		if requests[i].Status == "Pending Approval" && requests[i].ApprovalID != nil {
			if _, ok := waiting[*requests[i].ApprovalID]; !ok {
				var s models.ApprovalStep
				if database.DB.Where("request_id = ? AND status = 'Pending'", *requests[i].ApprovalID).Limit(1).Find(&s).Error == nil && s.ID != 0 {
					waiting[*requests[i].ApprovalID] = names[s.ApproverUserID]
				}
			}
			requests[i].WaitingFor = waiting[*requests[i].ApprovalID]
		}
	}
	return
}

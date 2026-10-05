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

func init() { approval.Hooks["roster"] = rosterAdjustmentHook }

// Approved adjustments take effect automatically: the schedule resolver reads them (status = Disetujui).
func rosterAdjustmentHook(tx *gorm.DB, req *models.ApprovalRequest, outcome string) error {
	var a models.RosterAdjustment
	if err := tx.First(&a, req.RefID).Error; err != nil {
		return err
	}
	switch outcome {
	case approval.Approved:
		a.Status = "Disetujui"
	case approval.Rejected:
		a.Status = "Ditolak"
	case approval.Cancelled:
		a.Status = "Dibatalkan"
	}
	return tx.Save(&a).Error
}

type adjustmentView struct {
	models.RosterAdjustment
	EmployeeName string `json:"employee_name"`
	UnitName     string `json:"unit_name"`
	WaitingFor   string `json:"waiting_for"`
	CanCancel    bool   `json:"can_cancel"`
}

func ListRosterAdjustments(c *gin.Context) {
	q := scopeBusiness(c, database.DB.Model(&models.RosterAdjustment{}), "roster_adjustments.business_id")
	if !isGroupLevel(c) {
		me := myEmployeeID(c)
		if me == nil {
			q = q.Where("1 = 0")
		} else {
			q = q.Where("roster_adjustments.employee_id = ? OR roster_adjustments.employee_id IN "+downlineSQL, *me, *me)
		}
	}
	var l []models.RosterAdjustment
	q.Order("roster_adjustments.created_at DESC").Limit(500).Find(&l)
	emps := map[uint]models.Employee{}
	var es []models.Employee
	database.DB.Preload("Unit").Select("id, name, unit_id").Find(&es)
	for _, e := range es {
		emps[e.ID] = e
	}
	waiting := map[uint]string{}
	var ws []struct {
		RequestID uint
		Name      string
	}
	database.DB.Raw(`SELECT s.request_id, u.name FROM approval_steps s JOIN users u ON u.id = s.approver_user_id WHERE s.status = 'Pending'
		AND s.request_id IN (SELECT approval_id FROM roster_adjustments WHERE status = 'Pending Approval')`).Scan(&ws)
	for _, w := range ws {
		waiting[w.RequestID] = w.Name
	}
	me := myEmployeeID(c)
	out := make([]adjustmentView, 0, len(l))
	for _, a := range l {
		v := adjustmentView{RosterAdjustment: a, EmployeeName: emps[a.EmployeeID].Name}
		if u := emps[a.EmployeeID].Unit; u != nil {
			v.UnitName = u.Name
		}
		if a.ApprovalID != nil {
			v.WaitingFor = waiting[*a.ApprovalID]
		}
		v.CanCancel = a.Status == "Pending Approval" && (isGroupLevel(c) || (me != nil && *me == a.EmployeeID) || isDirectManagerOf(c, a.EmployeeID))
		out = append(out, v)
	}
	c.JSON(http.StatusOK, out)
}

// CreateRosterAdjustment: the employee, their direct superior, or schedule managers can ask to turn a date range
// of a roster member into work or off days. It goes through approval (n+1, or an assigned approver).
func CreateRosterAdjustment(c *gin.Context) {
	var in struct {
		EmployeeID     uint   `json:"employee_id"`
		StartDate      string `json:"start_date"`
		EndDate        string `json:"end_date"`
		Kind           string `json:"kind"`
		Reason         string `json:"reason"`
		AssignedUserID *uint  `json:"assigned_user_id"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "data tidak valid"})
		return
	}
	start, ok1 := parseDate(in.StartDate)
	end, ok2 := parseDate(in.EndDate)
	if !ok1 || !ok2 || (in.Kind != "kerja" && in.Kind != "off") || strings.TrimSpace(in.Reason) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tanggal mulai/selesai, jenis (kerja/libur), dan alasan wajib diisi"})
		return
	}
	if end.Before(start) || end.Sub(start) > 60*24*time.Hour {
		c.JSON(http.StatusBadRequest, gin.H{"error": "rentang tanggal tidak valid (maksimal 60 hari)"})
		return
	}
	if end.Before(today().AddDate(0, 0, -7)) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "penyesuaian tidak boleh untuk tanggal lebih dari 7 hari yang lalu"})
		return
	}
	me := myEmployeeID(c)
	empID := in.EmployeeID
	if empID == 0 && me != nil {
		empID = *me
	}
	if empID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "pilih karyawan"})
		return
	}
	if !(me != nil && *me == empID) && !canManageSchedule(c) && !isDirectManagerOf(c, empID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Anda hanya dapat mengajukan untuk diri sendiri atau bawahan langsung Anda"})
		return
	}
	var emp models.Employee
	if database.DB.Limit(1).Find(&emp, empID).Error != nil || emp.ID == 0 || emp.Status != "Aktif" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "karyawan tidak ditemukan atau tidak aktif"})
		return
	}
	if _, member := newResolver(start, end).rosterOf[empID]; !member {
		c.JSON(http.StatusBadRequest, gin.H{"error": "karyawan ini tidak mengikuti roster, jadwalnya mengikuti kalender kerja"})
		return
	}
	var dup int64
	database.DB.Model(&models.RosterAdjustment{}).Where("employee_id = ? AND status = 'Pending Approval' AND start_date <= ? AND end_date >= ?", empID, end, start).Count(&dup)
	if dup > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "sudah ada pengajuan penyesuaian yang menunggu pada rentang tanggal tersebut"})
		return
	}
	var empUser models.User
	database.DB.Where("employee_id = ?", empID).Limit(1).Find(&empUser)
	requester := empUser.ID
	if requester == 0 {
		requester = uid(c)
	}
	var a models.RosterAdjustment
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		a = models.RosterAdjustment{EmployeeID: empID, BusinessID: emp.BusinessID, StartDate: start, EndDate: end, Kind: in.Kind, Reason: strings.TrimSpace(in.Reason), Status: "Pending Approval"}
		if err := tx.Create(&a).Error; err != nil {
			return err
		}
		label := map[string]string{"kerja": "KERJA", "off": "LIBUR"}[in.Kind]
		req, err := approval.Submit(tx, approval.SubmitInput{Type: "roster", RefID: a.ID, BusinessID: emp.BusinessID, RequesterEmployeeID: &empID, RequesterUserID: requester,
			Title: "Penyesuaian Roster — " + emp.Name, Summary: fmt.Sprintf("%s – %s → %s · %s", start.Format("02/01/06"), end.Format("02/01/06"), label, a.Reason), AssignedUserID: in.AssignedUserID})
		if err != nil {
			return err
		}
		a.ApprovalID = &req.ID
		return tx.Model(&a).Update("approval_id", req.ID).Error
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	audit(c, "create", "roster_adjustment", a.ID)
	c.JSON(http.StatusOK, a)
}

func CancelRosterAdjustment(c *gin.Context) {
	var a models.RosterAdjustment
	if database.DB.Limit(1).Find(&a, paramID(c)).Error != nil || a.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "pengajuan tidak ditemukan"})
		return
	}
	me := myEmployeeID(c)
	if !isGroupLevel(c) && !(me != nil && *me == a.EmployeeID) && !isDirectManagerOf(c, a.EmployeeID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "tidak berwenang membatalkan"})
		return
	}
	if a.Status != "Pending Approval" || a.ApprovalID == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "hanya pengajuan yang menunggu yang dapat dibatalkan"})
		return
	}
	var req models.ApprovalRequest
	database.DB.First(&req, *a.ApprovalID)
	err := database.DB.Transaction(func(tx *gorm.DB) error { _, e := approval.Cancel(tx, req.ID, req.RequesterUserID); return e })
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	audit(c, "cancel", "roster_adjustment", a.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

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
	"gorm.io/gorm"
)

var validStatus = map[string]bool{"Aktif": true, "Suspend": true, "Tidak Bekerja": true}

// employeeBizScope: like scopeBusiness, but an employee also belongs to every business they have an
// additional placement in (multi-business), not only their primary one.
func employeeBizScope(c *gin.Context, q *gorm.DB) *gorm.DB {
	allowed := allowedBusinessIDs(c)
	const sub = "employees.id IN (SELECT employee_id FROM employee_placements WHERE business_id "
	if b, _ := strconv.Atoi(c.Query("business_id")); b > 0 {
		if allowed != nil {
			ok := false
			for _, id := range allowed {
				ok = ok || id == uint(b)
			}
			if !ok {
				return q.Where("1 = 0")
			}
		}
		return q.Where("employees.business_id = ? OR "+sub+"= ?)", b, b)
	}
	if allowed != nil {
		return q.Where("employees.business_id IN ? OR "+sub+"IN ?)", allowed, allowed)
	}
	return q
}

func ListEmployees(c *gin.Context) {
	q := employeeBizScope(c, database.DB.Model(&models.Employee{}))
	if s := c.Query("q"); s != "" {
		like := "%" + s + "%"
		q = q.Where("employees.name ILIKE ? OR employees.email ILIKE ? OR employees.nik ILIKE ? OR employees.position_id IN (SELECT id FROM positions WHERE title ILIKE ?)", like, like, like, like)
	}
	if v := c.Query("unit_id"); v != "" {
		q = q.Where("employees.unit_id = ?", v)
	}
	if v := c.Query("employee_type"); v != "" {
		q = q.Where("employees.employee_type = ?", v)
	}
	if v := c.Query("status"); v != "" {
		q = q.Where("employees.status = ?", v)
	}
	var total int64
	q.Count(&total)
	// stats cover the whole business scope, independent of search/filter/page
	base := employeeBizScope(c, database.DB.Model(&models.Employee{})).Where("employees.status = 'Aktif'")
	var active, tetap, kontrak, freelance, multi, expiring int64
	base.Count(&active)
	base.Session(&gorm.Session{}).Where("employees.employee_type = ?", "Tetap").Count(&tetap)
	base.Session(&gorm.Session{}).Where("employees.employee_type = ?", "Kontrak").Count(&kontrak)
	base.Session(&gorm.Session{}).Where("employees.employee_type = ?", "Freelance").Count(&freelance)
	base.Session(&gorm.Session{}).Where("employees.id IN (SELECT employee_id FROM employee_placements GROUP BY employee_id HAVING COUNT(*) > 1)").Count(&multi)
	base.Session(&gorm.Session{}).Where("employees.contract_end IS NOT NULL AND employees.contract_end <= ?", time.Now().AddDate(0, 0, 30)).Count(&expiring)

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 1000 {
		size = 50
	}
	var l []models.Employee
	q.Preload("Position").Preload("Unit").Preload("Location").Preload("Business").
		Preload("Placements.Position").Preload("Placements.Business").
		Order("employees.name").Limit(size).Offset((page - 1) * size).Find(&l)
	c.JSON(http.StatusOK, gin.H{"data": l, "total": total, "page": page, "page_size": size,
		"stats": gin.H{"active": active, "tetap": tetap, "kontrak": kontrak, "freelance": freelance, "multi": multi, "expiring": expiring}})
}

func GetEmployee(c *gin.Context) {
	var e models.Employee
	err := database.DB.Preload("Position").Preload("Unit").Preload("Location").Preload("Business").
		Preload("Placements.Position").Preload("Placements.Business").First(&e, paramID(c)).Error
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "karyawan tidak ditemukan"})
		return
	}
	c.JSON(http.StatusOK, e)
}

func SaveEmployee(c *gin.Context) {
	var in models.Employee
	if err := c.ShouldBindJSON(&in); err != nil || strings.TrimSpace(in.Name) == "" || in.BusinessID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "nama dan bisnis wajib diisi"})
		return
	}
	if database.DB.First(&models.Business{}, in.BusinessID).Error != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bisnis tidak valid"})
		return
	}
	in.ID = paramID(c)
	in.Name = strings.TrimSpace(in.Name)
	in.Position, in.Unit, in.Location, in.Business, in.Placements = nil, nil, nil, nil, nil

	oldNIK := ""
	if in.ID != 0 { // status / active flag are changed only through the status endpoint
		var old models.Employee
		if database.DB.First(&old, in.ID).Error != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "karyawan tidak ditemukan"})
			return
		}
		in.Status, in.StatusNote, in.IsActive = old.Status, old.StatusNote, old.IsActive
		in.BusinessID = old.BusinessID // business is locked once created
		oldNIK = old.NIK
	} else {
		in.Status, in.IsActive = "Aktif", true
	}
	in.NIK = strings.ToUpper(strings.TrimSpace(in.NIK))
	if in.NIK == "" {
		in.NIK = oldNIK // an edit that does not mention the NIK keeps it (it is the attendance login)
	}
	if in.NIK != "" {
		var dup int64
		database.DB.Model(&models.Employee{}).Where("lower(nik) = lower(?) AND id <> ?", in.NIK, in.ID).Count(&dup)
		if dup > 0 {
			c.JSON(http.StatusConflict, gin.H{"error": "NIK sudah dipakai karyawan lain"})
			return
		}
	} else { // auto-number: <business code>-0001…
		var b models.Business
		database.DB.Limit(1).Find(&b, in.BusinessID)
		var n int64
		database.DB.Model(&models.Employee{}).Where("business_id = ?", in.BusinessID).Count(&n)
		for i := n + 1; ; i++ {
			cand := fmt.Sprintf("%s-%04d", b.Code, i)
			var taken int64
			database.DB.Model(&models.Employee{}).Where("lower(nik) = lower(?) AND id <> ?", cand, in.ID).Count(&taken)
			if taken == 0 {
				in.NIK = cand
				break
			}
		}
	}
	if in.WorkCalendarID != nil {
		var cal models.WorkCalendar
		if database.DB.Limit(1).Find(&cal, *in.WorkCalendarID).Error != nil || cal.ID == 0 || cal.BusinessID != in.BusinessID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "kalender kerja tidak sesuai dengan bisnis karyawan"})
			return
		}
	}
	if in.EmployeeType != "Kontrak" && in.EmployeeType != "Freelance" { // freelance may carry an optional engagement period
		in.ContractStart, in.ContractEnd = nil, nil
	}
	// n+1: default manager = holder of the position this position reports to
	if in.PositionID != nil {
		var p models.Position
		if database.DB.First(&p, *in.PositionID).Error != nil || p.BusinessID != in.BusinessID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "jabatan tidak sesuai dengan bisnis"})
			return
		}
		in.UnitID = p.UnitID
		if in.ManagerID == nil && p.ReportsToID != nil {
			var m models.Employee
			if database.DB.Where("position_id = ?", *p.ReportsToID).Limit(1).Find(&m).Error == nil && m.ID != 0 && m.ID != in.ID {
				in.ManagerID = &m.ID
			}
		}
	}
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		isNew := in.ID == 0
		if err := tx.Save(&in).Error; err != nil {
			return err
		}
		if isNew && in.PositionID != nil { // primary placement row
			return tx.Create(&models.EmployeePlacement{EmployeeID: in.ID, BusinessID: in.BusinessID, PositionID: *in.PositionID, IsPrimary: true}).Error
		}
		if !isNew && in.PositionID != nil {
			return tx.Model(&models.EmployeePlacement{}).Where("employee_id = ? AND is_primary = true", in.ID).Update("position_id", *in.PositionID).Error
		}
		return nil
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	audit(c, "save", "employee", in.ID)
	c.JSON(http.StatusOK, in)
}

// SetEmployeeStatus: Aktif | Suspend | Tidak Bekerja. Non-active employees can't log in.
func SetEmployeeStatus(c *gin.Context) {
	var in struct {
		Status string `json:"status"`
		Note   string `json:"note"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || !validStatus[in.Status] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "status harus Aktif, Suspend, atau Tidak Bekerja"})
		return
	}
	id := paramID(c)
	res := database.DB.Model(&models.Employee{}).Where("id = ?", id).
		Updates(map[string]any{"status": in.Status, "status_note": in.Note, "is_active": in.Status == "Aktif"})
	if res.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "karyawan tidak ditemukan"})
		return
	}
	database.DB.Model(&models.User{}).Where("employee_id = ?", id).Update("is_active", in.Status == "Aktif")
	audit(c, "status:"+in.Status, "employee", id)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// DeleteEmployee removes the employee, placements, uploaded documents (files too) and the
// login account. Subordinates lose their manager link. Prefer "Tidak Bekerja" to keep history.
func DeleteEmployee(c *gin.Context) {
	id := paramID(c)
	var openTasks int64
	database.DB.Model(&models.Task{}).Where("pic_id = ? AND status <> 'done'", id).Count(&openTasks)
	if openTasks > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": fmt.Sprintf("karyawan masih menjadi PIC %d tugas yang belum selesai; alihkan tugasnya dulu atau ubah status menjadi Tidak Bekerja", openTasks)})
		return
	}
	var docs []models.EmployeeDocument
	database.DB.Where("employee_id = ?", id).Find(&docs)
	var leaveFiles []models.LeaveAttachment
	database.DB.Where("leave_request_id IN (SELECT id FROM leave_requests WHERE employee_id = ?)", id).Find(&leaveFiles)
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		// leave data goes with the employee; approvals still waiting on it are closed
		tx.Exec(`UPDATE approval_steps SET status = 'Cancelled' WHERE status IN ('Pending','Waiting') AND request_id IN
			(SELECT id FROM approval_requests WHERE request_type = 'leave' AND status = 'Pending' AND ref_id IN (SELECT id FROM leave_requests WHERE employee_id = ?))`, id)
		tx.Exec(`UPDATE approval_requests SET status = 'Cancelled' WHERE request_type = 'leave' AND status = 'Pending' AND ref_id IN (SELECT id FROM leave_requests WHERE employee_id = ?)`, id)
		tx.Exec("DELETE FROM leave_attachments WHERE leave_request_id IN (SELECT id FROM leave_requests WHERE employee_id = ?)", id)
		tx.Where("employee_id = ?", id).Delete(&models.LeaveRequest{})
		tx.Where("employee_id = ?", id).Delete(&models.LeaveBalance{})
		tx.Where("employee_id = ?", id).Delete(&models.LeaveGrant{})
		tx.Where("employee_id = ?", id).Delete(&models.AttendanceRecord{})
		tx.Where("employee_id = ?", id).Delete(&models.RosterAssignment{})
		tx.Where("employee_id = ?", id).Delete(&models.TaskMember{})
		tx.Exec("UPDATE tasks SET kpi_id = NULL WHERE kpi_id IN (SELECT id FROM employee_kpis WHERE employee_id = ?)", id)
		tx.Where("employee_id = ?", id).Delete(&models.EmployeeKPI{})
		tx.Exec(`UPDATE approval_requests SET status = 'Cancelled' WHERE request_type = 'roster' AND status = 'Pending' AND ref_id IN (SELECT id FROM roster_adjustments WHERE employee_id = ?)`, id)
		tx.Where("employee_id = ?", id).Delete(&models.RosterAdjustment{})
		tx.Exec(`UPDATE approval_requests SET status = 'Cancelled' WHERE request_type = 'attendance_manual' AND status = 'Pending' AND ref_id IN (SELECT id FROM manual_attendances WHERE employee_id = ?)`, id)
		tx.Where("employee_id = ?", id).Delete(&models.ManualAttendance{})
		tx.Model(&models.Employee{}).Where("manager_id = ?", id).Update("manager_id", nil)
		tx.Where("employee_id = ?", id).Delete(&models.EmployeeDocument{})
		tx.Where("employee_id = ?", id).Delete(&models.EmployeePlacement{})
		var u models.User
		if tx.Where("employee_id = ?", id).Limit(1).Find(&u).Error == nil && u.ID != 0 {
			tx.Exec("DELETE FROM user_businesses WHERE user_id = ?", u.ID)
			tx.Delete(&u)
		}
		return tx.Delete(&models.Employee{}, id).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	for _, d := range docs {
		Store.Remove(d.LocalPath)
	}
	for _, f := range leaveFiles {
		Store.Remove(f.LocalPath)
	}
	audit(c, "delete", "employee", id)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ContractExpiring lists contracts ending within ?days (default 30).
func ContractExpiring(c *gin.Context) {
	days, _ := strconv.Atoi(c.DefaultQuery("days", "30"))
	l := []models.Employee{}
	scopeBusiness(c, database.DB, "business_id").Preload("Position").
		Where("contract_end IS NOT NULL AND contract_end <= ? AND status = 'Aktif'", time.Now().AddDate(0, 0, days)).
		Order("contract_end").Find(&l)
	c.JSON(http.StatusOK, l)
}

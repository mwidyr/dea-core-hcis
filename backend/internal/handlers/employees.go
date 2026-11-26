package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Status is set manually by HR (never derived from contract dates). Only Aktif / Non aktif keep a login; only Aktif counts as active staff.
var validStatus = map[string]bool{"Aktif": true, "Non aktif": true, "Suspend": true, "Tidak Bekerja": true}

// statusKeepsLogin: Non aktif employees can still sign in, Suspend / Tidak Bekerja cannot.
func statusKeepsLogin(status string) bool { return status == "Aktif" || status == "Non aktif" }

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

// hierarchyScope limits an employee query to the caller themself plus their whole downline (recursive).
// No peers and no superiors. Group-level roles (super admin, HR admin) keep the full view.
func hierarchyScope(c *gin.Context, q *gorm.DB) *gorm.DB {
	if seesAll(c) {
		return q
	}
	me := myEmployeeID(c)
	if me == nil {
		return q.Where("1 = 0")
	}
	return q.Where("employees.id = ? OR employees.id IN "+downlineSQL, *me, *me)
}

// employeeVisible is the pure rule behind hierarchyScope: group-level sees everyone; everybody else sees
// themself and anyone below them, never peers or superiors.
func employeeVisible(group bool, me *uint, target uint, below func(me, target uint) bool) bool {
	if group {
		return true
	}
	if me == nil {
		return false
	}
	return *me == target || below(*me, target)
}

// canSeeEmployee applies employeeVisible for the current request.
func canSeeEmployee(c *gin.Context, target uint) bool {
	if role(c) == "komisaris" { // sees everyone, but only inside the businesses on their account
		var n int64
		employeeBizScope(c, database.DB.Model(&models.Employee{})).Where("employees.id = ?", target).Count(&n)
		if n > 0 {
			return true
		}
		return employeeVisible(false, myEmployeeID(c), target, inDownline)
	}
	return employeeVisible(isGroupLevel(c), myEmployeeID(c), target, inDownline)
}

// EmployeeOptions is a light picker list (id, name, nik, unit, business). ?scope=team keeps the caller's
// own hierarchy (self + downline); the default is everyone active in the caller's businesses, which the
// task form needs for giver / member / watcher pickers.
func EmployeeOptions(c *gin.Context) {
	q := database.DB.Model(&models.Employee{}).Where("employees.status = 'Aktif'")
	if c.Query("scope") == "team" {
		q = hierarchyScope(c, employeeBizScope(c, q))
	} else {
		q = employeeBizScope(c, q)
	}
	var l []models.Employee
	q.Preload("Unit").Preload("Position").Order("employees.name").Limit(2000).Find(&l)
	out := make([]gin.H, 0, len(l))
	for _, e := range l {
		row := gin.H{"id": e.ID, "name": e.Name, "nik": e.NIK, "business_id": e.BusinessID, "unit_id": e.UnitID, "manager_id": e.ManagerID}
		if e.Unit != nil {
			row["unit"] = gin.H{"id": e.Unit.ID, "name": e.Unit.Name}
		}
		if e.Position != nil {
			row["position"] = gin.H{"id": e.Position.ID, "title": e.Position.Title}
		}
		out = append(out, row)
	}
	c.JSON(http.StatusOK, out)
}

func ListEmployees(c *gin.Context) {
	q := hierarchyScope(c, employeeBizScope(c, database.DB.Model(&models.Employee{})))
	if s := c.Query("q"); s != "" {
		like := "%" + s + "%"
		q = q.Where("employees.name ILIKE ? OR employees.email ILIKE ? OR employees.nik ILIKE ? OR employees.position_id IN (SELECT id FROM positions WHERE title ILIKE ?)", like, like, like, like)
	}
	if v := c.Query("unit_id"); v != "" {
		// a unit includes everything below it in the organisation tree
		q = q.Where(`employees.unit_id IN (WITH RECURSIVE t AS (SELECT id FROM org_units WHERE id = ? UNION ALL SELECT u.id FROM org_units u JOIN t ON u.parent_id = t.id) SELECT id FROM t)`, v)
	}
	if v := c.Query("employee_type"); v != "" {
		q = q.Where("employees.employee_type = ?", v)
	}
	if v := c.Query("location_id"); v != "" && v != "0" {
		// the effective work location: a roster's location wins over the one on the employee record
		q = q.Where(`COALESCE((SELECT r.location_id FROM roster_assignments a JOIN rosters r ON r.id = a.roster_id
			WHERE a.employee_id = employees.id AND r.is_active = true AND r.location_id IS NOT NULL LIMIT 1), employees.location_id) = ?`, v)
	}
	if v := c.Query("status"); v != "" {
		q = q.Where("employees.status = ?", v)
	}
	var total int64
	q.Count(&total)
	// stats cover the whole business scope, independent of search/filter/page
	scoped := hierarchyScope(c, employeeBizScope(c, database.DB.Model(&models.Employee{})))
	base := scoped.Session(&gorm.Session{}).Where("employees.status = 'Aktif'")
	var active, inactive, tetap, kontrak, freelance, multi, expiring int64
	base.Count(&active)
	scoped.Session(&gorm.Session{}).Where("employees.status <> 'Aktif'").Count(&inactive)
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
	switch {
	case size == 0: // "tampilkan semua"
		size, page = maxAllRows, 1
	case size < 1 || size > 1000:
		size = 50
	}
	var l []models.Employee
	q.Preload("Position").Preload("Unit").Preload("Location").Preload("Business").
		Preload("Placements.Position").Preload("Placements.Business").
		Preload("Contracts", func(db *gorm.DB) *gorm.DB { return db.Order("start_date DESC, id DESC") }).
		Order(employeeOrder(c.Query("sort"), c.Query("dir"))).Limit(size).Offset((page - 1) * size).Find(&l)
	ptrs := make([]*models.Employee, len(l))
	for i := range l {
		ptrs[i] = &l[i]
	}
	fillRosters(ptrs)
	c.JSON(http.StatusOK, gin.H{"data": l, "total": total, "page": page, "page_size": size,
		"stats": gin.H{"active": active, "inactive": inactive, "tetap": tetap, "kontrak": kontrak, "freelance": freelance, "multi": multi, "expiring": expiring}})
}

// employeeOrder maps the whitelisted ?sort= / ?dir= to an ORDER BY. Default: name A–Z.
// tenure ascending = shortest tenure first (latest join date first); empty dates always come last.
func employeeOrder(sort, dir string) string {
	asc := dir != "desc"
	switch sort {
	case "tenure":
		if asc {
			return "employees.join_date DESC NULLS LAST, employees.name"
		}
		return "employees.join_date ASC NULLS LAST, employees.name"
	case "contract_end":
		if asc {
			return "employees.contract_end ASC NULLS LAST, employees.name"
		}
		return "employees.contract_end DESC NULLS LAST, employees.name"
	case "name":
		if !asc {
			return "employees.name DESC"
		}
	}
	return "employees.name ASC"
}

func GetEmployee(c *gin.Context) {
	var e models.Employee
	if !canSeeEmployee(c, paramID(c)) { // only yourself and your downline; same answer as "missing" so ids can't be probed
		c.JSON(http.StatusForbidden, gin.H{"error": "Anda tidak berwenang melihat karyawan ini"})
		return
	}
	err := database.DB.Preload("Position").Preload("Unit").Preload("Location").Preload("Business").
		Preload("Placements.Position").Preload("Placements.Business").First(&e, paramID(c)).Error
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "karyawan tidak ditemukan"})
		return
	}
	fillDOH(&e)
	fillRosters([]*models.Employee{&e})
	managerName := ""
	if e.ManagerID != nil {
		var m models.Employee
		if database.DB.Select("id, name").Limit(1).Find(&m, *e.ManagerID).Error == nil {
			managerName = m.Name
		}
	}
	var acct models.User // the account this employee logs in with (its email may differ from the employee's own email)
	database.DB.Select("id, email").Where("employee_id = ?", e.ID).Limit(1).Find(&acct)
	c.JSON(http.StatusOK, struct {
		models.Employee
		ManagerName string `json:"manager_name"`
		LoginEmail  string `json:"login_email"`
		HasAccount  bool   `json:"has_account"`
	}{e, managerName, acct.Email, acct.ID != 0})
}

func SaveEmployee(c *gin.Context) {
	var in models.Employee
	raw, _ := io.ReadAll(c.Request.Body)
	var ex struct {
		ConfirmLoginEmail bool `json:"confirm_login_email"` // the user confirmed that the login email follows the new employee email
	}
	_ = json.Unmarshal(raw, &ex)
	if err := json.Unmarshal(raw, &in); err != nil || strings.TrimSpace(in.Name) == "" || in.BusinessID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "nama dan bisnis wajib diisi"})
		return
	}
	if database.DB.First(&models.Business{}, in.BusinessID).Error != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bisnis tidak valid"})
		return
	}
	in.ID = paramID(c)
	in.Name = strings.TrimSpace(in.Name)
	in.Email = strings.TrimSpace(in.Email)
	in.Position, in.Unit, in.Location, in.Business, in.Placements, in.Contracts = nil, nil, nil, nil, nil, nil

	oldNIK := ""
	if in.ID != 0 { // status / active flag are changed only through the status endpoint
		var old models.Employee
		if database.DB.First(&old, in.ID).Error != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "karyawan tidak ditemukan"})
			return
		}
		in.Status, in.StatusNote, in.IsActive = old.Status, old.StatusNote, old.IsActive
		in.ContractStart, in.ContractEnd = old.ContractStart, old.ContractEnd // contract periods are managed under /contracts
		in.BusinessID = old.BusinessID                                        // business is locked once created
		oldNIK = old.NIK
		in.AvatarPath, in.AvatarMime, in.AvatarAt = old.AvatarPath, old.AvatarMime, old.AvatarAt // the photo is changed only through the avatar endpoints
		if !isGroupLevel(c) {                                                                    // the work calendar is a rule: only HR admin / super admin change it
			in.WorkCalendarID = old.WorkCalendarID
		}
	} else {
		if !isGroupLevel(c) {
			in.WorkCalendarID = nil
		}
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
	// A new Kontrak / Freelance employee may arrive with a first contract period; later ones are added under /contracts.
	var firstContract *models.EmployeeContract
	if in.ID == 0 && (in.EmployeeType == "Kontrak" || in.EmployeeType == "Freelance") && in.ContractStart != nil {
		firstContract = &models.EmployeeContract{StartDate: *in.ContractStart, EndDate: in.ContractEnd}
	}
	if in.ID == 0 {
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
	// The employee's email is also the login email of their account: changing it renames the login, after an explicit confirmation.
	var acct models.User
	newLogin := ""
	if in.ID != 0 && in.Email != "" {
		database.DB.Where("employee_id = ?", in.ID).Limit(1).Find(&acct)
		if acct.ID != 0 && !strings.EqualFold(acct.Email, in.Email) {
			newLogin = strings.ToLower(in.Email)
			if !strings.Contains(newLogin, "@") || strings.ContainsAny(newLogin, " ,;") {
				c.JSON(http.StatusBadRequest, gin.H{"error": "format email tidak valid"})
				return
			}
			var taken int64
			database.DB.Model(&models.User{}).Where("lower(email) = ? AND id <> ?", newLogin, acct.ID).Count(&taken)
			if taken > 0 {
				c.JSON(http.StatusConflict, gin.H{"error": "email ini sudah dipakai sebagai email login akun lain"})
				return
			}
			if !ex.ConfirmLoginEmail {
				c.JSON(http.StatusConflict, gin.H{"code": "login_email_change", "error": "email login akan ikut berubah, konfirmasi diperlukan", "old_email": acct.Email, "new_email": newLogin})
				return
			}
		}
	}
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		isNew := in.ID == 0
		if err := tx.Save(&in).Error; err != nil {
			return err
		}
		if newLogin != "" {
			if err := tx.Model(&models.User{}).Where("id = ?", acct.ID).Update("email", newLogin).Error; err != nil {
				return err
			}
		}
		if firstContract != nil {
			firstContract.EmployeeID = in.ID
			if err := tx.Create(firstContract).Error; err != nil {
				return err
			}
		}
		if err := syncCurrentContract(tx, in.ID); err != nil { // type may have changed (e.g. Kontrak → Tetap)
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
	if newLogin != "" {
		audit(c, "login_email_change", "user", acct.ID)
	}
	c.JSON(http.StatusOK, in)
}

// SetEmployeeStatus: Aktif | Non aktif | Suspend | Tidak Bekerja. Suspend / Tidak Bekerja employees can't log in; Non aktif can.
func SetEmployeeStatus(c *gin.Context) {
	var in struct {
		Status string `json:"status"`
		Note   string `json:"note"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || !validStatus[in.Status] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "status harus Aktif, Non aktif, Suspend, atau Tidak Bekerja"})
		return
	}
	id := paramID(c)
	res := database.DB.Model(&models.Employee{}).Where("id = ?", id).
		Updates(map[string]any{"status": in.Status, "status_note": in.Note, "is_active": in.Status == "Aktif"})
	if res.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "karyawan tidak ditemukan"})
		return
	}
	database.DB.Model(&models.User{}).Where("employee_id = ?", id).Update("is_active", statusKeepsLogin(in.Status))
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
	var photoFiles []models.AttendancePhoto
	database.DB.Where("record_id IN (SELECT id FROM attendance_records WHERE employee_id = ?)", id).Find(&photoFiles)
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
		tx.Exec("DELETE FROM attendance_photos WHERE record_id IN (SELECT id FROM attendance_records WHERE employee_id = ?)", id)
		tx.Where("employee_id = ?", id).Delete(&models.AttendanceRecord{})
		tx.Where("employee_id = ?", id).Delete(&models.RosterAssignment{})
		tx.Where("employee_id = ?", id).Delete(&models.TaskMember{})
		tx.Exec("UPDATE tasks SET kpi_id = NULL WHERE kpi_id IN (SELECT id FROM employee_kpis WHERE employee_id = ?)", id)
		tx.Where("employee_id = ?", id).Delete(&models.EmployeeKPI{})
		tx.Exec(`UPDATE approval_requests SET status = 'Cancelled' WHERE request_type = 'roster' AND status = 'Pending' AND ref_id IN (SELECT id FROM roster_adjustments WHERE employee_id = ?)`, id)
		tx.Exec("DELETE FROM roster_adjustment_attachments WHERE roster_adjustment_id IN (SELECT id FROM roster_adjustments WHERE employee_id = ?)", id)
		tx.Exec("DELETE FROM roster_adjustment_days WHERE roster_adjustment_id IN (SELECT id FROM roster_adjustments WHERE employee_id = ?)", id)
		tx.Where("employee_id = ?", id).Delete(&models.RosterAdjustment{})
		tx.Exec(`UPDATE approval_requests SET status = 'Cancelled' WHERE request_type = 'attendance_manual' AND status = 'Pending' AND ref_id IN (SELECT id FROM manual_attendances WHERE employee_id = ?)`, id)
		tx.Where("employee_id = ?", id).Delete(&models.ManualAttendance{})
		tx.Model(&models.Employee{}).Where("manager_id = ?", id).Update("manager_id", nil)
		tx.Where("employee_id = ?", id).Delete(&models.EmployeeDocument{})
		tx.Where("employee_id = ?", id).Delete(&models.EmployeeContract{})
		tx.Where("employee_id = ?", id).Delete(&models.EmployeeCompetency{})
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
	for _, p := range photoFiles {
		Store.Remove(p.LocalPath)
	}
	audit(c, "delete", "employee", id)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ContractExpiring lists contracts ending within ?days (default 30).
func ContractExpiring(c *gin.Context) {
	days, _ := strconv.Atoi(c.DefaultQuery("days", "30"))
	l := []models.Employee{}
	hierarchyScope(c, scopeBusiness(c, database.DB.Model(&models.Employee{}), "employees.business_id")).Preload("Position").
		Where("contract_end IS NOT NULL AND contract_end <= ? AND status = 'Aktif'", time.Now().AddDate(0, 0, days)).
		Order("contract_end").Find(&l)
	c.JSON(http.StatusOK, l)
}

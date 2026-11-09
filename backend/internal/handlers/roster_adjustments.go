package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
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
	// CanApprove: I am the approver of the current step (approval.MayDecide); the approval itself is ApprovalID.
	CanApprove      bool        `json:"can_approve"`
	EmployeeNIK     string      `json:"employee_nik"`
	PositionName    string      `json:"position_name"`
	AttachmentCount int         `json:"attachment_count"`
	Chain           []chainStep `json:"chain"`
}

// canCancelAdjustment: only the requester (the employee it is filed for) and group-level roles (HR / super admin).
func canCancelAdjustment(group bool, me *uint, a models.RosterAdjustment) bool {
	return a.Status == "Pending Approval" && (group || (me != nil && *me == a.EmployeeID))
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
	database.DB.Preload("Unit").Preload("Position").Select("id, name, nik, unit_id, position_id").Find(&es)
	for _, e := range es {
		emps[e.ID] = e
	}
	var apIDs, ids []uint
	for _, a := range l {
		ids = append(ids, a.ID)
		if a.ApprovalID != nil {
			apIDs = append(apIDs, *a.ApprovalID)
		}
	}
	pending := loadPending(apIDs)
	chains := loadChains(apIDs)
	attach := map[uint]int{}
	if len(ids) > 0 {
		var cs []struct {
			RosterAdjustmentID uint
			N                  int
		}
		database.DB.Raw("SELECT roster_adjustment_id, COUNT(*) AS n FROM roster_adjustment_attachments WHERE roster_adjustment_id IN ? GROUP BY roster_adjustment_id", ids).Scan(&cs)
		for _, x := range cs {
			attach[x.RosterAdjustmentID] = x.N
		}
	}
	daysOf := map[uint][]models.RosterAdjustmentDay{}
	if len(ids) > 0 {
		var ds []models.RosterAdjustmentDay
		database.DB.Where("roster_adjustment_id IN ?", ids).Order("date, id").Find(&ds)
		for _, d := range ds {
			daysOf[d.RosterAdjustmentID] = append(daysOf[d.RosterAdjustmentID], d)
		}
	}
	me := myEmployeeID(c)
	out := make([]adjustmentView, 0, len(l))
	for _, a := range l {
		e := emps[a.EmployeeID]
		a.Days = daysOf[a.ID]
		if a.Days == nil {
			a.Days = []models.RosterAdjustmentDay{}
		}
		v := adjustmentView{RosterAdjustment: a, EmployeeName: e.Name, EmployeeNIK: e.NIK, AttachmentCount: attach[a.ID]}
		if e.Unit != nil {
			v.UnitName = e.Unit.Name
		}
		if e.Position != nil {
			v.PositionName = e.Position.Title
		}
		if a.ApprovalID != nil {
			v.Chain = chains[*a.ApprovalID]
			if p, ok := pending[*a.ApprovalID]; ok && a.Status == "Pending Approval" {
				v.WaitingFor = p.ApproverName
				v.CanApprove = p.mayDecide(c, me)
			}
		}
		v.CanCancel = canCancelAdjustment(isGroupLevel(c), me, a)
		out = append(out, v)
	}
	c.JSON(http.StatusOK, out)
}

// authorizeAdjustTarget: who may file/preview for an employee (self, direct superior or schedule managers), and that
// the employee is active and follows a roster. It writes the error response itself.
func authorizeAdjustTarget(c *gin.Context, empID uint) (models.Employee, rosterSlot, bool) {
	var emp models.Employee
	me := myEmployeeID(c)
	if empID == 0 && me != nil {
		empID = *me
	}
	if empID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "pilih karyawan"})
		return emp, rosterSlot{}, false
	}
	if !(me != nil && *me == empID) && !canManageSchedule(c) && !isDirectManagerOf(c, empID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Anda hanya dapat mengajukan untuk diri sendiri atau bawahan langsung Anda"})
		return emp, rosterSlot{}, false
	}
	if database.DB.Limit(1).Find(&emp, empID).Error != nil || emp.ID == 0 || emp.Status != "Aktif" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "karyawan tidak ditemukan atau tidak aktif"})
		return emp, rosterSlot{}, false
	}
	slot, member := newResolver(today(), today()).rosterOf[empID]
	if !member {
		c.JSON(http.StatusBadRequest, gin.H{"error": "karyawan ini tidak mengikuti roster, jadwalnya mengikuti kalender kerja"})
		return emp, rosterSlot{}, false
	}
	return emp, slot, true
}

// pendingDates: dates of the employee's other pending adjustment requests (from `from` on).
func pendingDates(empID uint, from string) map[string]bool {
	var ds []string
	database.DB.Raw(`SELECT d.date FROM roster_adjustment_days d JOIN roster_adjustments a ON a.id = d.roster_adjustment_id
		WHERE a.employee_id = ? AND a.status = 'Pending Approval' AND d.date >= ?`, empID, from).Scan(&ds)
	m := map[string]bool{}
	for _, d := range ds {
		m[d] = true
	}
	return m
}

type previewDay struct {
	Date    string `json:"date"`
	Kind    string `json:"kind"`
	Pattern string `json:"pattern"`
	Changed bool   `json:"changed"`
}

type compensationPreview struct {
	N         int          `json:"n"`
	Kind      string       `json:"kind"`      // kind of the compensating days
	Suggested []string     `json:"suggested"` // suggested compensating dates (after the requested range)
	Days      []previewDay `json:"days"`
}

func buildPreview(days []adjDay, pat patternFn, pending map[string]bool) compensationPreview {
	base := []adjDay{}
	taken := map[string]bool{}
	for k := range pending {
		taken[k] = true
	}
	p := compensationPreview{Days: []previewDay{}}
	for _, d := range days {
		taken[d.Date] = true
		if d.IsCompensation {
			continue
		}
		base = append(base, d)
		pt := pat(d.Date)
		p.Days = append(p.Days, previewDay{d.Date, d.Kind, pt, pt != d.Kind})
	}
	p.N, p.Kind = netChange(base, pat)
	p.Suggested = suggestCompensation(base, p.N, p.Kind, pat, taken)
	return p
}

// PreviewRosterAdjustment: POST /roster-adjustments/preview {employee_id, days:[{date,kind}]}: pattern status per day,
// N (days to compensate) and suggested compensating dates. Nothing is stored.
func PreviewRosterAdjustment(c *gin.Context) {
	var in struct {
		EmployeeID uint     `json:"employee_id"`
		Days       []adjDay `json:"days"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || len(in.Days) == 0 || len(in.Days) > maxAdjustDays {
		c.JSON(http.StatusBadRequest, gin.H{"error": "daftar tanggal tidak valid"})
		return
	}
	for _, d := range in.Days {
		if _, ok := parseDate(d.Date); !ok || (d.Kind != "kerja" && d.Kind != "off") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "tanggal atau jenis hari tidak valid"})
			return
		}
	}
	emp, slot, ok := authorizeAdjustTarget(c, in.EmployeeID)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, buildPreview(in.Days, slot.patternStatus, pendingDates(emp.ID, today().Format("2006-01-02"))))
}

// CreateRosterAdjustment: the employee, their direct superior, or schedule managers can ask to turn a list of dates
// of a roster member into work or off days (optionally with compensation days). It goes through approval.
// multipart: employee_id, reason, note, days (JSON [{date,kind,is_compensation}]), compensate, files[];
// the legacy start_date/end_date/kind range is still accepted when `days` is absent.
func CreateRosterAdjustment(c *gin.Context) {
	empID64, _ := strconv.ParseUint(c.PostForm("employee_id"), 10, 64)
	in := struct {
		EmployeeID                       uint
		StartDate, EndDate, Kind, Reason string
		Note                             string
	}{uint(empID64), c.PostForm("start_date"), c.PostForm("end_date"), c.PostForm("kind"), c.PostForm("reason"), strings.TrimSpace(c.PostForm("note"))}
	compensate := c.PostForm("compensate") == "true" || c.PostForm("compensate") == "1"
	form, _ := c.MultipartForm()
	var files []*multipartFile
	if form != nil {
		for _, fh := range form.File["files"] {
			files = append(files, &multipartFile{fh})
		}
	}
	if len(files) > 10 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "maksimal 10 lampiran"})
		return
	}
	if strings.TrimSpace(in.Reason) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "alasan wajib diisi"})
		return
	}
	var days []adjDay
	strict := true
	if raw := strings.TrimSpace(c.PostForm("days")); raw != "" {
		if err := json.Unmarshal([]byte(raw), &days); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "daftar tanggal tidak valid"})
			return
		}
	} else { // legacy range payload
		strict = false
		start, ok1 := parseDate(in.StartDate)
		end, ok2 := parseDate(in.EndDate)
		if !ok1 || !ok2 || (in.Kind != "kerja" && in.Kind != "off") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "tanggal mulai/selesai, jenis (kerja/libur), dan alasan wajib diisi"})
			return
		}
		if end.Before(start) || end.Sub(start) > 60*24*time.Hour {
			c.JSON(http.StatusBadRequest, gin.H{"error": "rentang tanggal tidak valid (maksimal 60 hari)"})
			return
		}
		days = expandRange(start, end, in.Kind)
	}
	for i := range days {
		days[i].Date = strings.TrimSpace(days[i].Date)
	}
	emp, slot, ok := authorizeAdjustTarget(c, in.EmployeeID)
	if !ok {
		return
	}
	empID := emp.ID
	if err := validateAdjustmentDays(days, compensate, slot.patternStatus, time.Now(), strict); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	minD, maxD, kind := summarizeDays(days)
	if dup := firstOverlap(days, pendingDates(empID, minD)); dup != "" {
		c.JSON(http.StatusConflict, gin.H{"error": "sudah ada pengajuan penyesuaian yang menunggu pada tanggal " + dup})
		return
	}
	start, _ := parseDate(minD)
	end, _ := parseDate(maxD)
	mimes := make([]string, len(files))
	for i, f := range files { // validate every file before anything is created
		m, st, msg := checkUpload(f.fh)
		if st != 0 {
			c.JSON(st, gin.H{"error": msg})
			return
		}
		mimes[i] = m
	}
	var empUser models.User
	database.DB.Where("employee_id = ?", empID).Limit(1).Find(&empUser)
	requester := empUser.ID
	if requester == 0 {
		requester = uid(c)
	}
	var a models.RosterAdjustment
	var saved []string
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		a = models.RosterAdjustment{EmployeeID: empID, BusinessID: emp.BusinessID, StartDate: start, EndDate: end, Kind: kind, Reason: strings.TrimSpace(in.Reason), Note: in.Note, Compensate: compensate, Status: "Pending Approval"}
		if err := tx.Create(&a).Error; err != nil {
			return err
		}
		rows := make([]models.RosterAdjustmentDay, 0, len(days))
		for _, d := range days {
			rows = append(rows, models.RosterAdjustmentDay{RosterAdjustmentID: a.ID, EmployeeID: empID, Date: d.Date, Kind: d.Kind, IsCompensation: d.IsCompensation})
		}
		if err := tx.Create(&rows).Error; err != nil {
			return err
		}
		for i, f := range files {
			rel, size, err := saveUpload(f.fh, fmt.Sprintf("roster/%d", a.ID))
			if err != nil {
				return fmt.Errorf("gagal menyimpan lampiran \"%s\"", f.fh.Filename)
			}
			saved = append(saved, rel)
			if err := tx.Create(&models.RosterAdjustmentAttachment{RosterAdjustmentID: a.ID, FileName: f.fh.Filename, MimeType: mimes[i], Size: size, LocalPath: rel}).Error; err != nil {
				return err
			}
		}
		req, err := approval.Submit(tx, approval.SubmitInput{Type: "roster", RefID: a.ID, BusinessID: emp.BusinessID, RequesterEmployeeID: &empID, RequesterUserID: requester, FlowKey: "roster",
			Title: "Penyesuaian Roster — " + emp.Name, Summary: fmt.Sprintf("%s · %s", daysSummaryText(days), a.Reason)})
		if err != nil {
			return err
		}
		a.ApprovalID = &req.ID
		return tx.Model(&a).Update("approval_id", req.ID).Error
	})
	if err != nil {
		for _, rel := range saved { // rolled back: no orphan files
			Store.Remove(rel)
		}
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
	if !isGroupLevel(c) && !(me != nil && *me == a.EmployeeID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "hanya pemohon atau HR yang dapat membatalkan"})
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

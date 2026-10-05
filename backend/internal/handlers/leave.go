package handlers

import (
	"fmt"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/dea-core/hcis/backend/internal/approval"
	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var jkt = time.FixedZone("WIB", 7*3600)

func init() { approval.Hooks["leave"] = leaveHook }

func day(t time.Time) time.Time {
	t = t.In(jkt)
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, jkt)
}
func today() time.Time { return day(time.Now()) }

func parseDate(s string) (time.Time, bool) {
	if t, err := time.ParseInLocation("2006-01-02", strings.TrimSpace(s), jkt); err == nil {
		return t, true
	}
	if t, err := time.Parse(time.RFC3339, strings.TrimSpace(s)); err == nil {
		return day(t), true
	}
	return time.Time{}, false
}

func myEmployeeID(c *gin.Context) *uint {
	var u models.User
	if database.DB.Select("id, employee_id").Limit(1).Find(&u, uid(c)).Error != nil {
		return nil
	}
	return u.EmployeeID
}

// ---- who may see whom ----
// Everyone sees themselves; a superior sees ALL of their subordinates (every level below), via manager_id.
// Super admin / HR admin see the whole business scope (they run the system).

const downlineSQL = `(WITH RECURSIVE d AS (
	SELECT id FROM employees WHERE manager_id = ?
	UNION SELECT e.id FROM employees e JOIN d ON e.manager_id = d.id) SELECT id FROM d)`

func inDownline(me, target uint) bool {
	var n int64
	database.DB.Raw(`WITH RECURSIVE d AS (SELECT id FROM employees WHERE manager_id = ?
		UNION SELECT e.id FROM employees e JOIN d ON e.manager_id = d.id) SELECT COUNT(*) FROM d WHERE id = ?`, me, target).Scan(&n)
	return n > 0
}

func leaveScope(c *gin.Context, q *gorm.DB) *gorm.DB {
	q = scopeBusiness(c, q, "leave_requests.business_id")
	if isGroupLevel(c) {
		return q
	}
	me := myEmployeeID(c)
	if me == nil {
		return q.Where("1 = 0")
	}
	return q.Where("leave_requests.employee_id = ? OR leave_requests.employee_id IN "+downlineSQL, *me, *me)
}

func employeeScope(c *gin.Context, q *gorm.DB) *gorm.DB {
	q = scopeBusiness(c, q, "employees.business_id").Where("employees.status = 'Aktif'")
	if isGroupLevel(c) {
		return q
	}
	me := myEmployeeID(c)
	if me == nil {
		return q.Where("1 = 0")
	}
	return q.Where("employees.id = ? OR employees.id IN "+downlineSQL, *me, *me)
}

// canViewLeave: the requester, their superiors, anyone who must approve it, and group-level roles.
func canViewLeave(c *gin.Context, lr models.LeaveRequest) bool {
	if isGroupLevel(c) {
		return true
	}
	if me := myEmployeeID(c); me != nil && (*me == lr.EmployeeID || inDownlineOf(*me, lr.EmployeeID)) {
		return true
	}
	if lr.ApprovalID != nil {
		var n int64
		database.DB.Model(&models.ApprovalStep{}).Where("request_id = ? AND approver_user_id = ?", *lr.ApprovalID, uid(c)).Count(&n)
		return n > 0
	}
	return false
}
func inDownlineOf(superior, target uint) bool { return inDownline(superior, target) }

// ---- balances ----

func annualDefault(db *gorm.DB) int {
	var t models.LeaveType
	if db.Where("category = 'cuti' AND deducts_balance = true").Order("id").Limit(1).Find(&t).Error == nil && t.ID != 0 {
		return t.DefaultDays
	}
	return 12
}

func getBalance(db *gorm.DB, empID uint, year int) models.LeaveBalance {
	var b models.LeaveBalance
	db.Where("employee_id = ? AND year = ?", empID, year).Limit(1).Find(&b)
	if b.ID == 0 {
		// two requests can race to create the first row of the year: insert-if-absent, then re-read
		db.Clauses(clause.OnConflict{DoNothing: true}).Create(&models.LeaveBalance{EmployeeID: empID, Year: year, Initial: annualDefault(db)})
		db.Where("employee_id = ? AND year = ?", empID, year).Limit(1).Find(&b)
	}
	return b
}

func pendingDays(db *gorm.DB, empID uint, year int) int {
	var n int
	db.Raw(`SELECT COALESCE(SUM(r.days),0) FROM leave_requests r JOIN leave_types t ON t.id = r.type_id
		WHERE r.employee_id = ? AND r.status = 'Pending Approval' AND t.deducts_balance = true AND EXTRACT(YEAR FROM r.start_date AT TIME ZONE 'Asia/Jakarta') = ?`, empID, year).Scan(&n)
	return n
}

// collectiveDays: "cuti bersama" (deducting holidays) falling in the year, after the employee joined.
func collectiveDays(emp models.Employee, year int, hs holidaySet) int {
	from := time.Date(year, 1, 1, 0, 0, 0, 0, jkt)
	if emp.JoinDate != nil && day(*emp.JoinDate).After(from) {
		from = day(*emp.JoinDate)
	}
	return hs.collective(emp.BusinessID, from, time.Date(year, 12, 31, 0, 0, 0, 0, jkt))
}

// Roster members (shift / site crews) follow their roster instead of the Mon–Fri calendar: only days the roster
// says "kerja" count as leave days (so OFF blocks are never deducted), national holidays do not apply to them,
// and "cuti bersama" does not deduct their balance.
func rosterMemberSet() map[uint]bool {
	m := map[uint]bool{}
	var ids []uint
	database.DB.Raw("SELECT a.employee_id FROM roster_assignments a JOIN rosters r ON r.id = a.roster_id AND r.is_active = true").Scan(&ids)
	for _, id := range ids {
		m[id] = true
	}
	return m
}

func countLeaveDays(emp models.Employee, a, b time.Time) (int, []skippedDay) {
	res := newResolver(a, b)
	if _, ok := res.rosterOf[emp.ID]; !ok {
		return res.hs.workDays(emp.BusinessID, a, b)
	}
	n := 0
	skipped := []skippedDay{}
	for d := day(a); !d.After(day(b)); d = d.AddDate(0, 0, 1) {
		if res.schedule(emp, d).Status == "kerja" {
			n++
		} else {
			skipped = append(skipped, skippedDay{d.Format("2006-01-02"), "OFF roster", false})
		}
	}
	return n, skipped
}

type balanceNumbers struct{ Initial, Added, Used, Pending, Collective, Remaining int }

func balanceFor(emp models.Employee, year int, hs holidaySet, roster bool) balanceNumbers {
	b := getBalance(database.DB, emp.ID, year)
	n := balanceNumbers{Initial: b.Initial, Added: b.Added, Used: b.Used, Pending: pendingDays(database.DB, emp.ID, year)}
	if !roster {
		n.Collective = collectiveDays(emp, year, hs)
	}
	n.Remaining = n.Initial + n.Added - n.Used - n.Pending - n.Collective
	return n
}

func yearHolidays(year int) holidaySet {
	return loadHolidays(time.Date(year, 1, 1, 0, 0, 0, 0, jkt), time.Date(year, 12, 31, 0, 0, 0, 0, jkt))
}

func leaveHook(tx *gorm.DB, req *models.ApprovalRequest, outcome string) error {
	var lr models.LeaveRequest
	if err := tx.Preload("Type").First(&lr, req.RefID).Error; err != nil {
		return err
	}
	switch outcome {
	case approval.Approved:
		lr.Status = "Disetujui"
		if lr.Type != nil && lr.Type.DeductsBalance { // pending reservation becomes used
			b := getBalance(tx, lr.EmployeeID, day(lr.StartDate).Year())
			b.Used += lr.Days
			tx.Save(&b)
		}
	case approval.Rejected:
		lr.Status = "Ditolak"
	case approval.Cancelled:
		lr.Status = "Dibatalkan"
	}
	return tx.Omit("Employee", "Type").Save(&lr).Error
}

// ---- list ----

type leaveView struct {
	models.LeaveRequest
	EmployeeName    string    `json:"employee_name"`
	UnitName        string    `json:"unit_name"`
	BusinessName    string    `json:"business_name"`
	TypeName        string    `json:"type_name"`
	Category        string    `json:"category"`
	TimeState       string    `json:"time_state"`
	BackDate        time.Time `json:"back_date"`
	AttachmentCount int       `json:"attachment_count"`
	WaitingFor      string    `json:"waiting_for"` // current approver's name while pending
	CanDecide       bool      `json:"can_decide"`  // I am the approver right now
	CanCancel       bool      `json:"can_cancel"`
}

func ListLeaveRequests(c *gin.Context) {
	q := leaveScope(c, database.DB.Model(&models.LeaveRequest{}))
	if v := c.Query("status"); v != "" {
		q = q.Where("leave_requests.status = ?", v)
	}
	if v := c.Query("type_id"); v != "" {
		q = q.Where("leave_requests.type_id = ?", v)
	}
	if v := c.Query("q"); v != "" {
		q = q.Where("leave_requests.employee_id IN (SELECT id FROM employees WHERE name ILIKE ?)", "%"+v+"%")
	}
	var l []models.LeaveRequest
	q.Preload("Employee.Unit").Preload("Employee.Business").Preload("Type").Order("leave_requests.created_at DESC").Limit(1000).Find(&l)

	var ids, approvalIDs []uint
	for _, r := range l {
		ids = append(ids, r.ID)
		if r.Status == "Pending Approval" && r.ApprovalID != nil {
			approvalIDs = append(approvalIDs, *r.ApprovalID)
		}
	}
	attach := map[uint]int{}
	type cnt struct {
		LeaveRequestID uint
		N              int
	}
	if len(ids) > 0 {
		var cs []cnt
		database.DB.Raw("SELECT leave_request_id, COUNT(*) AS n FROM leave_attachments WHERE leave_request_id IN ? GROUP BY leave_request_id", ids).Scan(&cs)
		for _, x := range cs {
			attach[x.LeaveRequestID] = x.N
		}
	}
	type waiting struct {
		RequestID      uint
		ApproverUserID uint
		Name           string
	}
	wait := map[uint]waiting{}
	if len(approvalIDs) > 0 {
		var ws []waiting
		database.DB.Raw(`SELECT s.request_id, s.approver_user_id, u.name FROM approval_steps s JOIN users u ON u.id = s.approver_user_id
			WHERE s.request_id IN ? AND s.status = 'Pending'`, approvalIDs).Scan(&ws)
		for _, w := range ws {
			wait[w.RequestID] = w
		}
	}

	me := myEmployeeID(c)
	now := today()
	var res *resolver
	if len(l) > 0 {
		res = newResolver(now.AddDate(-2, 0, 0), now.AddDate(3, 0, 0))
	}
	out := make([]leaveView, 0, len(l))
	for _, r := range l {
		v := leaveView{LeaveRequest: r, AttachmentCount: attach[r.ID]}
		if r.Employee != nil {
			v.EmployeeName = r.Employee.Name
			if r.Employee.Unit != nil {
				v.UnitName = r.Employee.Unit.Name
			}
			if r.Employee.Business != nil {
				v.BusinessName = r.Employee.Business.Name
			}
			if _, isRoster := res.rosterOf[r.EmployeeID]; isRoster { // next day the roster says "kerja"
				d := day(r.EndDate)
				for i := 0; i < 90; i++ {
					d = d.AddDate(0, 0, 1)
					if res.schedule(*r.Employee, d).Status == "kerja" {
						break
					}
				}
				v.BackDate = d
			} else {
				v.BackDate = res.hs.nextWorkday(r.Employee.BusinessID, r.EndDate)
			}
		}
		if r.Type != nil {
			v.TypeName, v.Category = r.Type.Name, r.Type.Category
		}
		switch {
		case day(r.EndDate).Before(now):
			v.TimeState = "Selesai"
		case day(r.StartDate).After(now):
			v.TimeState = "Akan Datang"
		default:
			v.TimeState = "Sedang Berlangsung"
		}
		if t := c.Query("time"); t != "" && t != v.TimeState {
			continue
		}
		if r.ApprovalID != nil {
			if w, ok := wait[*r.ApprovalID]; ok {
				v.WaitingFor = w.Name
				v.CanDecide = w.ApproverUserID == uid(c) || role(c) == "super_admin"
			}
		}
		own := me != nil && *me == r.EmployeeID
		v.CanCancel = (own || isGroupLevel(c)) && (r.Status == "Pending Approval" || (r.Status == "Disetujui" && day(r.StartDate).After(now)))
		v.Employee, v.Type = nil, nil
		out = append(out, v)
	}
	c.JSON(http.StatusOK, out)
}

// LeaveCalc previews the countable days for a range (weekends and holidays are skipped).
func LeaveCalc(c *gin.Context) {
	empID, _ := strconv.Atoi(c.Query("employee_id"))
	if empID == 0 {
		if me := myEmployeeID(c); me != nil {
			empID = int(*me)
		}
	}
	var emp models.Employee
	database.DB.Limit(1).Find(&emp, empID)
	a, ok1 := parseDate(c.Query("start_date"))
	b, ok2 := parseDate(c.Query("end_date"))
	if emp.ID == 0 || !ok1 || !ok2 || b.Before(a) {
		c.JSON(http.StatusOK, gin.H{"days": 0, "skipped": []skippedDay{}})
		return
	}
	days, skipped := countLeaveDays(emp, a, b)
	out := gin.H{"days": days, "skipped": skipped}
	if tid := c.Query("type_id"); tid != "" { // preview the roster rule for the chosen leave type
		var lt models.LeaveType
		if database.DB.Limit(1).Find(&lt, tid).Error == nil && lt.ID != 0 {
			if msg := rosterLeaveError(emp, lt, a, b); msg != "" {
				out["error"] = msg
			}
		}
	}
	c.JSON(http.StatusOK, out)
}

// ---- create (multipart: fields + files[]) ----

func CreateLeaveRequest(c *gin.Context) {
	empID64, _ := strconv.ParseUint(c.PostForm("employee_id"), 10, 64)
	typeID64, _ := strconv.ParseUint(c.PostForm("type_id"), 10, 64)
	start, ok1 := parseDate(c.PostForm("start_date"))
	end, ok2 := parseDate(c.PostForm("end_date"))
	if typeID64 == 0 || !ok1 || !ok2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "jenis dan tanggal wajib diisi"})
		return
	}
	var assigned *uint
	if v, _ := strconv.ParseUint(c.PostForm("assigned_user_id"), 10, 64); v > 0 {
		u := uint(v)
		assigned = &u
	}
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

	empID := uint(empID64)
	me := myEmployeeID(c)
	if empID == 0 && me != nil {
		empID = *me
	}
	if empID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "pilih karyawan (akun Anda belum terhubung ke data karyawan)"})
		return
	}
	// own request, or on behalf of someone: admins any employee; a superior only their subordinates
	isSelf := me != nil && *me == empID
	if !isSelf && !isGroupLevel(c) && !(me != nil && inDownline(*me, empID)) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Anda hanya dapat mengajukan untuk diri sendiri atau bawahan Anda"})
		return
	}
	var emp models.Employee
	if database.DB.Limit(1).Find(&emp, empID).Error != nil || emp.ID == 0 || emp.Status != "Aktif" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "karyawan tidak ditemukan atau tidak aktif"})
		return
	}
	var lt models.LeaveType
	if database.DB.Limit(1).Find(&lt, typeID64).Error != nil || lt.ID == 0 || !lt.IsActive {
		c.JSON(http.StatusBadRequest, gin.H{"error": "jenis cuti tidak valid"})
		return
	}
	if end.Before(start) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tanggal selesai tidak boleh sebelum tanggal mulai"})
		return
	}
	if start.Year() != end.Year() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "pengajuan tidak boleh melewati pergantian tahun; ajukan terpisah"})
		return
	}
	days, _ := countLeaveDays(emp, start, end)
	if days == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "rentang tanggal tidak mengandung hari kerja (akhir pekan, hari libur, atau masa OFF roster tidak dihitung)"})
		return
	}
	if msg := rosterLeaveError(emp, lt, start, end); msg != "" { // roster members: annual leave only right after an OFF block
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	if lt.RequiresAttachment && len(files) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("jenis \"%s\" wajib melampirkan dokumen pendukung (mis. surat dokter)", lt.Name)})
		return
	}
	mimes := make([]string, len(files))
	for i, f := range files { // validate every file before anything is created
		m, st, msg := checkUpload(f.fh)
		if st != 0 {
			c.JSON(st, gin.H{"error": msg})
			return
		}
		mimes[i] = m
	}
	var overlap int64
	database.DB.Model(&models.LeaveRequest{}).Where("employee_id = ? AND status IN ('Pending Approval','Disetujui') AND start_date <= ? AND end_date >= ?", empID, end, start).Count(&overlap)
	if overlap > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "sudah ada pengajuan cuti/izin pada rentang tanggal tersebut"})
		return
	}
	if lt.DeductsBalance {
		b := balanceFor(emp, start.Year(), yearHolidays(start.Year()), rosterMemberSet()[emp.ID])
		if days > b.Remaining {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("saldo cuti tidak cukup (sisa %d hari, diajukan %d hari)", b.Remaining, days)})
			return
		}
	}

	var empUser models.User
	database.DB.Where("employee_id = ?", empID).Limit(1).Find(&empUser)
	requesterUser := empUser.ID
	if requesterUser == 0 {
		requesterUser = uid(c)
	}
	reason := strings.TrimSpace(c.PostForm("reason"))
	var lr models.LeaveRequest
	var saved []string
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		lr = models.LeaveRequest{EmployeeID: empID, BusinessID: emp.BusinessID, TypeID: lt.ID, StartDate: start, EndDate: end, Days: days, Reason: reason, Status: "Pending Approval"}
		if err := tx.Create(&lr).Error; err != nil {
			return err
		}
		for i, f := range files {
			rel, size, err := saveUpload(f.fh, fmt.Sprintf("leave/%d", lr.ID))
			if err != nil {
				return fmt.Errorf("gagal menyimpan lampiran \"%s\"", f.fh.Filename)
			}
			saved = append(saved, rel)
			if err := tx.Create(&models.LeaveAttachment{LeaveRequestID: lr.ID, FileName: f.fh.Filename, MimeType: mimes[i], Size: size, LocalPath: rel, DriveStatus: "pending"}).Error; err != nil {
				return err
			}
		}
		summary := fmt.Sprintf("%s – %s · %d hari", start.Format("02/01/06"), end.Format("02/01/06"), days)
		if reason != "" {
			summary += " · " + reason
		}
		if len(files) > 0 {
			summary += fmt.Sprintf(" · %d lampiran", len(files))
		}
		req, err := approval.Submit(tx, approval.SubmitInput{Type: "leave", RefID: lr.ID, BusinessID: emp.BusinessID,
			RequesterEmployeeID: &empID, RequesterUserID: requesterUser, Title: lt.Name + " — " + emp.Name, Summary: summary, AssignedUserID: assigned})
		if err != nil {
			return err
		}
		lr.ApprovalID = &req.ID
		return tx.Model(&lr).Update("approval_id", req.ID).Error
	})
	if err != nil {
		for _, rel := range saved { // transaction rolled back → don't leave orphan files
			Store.Remove(rel)
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	audit(c, "create", "leave_request", lr.ID)
	c.JSON(http.StatusOK, lr)
}

// multipartFile just keeps the header handy.
type multipartFile struct{ fh *multipart.FileHeader }

// ---- cancel (pending, or approved but not yet started) ----

func CancelLeaveRequest(c *gin.Context) {
	var lr models.LeaveRequest
	if database.DB.Preload("Type").Limit(1).Find(&lr, paramID(c)).Error != nil || lr.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "pengajuan tidak ditemukan"})
		return
	}
	me := myEmployeeID(c)
	if !isGroupLevel(c) && (me == nil || *me != lr.EmployeeID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "hanya pemohon atau HR yang dapat membatalkan"})
		return
	}
	switch {
	case lr.Status == "Pending Approval" && lr.ApprovalID != nil:
		var req models.ApprovalRequest
		database.DB.First(&req, *lr.ApprovalID)
		err := database.DB.Transaction(func(tx *gorm.DB) error { _, e := approval.Cancel(tx, req.ID, req.RequesterUserID); return e })
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	case lr.Status == "Disetujui":
		if !day(lr.StartDate).After(today()) {
			c.JSON(http.StatusConflict, gin.H{"error": "cuti yang sudah berjalan atau selesai tidak dapat dibatalkan"})
			return
		}
		database.DB.Transaction(func(tx *gorm.DB) error { // give the days back
			if lr.Type != nil && lr.Type.DeductsBalance {
				b := getBalance(tx, lr.EmployeeID, day(lr.StartDate).Year())
				b.Used -= lr.Days
				if b.Used < 0 {
					b.Used = 0
				}
				tx.Save(&b)
			}
			return tx.Model(&models.LeaveRequest{}).Where("id = ?", lr.ID).Update("status", "Dibatalkan").Error
		})
	default:
		c.JSON(http.StatusConflict, gin.H{"error": "pengajuan ini tidak dapat dibatalkan"})
		return
	}
	audit(c, "cancel", "leave_request", lr.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ---- balances ----

type balanceRow struct {
	EmployeeID uint   `json:"employee_id"`
	Name       string `json:"name"`
	UnitName   string `json:"unit_name"`
	Business   string `json:"business_name"`
	BusinessID uint   `json:"business_id"`
	Year       int    `json:"year"`
	Initial    int    `json:"initial"`
	Added      int    `json:"added"`
	Used       int    `json:"used"`
	Pending    int    `json:"pending"`
	Collective int    `json:"collective"` // cuti bersama deducted from everyone
	Remaining  int    `json:"remaining"`
	Expiry     string `json:"expiry"`
	CanGrant   bool   `json:"can_grant"`
}

// canGrantLeave: admins anyone; a superior their subordinates; the top of the hierarchy (no manager, i.e. L1) themselves.
func canGrantLeave(c *gin.Context, target models.Employee) bool {
	if isGroupLevel(c) {
		return true
	}
	me := myEmployeeID(c)
	if me == nil {
		return false
	}
	if *me == target.ID {
		return target.ManagerID == nil
	}
	return inDownline(*me, target.ID)
}

func LeaveBalances(c *gin.Context) {
	year, _ := strconv.Atoi(c.DefaultQuery("year", strconv.Itoa(today().Year())))
	q := employeeScope(c, database.DB.Model(&models.Employee{}))
	if s := c.Query("q"); s != "" {
		q = q.Where("employees.name ILIKE ?", "%"+s+"%")
	}
	var emps []models.Employee
	q.Preload("Unit").Preload("Business").Order("employees.name").Limit(1000).Find(&emps)
	hs := yearHolidays(year)
	rosterSet := rosterMemberSet()
	out := make([]balanceRow, 0, len(emps))
	for _, e := range emps {
		n := balanceFor(e, year, hs, rosterSet[e.ID])
		r := balanceRow{EmployeeID: e.ID, Name: e.Name, BusinessID: e.BusinessID, Year: year, Initial: n.Initial, Added: n.Added, Used: n.Used, Pending: n.Pending,
			Collective: n.Collective, Remaining: n.Remaining, Expiry: fmt.Sprintf("%d-12-31", year), CanGrant: canGrantLeave(c, e)}
		if e.Unit != nil {
			r.UnitName = e.Unit.Name
		}
		if e.Business != nil {
			r.Business = e.Business.Name
		}
		out = append(out, r)
	}
	c.JSON(http.StatusOK, out)
}

// GrantLeave adds extra leave days (superior → subordinate; L1 → self). Traceable via leave_grants + audit log.
func GrantLeave(c *gin.Context) {
	var in struct {
		Year   int    `json:"year"`
		Days   int    `json:"days"`
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.Year < 2000 || in.Days < 1 || in.Days > 60 || strings.TrimSpace(in.Reason) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "jumlah hari 1–60 dan alasan wajib diisi"})
		return
	}
	var emp models.Employee
	if database.DB.Limit(1).Find(&emp, paramID(c)).Error != nil || emp.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "karyawan tidak ditemukan"})
		return
	}
	if !canGrantLeave(c, emp) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Anda hanya dapat menambah cuti untuk bawahan Anda (pimpinan tertinggi untuk dirinya sendiri)"})
		return
	}
	database.DB.Transaction(func(tx *gorm.DB) error {
		b := getBalance(tx, emp.ID, in.Year)
		b.Added += in.Days
		tx.Save(&b)
		return tx.Create(&models.LeaveGrant{EmployeeID: emp.ID, Year: in.Year, Days: in.Days, Reason: strings.TrimSpace(in.Reason), GrantedByUserID: uid(c)}).Error
	})
	audit(c, fmt.Sprintf("grant:+%d", in.Days), "leave_balance", emp.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// AdjustLeaveBalance (admin only) sets the opening balance / manual additions directly.
func AdjustLeaveBalance(c *gin.Context) {
	var in struct {
		Year    int `json:"year"`
		Initial int `json:"initial"`
		Added   int `json:"added"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.Year < 2000 || in.Initial < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "data tidak valid"})
		return
	}
	b := getBalance(database.DB, paramID(c), in.Year)
	b.Initial, b.Added = in.Initial, in.Added
	database.DB.Save(&b)
	audit(c, "adjust", "leave_balance", b.EmployeeID)
	c.JSON(http.StatusOK, b)
}

// LeaveSummary: scorecards for the top of the Cuti & Izin page.
func LeaveSummary(c *gin.Context) {
	var active int64
	employeeScope(c, database.DB.Model(&models.Employee{})).Count(&active)
	off := map[string]int64{"cuti": 0, "izin": 0, "sakit": 0}
	type row struct {
		Category string
		N        int64
	}
	var rows []row
	leaveScope(c, database.DB.Model(&models.LeaveRequest{})).
		Joins("JOIN leave_types t ON t.id = leave_requests.type_id").
		Where("leave_requests.status = 'Disetujui' AND leave_requests.start_date <= ? AND leave_requests.end_date >= ?", today(), today()).
		Select("t.category AS category, COUNT(DISTINCT leave_requests.employee_id) AS n").Group("t.category").Scan(&rows)
	var offTotal int64
	for _, r := range rows {
		off[r.Category] = r.N
		offTotal += r.N
	}
	var pending int64
	leaveScope(c, database.DB.Model(&models.LeaveRequest{})).Where("leave_requests.status = 'Pending Approval'").Count(&pending)
	c.JSON(http.StatusOK, gin.H{"active": active, "off": offTotal, "cuti": off["cuti"], "izin": off["izin"], "sakit": off["sakit"], "working": active - offTotal, "pending": pending})
}

func ListLeaveTypes(c *gin.Context) {
	l := []models.LeaveType{}
	database.DB.Order("id").Find(&l)
	c.JSON(http.StatusOK, l)
}

func SaveLeaveType(c *gin.Context) {
	var in models.LeaveType
	if err := c.ShouldBindJSON(&in); err != nil || strings.TrimSpace(in.Name) == "" || !map[string]bool{"cuti": true, "izin": true, "sakit": true}[in.Category] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "nama wajib; kategori cuti/izin/sakit"})
		return
	}
	in.ID = paramID(c)
	var dup int64
	database.DB.Model(&models.LeaveType{}).Where("name = ? AND id <> ?", in.Name, in.ID).Count(&dup)
	if dup > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "nama jenis sudah ada"})
		return
	}
	database.DB.Save(&in)
	audit(c, "save", "leave_type", in.ID)
	c.JSON(http.StatusOK, in)
}

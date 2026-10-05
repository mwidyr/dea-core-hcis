package handlers

import (
	"fmt"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ---- schedule resolution: what is employee X expected to do on day D? ----
//
//  1. employee follows a roster → cycle position decides work/off (holidays do not stop a roster)
//  2. otherwise their work calendar (or the business default): holiday → "libur", non-work weekday → "off"
//  Leave is layered on top by the attendance views (it is not part of the schedule).

type Sched struct {
	Status     string `json:"status"`  // kerja | off | libur
	Pattern    string `json:"pattern"` // "Reguler" | "Roster 6:2 (hari)"
	Name       string `json:"name"`
	Start      string `json:"start"`
	End        string `json:"end"`
	BreakStart string `json:"break_start"`
	BreakEnd   string `json:"break_end"`
	Tolerance  int    `json:"tolerance"`
	RequireGPS bool   `json:"require_gps"`
	LocationID *uint  `json:"location_id"`
	Holiday    string `json:"holiday"`
	Adjusted   bool   `json:"adjusted"` // an approved roster adjustment overrides the pattern on this day
}

type resolver struct {
	calendars map[uint]models.WorkCalendar // by id
	defaults  map[uint]models.WorkCalendar // by business id
	rosterOf  map[uint]rosterSlot          // by employee id
	adjust    map[uint][]models.RosterAdjustment
	hs        holidaySet
}

// rosterSlot = the roster an employee follows + THEIR cycle start (own start, else the roster's default).
type rosterSlot struct {
	ro    models.Roster
	start time.Time
}

func newResolver(from, to time.Time) *resolver {
	r := &resolver{calendars: map[uint]models.WorkCalendar{}, defaults: map[uint]models.WorkCalendar{}, rosterOf: map[uint]rosterSlot{}, adjust: map[uint][]models.RosterAdjustment{}}
	var cals []models.WorkCalendar
	database.DB.Where("is_active = true").Find(&cals)
	for _, c := range cals {
		r.calendars[c.ID] = c
		if c.IsDefault {
			r.defaults[c.BusinessID] = c
		}
	}
	var rosters []models.Roster
	database.DB.Where("is_active = true").Find(&rosters)
	byID := map[uint]models.Roster{}
	for _, ro := range rosters {
		byID[ro.ID] = ro
	}
	var as []models.RosterAssignment
	database.DB.Find(&as)
	for _, a := range as {
		if ro, ok := byID[a.RosterID]; ok {
			start := ro.StartCycle
			if a.StartCycle != nil {
				start = *a.StartCycle
			}
			r.rosterOf[a.EmployeeID] = rosterSlot{ro, start}
		}
	}
	var adj []models.RosterAdjustment
	database.DB.Where("status = 'Disetujui' AND end_date >= ? AND start_date <= ?", day(from), day(to)).Order("id").Find(&adj)
	for _, a := range adj {
		r.adjust[a.EmployeeID] = append(r.adjust[a.EmployeeID], a)
	}
	r.hs = loadHolidays(from, to)
	return r
}

func hasDay(workDays string, wd time.Weekday) bool {
	for _, p := range strings.Split(workDays, ",") {
		if n, err := strconv.Atoi(strings.TrimSpace(p)); err == nil && n == int(wd) {
			return true
		}
	}
	return false
}

func rosterLabel(ro models.Roster) string {
	return fmt.Sprintf("Roster %d:%d (%s)", ro.WorkUnits, ro.OffUnits, ro.Unit)
}

func rosterWorking(ro models.Roster, d time.Time) bool {
	mult := 1
	if ro.Unit == "minggu" {
		mult = 7
	}
	cycle := (ro.WorkUnits + ro.OffUnits) * mult
	if cycle <= 0 {
		return false
	}
	days := int(math.Round(day(d).Sub(day(ro.StartCycle)).Hours() / 24))
	pos := ((days % cycle) + cycle) % cycle
	return pos < ro.WorkUnits*mult
}

func (r *resolver) schedule(emp models.Employee, d time.Time) Sched {
	if slot, ok := r.rosterOf[emp.ID]; ok {
		ro := slot.ro
		s := Sched{Pattern: rosterLabel(ro), Name: ro.Name, Start: ro.StartTime, End: ro.EndTime, BreakStart: ro.BreakStart, BreakEnd: ro.BreakEnd,
			Tolerance: ro.ToleranceMin, RequireGPS: ro.RequireGPS, LocationID: ro.LocationID, Status: "off"}
		pat := ro
		pat.StartCycle = slot.start
		if rosterWorking(pat, d) {
			s.Status = "kerja"
		}
		for _, a := range r.adjust[emp.ID] { // approved adjustments override the pattern (later ones win)
			if !day(d).Before(day(a.StartDate)) && !day(d).After(day(a.EndDate)) {
				s.Status, s.Adjusted = "off", true
				if a.Kind == "kerja" {
					s.Status = "kerja"
				}
			}
		}
		if hol, ok := r.hs.on(emp.BusinessID, d); ok {
			s.Holiday = hol.Name
		}
		return s
	}
	cal, ok := models.WorkCalendar{}, false
	if emp.WorkCalendarID != nil {
		cal, ok = r.calendars[*emp.WorkCalendarID]
	}
	if !ok {
		cal, ok = r.defaults[emp.BusinessID]
	}
	if !ok { // no calendar configured at all → sensible office default
		cal = models.WorkCalendar{Name: "Reguler", WorkDays: "1,2,3,4,5", StartTime: "08:00", EndTime: "17:00", BreakStart: "12:00", BreakEnd: "13:00", ToleranceMin: 10, RequireGPS: true}
	}
	s := Sched{Pattern: "Reguler", Name: cal.Name, Start: cal.StartTime, End: cal.EndTime, BreakStart: cal.BreakStart, BreakEnd: cal.BreakEnd, Tolerance: cal.ToleranceMin, RequireGPS: cal.RequireGPS, Status: "off"}
	if hol, ok := r.hs.on(emp.BusinessID, d); ok {
		s.Status, s.Holiday = "libur", hol.Name
	} else if hasDay(cal.WorkDays, day(d).Weekday()) {
		s.Status = "kerja"
	}
	return s
}

// ---- time helpers ----

var hhmm = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

func atTime(d time.Time, hm string) time.Time {
	var h, m int
	fmt.Sscanf(hm, "%d:%d", &h, &m)
	d = day(d)
	return time.Date(d.Year(), d.Month(), d.Day(), h, m, 0, 0, jkt)
}

// computeTimes → late / early-leave / worked minutes (break time is not counted as work).
func computeTimes(s Sched, date time.Time, in, out *time.Time) (late, early, work int) {
	if s.Status == "kerja" && s.Start != "" {
		start, end := atTime(date, s.Start), atTime(date, s.End)
		if !end.After(start) {
			end = end.AddDate(0, 0, 1) // overnight shift
		}
		if in != nil && in.After(start.Add(time.Duration(s.Tolerance)*time.Minute)) {
			late = int(in.Sub(start).Minutes())
		}
		if out != nil && out.Before(end) {
			early = int(end.Sub(*out).Minutes())
		}
	}
	if in != nil && out != nil && out.After(*in) {
		work = int(out.Sub(*in).Minutes())
		if s.BreakStart != "" && s.BreakEnd != "" {
			bs, be := atTime(date, s.BreakStart), atTime(date, s.BreakEnd)
			if be.After(bs) {
				lo, hi := *in, *out
				if bs.After(lo) {
					lo = bs
				}
				if be.Before(hi) {
					hi = be
				}
				if hi.After(lo) {
					work -= int(hi.Sub(lo).Minutes())
				}
			}
		}
	}
	return
}

// ---- management API (calendars, rosters) ----

func canManageSchedule(c *gin.Context) bool { return isGroupLevel(c) || canManageHolidays(c) }

func scheduleGuard(c *gin.Context, businessID uint) bool {
	if !canManageSchedule(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "hanya Super Admin, HR Admin, atau pejabat L1/L2 yang dapat mengatur jadwal kerja"})
		return false
	}
	if !checkHolidayScope(c, &businessID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "bukan bisnis Anda"})
		return false
	}
	return true
}

func validTimes(vals ...string) bool {
	for _, v := range vals {
		if v != "" && !hhmm.MatchString(v) {
			return false
		}
	}
	return true
}

func ListWorkCalendars(c *gin.Context) {
	l := []models.WorkCalendar{}
	scopeBusiness(c, database.DB, "business_id").Order("business_id, id").Find(&l)
	counts := map[uint]int64{}
	type row struct {
		ID uint
		N  int64
	}
	var rows []row
	database.DB.Raw(`SELECT c.id, COUNT(e.id) AS n FROM work_calendars c LEFT JOIN employees e
		ON e.status = 'Aktif' AND NOT EXISTS (SELECT 1 FROM roster_assignments ra WHERE ra.employee_id = e.id)
		AND ((e.work_calendar_id = c.id) OR (e.work_calendar_id IS NULL AND c.is_default AND e.business_id = c.business_id)) GROUP BY c.id`).Scan(&rows)
	for _, r := range rows {
		counts[r.ID] = r.N
	}
	type view struct {
		models.WorkCalendar
		EmployeeCount int64 `json:"employee_count"`
	}
	out := make([]view, 0, len(l))
	for _, x := range l {
		out = append(out, view{x, counts[x.ID]})
	}
	c.JSON(http.StatusOK, gin.H{"data": out, "can_manage": canManageSchedule(c)})
}

func SaveWorkCalendar(c *gin.Context) {
	var in models.WorkCalendar
	if err := c.ShouldBindJSON(&in); err != nil || strings.TrimSpace(in.Name) == "" || in.BusinessID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "nama dan bisnis wajib diisi"})
		return
	}
	if !scheduleGuard(c, in.BusinessID) {
		return
	}
	if !hhmm.MatchString(in.StartTime) || !hhmm.MatchString(in.EndTime) || !validTimes(in.BreakStart, in.BreakEnd) || in.ToleranceMin < 0 || in.ToleranceMin > 240 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "jam kerja harus berformat HH:MM; toleransi 0–240 menit"})
		return
	}
	days := []string{}
	for _, p := range strings.Split(in.WorkDays, ",") {
		if n, err := strconv.Atoi(strings.TrimSpace(p)); err == nil && n >= 0 && n <= 6 {
			days = append(days, strconv.Itoa(n))
		}
	}
	if len(days) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "pilih minimal satu hari kerja"})
		return
	}
	in.WorkDays = strings.Join(days, ",")
	in.ID = paramID(c)
	if in.ID != 0 {
		var old models.WorkCalendar
		if database.DB.Limit(1).Find(&old, in.ID).Error != nil || old.ID == 0 {
			c.JSON(http.StatusNotFound, gin.H{"error": "kalender tidak ditemukan"})
			return
		}
		in.BusinessID = old.BusinessID // business is fixed once created
	}
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if in.IsDefault { // one default calendar per business
			tx.Model(&models.WorkCalendar{}).Where("business_id = ? AND id <> ?", in.BusinessID, in.ID).Update("is_default", false)
		}
		return tx.Save(&in).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	var def int64
	database.DB.Model(&models.WorkCalendar{}).Where("business_id = ? AND is_default = true AND is_active = true", in.BusinessID).Count(&def)
	if def == 0 { // never leave a business without a default
		database.DB.Model(&models.WorkCalendar{}).Where("id = ?", in.ID).Updates(map[string]any{"is_default": true, "is_active": true})
		in.IsDefault, in.IsActive = true, true
	}
	audit(c, "save", "work_calendar", in.ID)
	c.JSON(http.StatusOK, in)
}

func DeleteWorkCalendar(c *gin.Context) {
	var cal models.WorkCalendar
	if database.DB.Limit(1).Find(&cal, paramID(c)).Error != nil || cal.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "kalender tidak ditemukan"})
		return
	}
	if !scheduleGuard(c, cal.BusinessID) {
		return
	}
	if cal.IsDefault {
		c.JSON(http.StatusConflict, gin.H{"error": "kalender default tidak dapat dihapus; jadikan kalender lain sebagai default dulu"})
		return
	}
	database.DB.Model(&models.Employee{}).Where("work_calendar_id = ?", cal.ID).Update("work_calendar_id", nil) // back to the default
	database.DB.Delete(&cal)
	audit(c, "delete", "work_calendar", cal.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type rosterMember struct {
	EmployeeID uint       `json:"employee_id"`
	StartCycle *time.Time `json:"start_cycle"`
}

type rosterView struct {
	models.Roster
	Pattern       string         `json:"pattern"`
	EmployeeCount int64          `json:"employee_count"`
	EmployeeIDs   []uint         `json:"employee_ids"`
	Members       []rosterMember `json:"members"`
}

func ListRosters(c *gin.Context) {
	var l []models.Roster
	scopeBusiness(c, database.DB, "business_id").Order("business_id, id").Find(&l)
	var as []models.RosterAssignment
	database.DB.Find(&as)
	members := map[uint][]rosterMember{}
	for _, a := range as {
		members[a.RosterID] = append(members[a.RosterID], rosterMember{a.EmployeeID, a.StartCycle})
	}
	out := make([]rosterView, 0, len(l))
	for _, r := range l {
		ms := members[r.ID]
		if ms == nil {
			ms = []rosterMember{}
		}
		ids := make([]uint, 0, len(ms))
		for i, m := range ms {
			ids = append(ids, m.EmployeeID)
			if m.StartCycle == nil { // show the effective start
				st := r.StartCycle
				ms[i].StartCycle = &st
			}
		}
		out = append(out, rosterView{r, rosterLabel(r), int64(len(ids)), ids, ms})
	}
	c.JSON(http.StatusOK, gin.H{"data": out, "can_manage": canManageSchedule(c), "can_assign": canManageSchedule(c) || hasDirectReports(c)})
}

func SaveRoster(c *gin.Context) {
	var in models.Roster
	if err := c.ShouldBindJSON(&in); err != nil || strings.TrimSpace(in.Name) == "" || in.BusinessID == 0 || in.StartCycle.IsZero() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "nama, bisnis, dan start cycle wajib diisi"})
		return
	}
	if !scheduleGuard(c, in.BusinessID) {
		return
	}
	if in.WorkUnits < 1 || in.OffUnits < 0 || in.WorkUnits > 60 || in.OffUnits > 60 || (in.Unit != "hari" && in.Unit != "minggu") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "pola harus berupa jumlah kerja ≥ 1 dan libur ≥ 0 dalam hari atau minggu"})
		return
	}
	if !hhmm.MatchString(in.StartTime) || !hhmm.MatchString(in.EndTime) || !validTimes(in.BreakStart, in.BreakEnd) || in.ToleranceMin < 0 || in.ToleranceMin > 240 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "jam kerja harus berformat HH:MM; toleransi 0–240 menit"})
		return
	}
	if in.LocationID != nil {
		var l models.Location
		if database.DB.Limit(1).Find(&l, *in.LocationID).Error != nil || l.ID == 0 || l.BusinessID != in.BusinessID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "lokasi tidak sesuai dengan bisnis"})
			return
		}
	}
	in.ID = paramID(c)
	in.StartCycle = day(in.StartCycle)
	if in.ID != 0 {
		var old models.Roster
		if database.DB.Limit(1).Find(&old, in.ID).Error != nil || old.ID == 0 {
			c.JSON(http.StatusNotFound, gin.H{"error": "roster tidak ditemukan"})
			return
		}
		in.BusinessID = old.BusinessID
	}
	if err := database.DB.Save(&in).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	audit(c, "save", "roster", in.ID)
	c.JSON(http.StatusOK, in)
}

func DeleteRoster(c *gin.Context) {
	var ro models.Roster
	if database.DB.Limit(1).Find(&ro, paramID(c)).Error != nil || ro.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "roster tidak ditemukan"})
		return
	}
	if !scheduleGuard(c, ro.BusinessID) {
		return
	}
	database.DB.Where("roster_id = ?", ro.ID).Delete(&models.RosterAssignment{}) // members fall back to their calendar
	database.DB.Delete(&ro)
	audit(c, "delete", "roster", ro.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func hasDirectReports(c *gin.Context) bool {
	me := myEmployeeID(c)
	if me == nil {
		return false
	}
	var n int64
	database.DB.Model(&models.Employee{}).Where("manager_id = ? AND status = 'Aktif'", *me).Count(&n)
	return n > 0
}

func isDirectManagerOf(c *gin.Context, empID uint) bool {
	me := myEmployeeID(c)
	if me == nil {
		return false
	}
	var n int64
	database.DB.Model(&models.Employee{}).Where("id = ? AND manager_id = ?", empID, *me).Count(&n)
	return n > 0
}

// SetRosterEmployees sets who follows a roster, each with their OWN start cycle (the first work day of their
// cycle — the "off schedule" is derived from it, so it is required). Super admin / HR / L1-L2 manage every
// member; a direct superior may only add/change/remove their own direct reports. An employee follows one
// roster only, so anyone listed here is moved out of their previous roster.
func SetRosterEmployees(c *gin.Context) {
	var in struct {
		Members []struct {
			EmployeeID uint      `json:"employee_id"`
			StartCycle time.Time `json:"start_cycle"`
		} `json:"members"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "data tidak valid"})
		return
	}
	var ro models.Roster
	if database.DB.Limit(1).Find(&ro, paramID(c)).Error != nil || ro.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "roster tidak ditemukan"})
		return
	}
	admin := canManageSchedule(c)
	if !admin && !hasDirectReports(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "hanya admin, HR, pejabat L1/L2, atau atasan langsung yang dapat mengatur anggota roster"})
		return
	}
	if !checkHolidayScope(c, &ro.BusinessID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "bukan bisnis Anda"})
		return
	}
	manageable := func(empID uint) bool { return admin || isDirectManagerOf(c, empID) }

	seen := map[uint]bool{}
	for _, m := range in.Members {
		if m.EmployeeID == 0 || seen[m.EmployeeID] {
			c.JSON(http.StatusBadRequest, gin.H{"error": "daftar karyawan tidak valid"})
			return
		}
		seen[m.EmployeeID] = true
		if m.StartCycle.IsZero() {
			c.JSON(http.StatusBadRequest, gin.H{"error": "start cycle wajib diisi untuk setiap karyawan roster (tanggal pertama siklus kerjanya)"})
			return
		}
		if !manageable(m.EmployeeID) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Anda hanya dapat mengatur jadwal bawahan langsung Anda"})
			return
		}
		var n int64
		database.DB.Model(&models.Employee{}).Where(`id = ? AND status = 'Aktif' AND (business_id = ? OR id IN (SELECT employee_id FROM employee_placements WHERE business_id = ?))`, m.EmployeeID, ro.BusinessID, ro.BusinessID).Count(&n)
		if n == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "ada karyawan yang tidak aktif atau bukan bagian dari bisnis roster ini"})
			return
		}
	}
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		var current []models.RosterAssignment
		tx.Where("roster_id = ?", ro.ID).Find(&current)
		for _, a := range current { // remove members the caller manages and did not keep
			if !seen[a.EmployeeID] && manageable(a.EmployeeID) {
				if err := tx.Delete(&a).Error; err != nil {
					return err
				}
			}
		}
		for _, m := range in.Members {
			st := day(m.StartCycle)
			tx.Where("employee_id = ?", m.EmployeeID).Delete(&models.RosterAssignment{})
			if err := tx.Create(&models.RosterAssignment{RosterID: ro.ID, EmployeeID: m.EmployeeID, StartCycle: &st}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	audit(c, "assign", "roster", ro.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func uniqueIDs(ids []uint) []uint {
	seen := map[uint]bool{}
	out := []uint{}
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

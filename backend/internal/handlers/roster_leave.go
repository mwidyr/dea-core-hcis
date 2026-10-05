package handlers

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
)

// Roster leave policy (client rule): a roster member can take ANNUAL leave only directly AFTER an OFF block
// (extending the time off). Never in the middle of a work period and never right before an OFF block —
// that would cut into work days. Sick leave and izin are not restricted (nobody chooses when they are ill).

var idMonths = []string{"Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"}

func fmtShort(d time.Time) string {
	d = day(d)
	return fmt.Sprintf("%d %s", d.Day(), idMonths[d.Month()-1])
}

type rosterWin struct {
	InOff        bool      `json:"in_off"` // today is inside an OFF block
	OffStart     time.Time `json:"off_start"`
	OffEnd       time.Time `json:"off_end"`        // last OFF day (inclusive)
	LeaveFrom    time.Time `json:"leave_from"`     // first work day after the OFF block = earliest start of an allowed leave
	DaysUntilOff int       `json:"days_until_off"` // 0 when already off
}

// rosterWindow finds the relevant OFF block for a roster member: the one they are in, else the next one.
func rosterWindow(emp models.Employee, from time.Time) *rosterWin {
	from = day(from)
	res := newResolver(from.AddDate(0, 0, -130), from.AddDate(0, 0, 200))
	if _, ok := res.rosterOf[emp.ID]; !ok {
		return nil
	}
	off := func(d time.Time) bool { return res.schedule(emp, d).Status != "kerja" }
	w := &rosterWin{}
	d := from
	if off(from) {
		w.InOff = true
		start := from
		for i := 0; i < 120 && off(start.AddDate(0, 0, -1)); i++ {
			start = start.AddDate(0, 0, -1)
		}
		w.OffStart = start
	} else {
		found := false
		for i := 1; i <= 180; i++ {
			d = from.AddDate(0, 0, i)
			if off(d) {
				found = true
				break
			}
		}
		if !found {
			return nil
		}
		w.OffStart, w.DaysUntilOff = d, int(d.Sub(from).Hours()/24+0.5)
	}
	end := w.OffStart
	for i := 0; i < 180 && off(end.AddDate(0, 0, 1)); i++ {
		end = end.AddDate(0, 0, 1)
	}
	w.OffEnd, w.LeaveFrom = end, end.AddDate(0, 0, 1)
	return w
}

// rosterLeaveError returns a message when the range violates the roster rule ("" = allowed / not applicable).
func rosterLeaveError(emp models.Employee, lt models.LeaveType, start, end time.Time) string {
	if lt.Category != "cuti" {
		return ""
	}
	res := newResolver(start.AddDate(0, 0, -1), end)
	if _, ok := res.rosterOf[emp.ID]; !ok {
		return ""
	}
	hint := ""
	if w := rosterWindow(emp, today()); w != nil {
		hint = fmt.Sprintf(" Masa OFF berikutnya %s – %s, jadi cuti dapat dimulai %s.", fmtShort(w.OffStart), fmtShort(w.OffEnd), fmtShort(w.LeaveFrom))
	}
	started, ended := false, false
	for d := day(start); !d.After(day(end)); d = d.AddDate(0, 0, 1) {
		if res.schedule(emp, d).Status == "kerja" {
			if !started {
				if res.schedule(emp, d.AddDate(0, 0, -1)).Status == "kerja" { // work day before it → cuts the work period
					return "Karyawan roster hanya dapat mengambil cuti tahunan yang bersambung tepat setelah masa OFF — tidak di masa kerja atau sebelum masa OFF karena akan memotong hari kerja." + hint
				}
				started = true
			} else if ended {
				return "Cuti tahunan karyawan roster harus bersambung langsung setelah satu masa OFF; rentang ini melewati beberapa masa kerja dan OFF." + hint
			}
		} else if started {
			ended = true
		}
	}
	return ""
}

// RosterWindow: info for the leave form / banner. Non-roster employees get {is_roster:false} and see nothing.
func RosterWindow(c *gin.Context) {
	empID := uint(0)
	fmt.Sscanf(c.Query("employee_id"), "%d", &empID)
	if empID == 0 {
		if me := myEmployeeID(c); me != nil {
			empID = *me
		}
	}
	var emp models.Employee
	if database.DB.Limit(1).Find(&emp, empID).Error != nil || emp.ID == 0 {
		c.JSON(http.StatusOK, gin.H{"is_roster": false})
		return
	}
	w := rosterWindow(emp, today())
	if w == nil {
		c.JSON(http.StatusOK, gin.H{"is_roster": false})
		return
	}
	var req int64 // already asked for leave starting right after that OFF block?
	database.DB.Model(&models.LeaveRequest{}).Where(`employee_id = ? AND status IN ('Pending Approval','Disetujui') AND start_date <= ? AND end_date >= ?
		AND type_id IN (SELECT id FROM leave_types WHERE category = 'cuti')`, emp.ID, w.OffEnd.AddDate(0, 0, 1), w.LeaveFrom).Count(&req)
	c.JSON(http.StatusOK, gin.H{"is_roster": true, "window": w, "has_request": req > 0})
}

// ---- reminders ----

var reminderLeadDays = []int{7, 1} // remind this many days before an OFF block starts

// RunRosterReminders tells roster members that an OFF block is coming and that annual leave must be submitted to
// extend it (it can only attach AFTER the OFF). Idempotent; skipped when they already filed leave for that window.
func RunRosterReminders() int {
	created := 0
	now := today()
	var members []models.RosterAssignment
	database.DB.Find(&members)
	for _, m := range members {
		var emp models.Employee
		if database.DB.Limit(1).Find(&emp, m.EmployeeID).Error != nil || emp.ID == 0 || emp.Status != "Aktif" {
			continue
		}
		var u models.User
		if database.DB.Where("employee_id = ? AND is_active = true", emp.ID).Limit(1).Find(&u).Error != nil || u.ID == 0 {
			continue
		}
		w := rosterWindow(emp, now)
		if w == nil || w.InOff {
			continue
		}
		for _, lead := range reminderLeadDays {
			if w.DaysUntilOff != lead {
				continue
			}
			var filed int64
			database.DB.Model(&models.LeaveRequest{}).Where(`employee_id = ? AND status IN ('Pending Approval','Disetujui') AND start_date <= ? AND end_date >= ?
				AND type_id IN (SELECT id FROM leave_types WHERE category = 'cuti')`, emp.ID, w.LeaveFrom, w.LeaveFrom).Count(&filed)
			if filed > 0 {
				continue
			}
			when := fmt.Sprintf("%d hari lagi", lead)
			if lead == 1 {
				when = "besok"
			}
			title := "Masa OFF roster Anda dimulai " + when
			body := fmt.Sprintf("OFF %s – %s. Ingin memperpanjang libur? Ajukan cuti tahunan sekarang — cuti hanya dapat bersambung setelah masa OFF, mulai %s.", fmtShort(w.OffStart), fmtShort(w.OffEnd), fmtShort(w.LeaveFrom))
			link := "/leave?new=1&from=" + w.LeaveFrom.Format("2006-01-02")
			key := strings.Join([]string{"roster-off", fmt.Sprint(emp.ID), w.OffStart.Format("2006-01-02"), fmt.Sprint(lead)}, ":")
			if notify(u.ID, "roster_off", title, body, link, key) {
				created++
			}
		}
	}
	return created
}

// StartRosterReminderJob runs the reminder check shortly after start and then hourly (it is idempotent).
func StartRosterReminderJob() {
	time.Sleep(15 * time.Second)
	for {
		RunAllJobs()
		time.Sleep(time.Hour)
	}
}

// RunRemindersNow lets an admin trigger the check immediately (useful for testing).
func RunRemindersNow(c *gin.Context) {
	res := RunAllJobs()
	c.JSON(http.StatusOK, gin.H{"created": res["roster_reminders"], "jobs": res})
}

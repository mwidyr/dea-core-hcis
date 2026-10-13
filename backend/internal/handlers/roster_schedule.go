package handlers

import (
	"net/http"
	"strconv"
	"time"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
)

// fillRosters sets Employee.Roster for every listed employee that follows an active roster.
// A roster member's work calendar and location are the roster's, so the UI shows them instead of the employee's own.
func fillRosters(emps []*models.Employee) {
	ids := make([]uint, 0, len(emps))
	for _, e := range emps {
		ids = append(ids, e.ID)
	}
	if len(ids) == 0 {
		return
	}
	var as []models.RosterAssignment
	database.DB.Where("employee_id IN ?", ids).Find(&as)
	if len(as) == 0 {
		return
	}
	rids := make([]uint, 0, len(as))
	for _, a := range as {
		rids = append(rids, a.RosterID)
	}
	var rs []models.Roster
	database.DB.Where("id IN ? AND is_active = true", rids).Find(&rs)
	byID := map[uint]models.Roster{}
	for _, r := range rs {
		byID[r.ID] = r
	}
	locs := locNames()
	slot := map[uint]models.EmployeeRoster{}
	for _, a := range as {
		r, ok := byID[a.RosterID]
		if !ok {
			continue
		}
		start := r.StartCycle
		if a.StartCycle != nil {
			start = *a.StartCycle
		}
		er := models.EmployeeRoster{ID: r.ID, Name: r.Name, Pattern: rosterLabel(r), StartTime: r.StartTime, EndTime: r.EndTime, LocationID: r.LocationID, StartCycle: start}
		if r.LocationID != nil {
			er.LocationName = locs[*r.LocationID]
		}
		slot[a.EmployeeID] = er
	}
	for _, e := range emps {
		if er, ok := slot[e.ID]; ok {
			cp := er
			e.Roster = &cp
		}
	}
}

type rosterDayRow struct {
	EmployeeID   uint     `json:"employee_id"`
	Name         string   `json:"name"`
	NIK          string   `json:"nik"`
	BusinessName string   `json:"business_name"`
	RosterID     uint     `json:"roster_id"`
	RosterName   string   `json:"roster_name"`
	Pattern      string   `json:"pattern"`
	LocationID   *uint    `json:"location_id"`
	LocationName string   `json:"location_name"`
	StartCycle   string   `json:"start_cycle"`
	Days         []string `json:"days"`     // one status per day of the month: kerja | off | libur
	Adjusted     []int    `json:"adjusted"` // day numbers overridden by an approved roster adjustment
	Windows      []window `json:"windows"`  // consecutive runs of the same status, for the list view
}

type window struct {
	Status string `json:"status"`
	From   string `json:"from"`
	To     string `json:"to"`
}

// RosterSchedule: who follows a roster and what their roster looks like in a month (list + calendar views).
// GET /roster-schedule?month=YYYY-MM[&roster_id=][&location_id=]
func RosterSchedule(c *gin.Context) {
	month := c.Query("month")
	first, err := time.ParseInLocation("2006-01", month, jkt)
	if err != nil {
		first = day(time.Now())
		first = time.Date(first.Year(), first.Month(), 1, 0, 0, 0, 0, jkt)
	}
	last := first.AddDate(0, 1, -1)
	res := newResolver(first, last)

	q := scopeBusiness(c, database.DB.Model(&models.Employee{}), "employees.business_id").Where("employees.status = 'Aktif'")
	if !canManageSchedule(c) { // everyone else only sees their own line (themselves + their reports)
		q = employeeScope(c, database.DB.Model(&models.Employee{}))
	}
	var emps []models.Employee
	q.Preload("Business").Order("employees.name").Limit(2000).Find(&emps)

	rosterFilter, locFilter := c.Query("roster_id"), c.Query("location_id")
	locs := locNames()
	rosterList := map[uint]models.EmployeeRoster{}
	rows := []rosterDayRow{}
	for _, e := range emps {
		slot, ok := res.rosterOf[e.ID]
		if !ok {
			continue
		}
		ro := slot.ro
		if rosterFilter != "" && rosterFilter != strconv.FormatUint(uint64(ro.ID), 10) {
			continue
		}
		if locFilter != "" && (ro.LocationID == nil || locFilter != strconv.FormatUint(uint64(*ro.LocationID), 10)) {
			continue
		}
		row := rosterDayRow{EmployeeID: e.ID, Name: e.Name, NIK: e.NIK, RosterID: ro.ID, RosterName: ro.Name, Pattern: rosterLabel(ro), LocationID: ro.LocationID,
			StartCycle: slot.start.Format("2006-01-02"), Days: []string{}, Adjusted: []int{}, Windows: []window{}}
		if e.Business != nil {
			row.BusinessName = e.Business.Name
		}
		if ro.LocationID != nil {
			row.LocationName = locs[*ro.LocationID]
		}
		for d := first; !d.After(last); d = d.AddDate(0, 0, 1) {
			s := res.schedule(e, d)
			row.Days = append(row.Days, s.Status)
			if s.Adjusted {
				row.Adjusted = append(row.Adjusted, d.Day())
			}
			if n := len(row.Windows); n > 0 && row.Windows[n-1].Status == s.Status {
				row.Windows[n-1].To = d.Format("2006-01-02")
			} else {
				row.Windows = append(row.Windows, window{s.Status, d.Format("2006-01-02"), d.Format("2006-01-02")})
			}
		}
		rows = append(rows, row)
		rosterList[ro.ID] = models.EmployeeRoster{ID: ro.ID, Name: ro.Name, Pattern: rosterLabel(ro), StartTime: ro.StartTime, EndTime: ro.EndTime, LocationID: ro.LocationID, LocationName: row.LocationName}
	}
	rosters := make([]models.EmployeeRoster, 0, len(rosterList))
	for _, r := range rosterList {
		rosters = append(rosters, r)
	}
	c.JSON(http.StatusOK, gin.H{"month": first.Format("2006-01"), "from": first.Format("2006-01-02"), "to": last.Format("2006-01-02"), "days_in_month": last.Day(),
		"rosters": rosters, "employees": rows})
}

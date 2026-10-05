package handlers

import (
	"fmt"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/dea-core/hcis/backend/internal/approval"
	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func init() { approval.Hooks["attendance_manual"] = manualAttendanceHook }

const maxGPSAccuracy = 300.0 // metres; worse than this cannot be trusted against a 100–200 m radius

func haversine(lat1, lng1, lat2, lng2 float64) float64 {
	const R = 6371000.0
	rad := math.Pi / 180
	dLat, dLng := (lat2-lat1)*rad, (lng2-lng1)*rad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * R * math.Asin(math.Sqrt(a))
}

// leaveOn returns the leave category ("cuti"|"izin"|"sakit") and type name when the employee has approved leave on d.
func leaveOn(empID uint, d time.Time) (string, string) {
	var r struct {
		Category string
		Name     string
	}
	database.DB.Raw(`SELECT t.category, t.name FROM leave_requests l JOIN leave_types t ON t.id = l.type_id
		WHERE l.employee_id = ? AND l.status = 'Disetujui' AND l.start_date <= ? AND l.end_date >= ? LIMIT 1`, empID, day(d), day(d)).Scan(&r)
	return r.Category, r.Name
}

// allowedLocations: the employee's own work location + the roster's; with neither set, every active location of the business.
func allowedLocations(emp models.Employee, s Sched) []models.Location {
	var ids []uint
	if emp.LocationID != nil {
		ids = append(ids, *emp.LocationID)
	}
	if s.LocationID != nil {
		ids = append(ids, *s.LocationID)
	}
	var l []models.Location
	q := database.DB.Where("is_active = true")
	if len(ids) > 0 {
		q = q.Where("id IN ?", ids)
	} else {
		q = q.Where("business_id = ?", emp.BusinessID)
	}
	q.Find(&l)
	return l
}

type tapRequest struct {
	Emp      models.Employee
	Action   string // in | out
	Lat, Lng *float64
	Acc      *float64
	IP       string
	Now      time.Time
}

type tapError struct {
	Status int
	Msg    string
}

func (e *tapError) Error() string { return e.Msg }

func fail(status int, format string, a ...any) *tapError {
	return &tapError{status, fmt.Sprintf(format, a...)}
}

// checkGPS enforces the schedule's GPS policy: returns the nearest allowed location and the distance in metres.
func checkGPS(emp models.Employee, s Sched, lat, lng, acc *float64) (*models.Location, *int, *tapError) {
	if !s.RequireGPS && (lat == nil || lng == nil) {
		return nil, nil, nil
	}
	if lat == nil || lng == nil {
		return nil, nil, fail(http.StatusBadRequest, "Lokasi (GPS) wajib diaktifkan untuk absen. Izinkan akses lokasi pada browser lalu coba lagi.")
	}
	if *lat < -90 || *lat > 90 || *lng < -180 || *lng > 180 {
		return nil, nil, fail(http.StatusBadRequest, "Koordinat lokasi tidak valid")
	}
	if acc != nil && *acc > maxGPSAccuracy {
		return nil, nil, fail(http.StatusBadRequest, "Akurasi GPS terlalu rendah (±%.0f m). Pindah ke area terbuka atau aktifkan GPS perangkat, lalu coba lagi.", *acc)
	}
	var best *models.Location
	bestD := math.MaxFloat64
	withCoords := 0
	for _, l := range allowedLocations(emp, s) {
		if l.Latitude == nil || l.Longitude == nil {
			continue
		}
		withCoords++
		if d := haversine(*lat, *lng, *l.Latitude, *l.Longitude); d < bestD {
			l := l
			best, bestD = &l, d
		}
	}
	if best == nil {
		if !s.RequireGPS {
			return nil, nil, nil
		}
		return nil, nil, fail(http.StatusUnprocessableEntity, "Koordinat lokasi kerja belum diatur. Hubungi HR (Setup Organisasi → Lokasi).")
	}
	d := int(math.Round(bestD))
	if s.RequireGPS && bestD > float64(best.RadiusM) {
		return nil, nil, fail(http.StatusForbidden, "Anda berada %d m dari %s. Absen hanya dapat dilakukan dalam radius %d m.", d, best.Name, best.RadiusM)
	}
	return best, &d, nil
}

// performTap is the single place where a tap in / tap out is validated and stored.
func performTap(r tapRequest) (gin.H, *tapError) {
	emp, now := r.Emp, r.Now
	date := day(now)
	res := newResolver(date.AddDate(0, 0, -1), date)

	if r.Action == "in" {
		var existing models.AttendanceRecord
		database.DB.Where("employee_id = ? AND date = ?", emp.ID, date).Limit(1).Find(&existing)
		if existing.ID != 0 && existing.CheckInAt != nil {
			return nil, fail(http.StatusConflict, "Anda sudah tap in hari ini pukul %s.", existing.CheckInAt.In(jkt).Format("15:04"))
		}
		if cat, name := leaveOn(emp.ID, date); cat != "" {
			return nil, fail(http.StatusConflict, "Anda sedang %s (%s) pada hari ini, absen tidak diperlukan.", strings.ToLower(cat), name)
		}
		s := res.schedule(emp, date)
		loc, dist, terr := checkGPS(emp, s, r.Lat, r.Lng, r.Acc)
		if terr != nil {
			return nil, terr
		}
		late, _, _ := computeTimes(s, date, &now, nil)
		rec := models.AttendanceRecord{EmployeeID: emp.ID, Date: date, BusinessID: emp.BusinessID, CheckInAt: &now, InLat: r.Lat, InLng: r.Lng, InAccuracy: r.Acc,
			InDistance: dist, LateMinutes: late, WorkedOnOffDay: s.Status != "kerja", Source: "kiosk", IP: r.IP}
		if loc != nil {
			rec.InLocationID = &loc.ID
		}
		if existing.ID != 0 { // a manual row without tap-in
			rec.ID, rec.CheckOutAt, rec.WorkMinutes, rec.EarlyLeaveMinutes = existing.ID, existing.CheckOutAt, existing.WorkMinutes, existing.EarlyLeaveMinutes
		}
		if err := database.DB.Save(&rec).Error; err != nil {
			return nil, fail(http.StatusInternalServerError, "Gagal menyimpan absensi")
		}
		status, msg := "Hadir", "Tap in berhasil"
		if s.Status != "kerja" {
			status, msg = "Kerja Hari Libur", "Tap in berhasil — tercatat sebagai kerja pada hari libur/OFF"
		} else if late > 0 {
			status, msg = "Terlambat", fmt.Sprintf("Tap in berhasil — terlambat %d menit", late)
		}
		return gin.H{"action": "in", "time": now, "status": status, "late_minutes": late, "location": locName(loc), "distance": dist, "message": msg, "schedule": s.Start + "–" + s.End}, nil
	}

	// tap out: the latest open record from the last 20 h (covers overnight shifts)
	var rec models.AttendanceRecord
	database.DB.Where("employee_id = ? AND check_in_at IS NOT NULL AND check_out_at IS NULL AND check_in_at > ?", emp.ID, now.Add(-20*time.Hour)).Order("check_in_at DESC").Limit(1).Find(&rec)
	if rec.ID == 0 {
		var done models.AttendanceRecord
		database.DB.Where("employee_id = ? AND date = ? AND check_out_at IS NOT NULL", emp.ID, date).Limit(1).Find(&done)
		if done.ID != 0 {
			return nil, fail(http.StatusConflict, "Anda sudah tap out hari ini pukul %s.", done.CheckOutAt.In(jkt).Format("15:04"))
		}
		return nil, fail(http.StatusBadRequest, "Anda belum tap in. Jika lupa tap in, ajukan Absensi Manual di aplikasi.")
	}
	s := res.schedule(emp, rec.Date)
	loc, dist, terr := checkGPS(emp, s, r.Lat, r.Lng, r.Acc)
	if terr != nil {
		return nil, terr
	}
	late, early, work := computeTimes(s, rec.Date, rec.CheckInAt, &now)
	rec.CheckOutAt, rec.OutLat, rec.OutLng, rec.OutAccuracy, rec.OutDistance = &now, r.Lat, r.Lng, r.Acc, dist
	rec.LateMinutes, rec.EarlyLeaveMinutes, rec.WorkMinutes = late, early, work
	if loc != nil {
		rec.OutLocationID = &loc.ID
	}
	database.DB.Save(&rec)
	msg := fmt.Sprintf("Tap out berhasil — total %d jam %d menit", work/60, work%60)
	if early > 0 {
		msg += fmt.Sprintf(" (pulang %d menit lebih awal)", early)
	}
	return gin.H{"action": "out", "time": now, "status": "Pulang", "early_leave_minutes": early, "work_minutes": work, "location": locName(loc), "distance": dist, "message": msg}, nil
}

func locName(l *models.Location) string {
	if l == nil {
		return ""
	}
	return l.Name
}

// ---- views for the Absensi page ----

type attRow struct {
	EmployeeID   uint       `json:"employee_id"`
	Name         string     `json:"name"`
	NIK          string     `json:"nik"`
	UnitName     string     `json:"unit_name"`
	BusinessName string     `json:"business_name"`
	LocationName string     `json:"location_name"`
	Pattern      string     `json:"pattern"`
	Policy       string     `json:"policy"`
	SchedStatus  string     `json:"sched_status"`
	Schedule     string     `json:"schedule"`
	Holiday      string     `json:"holiday"`
	Adjusted     bool       `json:"adjusted"`
	Status       string     `json:"status"`
	LeaveType    string     `json:"leave_type"`
	CheckIn      *time.Time `json:"check_in"`
	CheckOut     *time.Time `json:"check_out"`
	Late         int        `json:"late_minutes"`
	Early        int        `json:"early_leave_minutes"`
	Work         int        `json:"work_minutes"`
	WorkedOff    bool       `json:"worked_on_off_day"`
	InLocation   string     `json:"in_location"`
	InDistance   *int       `json:"in_distance"`
	OutDistance  *int       `json:"out_distance"`
	Source       string     `json:"source"`
	Note         string     `json:"note"`
}

func attendanceEmployees(c *gin.Context) []models.Employee {
	q := employeeScope(c, database.DB.Model(&models.Employee{}))
	if s := c.Query("q"); s != "" {
		q = q.Where("employees.name ILIKE ? OR employees.nik ILIKE ?", "%"+s+"%", "%"+s+"%")
	}
	var emps []models.Employee
	q.Preload("Unit").Preload("Business").Preload("Location").Order("employees.name").Limit(1000).Find(&emps)
	return emps
}

func schedText(s Sched) string {
	switch s.Status {
	case "kerja":
		return s.Start + "–" + s.End
	case "libur":
		return "Libur"
	}
	return "OFF"
}

// statusFor derives the day's status from schedule + record + leave (see package doc on leave).
func statusFor(s Sched, rec *models.AttendanceRecord, leaveCat string, d, now time.Time) string {
	if rec != nil && rec.CheckInAt != nil {
		if s.Status == "kerja" && rec.LateMinutes > 0 {
			return "Terlambat"
		}
		return "Hadir"
	}
	if s.Status == "libur" {
		return "Libur"
	}
	if s.Status == "off" {
		return "OFF"
	}
	switch leaveCat {
	case "cuti":
		return "Cuti"
	case "izin":
		return "Izin"
	case "sakit":
		return "Sakit"
	}
	switch {
	case day(d).After(day(now)):
		return "Terjadwal"
	case day(d).Equal(day(now)):
		if s.Start != "" {
			end := atTime(d, s.End)
			if !end.After(atTime(d, s.Start)) {
				end = end.AddDate(0, 0, 1)
			}
			if now.After(end) {
				return "Tidak Hadir"
			}
		}
		return "Belum Absen"
	}
	return "Tidak Hadir"
}

func locNames() map[uint]string {
	m := map[uint]string{}
	var ls []models.Location
	database.DB.Select("id, name").Find(&ls)
	for _, l := range ls {
		m[l.ID] = l.Name
	}
	return m
}

func leaveMap(from, to time.Time, empIDs []uint) map[string]string { // "empID|yyyy-mm-dd" → category
	m := map[string]string{}
	if len(empIDs) == 0 {
		return m
	}
	type lv struct {
		EmployeeID uint
		StartDate  time.Time
		EndDate    time.Time
		Category   string
	}
	var ls []lv
	database.DB.Raw(`SELECT l.employee_id, l.start_date, l.end_date, t.category FROM leave_requests l JOIN leave_types t ON t.id = l.type_id
		WHERE l.status = 'Disetujui' AND l.start_date <= ? AND l.end_date >= ? AND l.employee_id IN ?`, to, from, empIDs).Scan(&ls)
	for _, l := range ls {
		for d := day(l.StartDate); !d.After(day(l.EndDate)); d = d.AddDate(0, 0, 1) {
			m[fmt.Sprintf("%d|%s", l.EmployeeID, d.Format("2006-01-02"))] = l.Category
		}
	}
	return m
}

func empIDsOf(emps []models.Employee) []uint {
	ids := make([]uint, 0, len(emps))
	for _, e := range emps {
		ids = append(ids, e.ID)
	}
	return ids
}

func policyText(s Sched) string {
	if s.RequireGPS {
		return "GPS wajib"
	}
	return "Tanpa GPS"
}

// AttendanceDaily: one row per employee for a date + scorecard counts.
func AttendanceDaily(c *gin.Context) {
	d := today()
	if v, ok := parseDate(c.Query("date")); ok {
		d = v
	}
	emps := attendanceEmployees(c)
	res := newResolver(d, d)
	var recs []models.AttendanceRecord
	if len(emps) > 0 {
		database.DB.Where("date = ? AND employee_id IN ?", d, empIDsOf(emps)).Find(&recs)
	}
	recOf := map[uint]*models.AttendanceRecord{}
	for i := range recs {
		recOf[recs[i].EmployeeID] = &recs[i]
	}
	leaves := leaveMap(d, d, empIDsOf(emps))
	locs := locNames()
	now := time.Now()
	rows := make([]attRow, 0, len(emps))
	sum := map[string]int{}
	for _, e := range emps {
		s := res.schedule(e, d)
		rec := recOf[e.ID]
		lc := leaves[fmt.Sprintf("%d|%s", e.ID, d.Format("2006-01-02"))]
		r := attRow{EmployeeID: e.ID, Name: e.Name, NIK: e.NIK, Pattern: s.Pattern, Policy: policyText(s), SchedStatus: s.Status, Schedule: schedText(s), Holiday: s.Holiday, Adjusted: s.Adjusted,
			Status: statusFor(s, rec, lc, d, now), LeaveType: lc}
		if e.Unit != nil {
			r.UnitName = e.Unit.Name
		}
		if e.Business != nil {
			r.BusinessName = e.Business.Name
		}
		lid := e.LocationID
		if s.LocationID != nil {
			lid = s.LocationID
		}
		if lid != nil {
			r.LocationName = locs[*lid]
		}
		if rec != nil {
			r.CheckIn, r.CheckOut, r.Late, r.Early, r.Work, r.WorkedOff = rec.CheckInAt, rec.CheckOutAt, rec.LateMinutes, rec.EarlyLeaveMinutes, rec.WorkMinutes, rec.WorkedOnOffDay
			r.InDistance, r.OutDistance, r.Source, r.Note = rec.InDistance, rec.OutDistance, rec.Source, rec.Note
			if rec.InLocationID != nil {
				r.InLocation = locs[*rec.InLocationID]
			}
		}
		rows = append(rows, r)
		// scorecards (Hari Kerja vs Hari Non-Kerja, as in the prototype)
		switch r.Status {
		case "Hadir", "Terlambat":
			sum["hadir"]++
			sum["kerja"]++
			if r.Status == "Terlambat" {
				sum["terlambat"]++
			}
			if r.WorkedOff {
				sum["kerja_hari_libur"]++
			}
		case "Izin", "Sakit":
			sum[strings.ToLower(r.Status)]++
			sum["kerja"]++
		case "Belum Absen", "Terjadwal", "Tidak Hadir":
			sum["belum"]++
			sum["kerja"]++
		case "Cuti":
			sum["cuti"]++
			sum["nonkerja"]++
		case "OFF":
			sum["off"]++
			sum["nonkerja"]++
		case "Libur":
			sum["libur"]++
			sum["nonkerja"]++
		}
	}
	c.JSON(http.StatusOK, gin.H{"date": d, "rows": rows, "summary": sum})
}

type recapRow struct {
	EmployeeID uint   `json:"employee_id"`
	Name       string `json:"name"`
	NIK        string `json:"nik"`
	UnitName   string `json:"unit_name"`
	Business   string `json:"business_name"`
	Location   string `json:"location_name"`
	WorkDays   int    `json:"work_days"`
	Present    int    `json:"present"`
	Late       int    `json:"late"`
	Absent     int    `json:"absent"` // belum / tidak absen on working days up to today
	Cuti       int    `json:"cuti"`
	Izin       int    `json:"izin"`
	Sakit      int    `json:"sakit"`
	WorkedOff  int    `json:"worked_off"`
	Off        int    `json:"off"`
	Holiday    int    `json:"holiday"`
	Minutes    int    `json:"work_minutes"`
	Rate       int    `json:"rate"`            // attendance % of working days elapsed
	Elapsed    int    `json:"elapsed"`         // scheduled working days already due (today counts once the person tapped in)
	Excused    int    `json:"excused_elapsed"` // of those, days covered by approved leave
}

// buildRecap computes per-employee attendance totals over [first,last].
func buildRecap(emps []models.Employee, first, last time.Time) []recapRow {
	now := today()
	res := newResolver(first, last)
	var recs []models.AttendanceRecord
	if len(emps) > 0 {
		database.DB.Where("date >= ? AND date <= ? AND employee_id IN ?", first, last, empIDsOf(emps)).Find(&recs)
	}
	recAt := map[string]*models.AttendanceRecord{}
	for i := range recs {
		recAt[fmt.Sprintf("%d|%s", recs[i].EmployeeID, day(recs[i].Date).Format("2006-01-02"))] = &recs[i]
	}
	leaves := leaveMap(first, last, empIDsOf(emps))
	locs := locNames()
	out := make([]recapRow, 0, len(emps))
	for _, e := range emps {
		r := recapRow{EmployeeID: e.ID, Name: e.Name, NIK: e.NIK}
		if e.Unit != nil {
			r.UnitName = e.Unit.Name
		}
		if e.Business != nil {
			r.Business = e.Business.Name
		}
		if e.LocationID != nil {
			r.Location = locs[*e.LocationID]
		}
		elapsed := 0
		for d := first; !d.After(last); d = d.AddDate(0, 0, 1) {
			k := fmt.Sprintf("%d|%s", e.ID, d.Format("2006-01-02"))
			s := res.schedule(e, d)
			rec := recAt[k]
			if rec != nil && rec.CheckInAt != nil {
				r.Present++
				r.Minutes += rec.WorkMinutes
				if s.Status == "kerja" {
					r.WorkDays++
					if !d.After(now) {
						elapsed++
					}
					if rec.LateMinutes > 0 {
						r.Late++
					}
				} else {
					r.WorkedOff++
				}
				continue
			}
			switch s.Status {
			case "libur":
				r.Holiday++
			case "off":
				r.Off++
			default:
				r.WorkDays++
				switch leaves[k] {
				case "cuti":
					r.Cuti++
				case "izin":
					r.Izin++
				case "sakit":
					r.Sakit++
				default:
					if d.Before(now) { // today is still open until the person taps in
						r.Absent++
					}
				}
				if leaves[k] != "" && !d.After(now) {
					elapsed++
					r.Excused++
				} else if leaves[k] == "" && d.Before(now) {
					elapsed++
				}
			}
		}
		r.Elapsed = elapsed
		if elapsed > 0 {
			r.Rate = int(math.Round(float64(r.Present-r.WorkedOff) * 100 / float64(elapsed)))
		}
		out = append(out, r)
	}
	return out
}

// AttendanceRecap: per-employee totals for a month (?month=YYYY-MM).
func AttendanceRecap(c *gin.Context) {
	first := time.Date(today().Year(), today().Month(), 1, 0, 0, 0, 0, jkt)
	if t, err := time.ParseInLocation("2006-01", c.Query("month"), jkt); err == nil {
		first = t
	}
	c.JSON(http.StatusOK, gin.H{"month": first.Format("2006-01"), "rows": buildRecap(attendanceEmployees(c), first, first.AddDate(0, 1, -1))})
}

type shiftRow struct {
	EmployeeID uint   `json:"employee_id"`
	Name       string `json:"name"`
	NIK        string `json:"nik"`
	Business   string `json:"business_name"`
	Location   string `json:"location_name"`
	Policy     string `json:"policy"`
	Pattern    string `json:"pattern"`
	Name2      string `json:"schedule_name"`
	Today      string `json:"today"`
	TodayState string `json:"today_state"`
	Tomorrow   string `json:"tomorrow"`
	Next       string `json:"tomorrow_state"`
	Adjusted   bool   `json:"adjusted"` // today follows an approved roster adjustment
}

func holidayHint(s Sched) string {
	if s.Holiday != "" && s.Status != "libur" {
		return " · " + s.Holiday
	}
	return ""
}

// AttendanceSchedule: who works which shift today and tomorrow.
func AttendanceSchedule(c *gin.Context) {
	d := today()
	if v, ok := parseDate(c.Query("date")); ok {
		d = v
	}
	emps := attendanceEmployees(c)
	res := newResolver(d, d.AddDate(0, 0, 1))
	locs := locNames()
	out := make([]shiftRow, 0, len(emps))
	for _, e := range emps {
		a, b := res.schedule(e, d), res.schedule(e, d.AddDate(0, 0, 1))
		r := shiftRow{EmployeeID: e.ID, Name: e.Name, NIK: e.NIK, Policy: policyText(a), Pattern: a.Pattern, Name2: a.Name,
			Today: schedText(a) + holidayHint(a), TodayState: a.Status, Tomorrow: schedText(b) + holidayHint(b), Next: b.Status, Adjusted: a.Adjusted || b.Adjusted}
		if e.Business != nil {
			r.Business = e.Business.Name
		}
		lid := e.LocationID
		if a.LocationID != nil {
			lid = a.LocationID
		}
		if lid != nil {
			r.Location = locs[*lid]
		}
		out = append(out, r)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	c.JSON(http.StatusOK, gin.H{"date": d, "rows": out})
}

// ---- manual attendance (approved through the approval engine) ----

func manualAttendanceHook(tx *gorm.DB, req *models.ApprovalRequest, outcome string) error {
	var m models.ManualAttendance
	if err := tx.First(&m, req.RefID).Error; err != nil {
		return err
	}
	switch outcome {
	case approval.Rejected:
		m.Status = "Ditolak"
	case approval.Cancelled:
		m.Status = "Dibatalkan"
	case approval.Approved:
		m.Status = "Disetujui"
		var emp models.Employee
		tx.Limit(1).Find(&emp, m.EmployeeID)
		date := day(m.Date)
		s := newResolver(date, date).schedule(emp, date)
		in, out := atTime(date, m.CheckIn), atTime(date, m.CheckOut)
		late, early, work := computeTimes(s, date, &in, &out)
		var rec models.AttendanceRecord
		tx.Where("employee_id = ? AND date = ?", m.EmployeeID, date).Limit(1).Find(&rec)
		rec.EmployeeID, rec.Date, rec.BusinessID = m.EmployeeID, date, m.BusinessID
		rec.CheckInAt, rec.CheckOutAt = &in, &out
		rec.InLat, rec.InLng, rec.InAccuracy, rec.InDistance, rec.InLocationID = nil, nil, nil, nil, nil
		rec.OutLat, rec.OutLng, rec.OutAccuracy, rec.OutDistance, rec.OutLocationID = nil, nil, nil, nil, nil
		rec.LateMinutes, rec.EarlyLeaveMinutes, rec.WorkMinutes = late, early, work
		rec.WorkedOnOffDay, rec.Source, rec.Note = s.Status != "kerja", "manual", "Absensi manual: "+m.Reason
		if err := tx.Save(&rec).Error; err != nil {
			return err
		}
	}
	return tx.Save(&m).Error
}

type manualView struct {
	models.ManualAttendance
	EmployeeName string `json:"employee_name"`
	UnitName     string `json:"unit_name"`
	WaitingFor   string `json:"waiting_for"`
	CanCancel    bool   `json:"can_cancel"`
}

func ListManualAttendance(c *gin.Context) {
	q := scopeBusiness(c, database.DB.Model(&models.ManualAttendance{}), "manual_attendances.business_id")
	if !isGroupLevel(c) {
		me := myEmployeeID(c)
		if me == nil {
			q = q.Where("1 = 0")
		} else {
			q = q.Where("manual_attendances.employee_id = ? OR manual_attendances.employee_id IN "+downlineSQL, *me, *me)
		}
	}
	var l []models.ManualAttendance
	q.Order("manual_attendances.created_at DESC").Limit(500).Find(&l)
	names := map[uint]models.Employee{}
	var es []models.Employee
	database.DB.Preload("Unit").Select("id, name, unit_id").Find(&es)
	for _, e := range es {
		names[e.ID] = e
	}
	waiting := map[uint]string{}
	var ws []struct {
		RequestID uint
		Name      string
	}
	database.DB.Raw(`SELECT s.request_id, u.name FROM approval_steps s JOIN users u ON u.id = s.approver_user_id WHERE s.status = 'Pending'
		AND s.request_id IN (SELECT approval_id FROM manual_attendances WHERE status = 'Pending Approval')`).Scan(&ws)
	for _, w := range ws {
		waiting[w.RequestID] = w.Name
	}
	me := myEmployeeID(c)
	out := make([]manualView, 0, len(l))
	for _, m := range l {
		v := manualView{ManualAttendance: m, EmployeeName: names[m.EmployeeID].Name}
		if u := names[m.EmployeeID].Unit; u != nil {
			v.UnitName = u.Name
		}
		if m.ApprovalID != nil {
			v.WaitingFor = waiting[*m.ApprovalID]
		}
		v.CanCancel = m.Status == "Pending Approval" && (isGroupLevel(c) || (me != nil && *me == m.EmployeeID))
		out = append(out, v)
	}
	c.JSON(http.StatusOK, out)
}

func CreateManualAttendance(c *gin.Context) {
	var in struct {
		EmployeeID     uint   `json:"employee_id"`
		Date           string `json:"date"`
		CheckIn        string `json:"check_in"`
		CheckOut       string `json:"check_out"`
		Reason         string `json:"reason"`
		AssignedUserID *uint  `json:"assigned_user_id"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "data tidak valid"})
		return
	}
	date, ok := parseDate(in.Date)
	if !ok || !hhmm.MatchString(in.CheckIn) || !hhmm.MatchString(in.CheckOut) || strings.TrimSpace(in.Reason) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tanggal, jam masuk, jam keluar (HH:MM), dan alasan wajib diisi"})
		return
	}
	if in.CheckOut <= in.CheckIn {
		c.JSON(http.StatusBadRequest, gin.H{"error": "jam keluar harus setelah jam masuk"})
		return
	}
	if date.After(today()) || date.Before(today().AddDate(0, 0, -31)) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tanggal harus dalam 31 hari terakhir dan tidak boleh di masa depan"})
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
	if !(me != nil && *me == empID) && !isGroupLevel(c) && !(me != nil && inDownline(*me, empID)) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Anda hanya dapat mengajukan untuk diri sendiri atau bawahan Anda"})
		return
	}
	var emp models.Employee
	if database.DB.Limit(1).Find(&emp, empID).Error != nil || emp.ID == 0 || emp.Status != "Aktif" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "karyawan tidak ditemukan atau tidak aktif"})
		return
	}
	var dup int64
	database.DB.Model(&models.ManualAttendance{}).Where("employee_id = ? AND date = ? AND status = 'Pending Approval'", empID, date).Count(&dup)
	if dup > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "sudah ada pengajuan absensi manual yang menunggu untuk tanggal tersebut"})
		return
	}
	var empUser models.User
	database.DB.Where("employee_id = ?", empID).Limit(1).Find(&empUser)
	requester := empUser.ID
	if requester == 0 {
		requester = uid(c)
	}
	var m models.ManualAttendance
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		m = models.ManualAttendance{EmployeeID: empID, BusinessID: emp.BusinessID, Date: date, CheckIn: in.CheckIn, CheckOut: in.CheckOut, Reason: strings.TrimSpace(in.Reason), Status: "Pending Approval"}
		if err := tx.Create(&m).Error; err != nil {
			return err
		}
		req, err := approval.Submit(tx, approval.SubmitInput{Type: "attendance_manual", RefID: m.ID, BusinessID: emp.BusinessID, RequesterEmployeeID: &empID, RequesterUserID: requester,
			Title: "Absensi Manual — " + emp.Name, Summary: fmt.Sprintf("%s · %s–%s · %s", date.Format("02/01/06"), in.CheckIn, in.CheckOut, m.Reason), AssignedUserID: in.AssignedUserID})
		if err != nil {
			return err
		}
		m.ApprovalID = &req.ID
		return tx.Model(&m).Update("approval_id", req.ID).Error
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	audit(c, "create", "manual_attendance", m.ID)
	c.JSON(http.StatusOK, m)
}

func CancelManualAttendance(c *gin.Context) {
	var m models.ManualAttendance
	if database.DB.Limit(1).Find(&m, paramID(c)).Error != nil || m.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "pengajuan tidak ditemukan"})
		return
	}
	me := myEmployeeID(c)
	if !isGroupLevel(c) && (me == nil || *me != m.EmployeeID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "hanya pemohon atau HR yang dapat membatalkan"})
		return
	}
	if m.Status != "Pending Approval" || m.ApprovalID == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "hanya pengajuan yang menunggu yang dapat dibatalkan"})
		return
	}
	var req models.ApprovalRequest
	database.DB.First(&req, *m.ApprovalID)
	err := database.DB.Transaction(func(tx *gorm.DB) error { _, e := approval.Cancel(tx, req.ID, req.RequesterUserID); return e })
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	audit(c, "cancel", "manual_attendance", m.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

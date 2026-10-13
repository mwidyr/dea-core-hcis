package handlers

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
)

type actionItem struct {
	Title string `json:"title"`
	Sub   string `json:"sub"`
	Badge string `json:"badge"`
	Tone  string `json:"tone"` // red | amber | blue | gray | green
	To    string `json:"to"`
}

type unitScore struct {
	Name  string  `json:"name"`
	Score float64 `json:"score"`
	Count int     `json:"count"`
}

type teamRow struct {
	EmployeeID uint     `json:"employee_id"`
	Name       string   `json:"name"`
	Unit       string   `json:"unit"`
	Open       int      `json:"open"`
	Overdue    int      `json:"overdue"`
	KPI        *float64 `json:"kpi"`
	Attendance *int     `json:"attendance"`
}

type projectRow struct {
	ID        uint    `json:"id"`
	Name      string  `json:"name"`
	Desc      string  `json:"desc"`
	Business  string  `json:"business"`
	Owner     string  `json:"owner"`
	Start     string  `json:"start"`
	End       string  `json:"end"`
	DaysLeft  *int    `json:"days_left"`
	Tasks     int     `json:"tasks"`
	Open      int     `json:"open"`
	Overdue   int     `json:"overdue"`
	Progress  float64 `json:"progress"`
	Status    string  `json:"status"` // On Track | Monitoring | At Risk
	StatusTon string  `json:"status_tone"`
}

type myTaskRow struct {
	ID         uint    `json:"id"`
	Title      string  `json:"title"`
	Project    string  `json:"project"`
	Due        string  `json:"due"`
	Status     string  `json:"status"`
	Timeliness string  `json:"timeliness"`
	Label      string  `json:"timeliness_label"`
	Progress   float64 `json:"progress"`
}

// dashboardLayout adds the blocks of the redesigned dashboard (prototype V113 layout) to the payload.
func dashboardLayout(c *gin.Context, out gin.H, view string, emps []models.Employee, ts []models.Task, calcs map[uint]*taskCalc, scores []empScore, st models.KPISettings, now time.Time, pv []projectView, expiring, vacant int) {
	// leaf tasks only, derived status, per PIC
	byPIC := map[uint]*picAgg{}
	var overdueTitles, lateTitles []string
	for _, t := range ts {
		cc := calcs[t.BusinessID]
		if cc == nil || cc.isParent(t.ID) || t.Status == "done" {
			continue
		}
		a := byPIC[t.PICID]
		if a == nil {
			a = &picAgg{}
			byPIC[t.PICID] = a
		}
		a.open++
		switch taskTimeliness(t.Status, t.StartDate, t.DueDate, t.CompletedAt, now) {
		case tmOverdue:
			a.overdue++
			if len(overdueTitles) < 2 {
				overdueTitles = append(overdueTitles, t.Title)
			}
		case tmLateStart:
			a.lateStart++
			if len(lateTitles) < 2 {
				lateTitles = append(lateTitles, t.Title)
			}
		}
	}
	totOver, totLate := 0, 0
	for _, a := range byPIC {
		totOver += a.overdue
		totLate += a.lateStart
	}

	var pending int64
	var pendingTypes []struct {
		RequestType string
		N           int
	}
	database.DB.Raw(`SELECT r.request_type, COUNT(*) AS n FROM approval_steps s JOIN approval_requests r ON r.id = s.request_id
		WHERE s.approver_user_id = ? AND s.status = 'Pending' AND r.status = 'Pending' AND r.current_level = s.level GROUP BY r.request_type`, uid(c)).Scan(&pendingTypes)
	typeName := map[string]string{"leave": "cuti/izin", "attendance_manual": "absensi manual", "task": "penyelesaian tugas", "task_deadline": "deadline tugas", "roster": "penyesuaian roster", "employee_change": "data karyawan"}
	var parts []string
	for _, p := range pendingTypes {
		pending += int64(p.N)
		parts = append(parts, fmt.Sprintf("%d %s", p.N, typeName[p.RequestType]))
	}

	// KPI figures of the people in this view
	byEmp := map[uint]empScore{}
	below := 0
	for _, s := range scores {
		byEmp[s.EmployeeID] = s
		if s.Final != nil && (s.Status == "Attention" || s.Status == "Critical") {
			below++
		}
	}

	actions := []actionItem{}
	add := func(n int, title, sub, badge, tone, to string) {
		if n > 0 {
			actions = append(actions, actionItem{title, sub, badge, tone, to})
		}
	}
	mine := view == "me"
	who := map[bool]string{true: "Anda", false: "tim"}[mine]
	add(totOver, fmt.Sprintf("%d Task Overdue", totOver), orSub(strings.Join(overdueTitles, " · "), "Lewat deadline, perlu tindak lanjut"), "Urgent", "red", "/tasks")
	add(totLate, fmt.Sprintf("%d Task Terlambat Mulai", totLate), orSub(strings.Join(lateTitles, " · "), "Sudah waktunya mulai tetapi masih To Do"), "Mulai", "amber", "/tasks")
	add(int(pending), fmt.Sprintf("%d Approval Pending", pending), strings.Join(parts, " · "), "Pending", "amber", "/approval")

	// projects: "Project / Pekerjaan Aktif"
	biz := map[uint]string{}
	var bs []models.Business
	database.DB.Select("id, name").Find(&bs)
	for _, b := range bs {
		biz[b.ID] = b.Name
	}
	rows := []projectRow{}
	atRisk := []string{}
	for _, p := range pv {
		r := projectRow{ID: p.ID, Name: p.Name, Desc: p.Description, Business: biz[p.BusinessID], Owner: p.OwnerName, Start: fmtDate(p.StartDate), End: fmtDate(p.EndDate),
			Tasks: p.TopLevel + p.Subtasks, Open: p.Open, Overdue: p.Overdue, Progress: p.Progress}
		if p.EndDate != nil {
			dl := int(day(*p.EndDate).Sub(now).Hours() / 24)
			r.DaysLeft = &dl
		}
		switch {
		case p.Overdue > 0 || (r.DaysLeft != nil && *r.DaysLeft < 0 && p.Progress < 100):
			r.Status, r.StatusTon = "At Risk", "red"
			atRisk = append(atRisk, fmt.Sprintf("%s · progres %.0f%%", p.Name, p.Progress))
		case r.DaysLeft != nil && *r.DaysLeft <= 14 && p.Progress < 80:
			r.Status, r.StatusTon = "Monitoring", "blue"
		default:
			r.Status, r.StatusTon = "On Track", "green"
		}
		rows = append(rows, r)
	}
	sort.SliceStable(rows, func(i, j int) bool {
		rank := map[string]int{"At Risk": 0, "Monitoring": 1, "On Track": 2}
		if rank[rows[i].Status] != rank[rows[j].Status] {
			return rank[rows[i].Status] < rank[rows[j].Status]
		}
		return rows[i].End < rows[j].End
	})
	if len(rows) > 6 {
		rows = rows[:6]
	}
	if !mine {
		add(len(atRisk), fmt.Sprintf("%d Proyek Perlu Perhatian", len(atRisk)), strings.Join(atRisk[:minInt(len(atRisk), 2)], " · "), "At Risk", "red", "/projects")
	}
	add(below, fmt.Sprintf("%d KPI di Bawah Target", below), map[bool]string{true: "Skor akhir Anda perlu ditingkatkan", false: "Perlu review atasan periode ini"}[mine], "Review", "blue", "/kpi")
	if !mine {
		add(expiring, fmt.Sprintf("%d Kontrak Berakhir ≤ 30 Hari", expiring), "Perpanjang atau selesaikan kontrak", "Kontrak", "amber", "/contracts")
		add(vacant, fmt.Sprintf("%d Posisi Vacant", vacant), "Belum ada pemegang jabatan", "Vacant", "gray", "/org")
	}
	if len(actions) == 0 {
		actions = append(actions, actionItem{"Semua beres", "Tidak ada yang perlu ditindaklanjuti untuk " + who + " saat ini", "OK", "green", "/"})
	}
	out["actions"] = actions
	out["project_rows"] = rows

	if mine {
		out["personal"] = personalBlock(c, ts, calcs, now)
	} else {
		out["units"] = unitScores(scores, st)
		out["team"] = teamTable(emps, byPIC, byEmp, now)
	}
	items, total := listActivity(c, mine, &now, 8, 0)
	out["activity"] = items
	out["activity_total"] = total
}

func orSub(s, fallback string) string {
	if strings.TrimSpace(s) == "" {
		return fallback
	}
	return s
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

type picAgg struct{ open, overdue, lateStart int }

// teamTable: "Team Performance" — people worth watching first (most overdue, then lowest KPI), with attendance of this month.
func teamTable(emps []models.Employee, byPIC map[uint]*picAgg, kpi map[uint]empScore, now time.Time) []teamRow {
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, jkt)
	rate := map[uint]int{}
	has := map[uint]bool{}
	for _, r := range buildRecap(emps, monthStart, now) {
		rate[r.EmployeeID], has[r.EmployeeID] = r.Rate, r.WorkDays > 0
	}
	rows := make([]teamRow, 0, len(emps))
	for _, e := range emps {
		r := teamRow{EmployeeID: e.ID, Name: e.Name}
		if e.Unit != nil {
			r.Unit = e.Unit.Name
		}
		if a := byPIC[e.ID]; a != nil {
			r.Open, r.Overdue = a.open, a.overdue
		}
		if s, ok := kpi[e.ID]; ok {
			r.KPI = s.Final
		}
		if has[e.ID] {
			v := rate[e.ID]
			r.Attendance = &v
		}
		rows = append(rows, r)
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].Overdue != rows[j].Overdue {
			return rows[i].Overdue > rows[j].Overdue
		}
		ki, kj := 1e9, 1e9
		if rows[i].KPI != nil {
			ki = *rows[i].KPI
		}
		if rows[j].KPI != nil {
			kj = *rows[j].KPI
		}
		return ki < kj
	})
	if len(rows) > 8 {
		rows = rows[:8]
	}
	return rows
}

// personalBlock: the "Personal" dashboard — own attendance today, leave balance, open tasks.
func personalBlock(c *gin.Context, ts []models.Task, calcs map[uint]*taskCalc, now time.Time) gin.H {
	out := gin.H{}
	me := myEmployeeID(c)
	if me == nil {
		return out
	}
	var emp models.Employee
	database.DB.Preload("Position").Preload("Unit").Limit(1).Find(&emp, *me)
	out["name"] = emp.Name
	if emp.Position != nil {
		out["position"] = emp.Position.Title
	}
	// attendance today
	var rec models.AttendanceRecord
	database.DB.Where("employee_id = ? AND date = ?", emp.ID, day(now)).Limit(1).Find(&rec)
	att := gin.H{"status": "Belum Absen"}
	if rec.ID != 0 && rec.CheckInAt != nil {
		att["check_in"] = rec.CheckInAt
		att["status"] = "Hadir"
		if rec.LateMinutes > 0 {
			att["status"] = "Terlambat"
			att["late_minutes"] = rec.LateMinutes
		}
		if rec.CheckOutAt != nil {
			att["check_out"], att["status"] = rec.CheckOutAt, "Pulang"
			att["work_minutes"] = rec.WorkMinutes
		}
	}
	out["attendance_today"] = att
	// leave balance
	year := now.Year()
	var rosterN int64
	database.DB.Model(&models.RosterAssignment{}).Where("employee_id = ?", emp.ID).Count(&rosterN)
	b := balanceFor(emp, year, yearHolidays(year), rosterN > 0)
	out["leave"] = gin.H{"remaining": b.Remaining, "used": b.Used, "pending": b.Pending, "initial": b.Initial + b.Added}
	var pendingLeave int64
	database.DB.Model(&models.LeaveRequest{}).Where("employee_id = ? AND status = 'Pending Approval'", emp.ID).Count(&pendingLeave)
	out["pending_leave_mine"] = pendingLeave
	// my open tasks, most urgent first
	projNames := map[uint]string{}
	var pids []uint
	for _, t := range ts {
		if t.ProjectID != nil {
			pids = append(pids, *t.ProjectID)
		}
	}
	if len(pids) > 0 {
		var ps []models.Project
		database.DB.Select("id, name").Where("id IN ?", pids).Find(&ps)
		for _, p := range ps {
			projNames[p.ID] = p.Name
		}
	}
	list := []myTaskRow{}
	for _, t := range ts {
		cc := calcs[t.BusinessID]
		if cc == nil || cc.isParent(t.ID) || t.Status == "done" || t.PICID != emp.ID {
			continue
		}
		tm := taskTimeliness(t.Status, t.StartDate, t.DueDate, t.CompletedAt, now)
		r := myTaskRow{ID: t.ID, Title: t.Title, Due: fmtDate(t.DueDate), Status: statusText(t.Status), Timeliness: tm, Label: timelinessLabel[tm], Progress: cc.progress(t.ID)}
		if t.ProjectID != nil {
			r.Project = projNames[*t.ProjectID]
		}
		list = append(list, r)
	}
	rank := map[string]int{tmOverdue: 0, tmLateStart: 1, tmOnTrack: 2, "": 3}
	sort.SliceStable(list, func(i, j int) bool { return rank[list[i].Timeliness] < rank[list[j].Timeliness] })
	if len(list) > 8 {
		list = list[:8]
	}
	out["my_tasks"] = list
	return out
}

// unitScores: "Performance Departemen" — average final score per Fungsi (organisation level 2; the PIC's own unit when the tree is shallower).
func unitScores(scores []empScore, st models.KPISettings) []unitScore {
	chains := unitChains()
	sum, cnt := map[string]float64{}, map[string]int{}
	for _, s := range scores {
		if s.Final == nil || s.UnitID == nil {
			continue
		}
		name := s.UnitName
		chain := chains[*s.UnitID]
		for _, u := range chain {
			if u.Level == 2 {
				name = u.Name
				break
			}
		}
		if name == "" {
			name = "Tanpa unit"
		}
		sum[name] += *s.Final
		cnt[name]++
	}
	out := []unitScore{}
	for n, v := range sum {
		out = append(out, unitScore{n, r1(v / float64(cnt[n])), cnt[n]})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Score > out[j].Score })
	if len(out) > 8 {
		out = out[:8]
	}
	return out
}

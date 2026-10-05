package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/dea-core/hcis/backend/internal/perm"
	"github.com/gin-gonic/gin"
	"github.com/xuri/excelize/v2"
)

// Reports share one shape so the same data feeds the on-screen table, the Excel export (backend) and the PDF (frontend).
type reportData struct {
	Type      string     `json:"type"`
	Title     string     `json:"title"`
	Subtitle  string     `json:"subtitle"`
	Columns   []string   `json:"columns"`
	Rows      [][]any    `json:"rows"`
	Summary   [][]string `json:"summary"` // [label, value]
	CanExport bool       `json:"can_export"`
}

func fmtDate(t *time.Time) string {
	if t == nil || t.IsZero() {
		return ""
	}
	return day(*t).Format("02/01/2006")
}

func dateParam(c *gin.Context, name string, def time.Time) (time.Time, bool) {
	s := strings.TrimSpace(c.Query(name))
	if s == "" {
		return def, true
	}
	return parseDate(s)
}

// rangeParams: from/to (default: this month), at most 366 days.
func rangeParams(c *gin.Context) (time.Time, time.Time, string) {
	now := today()
	first := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, jkt)
	from, ok1 := dateParam(c, "from", first)
	to, ok2 := dateParam(c, "to", first.AddDate(0, 1, -1))
	if !ok1 || !ok2 {
		return from, to, "format tanggal tidak valid"
	}
	if to.Before(from) {
		return from, to, "tanggal akhir tidak boleh sebelum tanggal awal"
	}
	if to.Sub(from).Hours()/24 > 366 {
		return from, to, "rentang laporan maksimal 1 tahun"
	}
	return from, to, ""
}

func rangeText(from, to time.Time) string {
	return from.Format("02/01/2006") + " – " + to.Format("02/01/2006")
}

func scopeName(c *gin.Context) string {
	if b, _ := strconv.Atoi(c.Query("business_id")); b > 0 {
		var bz models.Business
		database.DB.Select("id, name").Limit(1).Find(&bz, b)
		if bz.Name != "" {
			return bz.Name
		}
	}
	return "Semua bisnis yang dapat diakses"
}

func GetReport(c *gin.Context) {
	rep, status, msg := buildReport(c, c.Param("type"))
	if msg != "" {
		c.JSON(status, gin.H{"error": msg})
		return
	}
	rep.CanExport = perm.Has(role(c), "reports.export")
	if c.Query("format") == "xlsx" {
		if !rep.CanExport {
			c.JSON(http.StatusForbidden, gin.H{"error": "Anda tidak memiliki izin untuk mengekspor laporan"})
			return
		}
		writeXLSX(c, rep)
		audit(c, "export", "report:"+rep.Type, 0)
		return
	}
	c.JSON(http.StatusOK, rep)
}

func writeXLSX(c *gin.Context, rep reportData) {
	f := excelize.NewFile()
	sheet := "Laporan"
	f.SetSheetName("Sheet1", sheet)
	title, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true, Size: 14}})
	head, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true, Color: "FFFFFF"}, Fill: excelize.Fill{Type: "pattern", Color: []string{"D84A4A"}, Pattern: 1},
		Alignment: &excelize.Alignment{Vertical: "center", WrapText: true}})
	f.SetCellValue(sheet, "A1", rep.Title)
	f.SetCellStyle(sheet, "A1", "A1", title)
	f.SetCellValue(sheet, "A2", rep.Subtitle)
	r := 4
	for _, kv := range rep.Summary {
		f.SetCellValue(sheet, cell(1, r), kv[0])
		f.SetCellValue(sheet, cell(2, r), kv[1])
		r++
	}
	if len(rep.Summary) > 0 {
		r++
	}
	hr := r
	for i, h := range rep.Columns {
		f.SetCellValue(sheet, cell(i+1, r), h)
		f.SetColWidth(sheet, colName(i+1), colName(i+1), 16)
	}
	f.SetCellStyle(sheet, cell(1, r), cell(len(rep.Columns), r), head)
	for _, row := range rep.Rows {
		r++
		for i, v := range row {
			f.SetCellValue(sheet, cell(i+1, r), v)
		}
	}
	if len(rep.Columns) > 0 {
		f.AutoFilter(sheet, cell(1, hr)+":"+cell(len(rep.Columns), r), nil)
		f.SetPanes(sheet, &excelize.Panes{Freeze: true, YSplit: hr, TopLeftCell: cell(1, hr+1), ActivePane: "bottomLeft"})
	}
	c.Header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="laporan-%s-%s.xlsx"`, rep.Type, today().Format("20060102")))
	f.Write(c.Writer)
}

func colName(n int) string { s, _ := excelize.ColumnNumberToName(n); return s }
func cell(col, row int) string {
	s, _ := excelize.CoordinatesToCellName(col, row)
	return s
}

func buildReport(c *gin.Context, typ string) (reportData, int, string) {
	rep := reportData{Type: typ, Rows: [][]any{}, Summary: [][]string{}}
	switch typ {
	case "employees":
		rep.Title = "Laporan Karyawan"
		rep.Subtitle = scopeName(c)
		q := employeeScope(c, database.DB.Model(&models.Employee{}))
		if u, _ := strconv.Atoi(c.Query("unit_id")); u > 0 {
			q = q.Where("employees.unit_id IN (?)", subtreeUnits(uint(u)))
		}
		if v := c.Query("employee_type"); v != "" {
			q = q.Where("employees.employee_type = ?", v)
		}
		var es []models.Employee
		q.Preload("Position").Preload("Unit").Preload("Location").Preload("Business").Order("employees.business_id, employees.name").Limit(5000).Find(&es)
		mgr := map[uint]string{}
		var all []models.Employee
		database.DB.Select("id, name").Find(&all)
		for _, e := range all {
			mgr[e.ID] = e.Name
		}
		rep.Columns = []string{"NIK", "Nama", "Bisnis", "Unit", "Jabatan", "Lokasi", "Tipe", "Tgl Bergabung", "Kontrak Berakhir", "Atasan"}
		tetap := 0
		for _, e := range es {
			var unit, pos, loc, biz string
			if e.Unit != nil {
				unit = e.Unit.Name
			}
			if e.Position != nil {
				pos = e.Position.Title
			}
			if e.Location != nil {
				loc = e.Location.Name
			}
			if e.Business != nil {
				biz = e.Business.Name
			}
			var m string
			if e.ManagerID != nil {
				m = mgr[*e.ManagerID]
			}
			if e.EmployeeType == "Tetap" {
				tetap++
			}
			rep.Rows = append(rep.Rows, []any{e.NIK, e.Name, biz, unit, pos, loc, e.EmployeeType, fmtDate(e.JoinDate), fmtDate(e.ContractEnd), m})
		}
		rep.Summary = [][]string{{"Karyawan aktif", strconv.Itoa(len(es))}, {"Tetap", strconv.Itoa(tetap)}, {"Kontrak", strconv.Itoa(len(es) - tetap)}}

	case "attendance":
		from, to, msg := rangeParams(c)
		if msg != "" {
			return rep, http.StatusBadRequest, msg
		}
		rep.Title = "Laporan Rekap Absensi"
		rep.Subtitle = scopeName(c) + " · " + rangeText(from, to)
		emps := kpiEmployees(c)
		rows := buildRecap(emps, from, to)
		rep.Columns = []string{"NIK", "Nama", "Unit", "Hari Kerja", "Hadir", "Terlambat", "Tidak Hadir", "Cuti", "Izin", "Sakit", "Jam Kerja", "Kehadiran %"}
		var present, late, absent, workDays int
		for _, r := range rows {
			rep.Rows = append(rep.Rows, []any{r.NIK, r.Name, r.UnitName, r.WorkDays, r.Present, r.Late, r.Absent, r.Cuti, r.Izin, r.Sakit, r1(float64(r.Minutes) / 60), r.Rate})
			present += r.Present
			late += r.Late
			absent += r.Absent
			workDays += r.WorkDays
		}
		rep.Summary = [][]string{{"Karyawan", strconv.Itoa(len(rows))}, {"Total hadir", strconv.Itoa(present)}, {"Total terlambat", strconv.Itoa(late)}, {"Total tidak hadir", strconv.Itoa(absent)}}

	case "leave":
		from, to, msg := rangeParams(c)
		if msg != "" {
			return rep, http.StatusBadRequest, msg
		}
		rep.Title = "Laporan Cuti & Izin"
		rep.Subtitle = scopeName(c) + " · " + rangeText(from, to)
		q := database.DB.Model(&models.LeaveRequest{}).Preload("Employee.Unit").Preload("Type").
			Where("leave_requests.employee_id IN (?) AND leave_requests.start_date <= ? AND leave_requests.end_date >= ?",
				employeeScope(c, database.DB.Model(&models.Employee{})).Select("employees.id"), to, from)
		if v := c.Query("status"); v != "" {
			q = q.Where("leave_requests.status = ?", v)
		}
		if v := c.Query("category"); v != "" {
			q = q.Where("leave_requests.type_id IN (SELECT id FROM leave_types WHERE category = ?)", v)
		}
		var ls []models.LeaveRequest
		q.Order("leave_requests.start_date").Limit(5000).Find(&ls)
		rep.Columns = []string{"Karyawan", "Unit", "Jenis", "Mulai", "Selesai", "Hari", "Status", "Alasan", "Diajukan"}
		days := 0
		for _, l := range ls {
			var name, unit, typ string
			if l.Employee != nil {
				name = l.Employee.Name
				if l.Employee.Unit != nil {
					unit = l.Employee.Unit.Name
				}
			}
			if l.Type != nil {
				typ = l.Type.Name
			}
			if l.Status == "Disetujui" {
				days += l.Days
			}
			created := l.CreatedAt
			rep.Rows = append(rep.Rows, []any{name, unit, typ, fmtDate(&l.StartDate), fmtDate(&l.EndDate), l.Days, l.Status, l.Reason, fmtDate(&created)})
		}
		rep.Summary = [][]string{{"Pengajuan", strconv.Itoa(len(ls))}, {"Total hari disetujui", strconv.Itoa(days)}}

	case "tasks":
		from, to, msg := rangeParams(c)
		if msg != "" {
			return rep, http.StatusBadRequest, msg
		}
		rep.Title = "Laporan Tugas"
		rep.Subtitle = scopeName(c) + " · deadline " + rangeText(from, to)
		q := taskScope(c, "all").Where("tasks.due_date >= ? AND tasks.due_date <= ?", from, to)
		if v := c.Query("project_id"); v == "none" {
			q = q.Where("tasks.project_id IS NULL")
		} else if v != "" {
			q = q.Where("tasks.project_id = ?", v)
		}
		if v := c.Query("pic_id"); v != "" {
			q = q.Where("tasks.pic_id = ?", v)
		}
		var ts []models.Task
		q.Order("tasks.due_date, tasks.id").Limit(5000).Find(&ts)
		views := decorateTasks(c, ts, calcsFor(ts))
		stF := c.Query("status")
		rep.Columns = []string{"ID", "Tugas", "Proyek", "PIC", "Pemberi Tugas", "Prioritas", "Status", "Progres %", "Mulai", "Deadline", "Selesai", "Terlambat"}
		done, late := 0, 0
		n := 0
		for _, v := range views {
			if stF != "" && v.Status != stF {
				continue
			}
			n++
			if v.Status == "done" {
				done++
			}
			l := ""
			if v.Overdue {
				l = "Ya"
				late++
			}
			rep.Rows = append(rep.Rows, []any{v.ID, v.Title, v.ProjectName, v.PICName, v.AssignerName, v.Priority, statusLabelID(v.Status), v.Progress, fmtDate(v.StartDate), fmtDate(v.DueDate), fmtDate(v.CompletedAt), l})
		}
		rep.Summary = [][]string{{"Total tugas", strconv.Itoa(n)}, {"Selesai", strconv.Itoa(done)}, {"Terlambat", strconv.Itoa(late)}}

	case "projects":
		rep.Title = "Laporan Proyek"
		rep.Subtitle = scopeName(c)
		q := scopeBusiness(c, database.DB.Model(&models.Project{}), "projects.business_id")
		if !isGroupLevel(c) {
			me := myEmployeeID(c)
			if me == nil {
				q = q.Where("1 = 0")
			} else {
				q = q.Where("projects.owner_id = ? OR projects.owner_id IN "+downlineSQL, *me, *me)
			}
		}
		if v := c.Query("status"); v != "" {
			q = q.Where("projects.status = ?", v)
		}
		var ps []models.Project
		q.Order("projects.id DESC").Limit(1000).Find(&ps)
		rep.Columns = []string{"Proyek", "Pemilik", "Status", "Mulai", "Selesai", "Progres %", "Tugas Induk", "Sub Tugas", "Tugas Selesai", "Tugas Open", "Terlambat"}
		for _, v := range decorateProjects(c, ps) {
			rep.Rows = append(rep.Rows, []any{v.Name, v.OwnerName, v.Status, fmtDate(v.StartDate), fmtDate(v.EndDate), v.Progress, v.TopLevel, v.Subtasks, v.Done, v.Open, v.Overdue})
		}
		rep.Summary = [][]string{{"Proyek", strconv.Itoa(len(rep.Rows))}}

	case "kpi":
		per, ok := periodFrom(c)
		if !ok {
			return rep, http.StatusBadRequest, "periode tidak valid (gunakan 2026-10 atau 2026-Q4)"
		}
		rep.Title = "Laporan KPI & Scorecard"
		rep.Subtitle = scopeName(c) + " · " + per.Label
		st := getKPISettings()
		emps := kpiEmployees(c)
		var scores []empScore
		if closeInfo(per.Key) != nil {
			scores = snapshotScores(per.Key, emps)
			rep.Subtitle += " (periode ditutup)"
		} else {
			scores = computeScores(emps, per, st)
		}
		rep.Columns = []string{"Peringkat", "NIK", "Nama", "Unit", "KPI %", "Tugas %", "Absensi %", "Skor Akhir %", "Status"}
		var sum float64
		n := 0
		for _, s := range scores {
			rep.Rows = append(rep.Rows, []any{rankText(s.Rank), s.NIK, s.Name, s.UnitName, nilNum(s.KPI), nilNum(s.Task), nilNum(s.Att), nilNum(s.Final), s.Status})
			if s.Final != nil {
				sum += *s.Final
				n++
			}
		}
		avg := "–"
		if n > 0 {
			avg = fmt.Sprintf("%.1f%%", sum/float64(n))
		}
		rep.Summary = [][]string{{"Karyawan", strconv.Itoa(len(scores))}, {"Rata-rata skor akhir", avg},
			{"Bobot", fmt.Sprintf("KPI %.0f%% · Tugas %.0f%% · Absensi %.0f%%", st.WeightKPI, st.WeightTask, st.WeightAttendance)}}

	default:
		return rep, http.StatusNotFound, "jenis laporan tidak dikenal"
	}
	return rep, http.StatusOK, ""
}

func statusLabelID(s string) string {
	switch s {
	case "todo":
		return "To Do"
	case "in_progress":
		return "In Progress"
	case "review":
		return "Menunggu Approval"
	case "done":
		return "Selesai"
	}
	return s
}

func rankText(r int) any {
	if r == 0 {
		return ""
	}
	return r
}

func nilNum(v *float64) any {
	if v == nil {
		return ""
	}
	return *v
}

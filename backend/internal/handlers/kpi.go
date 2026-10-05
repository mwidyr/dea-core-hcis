package handlers

import (
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ---- periods: "2026-10" (monthly) or "2026-Q4" (quarterly) ----

type kpiPeriod struct {
	Key, Label string
	From, To   time.Time
}

var qLabel = map[int]string{1: "Q1", 2: "Q2", 3: "Q3", 4: "Q4"}

func parsePeriod(key string) (kpiPeriod, bool) {
	key = strings.TrimSpace(key)
	if key == "" {
		n := today()
		key = n.Format("2006-01")
	}
	if t, err := time.ParseInLocation("2006-01", key, jkt); err == nil {
		return kpiPeriod{key, fmt.Sprintf("%s %d", []string{"Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"}[t.Month()-1], t.Year()), t, t.AddDate(0, 1, -1)}, true
	}
	var y, q int
	if n, _ := fmt.Sscanf(key, "%d-Q%d", &y, &q); n == 2 && q >= 1 && q <= 4 && y > 2000 {
		from := time.Date(y, time.Month((q-1)*3+1), 1, 0, 0, 0, 0, jkt)
		return kpiPeriod{key, fmt.Sprintf("%s %d", qLabel[q], y), from, from.AddDate(0, 3, -1)}, true
	}
	return kpiPeriod{}, false
}

func periodFrom(c *gin.Context) (kpiPeriod, bool) {
	p, ok := parsePeriod(c.Query("period"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "periode tidak valid (gunakan 2026-10 atau 2026-Q4)"})
	}
	return p, ok
}

// ---- scoring ----

func r1(v float64) float64 { return math.Round(v*10) / 10 }

// kpiScore: actual vs target as a percentage, capped at 120. "lower is better" inverts the ratio.
func kpiScore(actual, target float64, direction string) float64 {
	if target <= 0 {
		return 0
	}
	var s float64
	if direction == "lower" {
		if actual <= 0 {
			return 120
		}
		s = target / actual * 100
	} else {
		s = actual / target * 100
	}
	return r1(math.Min(120, math.Max(0, s)))
}

func getKPISettings() models.KPISettings {
	var st models.KPISettings
	database.DB.Order("id").Limit(1).Find(&st)
	if st.ID == 0 {
		st = models.KPISettings{WeightKPI: 50, WeightTask: 30, WeightAttendance: 20, CompanyTarget: 90, GoodMin: 90, AttentionMin: 70}
	}
	return st
}

func statusOfScore(score float64, st models.KPISettings) string {
	switch {
	case score >= st.GoodMin:
		return "Good"
	case score >= st.AttentionMin:
		return "Attention"
	}
	return "Critical"
}

// ---- employee KPI items ----

type kpiItemView struct {
	models.EmployeeKPI
	EmployeeName  string  `json:"employee_name"`
	UnitName      string  `json:"unit_name"`
	ActualValue   float64 `json:"actual_value"` // manual actual, or the count computed from linked tasks
	Score         float64 `json:"score"`
	Status        string  `json:"status"`
	LinkedTasks   int     `json:"linked_tasks"`
	LinkedDone    int     `json:"linked_done"`
	DeptObjective string  `json:"dept_objective"`
	Auto          bool    `json:"auto"`
}

// itemViews computes actual / score / status for items (auto metrics read the linked tasks).
func itemViews(items []models.EmployeeKPI, st models.KPISettings) []kpiItemView {
	if len(items) == 0 {
		return []kpiItemView{}
	}
	var ids []uint
	empIDs := map[uint]bool{}
	deptIDs := map[uint]bool{}
	for _, it := range items {
		ids = append(ids, it.ID)
		empIDs[it.EmployeeID] = true
		if it.DeptKPIID != nil {
			deptIDs[*it.DeptKPIID] = true
		}
	}
	type cnt struct {
		KPIID  uint
		Linked int
		Done   int
		OnTime int
	}
	counts := map[uint]cnt{}
	var rows []cnt
	// on time = completed no later than the end of its deadline day (no deadline → on time); counted when completed inside the period
	database.DB.Raw(`SELECT t.kpi_id,
			COUNT(*) AS linked,
			COUNT(*) FILTER (WHERE t.status = 'done') AS done,
			COUNT(*) FILTER (WHERE t.status = 'done' AND t.completed_at >= k.pstart AND t.completed_at < k.pend
				AND (t.due_date IS NULL OR t.completed_at < t.due_date + interval '1 day')) AS on_time
		FROM tasks t JOIN (SELECT id, period_key,
				CASE WHEN period_key ~ '^[0-9]{4}-Q[1-4]$' THEN make_timestamptz(substr(period_key,1,4)::int, ((substr(period_key,7,1)::int-1)*3+1), 1, 0, 0, 0, 'Asia/Jakarta')
				     ELSE make_timestamptz(substr(period_key,1,4)::int, substr(period_key,6,2)::int, 1, 0, 0, 0, 'Asia/Jakarta') END AS pstart,
				CASE WHEN period_key ~ '^[0-9]{4}-Q[1-4]$' THEN make_timestamptz(substr(period_key,1,4)::int, ((substr(period_key,7,1)::int-1)*3+1), 1, 0, 0, 0, 'Asia/Jakarta') + interval '3 months'
				     ELSE make_timestamptz(substr(period_key,1,4)::int, substr(period_key,6,2)::int, 1, 0, 0, 0, 'Asia/Jakarta') + interval '1 month' END AS pend
			FROM employee_kpis WHERE id IN ?) k ON k.id = t.kpi_id
		GROUP BY t.kpi_id`, ids).Scan(&rows)
	for _, r := range rows {
		counts[r.KPIID] = r
	}
	names, units := map[uint]string{}, map[uint]string{}
	var es []models.Employee
	database.DB.Preload("Unit").Select("id, name, unit_id").Find(&es)
	for _, e := range es {
		names[e.ID] = e.Name
		if e.Unit != nil {
			units[e.ID] = e.Unit.Name
		}
	}
	objectives := map[uint]string{}
	if len(deptIDs) > 0 {
		var ds []models.DeptKPI
		database.DB.Where("id IN ?", keys(deptIDs)).Find(&ds)
		for _, d := range ds {
			objectives[d.ID] = d.Objective
		}
	}
	out := make([]kpiItemView, 0, len(items))
	for _, it := range items {
		v := kpiItemView{EmployeeKPI: it, EmployeeName: names[it.EmployeeID], UnitName: units[it.EmployeeID], Auto: it.Metric == "tasks_on_time"}
		if it.DeptKPIID != nil {
			v.DeptObjective = objectives[*it.DeptKPIID]
		}
		if v.Auto {
			cc := counts[it.ID]
			v.ActualValue, v.LinkedTasks, v.LinkedDone = float64(cc.OnTime), cc.Linked, cc.Done
		} else {
			v.ActualValue = it.Actual
		}
		v.Score = kpiScore(v.ActualValue, it.Target, it.Direction)
		v.Status = statusOfScore(v.Score, st)
		out = append(out, v)
	}
	return out
}

func keys(m map[uint]bool) []uint {
	out := make([]uint, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// weightedScore: weighted average (equal weights when any weight is missing).
func weightedScore(scores, weights []float64) (float64, bool) {
	if len(scores) == 0 {
		return 0, false
	}
	all := true
	for _, w := range weights {
		if w <= 0 {
			all = false
		}
	}
	var sum, wsum float64
	for i, s := range scores {
		w := 1.0
		if all {
			w = weights[i]
		}
		sum += s * w
		wsum += w
	}
	return r1(sum / wsum), true
}

// ---- employee scores (KPI items + task completion + attendance) ----

type taskStat struct {
	Total   int `json:"total"`
	Done    int `json:"done"`
	OnTime  int `json:"on_time"`
	Overdue int `json:"overdue"`
}

type attStat struct {
	Required int `json:"required"` // scheduled working days already due, minus approved leave
	Present  int `json:"present"`
	Late     int `json:"late"`
	Absent   int `json:"absent"`
	Leave    int `json:"leave"`
}

type empScore struct {
	EmployeeID uint          `json:"employee_id"`
	Name       string        `json:"name"`
	NIK        string        `json:"nik"`
	UnitID     *uint         `json:"unit_id"`
	UnitName   string        `json:"unit_name"`
	Business   string        `json:"business_name"`
	KPI        *float64      `json:"kpi_score"`
	Task       *float64      `json:"task_score"`
	Att        *float64      `json:"attendance_score"`
	Final      *float64      `json:"final_score"`
	Status     string        `json:"status"`
	Rank       int           `json:"rank"`
	Items      []kpiItemView `json:"items"`
	Tasks      taskStat      `json:"tasks"`
	Attendance attStat       `json:"attendance"`
}

func computeScores(emps []models.Employee, per kpiPeriod, st models.KPISettings) []empScore {
	ids := make([]uint, 0, len(emps))
	for _, e := range emps {
		ids = append(ids, e.ID)
	}
	out := make([]empScore, 0, len(emps))
	if len(ids) == 0 {
		return out
	}
	// 1) KPI items
	var items []models.EmployeeKPI
	database.DB.Where("employee_id IN ? AND period_key = ?", ids, per.Key).Order("id").Find(&items)
	views := itemViews(items, st)
	byEmp := map[uint][]kpiItemView{}
	for _, v := range views {
		byEmp[v.EmployeeID] = append(byEmp[v.EmployeeID], v)
	}
	// 2) task completion — leaf tasks whose deadline is in the period and already due (or done)
	var parents []uint
	database.DB.Raw("SELECT DISTINCT parent_id FROM tasks WHERE parent_id IS NOT NULL").Scan(&parents)
	isParent := map[uint]bool{}
	for _, p := range parents {
		isParent[p] = true
	}
	var ts []models.Task
	database.DB.Where("pic_id IN ? AND due_date >= ? AND due_date <= ?", ids, per.From, per.To).Find(&ts)
	now := today()
	tstat := map[uint]*taskStat{}
	for _, t := range ts {
		if isParent[t.ID] || t.DueDate == nil {
			continue
		}
		due := day(*t.DueDate)
		if due.After(now) && t.Status != "done" {
			continue // not due yet: it must not count against the person
		}
		s := tstat[t.PICID]
		if s == nil {
			s = &taskStat{}
			tstat[t.PICID] = s
		}
		s.Total++
		if t.Status == "done" {
			s.Done++
			if t.CompletedAt != nil && !day(*t.CompletedAt).After(due) {
				s.OnTime++
			}
		} else if due.Before(now) {
			s.Overdue++
		}
	}
	// 3) attendance
	last := per.To
	if last.After(now) {
		last = now
	}
	recap := map[uint]recapRow{}
	if !last.Before(per.From) {
		for _, r := range buildRecap(emps, per.From, last) {
			recap[r.EmployeeID] = r
		}
	}
	for _, e := range emps {
		s := empScore{EmployeeID: e.ID, Name: e.Name, NIK: e.NIK, UnitID: e.UnitID, Items: byEmp[e.ID]}
		if s.Items == nil {
			s.Items = []kpiItemView{}
		}
		if e.Unit != nil {
			s.UnitName = e.Unit.Name
		}
		if e.Business != nil {
			s.Business = e.Business.Name
		}
		var sc, wt []float64
		for _, it := range s.Items {
			sc, wt = append(sc, it.Score), append(wt, it.Weight)
		}
		if v, ok := weightedScore(sc, wt); ok {
			s.KPI = &v
		}
		if ts := tstat[e.ID]; ts != nil {
			s.Tasks = *ts
			if ts.Total > 0 {
				v := r1(float64(ts.Done) * 100 / float64(ts.Total))
				s.Task = &v
			}
		}
		if r, ok := recap[e.ID]; ok {
			s.Attendance = attStat{Required: r.Elapsed - r.Excused, Present: r.Present - r.WorkedOff, Late: r.Late, Absent: r.Absent, Leave: r.Excused}
			if s.Attendance.Required > 0 {
				v := r1(math.Min(100, float64(s.Attendance.Present)*100/float64(s.Attendance.Required)))
				s.Att = &v
			}
		}
		// final = weighted mix of the components that have data (weights re-normalised)
		var num, den float64
		for _, c := range []struct {
			v *float64
			w float64
		}{{s.KPI, st.WeightKPI}, {s.Task, st.WeightTask}, {s.Att, st.WeightAttendance}} {
			if c.v != nil && c.w > 0 {
				num += *c.v * c.w
				den += c.w
			}
		}
		if den > 0 {
			v := r1(num / den)
			s.Final = &v
			s.Status = statusOfScore(v, st)
		}
		out = append(out, s)
	}
	// rank by final score (people without data are unranked)
	idx := make([]int, 0, len(out))
	for i := range out {
		if out[i].Final != nil {
			idx = append(idx, i)
		}
	}
	sort.SliceStable(idx, func(a, b int) bool { return *out[idx[a]].Final > *out[idx[b]].Final })
	for r, i := range idx {
		out[i].Rank = r + 1
	}
	return out
}

func kpiEmployees(c *gin.Context) []models.Employee {
	q := employeeScope(c, database.DB.Model(&models.Employee{}))
	if s := strings.TrimSpace(c.Query("q")); s != "" {
		q = q.Where("employees.name ILIKE ? OR employees.nik ILIKE ?", "%"+s+"%", "%"+s+"%")
	}
	if u := c.Query("unit_id"); u != "" {
		uid, _ := strconv.Atoi(u)
		q = q.Where("employees.unit_id IN (?)", subtreeUnits(uint(uid)))
	}
	var emps []models.Employee
	q.Preload("Unit").Preload("Business").Order("employees.name").Limit(1000).Find(&emps)
	return emps
}

// subtreeUnits returns the unit and all its descendants.
func subtreeUnits(root uint) []uint {
	var ids []uint
	database.DB.Raw(`WITH RECURSIVE u AS (SELECT id FROM org_units WHERE id = ? UNION SELECT o.id FROM org_units o JOIN u ON o.parent_id = u.id) SELECT id FROM u`, root).Scan(&ids)
	if len(ids) == 0 {
		ids = []uint{0}
	}
	return ids
}

// ---- scorecard ----

func Scorecard(c *gin.Context) {
	per, ok := periodFrom(c)
	if !ok {
		return
	}
	st := getKPISettings()
	emps := kpiEmployees(c)
	var scores []empScore
	info := closeInfo(per.Key)
	if info != nil {
		scores = snapshotScores(per.Key, emps)
	} else {
		scores = computeScores(emps, per, st)
	}
	var sum struct {
		Avg                               float64
		Good, Attention, Critical, NoData int
	}
	var total float64
	var n int
	for _, s := range scores {
		if s.Final == nil {
			sum.NoData++
			continue
		}
		total += *s.Final
		n++
		switch s.Status {
		case "Good":
			sum.Good++
		case "Attention":
			sum.Attention++
		default:
			sum.Critical++
		}
	}
	if n > 0 {
		sum.Avg = r1(total / n2f(n))
	}
	c.JSON(http.StatusOK, gin.H{"period": per.Label, "rows": scores, "settings": st, "closed": info,
		"summary": gin.H{"average": sum.Avg, "good": sum.Good, "attention": sum.Attention, "critical": sum.Critical, "no_data": sum.NoData}})
}

func n2f(n int) float64 { return float64(n) }

// ScorecardDetail: one employee's breakdown, including the tasks behind the task score.
func ScorecardDetail(c *gin.Context) {
	per, ok := periodFrom(c)
	if !ok {
		return
	}
	id := paramID(c)
	var emp models.Employee
	if employeeScope(c, database.DB.Model(&models.Employee{})).Preload("Unit").Preload("Business").Where("employees.id = ?", id).Limit(1).Find(&emp).Error != nil || emp.ID == 0 {
		c.JSON(http.StatusForbidden, gin.H{"error": "Anda tidak berhak melihat scorecard karyawan ini"})
		return
	}
	st := getKPISettings()
	if snap, ok := loadSnapshot(per.Key, id); ok {
		c.JSON(http.StatusOK, gin.H{"period": per.Label, "score": snap.Score, "tasks": snap.Tasks, "settings": st, "closed": closeInfo(per.Key)})
		return
	}
	all := computeScores([]models.Employee{emp}, per, st)
	tasks := scoreTasks(id, per)
	c.JSON(http.StatusOK, gin.H{"period": per.Label, "score": all[0], "tasks": tasks, "settings": st})
}

type scoreTaskRow struct {
	ID        uint       `json:"id"`
	Title     string     `json:"title"`
	DueDate   *time.Time `json:"due_date"`
	Status    string     `json:"status"`
	Completed *time.Time `json:"completed_at"`
	OnTime    bool       `json:"on_time"`
	Counted   bool       `json:"counted"`
}

// scoreTasks lists the tasks behind an employee's task score for a period.
func scoreTasks(id uint, per kpiPeriod) []scoreTaskRow {
	var ts []models.Task
	database.DB.Where("pic_id = ? AND due_date >= ? AND due_date <= ?", id, per.From, per.To).Order("due_date").Find(&ts)
	var parents []uint
	database.DB.Raw("SELECT DISTINCT parent_id FROM tasks WHERE parent_id IS NOT NULL").Scan(&parents)
	isParent := map[uint]bool{}
	for _, p := range parents {
		isParent[p] = true
	}
	now := today()
	tasks := []scoreTaskRow{}
	for _, t := range ts {
		if isParent[t.ID] {
			continue
		}
		counted := t.DueDate != nil && (!day(*t.DueDate).After(now) || t.Status == "done")
		onTime := t.Status == "done" && t.CompletedAt != nil && t.DueDate != nil && !day(*t.CompletedAt).After(day(*t.DueDate))
		tasks = append(tasks, scoreTaskRow{t.ID, t.Title, t.DueDate, t.Status, t.CompletedAt, onTime, counted})
	}
	return tasks
}

// ---- employee KPI items: CRUD ----

func canAssignKPI(c *gin.Context, empID uint) bool {
	if isGroupLevel(c) {
		return true
	}
	me := myEmployeeID(c)
	return me != nil && inDownline(*me, empID)
}

func ListKPIItems(c *gin.Context) {
	per, ok := periodFrom(c)
	if !ok {
		return
	}
	emps := kpiEmployees(c)
	ids := make([]uint, 0, len(emps))
	for _, e := range emps {
		ids = append(ids, e.ID)
	}
	info := closeInfo(per.Key)
	var views []kpiItemView
	if info != nil { // closed: the frozen items from the snapshots
		for _, sc := range snapshotScores(per.Key, emps) {
			if v := c.Query("employee_id"); v != "" && v != strconv.Itoa(int(sc.EmployeeID)) {
				continue
			}
			views = append(views, sc.Items...)
		}
	} else {
		items := []models.EmployeeKPI{}
		if len(ids) > 0 {
			q := database.DB.Where("employee_id IN ? AND period_key = ?", ids, per.Key)
			if v := c.Query("employee_id"); v != "" {
				q = q.Where("employee_id = ?", v)
			}
			q.Order("employee_id, id").Find(&items)
		}
		views = itemViews(items, getKPISettings())
	}
	type row struct {
		kpiItemView
		CanEdit bool `json:"can_edit"`
	}
	out := make([]row, 0, len(views))
	for _, v := range views {
		out = append(out, row{v, info == nil && canAssignKPI(c, v.EmployeeID)})
	}
	c.JSON(http.StatusOK, gin.H{"data": out, "period": per.Label, "can_assign": info == nil && (isGroupLevel(c) || hasDirectReports(c)), "closed": info})
}

type kpiItemInput struct {
	EmployeeID uint    `json:"employee_id"`
	PeriodKey  string  `json:"period_key"`
	Title      string  `json:"title"`
	Metric     string  `json:"metric"`
	Unit       string  `json:"unit"`
	Direction  string  `json:"direction"`
	Target     float64 `json:"target"`
	Actual     float64 `json:"actual"`
	Weight     float64 `json:"weight"`
	DeptKPIID  *uint   `json:"dept_kpi_id"`
}

func fillKPIItem(c *gin.Context, in kpiItemInput, it *models.EmployeeKPI, isNew bool) string {
	if strings.TrimSpace(in.Title) == "" {
		return "nama KPI wajib diisi"
	}
	if in.Target <= 0 {
		return "target harus lebih dari 0"
	}
	if in.Metric != "manual" && in.Metric != "tasks_on_time" {
		return "metode harus manual atau tasks_on_time"
	}
	if in.Direction != "lower" {
		in.Direction = "higher"
	}
	if in.Weight < 0 || in.Weight > 100 || in.Actual < 0 {
		return "bobot 0–100 dan actual tidak boleh negatif"
	}
	if isNew {
		per, ok := parsePeriod(in.PeriodKey)
		if !ok {
			return "periode tidak valid"
		}
		var emp models.Employee
		if database.DB.Limit(1).Find(&emp, in.EmployeeID).Error != nil || emp.ID == 0 || emp.Status != "Aktif" {
			return "karyawan tidak ditemukan atau tidak aktif"
		}
		if !canAssignKPI(c, emp.ID) {
			return "Anda hanya dapat menetapkan KPI untuk bawahan Anda"
		}
		it.EmployeeID, it.BusinessID, it.PeriodKey = emp.ID, emp.BusinessID, per.Key
	}
	if in.DeptKPIID != nil {
		var d models.DeptKPI
		if database.DB.Limit(1).Find(&d, *in.DeptKPIID).Error != nil || d.ID == 0 || d.BusinessID != it.BusinessID || d.PeriodKey != it.PeriodKey {
			return "KPI departemen harus dari bisnis dan periode yang sama"
		}
	}
	it.Title, it.Metric, it.Unit, it.Direction, it.Target, it.Weight, it.DeptKPIID = strings.TrimSpace(in.Title), in.Metric, strings.TrimSpace(in.Unit), in.Direction, in.Target, in.Weight, in.DeptKPIID
	it.Actual = 0
	if in.Metric == "manual" {
		it.Actual = in.Actual
	}
	return ""
}

func CreateKPIItem(c *gin.Context) {
	var in kpiItemInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "data tidak valid"})
		return
	}
	it := models.EmployeeKPI{CreatedByUserID: uid(c)}
	if msg := fillKPIItem(c, in, &it, true); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	if kpiLocked(c, it.PeriodKey) {
		return
	}
	database.DB.Create(&it)
	audit(c, "create", "kpi_item", it.ID)
	c.JSON(http.StatusOK, itemViews([]models.EmployeeKPI{it}, getKPISettings())[0])
}

func loadKPIItem(c *gin.Context) (models.EmployeeKPI, bool) {
	var it models.EmployeeKPI
	if database.DB.Limit(1).Find(&it, paramID(c)).Error != nil || it.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "KPI tidak ditemukan"})
		return it, false
	}
	if !canAssignKPI(c, it.EmployeeID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "hanya atasan karyawan atau HR yang dapat mengubah KPI ini"})
		return it, false
	}
	return it, true
}

func UpdateKPIItem(c *gin.Context) {
	it, ok := loadKPIItem(c)
	if !ok {
		return
	}
	var in kpiItemInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "data tidak valid"})
		return
	}
	if msg := fillKPIItem(c, in, &it, false); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	if kpiLocked(c, it.PeriodKey) {
		return
	}
	database.DB.Save(&it)
	audit(c, "update", "kpi_item", it.ID)
	c.JSON(http.StatusOK, itemViews([]models.EmployeeKPI{it}, getKPISettings())[0])
}

func DeleteKPIItem(c *gin.Context) {
	it, ok := loadKPIItem(c)
	if !ok || kpiLocked(c, it.PeriodKey) {
		return
	}
	database.DB.Transaction(func(tx *gorm.DB) error {
		tx.Model(&models.Task{}).Where("kpi_id = ?", it.ID).Update("kpi_id", nil) // linked tasks keep existing, just unlinked
		return tx.Delete(&it).Error
	})
	audit(c, "delete", "kpi_item", it.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// KPITaskOptions: the auto (tasks_on_time) KPI items of an employee, for the "terkait KPI" choice on a task.
func KPITaskOptions(c *gin.Context) {
	empID, _ := strconv.Atoi(c.Query("employee_id"))
	var n int64
	employeeScope(c, database.DB.Model(&models.Employee{})).Where("employees.id = ?", empID).Count(&n)
	if n == 0 {
		c.JSON(http.StatusOK, []gin.H{})
		return
	}
	var items []models.EmployeeKPI
	database.DB.Where("employee_id = ? AND metric = 'tasks_on_time'", empID).Order("period_key DESC, id").Limit(30).Find(&items)
	out := []gin.H{}
	for _, it := range items {
		per, _ := parsePeriod(it.PeriodKey)
		out = append(out, gin.H{"id": it.ID, "title": it.Title, "period_key": it.PeriodKey, "period": per.Label})
	}
	c.JSON(http.StatusOK, out)
}

// ---- department KPI ----

func canManageKPI(c *gin.Context) bool { return isGroupLevel(c) || canManageHolidays(c) }

func canViewDeptKPI(c *gin.Context) bool { return canManageKPI(c) || hasDirectReports(c) }

type deptView struct {
	models.DeptKPI
	UnitName    string  `json:"unit_name"`
	ActualValue float64 `json:"actual_value"`
	Score       float64 `json:"score"`
	Status      string  `json:"status"`
	TeamSize    int     `json:"team_size"`
}

func ListDeptKPIs(c *gin.Context) {
	if !canViewDeptKPI(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "KPI departemen hanya untuk atasan, HR, dan pimpinan"})
		return
	}
	per, ok := periodFrom(c)
	if !ok {
		return
	}
	st := getKPISettings()
	var closed *models.KPIPeriodClose
	var ds []models.DeptKPI
	scopeBusiness(c, database.DB.Model(&models.DeptKPI{}), "dept_kpis.business_id").Where("dept_kpis.period_key = ?", per.Key).Order("dept_kpis.id").Find(&ds)
	var out []deptView
	if info := closeInfo(per.Key); info != nil {
		out = snapshotDeptViews(per.Key, c)
		closed = info
	} else {
		out = buildDeptViews(ds, per, st)
	}
	var sc, wt []float64
	for _, v := range out {
		sc, wt = append(sc, v.Score), append(wt, v.Weight)
	}
	summary := gin.H{"company_score": nil, "company_target": st.CompanyTarget, "best": nil, "attention": 0}
	if company, ok := weightedScore(sc, wt); ok {
		summary["company_score"] = company
	}
	var best *deptView
	att := 0
	for i := range out {
		if best == nil || out[i].Score > best.Score {
			best = &out[i]
		}
		if out[i].Status != "Good" {
			att++
		}
	}
	if best != nil {
		summary["best"] = gin.H{"unit_name": best.UnitName, "score": best.Score}
	}
	summary["attention"] = att
	c.JSON(http.StatusOK, gin.H{"data": out, "summary": summary, "period": per.Label, "can_manage": canManageKPI(c) && closed == nil, "settings": st, "closed": closed})
}

// buildDeptViews computes live scores for department KPI rows.
func buildDeptViews(ds []models.DeptKPI, per kpiPeriod, st models.KPISettings) []deptView {
	unitName := map[uint]string{}
	var us []models.OrgUnit
	database.DB.Select("id, name").Find(&us)
	for _, u := range us {
		unitName[u.ID] = u.Name
	}
	// team_score: average final score of the unit's (and its sub-units') active employees
	scoreOf := map[uint][]empScore{}
	var need []uint
	for _, d := range ds {
		if d.Source == "team_score" {
			need = append(need, d.BusinessID)
		}
	}
	if len(need) > 0 {
		var emps []models.Employee
		database.DB.Preload("Unit").Preload("Business").Where("status = 'Aktif' AND business_id IN ?", need).Find(&emps)
		all := computeScores(emps, per, st)
		for _, s := range all {
			if s.UnitID != nil {
				scoreOf[*s.UnitID] = append(scoreOf[*s.UnitID], s)
			}
		}
	}
	out := make([]deptView, 0, len(ds))
	for _, d := range ds {
		v := deptView{DeptKPI: d, UnitName: unitName[d.UnitID], ActualValue: d.Actual}
		if d.Source == "team_score" {
			var sum float64
			var n int
			for _, uid := range subtreeUnits(d.UnitID) {
				for _, s := range scoreOf[uid] {
					v.TeamSize++
					if s.Final != nil {
						sum += *s.Final
						n++
					}
				}
			}
			v.ActualValue = 0
			if n > 0 {
				v.ActualValue = r1(sum / n2f(n))
			}
		}
		v.Score = kpiScore(v.ActualValue, d.Target, d.Direction)
		v.Status = statusOfScore(v.Score, st)
		out = append(out, v)
	}
	return out
}

type deptInput struct {
	BusinessID uint    `json:"business_id"`
	UnitID     uint    `json:"unit_id"`
	PeriodKey  string  `json:"period_key"`
	Objective  string  `json:"objective"`
	Unit       string  `json:"unit"`
	Direction  string  `json:"direction"`
	Target     float64 `json:"target"`
	Actual     float64 `json:"actual"`
	Source     string  `json:"source"`
	Weight     float64 `json:"weight"`
}

func fillDeptKPI(c *gin.Context, in deptInput, d *models.DeptKPI, isNew bool) string {
	if strings.TrimSpace(in.Objective) == "" || in.Target <= 0 {
		return "objective wajib diisi dan target harus lebih dari 0"
	}
	if in.Weight < 0 || in.Weight > 100 || in.Actual < 0 {
		return "bobot 0–100 dan actual tidak boleh negatif"
	}
	if in.Source != "team_score" {
		in.Source = "manual"
	}
	if in.Direction != "lower" {
		in.Direction = "higher"
	}
	if isNew {
		per, ok := parsePeriod(in.PeriodKey)
		if !ok {
			return "periode tidak valid"
		}
		var u models.OrgUnit
		if database.DB.Limit(1).Find(&u, in.UnitID).Error != nil || u.ID == 0 {
			return "unit organisasi tidak ditemukan"
		}
		if allowed := allowedBusinessIDs(c); allowed != nil {
			ok := false
			for _, id := range allowed {
				ok = ok || id == u.BusinessID
			}
			if !ok {
				return "bukan bisnis Anda"
			}
		}
		d.UnitID, d.BusinessID, d.PeriodKey = u.ID, u.BusinessID, per.Key
		var dup int64
		database.DB.Model(&models.DeptKPI{}).Where("unit_id = ? AND period_key = ? AND objective = ?", u.ID, per.Key, strings.TrimSpace(in.Objective)).Count(&dup)
		if dup > 0 {
			return "objective yang sama sudah ada untuk unit dan periode ini"
		}
	}
	d.Objective, d.Unit, d.Direction, d.Target, d.Source, d.Weight = strings.TrimSpace(in.Objective), strings.TrimSpace(in.Unit), in.Direction, in.Target, in.Source, in.Weight
	d.Actual = 0
	if in.Source == "manual" {
		d.Actual = in.Actual
	}
	return ""
}

func CreateDeptKPI(c *gin.Context) {
	if !canManageKPI(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "hanya Super Admin, HR, atau pejabat L1/L2 yang dapat mengatur KPI departemen"})
		return
	}
	var in deptInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "data tidak valid"})
		return
	}
	d := models.DeptKPI{CreatedByUserID: uid(c)}
	if msg := fillDeptKPI(c, in, &d, true); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	if kpiLocked(c, d.PeriodKey) {
		return
	}
	database.DB.Create(&d)
	audit(c, "create", "dept_kpi", d.ID)
	c.JSON(http.StatusOK, d)
}

func UpdateDeptKPI(c *gin.Context) {
	if !canManageKPI(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "tidak berwenang"})
		return
	}
	var d models.DeptKPI
	if database.DB.Limit(1).Find(&d, paramID(c)).Error != nil || d.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "KPI departemen tidak ditemukan"})
		return
	}
	var in deptInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "data tidak valid"})
		return
	}
	if msg := fillDeptKPI(c, in, &d, false); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	if kpiLocked(c, d.PeriodKey) {
		return
	}
	database.DB.Save(&d)
	audit(c, "update", "dept_kpi", d.ID)
	c.JSON(http.StatusOK, d)
}

func DeleteDeptKPI(c *gin.Context) {
	if !canManageKPI(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "tidak berwenang"})
		return
	}
	id := paramID(c)
	var old models.DeptKPI
	if database.DB.Limit(1).Find(&old, id).Error == nil && old.ID != 0 && kpiLocked(c, old.PeriodKey) {
		return
	}
	database.DB.Model(&models.EmployeeKPI{}).Where("dept_kpi_id = ?", id).Update("dept_kpi_id", nil)
	database.DB.Delete(&models.DeptKPI{}, id)
	audit(c, "delete", "dept_kpi", id)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ---- settings ----

func GetKPISettings(c *gin.Context) { c.JSON(http.StatusOK, getKPISettings()) }

func SaveKPISettings(c *gin.Context) {
	var in models.KPISettings
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "data tidak valid"})
		return
	}
	if in.WeightKPI < 0 || in.WeightTask < 0 || in.WeightAttendance < 0 || math.Abs(in.WeightKPI+in.WeightTask+in.WeightAttendance-100) > 0.01 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bobot KPI + Tugas + Absensi harus berjumlah 100"})
		return
	}
	if in.AttentionMin < 0 || in.GoodMin < in.AttentionMin || in.GoodMin > 120 || in.CompanyTarget <= 0 || in.CompanyTarget > 120 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ambang batas tidak valid (Attention ≤ Good ≤ 120, target perusahaan 1–120)"})
		return
	}
	st := getKPISettings()
	st.WeightKPI, st.WeightTask, st.WeightAttendance, st.CompanyTarget, st.GoodMin, st.AttentionMin = in.WeightKPI, in.WeightTask, in.WeightAttendance, in.CompanyTarget, in.GoodMin, in.AttentionMin
	database.DB.Save(&st)
	audit(c, "save", "kpi_settings", st.ID)
	c.JSON(http.StatusOK, st)
}

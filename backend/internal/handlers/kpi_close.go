package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"time"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// A closed KPI period is frozen: its scorecards and department KPIs are read from snapshots, and the KPI items /
// department KPIs of that period can no longer be edited until HR reopens it.

// autoCloseGraceDays: a period is closed automatically this many whole days after its last day (so the last
// day's attendance and tasks can still be filed).
const autoCloseGraceDays = 1

type snapshotData struct {
	Score empScore       `json:"score"`
	Tasks []scoreTaskRow `json:"tasks"`
}

func closeInfo(key string) *models.KPIPeriodClose {
	var r models.KPIPeriodClose
	if database.DB.Where("period_key = ? AND status = 'closed'", key).Limit(1).Find(&r).Error != nil || r.ID == 0 {
		return nil
	}
	r.ClosedByName = "Otomatis"
	if r.ClosedByUser != nil {
		var u models.User
		database.DB.Select("id, name").Limit(1).Find(&u, *r.ClosedByUser)
		r.ClosedByName = u.Name
	}
	return &r
}

// kpiLocked answers 409 when the period is closed.
func kpiLocked(c *gin.Context, key string) bool {
	if closeInfo(key) != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "periode " + key + " sudah ditutup; buka kembali periode di tab Scorecard (HR) untuk mengubah"})
		return true
	}
	return false
}

func loadSnapshot(key string, empID uint) (snapshotData, bool) {
	var d snapshotData
	if closeInfo(key) == nil {
		return d, false
	}
	var s models.KPISnapshot
	if database.DB.Where("period_key = ? AND employee_id = ?", key, empID).Limit(1).Find(&s).Error != nil || s.ID == 0 {
		return d, false
	}
	if json.Unmarshal([]byte(s.Data), &d) != nil {
		return d, false
	}
	return d, true
}

// snapshotScores returns the frozen scorecards of the given employees, re-ranked inside that set.
func snapshotScores(key string, emps []models.Employee) []empScore {
	ids := make([]uint, 0, len(emps))
	for _, e := range emps {
		ids = append(ids, e.ID)
	}
	out := []empScore{}
	if len(ids) == 0 {
		return out
	}
	var snaps []models.KPISnapshot
	database.DB.Where("period_key = ? AND employee_id IN ?", key, ids).Find(&snaps)
	by := map[uint]models.KPISnapshot{}
	for _, s := range snaps {
		by[s.EmployeeID] = s
	}
	for _, e := range emps {
		s, ok := by[e.ID]
		if !ok {
			continue
		}
		var d snapshotData
		if json.Unmarshal([]byte(s.Data), &d) == nil {
			d.Score.Rank = 0
			out = append(out, d.Score)
		}
	}
	idx := []int{}
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

func snapshotDeptViews(key string, c *gin.Context) []deptView {
	var rows []models.KPIDeptSnapshot
	scopeBusiness(c, database.DB.Model(&models.KPIDeptSnapshot{}), "kpi_dept_snapshots.business_id").Where("kpi_dept_snapshots.period_key = ?", key).Order("kpi_dept_snapshots.id").Find(&rows)
	out := []deptView{}
	for _, r := range rows {
		var v deptView
		if json.Unmarshal([]byte(r.Data), &v) == nil {
			out = append(out, v)
		}
	}
	return out
}

// closeKPIPeriod freezes the period (all active employees, all businesses). userID nil = automatic.
func closeKPIPeriod(per kpiPeriod, userID *uint) (*models.KPIPeriodClose, error) {
	st := getKPISettings()
	var emps []models.Employee
	database.DB.Preload("Unit").Preload("Business").Where("status = 'Aktif'").Find(&emps)
	scores := computeScores(emps, per, st)
	var ds []models.DeptKPI
	database.DB.Where("period_key = ?", per.Key).Order("id").Find(&ds)
	views := buildDeptViews(ds, per, st)
	bizOf := map[uint]uint{}
	for _, e := range emps {
		bizOf[e.ID] = e.BusinessID
	}
	var total float64
	var n int
	for _, s := range scores {
		if s.Final != nil {
			total += *s.Final
			n++
		}
	}
	var sc, wt []float64
	for _, v := range views {
		sc, wt = append(sc, v.Score), append(wt, v.Weight)
	}
	settingsJSON, _ := json.Marshal(st)
	rec := models.KPIPeriodClose{PeriodKey: per.Key, Status: "closed", Auto: userID == nil, ClosedAt: time.Now(), ClosedByUser: userID, Employees: len(scores), SettingsJSON: string(settingsJSON)}
	if n > 0 {
		v := r1(total / n2f(n))
		rec.AverageScore = &v
	}
	if v, ok := weightedScore(sc, wt); ok {
		rec.CompanyScore = &v
	}
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		tx.Where("period_key = ?", per.Key).Delete(&models.KPISnapshot{})
		tx.Where("period_key = ?", per.Key).Delete(&models.KPIDeptSnapshot{})
		for _, s := range scores {
			b, _ := json.Marshal(snapshotData{Score: s, Tasks: scoreTasks(s.EmployeeID, per)})
			if err := tx.Create(&models.KPISnapshot{PeriodKey: per.Key, EmployeeID: s.EmployeeID, BusinessID: bizOf[s.EmployeeID], KPI: s.KPI, Task: s.Task, Att: s.Att, Final: s.Final, Status: s.Status, Rank: s.Rank, Data: string(b)}).Error; err != nil {
				return err
			}
		}
		for i, v := range views {
			b, _ := json.Marshal(v)
			if err := tx.Create(&models.KPIDeptSnapshot{PeriodKey: per.Key, BusinessID: ds[i].BusinessID, Data: string(b)}).Error; err != nil {
				return err
			}
		}
		return tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "period_key"}}, UpdateAll: true}).Create(&rec).Error
	})
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

func notifyHR(kind, title, body, link, refKey string) {
	var us []models.User
	database.DB.Where("is_active = true AND role IN ('super_admin','hr_admin')").Find(&us)
	for _, u := range us {
		notify(u.ID, kind, title, body, link, fmt.Sprintf("%s:%d", refKey, u.ID))
	}
}

// AutoCloseKPIPeriods closes the latest finished month and quarter (after the grace days) unless a close row already exists
// — a period HR reopened is never closed again automatically.
func AutoCloseKPIPeriods() int {
	now := today()
	cands := []kpiPeriod{}
	m := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, jkt).AddDate(0, -1, 0)
	if p, ok := parsePeriod(m.Format("2006-01")); ok {
		if now.Before(p.To.AddDate(0, 0, 1+autoCloseGraceDays)) {
			p, _ = parsePeriod(m.AddDate(0, -1, 0).Format("2006-01"))
		}
		cands = append(cands, p)
	}
	q := (int(now.Month())-1)/3 + 1
	y := now.Year()
	q--
	if q == 0 {
		q, y = 4, y-1
	}
	if p, ok := parsePeriod(fmt.Sprintf("%d-Q%d", y, q)); ok {
		if now.Before(p.To.AddDate(0, 0, 1+autoCloseGraceDays)) {
			q--
			if q == 0 {
				q, y = 4, y-1
			}
			p, _ = parsePeriod(fmt.Sprintf("%d-Q%d", y, q))
		}
		cands = append(cands, p)
	}
	n := 0
	for _, p := range cands {
		var cnt int64
		database.DB.Model(&models.KPIPeriodClose{}).Where("period_key = ?", p.Key).Count(&cnt)
		if cnt > 0 {
			continue
		}
		if _, err := closeKPIPeriod(p, nil); err == nil {
			n++
			notifyHR("kpi_closed", "Periode KPI "+p.Label+" ditutup otomatis", "Skor periode ini sudah dibekukan sebagai riwayat. Buka kembali dari tab Scorecard bila perlu koreksi.", "/kpi?tab=scorecard&period="+p.Key, "kpi-close:"+p.Key)
		}
	}
	return n
}

// ---- endpoints ----

type closeRow struct {
	models.KPIPeriodClose
	Label string `json:"label"`
}

func ListKPIPeriods(c *gin.Context) {
	var rs []models.KPIPeriodClose
	database.DB.Order("period_key DESC").Find(&rs)
	out := []closeRow{}
	for _, r := range rs {
		row := closeRow{KPIPeriodClose: r}
		row.ClosedByName = "Otomatis"
		if p, ok := parsePeriod(r.PeriodKey); ok {
			row.Label = p.Label
		}
		if r.ClosedByUser != nil {
			var u models.User
			database.DB.Select("id, name").Limit(1).Find(&u, *r.ClosedByUser)
			row.ClosedByName = u.Name
		}
		out = append(out, row)
	}
	c.JSON(http.StatusOK, gin.H{"data": out, "grace_days": autoCloseGraceDays})
}

func periodFromBody(c *gin.Context) (kpiPeriod, bool) {
	var in struct {
		PeriodKey string `json:"period_key"`
	}
	if c.ShouldBindJSON(&in) != nil || in.PeriodKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "period_key wajib diisi"})
		return kpiPeriod{}, false
	}
	p, ok := parsePeriod(in.PeriodKey)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "periode tidak valid (gunakan 2026-10 atau 2026-Q4)"})
	}
	return p, ok
}

func CloseKPIPeriod(c *gin.Context) {
	per, ok := periodFromBody(c)
	if !ok {
		return
	}
	u := uid(c)
	rec, err := closeKPIPeriod(per, &u)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "gagal menutup periode: " + err.Error()})
		return
	}
	audit(c, "close", "kpi_period:"+per.Key, rec.ID)
	c.JSON(http.StatusOK, rec)
}

func ReopenKPIPeriod(c *gin.Context) {
	per, ok := periodFromBody(c)
	if !ok {
		return
	}
	var rec models.KPIPeriodClose
	if database.DB.Where("period_key = ? AND status = 'closed'", per.Key).Limit(1).Find(&rec).Error != nil || rec.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "periode ini belum ditutup"})
		return
	}
	database.DB.Transaction(func(tx *gorm.DB) error {
		tx.Where("period_key = ?", per.Key).Delete(&models.KPISnapshot{})
		tx.Where("period_key = ?", per.Key).Delete(&models.KPIDeptSnapshot{})
		return tx.Model(&rec).Update("status", "open").Error
	})
	audit(c, "reopen", "kpi_period:"+per.Key, rec.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// KPIHistory: an employee's frozen scores over the closed periods (trend).
func KPIHistory(c *gin.Context) {
	id := paramID(c)
	var emp models.Employee
	if employeeScope(c, database.DB.Model(&models.Employee{})).Where("employees.id = ?", id).Limit(1).Find(&emp).Error != nil || emp.ID == 0 {
		c.JSON(http.StatusForbidden, gin.H{"error": "Anda tidak berhak melihat riwayat karyawan ini"})
		return
	}
	var snaps []models.KPISnapshot
	database.DB.Joins("JOIN kpi_period_closes pc ON pc.period_key = kpi_snapshots.period_key AND pc.status = 'closed'").
		Where("kpi_snapshots.employee_id = ?", id).Order("kpi_snapshots.period_key DESC").Limit(24).Find(&snaps)
	type row struct {
		models.KPISnapshot
		Label string `json:"label"`
	}
	out := make([]row, 0, len(snaps))
	for i := len(snaps) - 1; i >= 0; i-- { // oldest first for charts
		r := row{KPISnapshot: snaps[i]}
		if p, ok := parsePeriod(snaps[i].PeriodKey); ok {
			r.Label = p.Label
		}
		out = append(out, r)
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

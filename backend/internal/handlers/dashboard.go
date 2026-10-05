package handlers

import (
	"net/http"
	"sort"
	"time"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
)

// Dashboard aggregates what the caller may see (business filter + their own reporting scope).
func Dashboard(c *gin.Context) {
	now := today()
	emps := kpiEmployees(c) // active employees inside the caller's scope
	out := gin.H{"scope": scopeName(c)}

	// people
	tetap, expiring := 0, 0
	for _, e := range emps {
		if e.EmployeeType == "Tetap" {
			tetap++
		}
		if e.ContractEnd != nil && !day(*e.ContractEnd).After(now.AddDate(0, 0, 30)) {
			expiring++
		}
	}
	var vacant int64
	if isGroupLevel(c) {
		scopeBusiness(c, database.DB.Model(&models.Position{}), "positions.business_id").
			Where("positions.id NOT IN (SELECT position_id FROM employee_placements WHERE position_id IS NOT NULL) AND positions.id NOT IN (SELECT position_id FROM employees WHERE position_id IS NOT NULL AND status = 'Aktif')").Count(&vacant)
	}
	out["people"] = gin.H{"active": len(emps), "tetap": tetap, "kontrak": len(emps) - tetap, "expiring": expiring, "vacant": vacant}

	// attendance today + last 7 days
	type dayPoint struct {
		Date    string `json:"date"`
		Label   string `json:"label"`
		Present int    `json:"present"`
		Late    int    `json:"late"`
		Leave   int    `json:"leave"`
		Absent  int    `json:"absent"`
	}
	trend := []dayPoint{}
	for i := 6; i >= 0; i-- {
		d := now.AddDate(0, 0, -i)
		p := dayPoint{Date: d.Format("2006-01-02"), Label: d.Format("02/01")}
		for _, r := range buildRecap(emps, d, d) {
			p.Present += r.Present - r.WorkedOff
			p.Late += r.Late
			p.Leave += r.Cuti + r.Izin + r.Sakit
			p.Absent += r.Absent
		}
		trend = append(trend, p)
	}
	today7 := trend[len(trend)-1]
	var scheduled int
	for _, r := range buildRecap(emps, now, now) {
		scheduled += r.WorkDays
	}
	out["attendance"] = gin.H{"scheduled": scheduled, "present": today7.Present, "late": today7.Late, "leave": today7.Leave, "absent": today7.Absent, "trend": trend}

	// tasks
	var ts []models.Task
	taskScope(c, "all").Find(&ts)
	calcs := calcsFor(ts)
	status := map[string]int{"todo": 0, "in_progress": 0, "review": 0, "done": 0}
	overdue, dueWeek := 0, 0
	for _, t := range ts {
		cc := calcs[t.BusinessID]
		if cc == nil || cc.isParent(t.ID) {
			continue
		}
		st := t.Status
		status[st]++
		if st != "done" && t.DueDate != nil {
			d := day(*t.DueDate)
			if d.Before(now) {
				overdue++
			} else if d.Before(now.AddDate(0, 0, 7)) {
				dueWeek++
			}
		}
	}
	type weekPoint struct {
		Label     string `json:"label"`
		Created   int    `json:"created"`
		Completed int    `json:"completed"`
	}
	weeks := []weekPoint{}
	monday := now.AddDate(0, 0, -((int(now.Weekday()) + 6) % 7))
	for i := 5; i >= 0; i-- {
		from := monday.AddDate(0, 0, -7*i)
		to := from.AddDate(0, 0, 7)
		w := weekPoint{Label: from.Format("02/01")}
		for _, t := range ts {
			if !t.CreatedAt.Before(from) && t.CreatedAt.Before(to) {
				w.Created++
			}
			if t.CompletedAt != nil && !t.CompletedAt.Before(from) && t.CompletedAt.Before(to) {
				w.Completed++
			}
		}
		weeks = append(weeks, w)
	}
	out["tasks"] = gin.H{"status": status, "overdue": overdue, "due_week": dueWeek, "weekly": weeks}

	// me
	var myOpen, myOverdue int64
	var pendingApprovals, pendingLeave int64
	if me := myEmployeeID(c); me != nil {
		database.DB.Model(&models.Task{}).Where("pic_id = ? AND status NOT IN ('done') AND NOT EXISTS (SELECT 1 FROM tasks k WHERE k.parent_id = tasks.id)", *me).Count(&myOpen)
		database.DB.Model(&models.Task{}).Where("pic_id = ? AND status NOT IN ('done','review') AND due_date < ? AND NOT EXISTS (SELECT 1 FROM tasks k WHERE k.parent_id = tasks.id)", *me, now).Count(&myOverdue)
	}
	database.DB.Model(&models.ApprovalStep{}).Where("approver_user_id = ? AND status = 'Pending'", uid(c)).Count(&pendingApprovals)
	scopeBusiness(c, database.DB.Model(&models.LeaveRequest{}), "leave_requests.business_id").Where("leave_requests.status = 'Pending Approval'").Count(&pendingLeave)
	out["me"] = gin.H{"open_tasks": myOpen, "overdue_tasks": myOverdue, "pending_approvals": pendingApprovals}
	out["pending_leave"] = pendingLeave

	// on leave today
	type onLeave struct {
		Name  string `json:"name"`
		Type  string `json:"type"`
		Until string `json:"until"`
	}
	leaves := []onLeave{}
	var ls []models.LeaveRequest
	database.DB.Preload("Employee").Preload("Type").Where("status = 'Disetujui' AND start_date <= ? AND end_date >= ? AND employee_id IN (?)", now, now,
		employeeScope(c, database.DB.Model(&models.Employee{})).Select("employees.id")).Limit(20).Find(&ls)
	for _, l := range ls {
		o := onLeave{Until: fmtShort(l.EndDate)}
		if l.Employee != nil {
			o.Name = l.Employee.Name
		}
		if l.Type != nil {
			o.Type = l.Type.Name
		}
		leaves = append(leaves, o)
	}
	out["on_leave"] = leaves

	// projects
	var ps []models.Project
	scopeBusiness(c, database.DB.Model(&models.Project{}), "projects.business_id").Where("projects.status = 'Aktif'").Order("projects.id DESC").Limit(50).Find(&ps)
	pv := decorateProjects(c, ps)
	sort.SliceStable(pv, func(i, j int) bool { return pv[i].Overdue > pv[j].Overdue })
	if len(pv) > 5 {
		pv = pv[:5]
	}
	type projRow struct {
		ID       uint    `json:"id"`
		Name     string  `json:"name"`
		Owner    string  `json:"owner"`
		Progress float64 `json:"progress"`
		Overdue  int     `json:"overdue"`
		End      string  `json:"end"`
	}
	prs := []projRow{}
	for _, p := range pv {
		prs = append(prs, projRow{p.ID, p.Name, p.OwnerName, p.Progress, p.Overdue, fmtDate(p.EndDate)})
	}
	var activeProjects int64
	scopeBusiness(c, database.DB.Model(&models.Project{}), "projects.business_id").Where("projects.status = 'Aktif'").Count(&activeProjects)
	out["projects"] = gin.H{"active": activeProjects, "top": prs}

	// KPI of this month
	per, _ := parsePeriod(now.Format("2006-01"))
	st := getKPISettings()
	var scores []empScore
	if closeInfo(per.Key) != nil {
		scores = snapshotScores(per.Key, emps)
	} else {
		scores = computeScores(emps, per, st)
	}
	var sum float64
	n, good, attn, crit := 0, 0, 0, 0
	ranked := []empScore{}
	for _, s := range scores {
		if s.Final == nil {
			continue
		}
		sum += *s.Final
		n++
		ranked = append(ranked, s)
		switch s.Status {
		case "Good":
			good++
		case "Attention":
			attn++
		default:
			crit++
		}
	}
	sort.SliceStable(ranked, func(i, j int) bool { return *ranked[i].Final > *ranked[j].Final })
	type perf struct {
		Name   string  `json:"name"`
		Unit   string  `json:"unit"`
		Score  float64 `json:"score"`
		Status string  `json:"status"`
	}
	top, low := []perf{}, []perf{}
	for i, s := range ranked {
		if i < 5 {
			top = append(top, perf{s.Name, s.UnitName, *s.Final, s.Status})
		}
	}
	for i := len(ranked) - 1; i >= 5 && len(low) < 5; i-- { // lowest scores, never repeating the top list
		low = append(low, perf{ranked[i].Name, ranked[i].UnitName, *ranked[i].Final, ranked[i].Status})
	}
	avg := 0.0
	if n > 0 {
		avg = r1(sum / n2f(n))
	}
	out["kpi"] = gin.H{"period": per.Label, "average": avg, "scored": n, "good": good, "attention": attn, "critical": crit, "top": top, "bottom": low, "settings": st, "closed": closeInfo(per.Key) != nil}
	out["generated_at"] = time.Now()
	c.JSON(http.StatusOK, out)
}

package handlers

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/dea-core/hcis/backend/internal/approval"
	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const maxTaskDepth = 5

func init() { approval.Hooks["task"] = taskApprovalHook }

// ---- access ----

type taskRoles struct{ Manager, PIC, Involved bool }

// rolesOn works out what the caller may do with a task:
//
//	Manager  = admin/HR, the creator, the person who gave the instruction, the PIC's superior, or the project owner (or their superior)
//	PIC      = the person in charge
//	Involved = PIC, assigner, member or watcher
func rolesOn(c *gin.Context, t models.Task) taskRoles {
	var r taskRoles
	me := myEmployeeID(c)
	if isGroupLevel(c) || t.CreatedByUserID == uid(c) {
		r.Manager, r.Involved = true, true
	}
	if me == nil {
		return r
	}
	m := *me
	if t.PICID == m {
		r.PIC, r.Involved = true, true
	}
	if t.AssignerID != nil && *t.AssignerID == m {
		r.Manager, r.Involved = true, true
	}
	if !r.Manager && inDownline(m, t.PICID) {
		r.Manager = true
	}
	if t.ProjectID != nil && !r.Manager {
		var p models.Project
		if database.DB.Select("id, owner_id").Limit(1).Find(&p, *t.ProjectID).Error == nil && p.ID != 0 {
			if p.OwnerID == m || inDownline(m, p.OwnerID) {
				r.Manager = true
			}
		}
	}
	if !r.Involved {
		var n int64
		database.DB.Model(&models.TaskMember{}).Where("task_id = ? AND employee_id = ?", t.ID, m).Count(&n)
		r.Involved = n > 0
	}
	return r
}

func canViewTask(c *gin.Context, t models.Task) bool {
	if allowed := allowedBusinessIDs(c); allowed != nil {
		ok := false
		for _, id := range allowed {
			ok = ok || id == t.BusinessID
		}
		if !ok {
			return false
		}
	}
	if r := rolesOn(c, t); r.Manager || r.Involved {
		return true
	}
	if t.ApprovalID != nil { // approvers must see what they are asked to approve
		var n int64
		database.DB.Model(&models.ApprovalStep{}).Where("request_id = ? AND approver_user_id = ?", *t.ApprovalID, uid(c)).Count(&n)
		return n > 0
	}
	return false
}

func loadTask(c *gin.Context) (models.Task, bool) {
	var t models.Task
	if database.DB.Limit(1).Find(&t, paramID(c)).Error != nil || t.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "tugas tidak ditemukan"})
		return t, false
	}
	if !canViewTask(c, t) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Anda tidak berhak melihat tugas ini"})
		return t, false
	}
	return t, true
}

func calcFor(businessID uint) *taskCalc {
	var all []models.Task
	database.DB.Where("business_id = ?", businessID).Find(&all)
	return newTaskCalc(all)
}

// ---- views ----

type memberView struct {
	EmployeeID uint   `json:"employee_id"`
	Name       string `json:"name"`
	Role       string `json:"role"`
}

type taskView struct {
	models.Task
	Status          string       `json:"status"`     // effective status (derived for parents)
	OwnStatus       string       `json:"own_status"` // the stored status
	AssignerName    string       `json:"assigner_name"`
	PICName         string       `json:"pic_name"`
	UnitName        string       `json:"unit_name"`
	ProjectName     string       `json:"project_name"`
	ParentTitle     string       `json:"parent_title"`
	Progress        float64      `json:"progress"`
	IsParent        bool         `json:"is_parent"`
	KidsTotal       int          `json:"kids_total"`
	KidsDone        int          `json:"kids_done"`
	Overdue         bool         `json:"overdue"`
	Members         []memberView `json:"members"`
	AttachmentCount int          `json:"attachment_count"`
	CommentCount    int          `json:"comment_count"`
	WaitingFor      string       `json:"waiting_for"`
	KPITitle        string       `json:"kpi_title"`
	CanManage       bool         `json:"can_manage"`
	CanWork         bool         `json:"can_work"` // PIC or manager: may change status / complete
	Depth           int          `json:"depth"`
}

func decorateTasks(c *gin.Context, ts []models.Task, calcs map[uint]*taskCalc) []taskView {
	if len(ts) == 0 {
		return []taskView{}
	}
	var ids, projIDs, apIDs []uint
	for _, t := range ts {
		ids = append(ids, t.ID)
		if t.ProjectID != nil {
			projIDs = append(projIDs, *t.ProjectID)
		}
		if t.ApprovalID != nil && t.Status == "review" {
			apIDs = append(apIDs, *t.ApprovalID)
		}
	}
	empName := map[uint]string{}
	unitName := map[uint]string{}
	var es []models.Employee
	database.DB.Preload("Unit").Select("id, name, unit_id").Find(&es)
	for _, e := range es {
		empName[e.ID] = e.Name
		if e.Unit != nil {
			unitName[e.ID] = e.Unit.Name
		}
	}
	var units []models.OrgUnit
	database.DB.Select("id, name").Find(&units)
	unitByID := map[uint]string{}
	for _, u := range units {
		unitByID[u.ID] = u.Name
	}
	projName := map[uint]string{}
	if len(projIDs) > 0 {
		var ps []models.Project
		database.DB.Select("id, name").Where("id IN ?", projIDs).Find(&ps)
		for _, p := range ps {
			projName[p.ID] = p.Name
		}
	}
	members := map[uint][]memberView{}
	var ms []models.TaskMember
	database.DB.Where("task_id IN ?", ids).Order("id").Find(&ms)
	for _, m := range ms {
		members[m.TaskID] = append(members[m.TaskID], memberView{m.EmployeeID, empName[m.EmployeeID], m.Role})
	}
	count := func(table string) map[uint]int {
		out := map[uint]int{}
		var rows []struct {
			TaskID uint
			N      int
		}
		database.DB.Raw("SELECT task_id, COUNT(*) AS n FROM "+table+" WHERE task_id IN ? GROUP BY task_id", ids).Scan(&rows)
		for _, r := range rows {
			out[r.TaskID] = r.N
		}
		return out
	}
	attach, comments := count("task_attachments"), count("task_comments")
	waiting := map[uint]string{}
	if len(apIDs) > 0 {
		var ws []struct {
			RequestID uint
			Name      string
		}
		database.DB.Raw(`SELECT s.request_id, u.name FROM approval_steps s JOIN users u ON u.id = s.approver_user_id WHERE s.status = 'Pending' AND s.request_id IN ?`, apIDs).Scan(&ws)
		for _, w := range ws {
			waiting[w.RequestID] = w.Name
		}
	}
	kpiTitles := map[uint]string{}
	var kids []uint
	for _, t := range ts {
		if t.KPIID != nil {
			kids = append(kids, *t.KPIID)
		}
	}
	if len(kids) > 0 {
		var ks []models.EmployeeKPI
		database.DB.Select("id, title").Where("id IN ?", kids).Find(&ks)
		for _, k := range ks {
			kpiTitles[k.ID] = k.Title
		}
	}
	titles := map[uint]string{}
	for _, cc := range calcs {
		for id, t := range cc.tasks {
			titles[id] = t.Title
		}
	}
	now := today()
	out := make([]taskView, 0, len(ts))
	for _, t := range ts {
		cc := calcs[t.BusinessID]
		v := taskView{Task: t, OwnStatus: t.Status, Status: t.Status, AssignerName: "", PICName: empName[t.PICID], Members: members[t.ID],
			AttachmentCount: attach[t.ID], CommentCount: comments[t.ID]}
		if v.Members == nil {
			v.Members = []memberView{}
		}
		if t.AssignerID != nil {
			v.AssignerName = empName[*t.AssignerID]
		}
		if t.UnitID != nil {
			v.UnitName = unitByID[*t.UnitID]
		} else {
			v.UnitName = unitName[t.PICID]
		}
		if t.ProjectID != nil {
			v.ProjectName = projName[*t.ProjectID]
		}
		if t.ParentID != nil {
			v.ParentTitle = titles[*t.ParentID]
		}
		if cc != nil {
			v.Status, v.Progress, v.IsParent = cc.status(t.ID), cc.progress(t.ID), cc.isParent(t.ID)
			v.KidsTotal, v.KidsDone = cc.counts(t.ID)
			v.Depth = cc.depthOf(t.ID)
		}
		if t.ApprovalID != nil {
			v.WaitingFor = waiting[*t.ApprovalID]
		}
		if t.KPIID != nil {
			v.KPITitle = kpiTitles[*t.KPIID]
		}
		if t.DueDate != nil && day(*t.DueDate).Before(now) && v.Status != "done" {
			v.Overdue = true
		}
		r := rolesOn(c, t)
		v.CanManage, v.CanWork = r.Manager, r.Manager || r.PIC
		out = append(out, v)
	}
	return out
}

func calcsFor(ts []models.Task) map[uint]*taskCalc {
	seen := map[uint]bool{}
	out := map[uint]*taskCalc{}
	for _, t := range ts {
		if !seen[t.BusinessID] {
			seen[t.BusinessID] = true
			out[t.BusinessID] = calcFor(t.BusinessID)
		}
	}
	return out
}

// ---- list ----

func taskScope(c *gin.Context, scope string) *gorm.DB {
	q := scopeBusiness(c, database.DB.Model(&models.Task{}), "tasks.business_id")
	me := myEmployeeID(c)
	if me == nil {
		if scope == "all" && isGroupLevel(c) {
			return q
		}
		return q.Where("1 = 0")
	}
	m := *me
	member := func(role string) string {
		s := "EXISTS (SELECT 1 FROM task_members tm WHERE tm.task_id = tasks.id AND tm.employee_id = ?"
		if role != "" {
			s += " AND tm.role = '" + role + "'"
		}
		return s + ")"
	}
	switch scope {
	case "mine":
		return q.Where("tasks.pic_id = ?", m)
	case "given":
		return q.Where("tasks.assigner_id = ?", m)
	case "involved":
		return q.Where(member("member"), m)
	case "watching":
		return q.Where(member("watcher"), m)
	case "team":
		return q.Where("tasks.pic_id IN "+downlineSQL, m)
	}
	if isGroupLevel(c) {
		return q
	}
	return q.Where("tasks.pic_id = ? OR tasks.assigner_id = ? OR "+member("")+" OR tasks.pic_id IN "+downlineSQL+" OR tasks.project_id IN (SELECT id FROM projects WHERE owner_id = ?)", m, m, m, m, m)
}

func ListTasks(c *gin.Context) {
	q := taskScope(c, c.DefaultQuery("scope", "all"))
	if v := c.Query("priority"); v != "" {
		q = q.Where("tasks.priority = ?", v)
	}
	if v := c.Query("project_id"); v == "none" {
		q = q.Where("tasks.project_id IS NULL")
	} else if v != "" {
		q = q.Where("tasks.project_id = ?", v)
	}
	if v := c.Query("pic_id"); v != "" {
		q = q.Where("tasks.pic_id = ?", v)
	}
	if s := strings.TrimSpace(c.Query("q")); s != "" {
		q = q.Where("tasks.title ILIKE ? OR tasks.pic_id IN (SELECT id FROM employees WHERE name ILIKE ?)", "%"+s+"%", "%"+s+"%")
	}
	var ts []models.Task
	q.Order("tasks.due_date ASC NULLS LAST, tasks.id").Limit(3000).Find(&ts)
	views := decorateTasks(c, ts, calcsFor(ts))

	now := today()
	statusF, dl := c.Query("status"), c.Query("deadline")
	out := make([]taskView, 0, len(views))
	for _, v := range views {
		if statusF != "" && v.Status != statusF {
			continue
		}
		if dl != "" {
			if v.DueDate == nil {
				if dl != "nodate" {
					continue
				}
			} else {
				d := day(*v.DueDate)
				ok := false
				switch dl {
				case "overdue":
					ok = v.Overdue
				case "today":
					ok = d.Equal(now) && v.Status != "done"
				case "week":
					ok = !d.Before(now) && d.Before(now.AddDate(0, 0, 7)) && v.Status != "done"
				}
				if !ok {
					continue
				}
			}
		}
		out = append(out, v)
	}
	sum := map[string]int{"total": len(out)}
	for _, v := range out {
		if v.IsParent {
			sum["parents"]++
		}
		if v.ParentID != nil {
			sum["subtasks"]++
		}
		if v.Status == "done" {
			sum["done"]++
		} else {
			sum["open"]++
		}
		if v.Overdue {
			sum["overdue"]++
		}
		if v.Status == "review" {
			sum["review"]++
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": out, "summary": sum})
}

// Assignees: who the caller may give a task to — themselves, their subordinates (everyone for admin/HR).
func TaskAssignees(c *gin.Context) {
	q := employeeScope(c, database.DB.Model(&models.Employee{}))
	var emps []models.Employee
	q.Preload("Unit").Order("employees.name").Limit(1000).Find(&emps)
	type row struct {
		ID         uint   `json:"id"`
		Name       string `json:"name"`
		BusinessID uint   `json:"business_id"`
		UnitID     *uint  `json:"unit_id"`
		UnitName   string `json:"unit_name"`
		NIK        string `json:"nik"`
	}
	out := make([]row, 0, len(emps))
	for _, e := range emps {
		r := row{ID: e.ID, Name: e.Name, BusinessID: e.BusinessID, UnitID: e.UnitID, NIK: e.NIK}
		if e.Unit != nil {
			r.UnitName = e.Unit.Name
		}
		out = append(out, r)
	}
	c.JSON(http.StatusOK, out)
}

// ---- get ----

func GetTask(c *gin.Context) {
	t, ok := loadTask(c)
	if !ok {
		return
	}
	calcs := map[uint]*taskCalc{t.BusinessID: calcFor(t.BusinessID)}
	cc := calcs[t.BusinessID]
	view := decorateTasks(c, []models.Task{t}, calcs)[0]

	var kids []models.Task
	for _, id := range cc.kids[t.ID] {
		kids = append(kids, cc.tasks[id])
	}
	children := decorateTasks(c, kids, calcs)

	type anc struct {
		ID    uint   `json:"id"`
		Title string `json:"title"`
	}
	var ancestors []anc
	for cur, i := t, 0; cur.ParentID != nil && i < 20; i++ {
		cur = cc.tasks[*cur.ParentID]
		ancestors = append([]anc{{cur.ID, cur.Title}}, ancestors...)
	}
	comments := []models.TaskComment{}
	database.DB.Where("task_id = ?", t.ID).Order("id").Find(&comments)
	names := map[uint]string{}
	var us []models.User
	database.DB.Select("id, name").Find(&us)
	for _, u := range us {
		names[u.ID] = u.Name
	}
	for i := range comments {
		comments[i].UserName = names[comments[i].UserID]
	}
	atts := []models.TaskAttachment{}
	database.DB.Where("task_id = ?", t.ID).Order("id").Find(&atts)
	if ancestors == nil {
		ancestors = []anc{}
	}
	c.JSON(http.StatusOK, gin.H{"task": view, "children": children, "ancestors": ancestors, "comments": comments, "attachments": atts})
}

// ---- create / update ----

type taskInput struct {
	Title            string   `json:"title"`
	Description      string   `json:"description"`
	Priority         string   `json:"priority"`
	PICID            uint     `json:"pic_id"`
	AssignerID       *uint    `json:"assigner_id"`
	UnitID           *uint    `json:"unit_id"`
	ProjectID        *uint    `json:"project_id"`
	ParentID         *uint    `json:"parent_id"`
	StartDate        string   `json:"start_date"`
	DueDate          string   `json:"due_date"`
	Weight           *float64 `json:"weight"`
	RequireResult    *bool    `json:"require_result"`
	RequiresApproval *bool    `json:"requires_approval"`
	ApprovalLevels   int      `json:"approval_levels"`
	ApproverUserID   *uint    `json:"approver_user_id"`
	KPIID            *uint    `json:"kpi_id"`
	MemberIDs        []uint   `json:"member_ids"`
	WatcherIDs       []uint   `json:"watcher_ids"`
}

func employeeInBusiness(empID, businessID uint) bool {
	var n int64
	database.DB.Model(&models.Employee{}).Where(`id = ? AND status = 'Aktif' AND (business_id = ? OR id IN (SELECT employee_id FROM employee_placements WHERE business_id = ?))`, empID, businessID, businessID).Count(&n)
	return n > 0
}

func parseOptDate(s string) (*time.Time, bool) {
	if strings.TrimSpace(s) == "" {
		return nil, true
	}
	d, ok := parseDate(s)
	if !ok {
		return nil, false
	}
	return &d, true
}

// fillTask validates the input and writes it onto t. A non-empty string means the request must be rejected.
func fillTask(c *gin.Context, in taskInput, t *models.Task, calc *taskCalc, full bool) string {
	if full {
		if strings.TrimSpace(in.Title) == "" {
			return "nama tugas wajib diisi"
		}
		t.Title = strings.TrimSpace(in.Title)
		t.Priority = "normal"
		if in.Priority == "tinggi" {
			t.Priority = "tinggi"
		}
		start, ok1 := parseOptDate(in.StartDate)
		due, ok2 := parseOptDate(in.DueDate)
		if !ok1 || !ok2 {
			return "format tanggal tidak valid"
		}
		if start != nil && due != nil && due.Before(*start) {
			return "deadline tidak boleh sebelum tanggal mulai"
		}
		t.StartDate, t.DueDate = start, due
		if in.RequireResult != nil {
			t.RequireResult = *in.RequireResult
		}
		if in.RequiresApproval != nil {
			t.RequiresApproval = *in.RequiresApproval
		}
		t.ApprovalLevels = in.ApprovalLevels
		if t.ApprovalLevels < 1 {
			t.ApprovalLevels = 1
		}
		if t.ApprovalLevels > 3 {
			return "jenjang approval maksimal 3"
		}
		t.ApproverUserID = in.ApproverUserID
		if in.ApproverUserID != nil {
			var u models.User
			if database.DB.Select("id").Where("is_active = true").Limit(1).Find(&u, *in.ApproverUserID).Error != nil || u.ID == 0 {
				return "approver tidak valid"
			}
		}
	}
	t.Description = in.Description
	return ""
}

// resolveStructure decides business / project / parent for a task and checks the PIC. Returns an error message or "".
func resolveStructure(c *gin.Context, in taskInput, t *models.Task, calc *taskCalc, isNew bool) string {
	var pic models.Employee
	if database.DB.Limit(1).Find(&pic, in.PICID).Error != nil || pic.ID == 0 || pic.Status != "Aktif" {
		return "PIC tidak ditemukan atau tidak aktif"
	}
	if in.ParentID != nil {
		parent, ok := models.Task{}, false
		if calc != nil {
			parent, ok = calc.tasks[*in.ParentID]
		}
		if !ok {
			if database.DB.Limit(1).Find(&parent, *in.ParentID).Error != nil || parent.ID == 0 {
				return "induk tugas tidak ditemukan"
			}
			calc = calcFor(parent.BusinessID)
		}
		if !canViewTask(c, parent) {
			return "Anda tidak berhak menambah sub tugas pada induk ini"
		}
		if !isNew && (parent.ID == t.ID || calcContains(calc, t.ID, parent.ID)) {
			return "induk tugas tidak boleh berupa tugas itu sendiri atau sub tugasnya"
		}
		if parent.Status == "review" && calc != nil && !calc.isParent(parent.ID) {
			return "induk sedang menunggu approval penyelesaian; batalkan penyelesaian atau tunggu keputusan dulu"
		}
		height := 1
		if !isNew && calc != nil {
			height = calc.subtreeHeight(t.ID)
		}
		if calc.depthOf(parent.ID)+height > maxTaskDepth {
			return fmt.Sprintf("kedalaman sub tugas maksimal %d tingkat", maxTaskDepth)
		}
		t.ParentID, t.BusinessID, t.ProjectID = &parent.ID, parent.BusinessID, parent.ProjectID // a sub-task lives in its parent's project
	} else {
		t.ParentID = nil
		t.ProjectID = in.ProjectID
		t.BusinessID = pic.BusinessID
		if in.ProjectID != nil {
			var p models.Project
			if database.DB.Limit(1).Find(&p, *in.ProjectID).Error != nil || p.ID == 0 {
				return "proyek tidak ditemukan"
			}
			if !canViewProject(c, p) {
				return "Anda tidak berhak menambah tugas pada proyek ini"
			}
			t.BusinessID = p.BusinessID
		}
	}
	if !employeeInBusiness(pic.ID, t.BusinessID) {
		return "PIC bukan bagian dari bisnis tugas/proyek ini"
	}
	t.PICID = pic.ID
	// "terkait KPI": the task counts toward one of the PIC's auto KPI items
	t.KPIID = nil
	if in.KPIID != nil {
		var k models.EmployeeKPI
		if database.DB.Limit(1).Find(&k, *in.KPIID).Error != nil || k.ID == 0 || k.EmployeeID != pic.ID || k.Metric != "tasks_on_time" {
			return "KPI yang dipilih harus KPI otomatis (tugas tepat waktu) milik PIC"
		}
		t.KPIID = &k.ID
	}
	t.UnitID = in.UnitID
	if t.UnitID == nil {
		t.UnitID = pic.UnitID
	}
	if t.UnitID != nil {
		var u models.OrgUnit
		if database.DB.Select("id, business_id").Limit(1).Find(&u, *t.UnitID).Error != nil || u.ID == 0 || u.BusinessID != t.BusinessID {
			t.UnitID = pic.UnitID // unit of another business → fall back to the PIC's own
		}
	}
	// weight ("bobot") only means something for a top-level project task
	t.Weight = nil
	if t.ParentID == nil && t.ProjectID != nil && in.Weight != nil && *in.Weight > 0 {
		if *in.Weight > 100 {
			return "bobot maksimal 100"
		}
		t.Weight = in.Weight
	}
	// who gave the instruction: any active employee (it may have come by chat or call)
	t.AssignerID = in.AssignerID
	if t.AssignerID != nil {
		var a models.Employee
		if database.DB.Select("id").Where("status = 'Aktif'").Limit(1).Find(&a, *t.AssignerID).Error != nil || a.ID == 0 {
			return "pemberi tugas tidak ditemukan"
		}
	}
	return ""
}

func calcContains(calc *taskCalc, ancestor, target uint) bool {
	if calc == nil {
		return false
	}
	for _, d := range calc.descendants(ancestor) {
		if d == target {
			return true
		}
	}
	return false
}

func syncMembers(tx *gorm.DB, t models.Task, members, watchers []uint) string {
	tx.Where("task_id = ?", t.ID).Delete(&models.TaskMember{})
	seen := map[uint]bool{t.PICID: true}
	add := func(ids []uint, role string) string {
		for _, id := range ids {
			if seen[id] {
				continue
			}
			if !employeeInBusiness(id, t.BusinessID) {
				return "anggota/pengamat harus karyawan aktif di bisnis yang sama"
			}
			seen[id] = true
			if err := tx.Create(&models.TaskMember{TaskID: t.ID, EmployeeID: id, Role: role}).Error; err != nil {
				return err.Error()
			}
		}
		return ""
	}
	if msg := add(members, "member"); msg != "" { // a person who is both member and watcher stays a member
		return msg
	}
	return add(watchers, "watcher")
}

func CreateTask(c *gin.Context) {
	var in taskInput
	if err := c.ShouldBindJSON(&in); err != nil || in.PICID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "nama tugas dan PIC wajib diisi"})
		return
	}
	me := myEmployeeID(c)
	// assign to yourself or a subordinate; admin/HR to anyone
	if !isGroupLevel(c) && !(me != nil && (*me == in.PICID || inDownline(*me, in.PICID))) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Anda hanya dapat memberi tugas kepada diri sendiri atau bawahan Anda"})
		return
	}
	if in.AssignerID == nil && me != nil && *me != in.PICID {
		in.AssignerID = me // default: you gave the instruction
	}
	t := models.Task{Status: "todo", RequiresApproval: true, ApprovalLevels: 1, CreatedByUserID: uid(c)}
	if msg := fillTask(c, in, &t, nil, true); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	if msg := resolveStructure(c, in, &t, nil, true); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	var errMsg string
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&t).Error; err != nil {
			return err
		}
		if errMsg = syncMembers(tx, t, in.MemberIDs, in.WatcherIDs); errMsg != "" {
			return fmt.Errorf("%s", errMsg)
		}
		return nil
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if me == nil || *me != t.PICID { // tell the PIC
		var pu models.User
		if database.DB.Where("employee_id = ? AND is_active = true", t.PICID).Limit(1).Find(&pu).Error == nil && pu.ID != 0 {
			body := "Tugas baru untuk Anda"
			if t.AssignerID != nil {
				var a models.Employee
				database.DB.Select("name").Limit(1).Find(&a, *t.AssignerID)
				body = "Dari " + a.Name
			}
			if t.DueDate != nil {
				body += " · deadline " + fmtShort(*t.DueDate)
			}
			notify(pu.ID, "task_assigned", "Tugas baru: "+t.Title, body, fmt.Sprintf("/tasks?open=%d", t.ID), "")
		}
	}
	audit(c, "create", "task", t.ID)
	c.JSON(http.StatusOK, decorateTasks(c, []models.Task{t}, calcsFor([]models.Task{t}))[0])
}

func UpdateTask(c *gin.Context) {
	t, ok := loadTask(c)
	if !ok {
		return
	}
	var in taskInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "data tidak valid"})
		return
	}
	r := rolesOn(c, t)
	if !r.Manager && !r.PIC {
		c.JSON(http.StatusForbidden, gin.H{"error": "tidak berwenang mengubah tugas ini"})
		return
	}
	calc := calcFor(t.BusinessID)
	oldPIC := t.PICID
	if r.Manager {
		if t.Status == "review" && in.PICID != t.PICID {
			c.JSON(http.StatusConflict, gin.H{"error": "tugas sedang menunggu approval; batalkan penyelesaian sebelum mengganti PIC"})
			return
		}
		if in.PICID == 0 {
			in.PICID = t.PICID
		}
		if in.PICID != t.PICID && !isGroupLevel(c) {
			if me := myEmployeeID(c); me == nil || !(*me == in.PICID || inDownline(*me, in.PICID)) {
				c.JSON(http.StatusForbidden, gin.H{"error": "PIC baru harus diri Anda atau bawahan Anda"})
				return
			}
		}
		if msg := fillTask(c, in, &t, calc, true); msg != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": msg})
			return
		}
		if msg := resolveStructure(c, in, &t, calc, false); msg != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": msg})
			return
		}
		if calc.isParent(t.ID) { // a parent has no status of its own
			t.Status = "todo"
		}
	} else { // the PIC alone may only adjust the description, members and watchers
		t.Description = in.Description
	}
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&t).Error; err != nil {
			return err
		}
		// children follow their parent's project
		for _, d := range calc.descendants(t.ID) {
			tx.Model(&models.Task{}).Where("id = ?", d).Updates(map[string]any{"project_id": t.ProjectID, "weight": nil})
		}
		if msg := syncMembers(tx, t, in.MemberIDs, in.WatcherIDs); msg != "" {
			return fmt.Errorf("%s", msg)
		}
		return nil
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if t.PICID != oldPIC {
		var pu models.User
		if database.DB.Where("employee_id = ? AND is_active = true", t.PICID).Limit(1).Find(&pu).Error == nil && pu.ID != 0 {
			notify(pu.ID, "task_assigned", "Tugas dialihkan ke Anda: "+t.Title, "", fmt.Sprintf("/tasks?open=%d", t.ID), "")
		}
	}
	audit(c, "update", "task", t.ID)
	c.JSON(http.StatusOK, decorateTasks(c, []models.Task{t}, calcsFor([]models.Task{t}))[0])
}

func DeleteTask(c *gin.Context) {
	t, ok := loadTask(c)
	if !ok {
		return
	}
	if !rolesOn(c, t).Manager {
		c.JSON(http.StatusForbidden, gin.H{"error": "hanya pemberi tugas, atasan PIC, atau admin yang dapat menghapus tugas"})
		return
	}
	calc := calcFor(t.BusinessID)
	ids := append([]uint{t.ID}, calc.descendants(t.ID)...)
	var files []models.TaskAttachment
	database.DB.Where("task_id IN ?", ids).Find(&files)
	database.DB.Transaction(func(tx *gorm.DB) error {
		tx.Exec(`UPDATE approval_steps SET status = 'Cancelled' WHERE status IN ('Pending','Waiting') AND request_id IN
			(SELECT id FROM approval_requests WHERE request_type = 'task' AND status = 'Pending' AND ref_id IN ?)`, ids)
		tx.Exec(`UPDATE approval_requests SET status = 'Cancelled' WHERE request_type = 'task' AND status = 'Pending' AND ref_id IN ?`, ids)
		tx.Where("task_id IN ?", ids).Delete(&models.TaskMember{})
		tx.Where("task_id IN ?", ids).Delete(&models.TaskAttachment{})
		tx.Where("task_id IN ?", ids).Delete(&models.TaskComment{})
		return tx.Where("id IN ?", ids).Delete(&models.Task{}).Error
	})
	for _, f := range files {
		Store.Remove(f.LocalPath)
	}
	audit(c, "delete", "task", t.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true, "deleted": len(ids)})
}

// ---- status & completion ----

func addTaskComment(tx *gorm.DB, taskID, userID uint, body string) {
	if strings.TrimSpace(body) != "" {
		tx.Create(&models.TaskComment{TaskID: taskID, UserID: userID, Body: strings.TrimSpace(body)})
	}
}

func SetTaskStatus(c *gin.Context) {
	t, ok := loadTask(c)
	if !ok {
		return
	}
	var in struct {
		Status string `json:"status"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || (in.Status != "todo" && in.Status != "in_progress") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "status harus todo atau in_progress; gunakan Selesaikan untuk menutup tugas"})
		return
	}
	if r := rolesOn(c, t); !r.Manager && !r.PIC {
		c.JSON(http.StatusForbidden, gin.H{"error": "hanya PIC atau pemberi tugas yang dapat mengubah status"})
		return
	}
	if calcFor(t.BusinessID).isParent(t.ID) {
		c.JSON(http.StatusConflict, gin.H{"error": "status tugas induk mengikuti sub tugasnya"})
		return
	}
	if t.Status == "review" || t.Status == "done" {
		c.JSON(http.StatusConflict, gin.H{"error": "tugas sudah diajukan/ditutup; batalkan penyelesaian atau buka kembali dulu"})
		return
	}
	database.DB.Model(&models.Task{}).Where("id = ?", t.ID).Update("status", in.Status)
	audit(c, "status:"+in.Status, "task", t.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// CompleteTask closes a leaf task — or, when approval is required, sends it for approval first.
func CompleteTask(c *gin.Context) {
	t, ok := loadTask(c)
	if !ok {
		return
	}
	var in struct {
		Note string `json:"note"`
	}
	c.ShouldBindJSON(&in)
	if r := rolesOn(c, t); !r.Manager && !r.PIC {
		c.JSON(http.StatusForbidden, gin.H{"error": "hanya PIC atau pemberi tugas yang dapat menyelesaikan tugas"})
		return
	}
	if calcFor(t.BusinessID).isParent(t.ID) {
		c.JSON(http.StatusConflict, gin.H{"error": "tugas induk selesai otomatis saat semua sub tugasnya selesai"})
		return
	}
	if t.Status != "todo" && t.Status != "in_progress" {
		c.JSON(http.StatusConflict, gin.H{"error": "tugas sudah diajukan atau selesai"})
		return
	}
	var files int64
	database.DB.Model(&models.TaskAttachment{}).Where("task_id = ?", t.ID).Count(&files)
	if t.RequireResult && files == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tugas ini wajib melampirkan hasil pekerjaan sebelum diselesaikan"})
		return
	}
	var pic models.Employee
	database.DB.Select("id, name").Limit(1).Find(&pic, t.PICID)
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		addTaskComment(tx, t.ID, uid(c), in.Note)
		if !t.RequiresApproval {
			now := time.Now()
			t.Status, t.CompletedAt = "done", &now
			return tx.Save(&t).Error
		}
		var picUser models.User
		tx.Where("employee_id = ?", t.PICID).Limit(1).Find(&picUser)
		requester := picUser.ID
		if requester == 0 {
			requester = uid(c)
		}
		var assigned *uint
		if t.ApproverUserID != nil && *t.ApproverUserID != requester {
			assigned = t.ApproverUserID
		}
		summary := "PIC " + pic.Name
		if t.DueDate != nil {
			summary += " · deadline " + fmtShort(*t.DueDate)
		}
		if files > 0 {
			summary += fmt.Sprintf(" · %d lampiran hasil", files)
		}
		req, err := approval.Submit(tx, approval.SubmitInput{Type: "task", RefID: t.ID, BusinessID: t.BusinessID, RequesterEmployeeID: &t.PICID, RequesterUserID: requester,
			Title: "Penyelesaian Tugas — " + t.Title, Summary: summary, AssignedUserID: assigned, Levels: t.ApprovalLevels})
		if err != nil {
			return err
		}
		t.Status, t.ApprovalID = "review", &req.ID
		return tx.Save(&t).Error
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	audit(c, "complete", "task", t.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": t.Status})
}

// CancelCompletion withdraws a completion that is waiting for approval.
func CancelCompletion(c *gin.Context) {
	t, ok := loadTask(c)
	if !ok {
		return
	}
	if r := rolesOn(c, t); !r.Manager && !r.PIC {
		c.JSON(http.StatusForbidden, gin.H{"error": "tidak berwenang"})
		return
	}
	if t.Status != "review" || t.ApprovalID == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "tugas tidak sedang menunggu approval"})
		return
	}
	var req models.ApprovalRequest
	database.DB.First(&req, *t.ApprovalID)
	err := database.DB.Transaction(func(tx *gorm.DB) error { _, e := approval.Cancel(tx, req.ID, req.RequesterUserID); return e })
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	audit(c, "cancel_completion", "task", t.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ReopenTask re-opens a finished task (managers only).
func ReopenTask(c *gin.Context) {
	t, ok := loadTask(c)
	if !ok {
		return
	}
	var in struct {
		Note string `json:"note"`
	}
	c.ShouldBindJSON(&in)
	if !rolesOn(c, t).Manager {
		c.JSON(http.StatusForbidden, gin.H{"error": "hanya pemberi tugas, atasan PIC, atau admin yang dapat membuka kembali tugas"})
		return
	}
	if t.Status != "done" {
		c.JSON(http.StatusConflict, gin.H{"error": "hanya tugas selesai yang dapat dibuka kembali"})
		return
	}
	database.DB.Transaction(func(tx *gorm.DB) error {
		addTaskComment(tx, t.ID, uid(c), "Dibuka kembali. "+in.Note)
		return tx.Model(&models.Task{}).Where("id = ?", t.ID).Updates(map[string]any{"status": "in_progress", "completed_at": nil, "approval_id": nil}).Error
	})
	audit(c, "reopen", "task", t.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// taskApprovalHook applies the approval decision to the task.
func taskApprovalHook(tx *gorm.DB, req *models.ApprovalRequest, outcome string) error {
	var t models.Task
	if err := tx.First(&t, req.RefID).Error; err != nil {
		return err
	}
	var pu models.User
	tx.Where("employee_id = ? AND is_active = true", t.PICID).Limit(1).Find(&pu)
	link := fmt.Sprintf("/tasks?open=%d", t.ID)
	switch outcome {
	case approval.Approved:
		now := time.Now()
		t.Status, t.CompletedAt = "done", &now
		if pu.ID != 0 {
			notify(pu.ID, "task_approved", "Penyelesaian tugas disetujui", t.Title, link, fmt.Sprintf("task-approved:%d:%d", t.ID, req.ID))
		}
	case approval.Rejected:
		t.Status, t.CompletedAt = "in_progress", nil
		addTaskComment(tx, t.ID, req.RequesterUserID, "Penyelesaian ditolak: "+req.DecisionNote)
		if pu.ID != 0 {
			notify(pu.ID, "task_rejected", "Penyelesaian tugas ditolak", t.Title+" — "+req.DecisionNote, link, fmt.Sprintf("task-rejected:%d:%d", t.ID, req.ID))
		}
	case approval.Cancelled:
		t.Status, t.CompletedAt = "in_progress", nil
	}
	return tx.Save(&t).Error
}

// ---- comments ----

func AddTaskComment(c *gin.Context) {
	t, ok := loadTask(c)
	if !ok {
		return
	}
	var in struct {
		Body string `json:"body"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || strings.TrimSpace(in.Body) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "komentar tidak boleh kosong"})
		return
	}
	cm := models.TaskComment{TaskID: t.ID, UserID: uid(c), Body: strings.TrimSpace(in.Body)}
	database.DB.Create(&cm)
	c.JSON(http.StatusOK, cm)
}

package handlers

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

var projectStatuses = map[string]bool{"Aktif": true, "Ditunda": true, "Selesai": true, "Dibatalkan": true}

func projectManageable(c *gin.Context, p models.Project) bool {
	if isGroupLevel(c) {
		return true
	}
	me := myEmployeeID(c)
	return me != nil && (*me == p.OwnerID || inDownline(*me, p.OwnerID))
}

func canViewProject(c *gin.Context, p models.Project) bool {
	if allowed := allowedBusinessIDs(c); allowed != nil {
		ok := false
		for _, id := range allowed {
			ok = ok || id == p.BusinessID
		}
		if !ok {
			return false
		}
	}
	if projectManageable(c, p) {
		return true
	}
	me := myEmployeeID(c)
	if me == nil {
		return false
	}
	var n int64
	database.DB.Raw(`SELECT COUNT(*) FROM tasks t WHERE t.project_id = ? AND (t.pic_id = ? OR t.assigner_id = ?
		OR EXISTS (SELECT 1 FROM task_members m WHERE m.task_id = t.id AND m.employee_id = ?))`, p.ID, *me, *me, *me).Scan(&n)
	return n > 0
}

func loadProject(c *gin.Context) (models.Project, bool) {
	var p models.Project
	if database.DB.Limit(1).Find(&p, paramID(c)).Error != nil || p.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "proyek tidak ditemukan"})
		return p, false
	}
	if !canViewProject(c, p) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Anda tidak berhak melihat proyek ini"})
		return p, false
	}
	return p, true
}

type projectView struct {
	models.Project
	OwnerName string  `json:"owner_name"`
	Progress  float64 `json:"progress"`
	TopLevel  int     `json:"top_level"` // "induk tugas"
	Subtasks  int     `json:"subtasks"`
	Open      int     `json:"open"`
	Done      int     `json:"done"`
	Overdue   int     `json:"overdue"`
	Weighted  bool    `json:"weighted"`
	CanManage bool    `json:"can_manage"`
}

func decorateProjects(c *gin.Context, ps []models.Project) []projectView {
	out := make([]projectView, 0, len(ps))
	names := map[uint]string{}
	var es []models.Employee
	database.DB.Select("id, name").Find(&es)
	for _, e := range es {
		names[e.ID] = e.Name
	}
	calcs := map[uint]*taskCalc{}
	now := today()
	for _, p := range ps {
		cc, ok := calcs[p.BusinessID]
		if !ok {
			cc = calcFor(p.BusinessID)
			calcs[p.BusinessID] = cc
		}
		v := projectView{Project: p, OwnerName: names[p.OwnerID], CanManage: projectManageable(c, p)}
		v.Progress, v.TopLevel, v.Weighted = cc.projectProgress(p.ID)
		for id, t := range cc.tasks {
			if t.ProjectID == nil || *t.ProjectID != p.ID {
				continue
			}
			if t.ParentID != nil {
				v.Subtasks++
			}
			if cc.isParent(id) {
				continue // open/done count leaf work only
			}
			if cc.status(id) == "done" {
				v.Done++
			} else {
				v.Open++
				if t.DueDate != nil && day(*t.DueDate).Before(now) {
					v.Overdue++
				}
			}
		}
		out = append(out, v)
	}
	return out
}

func ListProjects(c *gin.Context) {
	q := scopeBusiness(c, database.DB.Model(&models.Project{}), "projects.business_id")
	if !isGroupLevel(c) {
		me := myEmployeeID(c)
		if me == nil {
			q = q.Where("1 = 0")
		} else {
			q = q.Where(`projects.owner_id = ? OR projects.owner_id IN `+downlineSQL+` OR EXISTS (SELECT 1 FROM tasks t WHERE t.project_id = projects.id AND (t.pic_id = ? OR t.assigner_id = ?
				OR EXISTS (SELECT 1 FROM task_members m WHERE m.task_id = t.id AND m.employee_id = ?)))`, *me, *me, *me, *me, *me)
		}
	}
	if v := c.Query("status"); v != "" {
		q = q.Where("projects.status = ?", v)
	}
	if s := strings.TrimSpace(c.Query("q")); s != "" {
		q = q.Where("projects.name ILIKE ?", "%"+s+"%")
	}
	var ps []models.Project
	q.Order("projects.id DESC").Limit(500).Find(&ps)
	views := decorateProjects(c, ps)
	sum := map[string]int{"projects": len(views)}
	for _, v := range views {
		sum["parents"] += v.TopLevel
		sum["subtasks"] += v.Subtasks
		sum["open"] += v.Open
		sum["done"] += v.Done
	}
	c.JSON(http.StatusOK, gin.H{"data": views, "summary": sum, "can_create": isGroupLevel(c) || hasDirectReports(c)})
}

type projectInput struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	OwnerID     uint   `json:"owner_id"`
	BusinessID  uint   `json:"business_id"`
	StartDate   string `json:"start_date"`
	EndDate     string `json:"end_date"`
	Status      string `json:"status"`
}

func fillProject(c *gin.Context, in projectInput, p *models.Project, isNew bool) string {
	if strings.TrimSpace(in.Name) == "" {
		return "nama proyek wajib diisi"
	}
	start, ok1 := parseOptDate(in.StartDate)
	end, ok2 := parseOptDate(in.EndDate)
	if !ok1 || !ok2 {
		return "format tanggal tidak valid"
	}
	if start != nil && end != nil && end.Before(*start) {
		return "tanggal selesai tidak boleh sebelum tanggal mulai"
	}
	me := myEmployeeID(c)
	owner := in.OwnerID
	if owner == 0 && me != nil {
		owner = *me
	}
	if owner == 0 {
		return "pilih penanggung jawab proyek"
	}
	if !isGroupLevel(c) && !(me != nil && (*me == owner || inDownline(*me, owner))) {
		return "penanggung jawab harus diri Anda atau bawahan Anda"
	}
	var oe models.Employee
	if database.DB.Limit(1).Find(&oe, owner).Error != nil || oe.ID == 0 || oe.Status != "Aktif" {
		return "penanggung jawab tidak ditemukan atau tidak aktif"
	}
	if isNew {
		p.BusinessID = in.BusinessID
		if p.BusinessID == 0 {
			p.BusinessID = oe.BusinessID
		}
	}
	if !employeeInBusiness(owner, p.BusinessID) {
		return "penanggung jawab bukan bagian dari bisnis proyek"
	}
	p.Name, p.Description, p.OwnerID, p.StartDate, p.EndDate = strings.TrimSpace(in.Name), in.Description, owner, start, end
	if in.Status != "" {
		if !projectStatuses[in.Status] {
			return "status proyek tidak valid"
		}
		p.Status = in.Status
	}
	return ""
}

func CreateProject(c *gin.Context) {
	if !isGroupLevel(c) && !hasDirectReports(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "hanya admin, HR, atau atasan yang dapat membuat proyek"})
		return
	}
	var in projectInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "data tidak valid"})
		return
	}
	p := models.Project{Status: "Aktif", CreatedByUserID: uid(c)}
	if msg := fillProject(c, in, &p, true); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	if allowed := allowedBusinessIDs(c); allowed != nil {
		ok := false
		for _, id := range allowed {
			ok = ok || id == p.BusinessID
		}
		if !ok {
			c.JSON(http.StatusForbidden, gin.H{"error": "bukan bisnis Anda"})
			return
		}
	}
	database.DB.Create(&p)
	audit(c, "create", "project", p.ID)
	c.JSON(http.StatusOK, decorateProjects(c, []models.Project{p})[0])
}

func UpdateProject(c *gin.Context) {
	p, ok := loadProject(c)
	if !ok {
		return
	}
	if !projectManageable(c, p) {
		c.JSON(http.StatusForbidden, gin.H{"error": "hanya penanggung jawab, atasannya, atau admin yang dapat mengubah proyek"})
		return
	}
	var in projectInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "data tidak valid"})
		return
	}
	if msg := fillProject(c, in, &p, false); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	database.DB.Save(&p)
	audit(c, "update", "project", p.ID)
	c.JSON(http.StatusOK, decorateProjects(c, []models.Project{p})[0])
}

func DeleteProject(c *gin.Context) {
	p, ok := loadProject(c)
	if !ok {
		return
	}
	if !projectManageable(c, p) {
		c.JSON(http.StatusForbidden, gin.H{"error": "tidak berwenang menghapus proyek ini"})
		return
	}
	var n int64
	database.DB.Model(&models.Task{}).Where("project_id = ?", p.ID).Count(&n)
	if n > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": fmt.Sprintf("proyek masih memiliki %d tugas; hapus atau pindahkan tugasnya dulu", n)})
		return
	}
	var docs []models.ProjectDocument
	database.DB.Where("project_id = ?", p.ID).Find(&docs)
	database.DB.Where("project_id = ?", p.ID).Delete(&models.ProjectDocument{})
	database.DB.Delete(&p)
	for _, d := range docs {
		Store.Remove(d.LocalPath)
	}
	audit(c, "delete", "project", p.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// GetProject: the project plus its top-level work packages (the WBS roots) with their weights.
func GetProject(c *gin.Context) {
	p, ok := loadProject(c)
	if !ok {
		return
	}
	view := decorateProjects(c, []models.Project{p})[0]
	calc := calcFor(p.BusinessID)
	var top []models.Task
	sum := 0.0
	for _, id := range calc.topLevel(p.ID) {
		t := calc.tasks[id]
		top = append(top, t)
		if t.Weight != nil {
			sum += *t.Weight
		}
	}
	c.JSON(http.StatusOK, gin.H{"project": view, "top_level": decorateTasks(c, top, map[uint]*taskCalc{p.BusinessID: calc}), "weight_sum": sum})
}

// SetProjectWeights stores the "bobot" of the top-level tasks (null clears it).
func SetProjectWeights(c *gin.Context) {
	p, ok := loadProject(c)
	if !ok {
		return
	}
	if !projectManageable(c, p) {
		c.JSON(http.StatusForbidden, gin.H{"error": "tidak berwenang mengubah bobot"})
		return
	}
	var in struct {
		Weights []struct {
			TaskID uint     `json:"task_id"`
			Weight *float64 `json:"weight"`
		} `json:"weights"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "data tidak valid"})
		return
	}
	calc := calcFor(p.BusinessID)
	top := map[uint]bool{}
	for _, id := range calc.topLevel(p.ID) {
		top[id] = true
	}
	for _, w := range in.Weights {
		if !top[w.TaskID] {
			c.JSON(http.StatusBadRequest, gin.H{"error": "bobot hanya untuk tugas induk tingkat teratas proyek ini"})
			return
		}
		if w.Weight != nil && (*w.Weight <= 0 || *w.Weight > 100) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "bobot harus antara 0 dan 100"})
			return
		}
	}
	database.DB.Transaction(func(tx *gorm.DB) error {
		for _, w := range in.Weights {
			tx.Model(&models.Task{}).Where("id = ?", w.TaskID).Update("weight", w.Weight)
		}
		return nil
	})
	audit(c, "weights", "project", p.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ProjectCurve: Kurva-S (planned vs actual cumulative progress, weekly).
func ProjectCurve(c *gin.Context) {
	p, ok := loadProject(c)
	if !ok {
		return
	}
	calc := calcFor(p.BusinessID)
	progress, _, _ := calc.projectProgress(p.ID)
	pts, ok := calc.projectCurve(p, time.Now())
	if !ok {
		c.JSON(http.StatusOK, gin.H{"ok": false, "points": []curvePoint{}, "progress": progress})
		return
	}
	// deviation at the latest point that has an actual value
	var plan, actual float64
	for _, pt := range pts {
		if pt.Actual != nil {
			plan, actual = pt.Plan, *pt.Actual
		}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "points": pts, "progress": progress, "plan_now": plan, "actual_now": actual, "deviation": actual - plan})
}

// ---- documents ----

func ListProjectDocuments(c *gin.Context) {
	p, ok := loadProject(c)
	if !ok {
		return
	}
	l := []models.ProjectDocument{}
	database.DB.Where("project_id = ?", p.ID).Order("id").Find(&l)
	c.JSON(http.StatusOK, l)
}

func UploadProjectDocument(c *gin.Context) {
	p, ok := loadProject(c)
	if !ok {
		return
	}
	label := strings.TrimSpace(c.PostForm("label"))
	if label == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "jenis/nama dokumen wajib diisi"})
		return
	}
	fh, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file wajib dipilih"})
		return
	}
	mime, st, msg := checkUpload(fh)
	if st != 0 {
		c.JSON(st, gin.H{"error": msg})
		return
	}
	rel, size, err := saveUpload(fh, fmt.Sprintf("projects/%d", p.ID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "gagal menyimpan file"})
		return
	}
	d := models.ProjectDocument{ProjectID: p.ID, Label: label, FileName: fh.Filename, MimeType: mime, Size: size, LocalPath: rel, DriveStatus: "pending"}
	database.DB.Create(&d)
	audit(c, "upload", "project_document", d.ID)
	c.JSON(http.StatusOK, d)
}

func DownloadProjectDocument(c *gin.Context) {
	p, ok := loadProject(c)
	if !ok {
		return
	}
	var d models.ProjectDocument
	if database.DB.Where("id = ? AND project_id = ?", c.Param("did"), p.ID).Limit(1).Find(&d).Error != nil || d.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "dokumen tidak ditemukan"})
		return
	}
	c.Header("Content-Type", d.MimeType)
	c.Header("Content-Disposition", fmt.Sprintf(`inline; filename=%q`, d.FileName))
	c.Header("X-Content-Type-Options", "nosniff")
	c.File(Store.Abs(d.LocalPath))
}

func DeleteProjectDocument(c *gin.Context) {
	p, ok := loadProject(c)
	if !ok {
		return
	}
	if !projectManageable(c, p) {
		c.JSON(http.StatusForbidden, gin.H{"error": "hanya penanggung jawab proyek atau admin yang dapat menghapus dokumen"})
		return
	}
	var d models.ProjectDocument
	if database.DB.Where("id = ? AND project_id = ?", c.Param("did"), p.ID).Limit(1).Find(&d).Error != nil || d.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "dokumen tidak ditemukan"})
		return
	}
	database.DB.Delete(&d)
	Store.Remove(d.LocalPath)
	audit(c, "delete", "project_document", d.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

package handlers

import (
	"net/http"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
)

// ---- Units ----
func ListUnits(c *gin.Context) {
	var l []models.OrgUnit
	scopeBusiness(c, database.DB, "business_id").Preload("Parent").Order("level, id").Find(&l)
	c.JSON(http.StatusOK, l)
}
func SaveUnit(c *gin.Context) {
	var in models.OrgUnit
	if err := c.ShouldBindJSON(&in); err != nil || in.Name == "" || in.Level < 1 || in.Level > 10 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name wajib, level 1–10"})
		return
	}
	in.ID = paramID(c)
	in.Parent = nil
	if in.ID == 0 {
		in.IsActive = true
	}
	if err := database.DB.Save(&in).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	audit(c, "save", "org_unit", in.ID)
	c.JSON(http.StatusOK, in)
}
func DeleteUnit(c *gin.Context) {
	id := paramID(c)
	var kids int64
	database.DB.Model(&models.OrgUnit{}).Where("parent_id = ?", id).Count(&kids)
	if kids > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "unit masih memiliki sub-unit"})
		return
	}
	database.DB.Delete(&models.OrgUnit{}, id)
	audit(c, "delete", "org_unit", id)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ---- Positions ----
func ListPositions(c *gin.Context) {
	var l []models.Position
	scopeBusiness(c, database.DB, "business_id").Preload("Unit").Order("id").Find(&l)
	// attach holders
	type row struct {
		models.Position
		Holder string `json:"holder"`
	}
	holders := map[uint]string{}
	var emps []models.Employee
	database.DB.Select("id,name,position_id").Where("position_id IS NOT NULL").Find(&emps)
	for _, e := range emps {
		holders[*e.PositionID] = e.Name
	}
	// additional (multi-business) placements also fill a position
	type pl struct {
		PositionID uint
		Name       string
	}
	var pls []pl
	database.DB.Raw("SELECT p.position_id, e.name FROM employee_placements p JOIN employees e ON e.id = p.employee_id").Scan(&pls)
	for _, x := range pls {
		holders[x.PositionID] = x.Name
	}
	out := make([]row, 0, len(l))
	for _, p := range l {
		h := holders[p.ID]
		if h == "" {
			h = "Vacant"
		}
		out = append(out, row{p, h})
	}
	c.JSON(http.StatusOK, out)
}
func SavePosition(c *gin.Context) {
	var in models.Position
	if err := c.ShouldBindJSON(&in); err != nil || in.Title == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "title wajib"})
		return
	}
	in.ID = paramID(c)
	in.Unit = nil
	if in.ReportsToID != nil && *in.ReportsToID == in.ID && in.ID != 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "posisi tidak boleh melapor ke dirinya sendiri"})
		return
	}
	database.DB.Save(&in)
	audit(c, "save", "position", in.ID)
	c.JSON(http.StatusOK, in)
}
func DeletePosition(c *gin.Context) {
	id := paramID(c)
	var n int64
	database.DB.Raw("SELECT (SELECT COUNT(*) FROM employees WHERE position_id = ?) + (SELECT COUNT(*) FROM employee_placements WHERE position_id = ?)", id, id).Scan(&n)
	if n > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "posisi masih terisi karyawan"})
		return
	}
	database.DB.Delete(&models.Position{}, id)
	audit(c, "delete", "position", id)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ---- Locations ----
func ListLocations(c *gin.Context) {
	var l []models.Location
	scopeBusiness(c, database.DB, "business_id").Order("id").Find(&l)
	c.JSON(http.StatusOK, l)
}
func SaveLocation(c *gin.Context) {
	var in models.Location
	if err := c.ShouldBindJSON(&in); err != nil || in.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name wajib"})
		return
	}
	in.ID = paramID(c)
	if in.ID == 0 {
		in.IsActive = true
	}
	if in.RadiusM == 0 {
		in.RadiusM = 100
	}
	database.DB.Save(&in)
	audit(c, "save", "location", in.ID)
	c.JSON(http.StatusOK, in)
}
func DeleteLocation(c *gin.Context) {
	id := paramID(c)
	database.DB.Delete(&models.Location{}, id)
	audit(c, "delete", "location", id)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

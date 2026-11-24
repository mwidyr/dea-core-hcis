package handlers

import (
	"fmt"
	"net/http"
	"time"

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
		Holder       string `json:"holder"`
		HolderID     uint   `json:"holder_id,omitempty"`
		HolderAvatar int64  `json:"holder_avatar,omitempty"`
		HolderNote   string `json:"holder_note,omitempty"` // e.g. "habis kontrak -10 hari"
	}
	type who struct {
		PositionID uint
		ID         uint
		Name       string
		End        *time.Time
		Avatar     int64
		Has        bool
	}
	holders := map[uint]who{}
	// only people whose status is "Tidak Bekerja" leave the chart; an ended contract stays visible with a note.
	// Extra (multi-business) placements also fill a position.
	var ws []who
	database.DB.Raw(`SELECT e.position_id, e.id, e.name, e.contract_end AS "end", e.avatar_at AS avatar, (e.avatar_path <> '') AS has FROM employees e WHERE e.position_id IS NOT NULL AND e.status = 'Aktif'
		UNION ALL
		SELECT p.position_id, e.id, e.name, e.contract_end, e.avatar_at, (e.avatar_path <> '') FROM employee_placements p JOIN employees e ON e.id = p.employee_id WHERE e.status = 'Aktif'`).Scan(&ws)
	for _, w := range ws {
		holders[w.PositionID] = w
	}
	// non group-level callers only learn the holder when that person is themself or in their downline
	var visible map[string]bool
	if !seesAll(c) {
		visible = map[string]bool{}
		var names []string
		hierarchyScope(c, database.DB.Model(&models.Employee{})).Pluck("employees.name", &names)
		for _, n := range names {
			visible[n] = true
		}
	}
	out := make([]row, 0, len(l))
	for _, p := range l {
		w, filled := holders[p.ID]
		r := row{Position: p, Holder: "Vacant"}
		switch {
		case !filled:
		case visible != nil && !visible[w.Name]:
			r.Holder = "-"
		default:
			r.Holder, r.HolderID = w.Name, w.ID
			if w.Has {
				r.HolderAvatar = w.Avatar
			}
			if w.End != nil && day(*w.End).Before(today()) {
				r.HolderNote = fmt.Sprintf("habis kontrak -%d hari", int(today().Sub(day(*w.End)).Hours()/24))
			}
		}
		out = append(out, r)
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

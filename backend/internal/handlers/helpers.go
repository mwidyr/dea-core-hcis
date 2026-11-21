package handlers

import (
	"strconv"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func uid(c *gin.Context) uint    { v, _ := c.Get("user_id"); u, _ := v.(uint); return u }
func role(c *gin.Context) string { v, _ := c.Get("role"); s, _ := v.(string); return s }

// isGroupLevel roles may see every business ("Semua Bisnis").
func isGroupLevel(c *gin.Context) bool { r := role(c); return r == "super_admin" || r == "hr_admin" }

// seesAll: roles that may READ every business and person (group-level + Komisaris). Write powers stay with isGroupLevel.
func seesAll(c *gin.Context) bool { return isGroupLevel(c) || role(c) == "komisaris" }

// topLevelClasses are the "Direksi" / "Komisaris" positions: no attendance and no approvals of their own.
var topLevelClasses = []string{"Direksi", "Komisaris"}

func noAttendanceClass(levelClass string) bool {
	for _, c := range topLevelClasses {
		if c == levelClass {
			return true
		}
	}
	return false
}

// noAttendanceSQL keeps Direksi / Komisaris out of attendance lists, recaps and scores (they have no approver, so no attendance to approve).
const noAttendanceSQL = "employees.id NOT IN (SELECT e.id FROM employees e JOIN positions p ON p.id = e.position_id WHERE p.level_class IN ('Direksi','Komisaris'))"

// isDirekturEmployee: does the employee hold a Direksi position (the only people a Komisaris may assign work to)?
func isDirekturEmployee(empID uint) bool {
	var n int64
	database.DB.Raw(`SELECT COUNT(*) FROM employees e JOIN positions p ON p.id = e.position_id WHERE e.id = ? AND p.level_class = 'Direksi'`, empID).Scan(&n)
	return n > 0
}

// allowedBusinessIDs returns nil for users who see every business (no restriction).
func allowedBusinessIDs(c *gin.Context) []uint {
	if seesAll(c) {
		return nil
	}
	var ids []uint
	database.DB.Table("user_businesses").Where("user_id = ?", uid(c)).Pluck("business_id", &ids)
	if ids == nil {
		ids = []uint{}
	}
	return ids
}

// scopeBusiness limits a query to the requested business_id (if permitted) or all permitted ones.
func scopeBusiness(c *gin.Context, q *gorm.DB, col string) *gorm.DB {
	allowed := allowedBusinessIDs(c)
	if b, _ := strconv.Atoi(c.Query("business_id")); b > 0 {
		if allowed != nil {
			ok := false
			for _, id := range allowed {
				if id == uint(b) {
					ok = true
				}
			}
			if !ok {
				return q.Where("1 = 0")
			}
		}
		return q.Where(col+" = ?", b)
	}
	if allowed != nil {
		return q.Where(col+" IN ?", allowed)
	}
	return q
}

func audit(c *gin.Context, action, entity string, id uint) {
	database.DB.Create(&models.AuditLog{UserID: uid(c), Action: action, Entity: entity, EntityID: strconv.Itoa(int(id))})
}

func paramID(c *gin.Context) uint { n, _ := strconv.Atoi(c.Param("id")); return uint(n) }

// maxAllRows caps a list requested with page_size=0 ("tampilkan semua") so one request cannot pull an unbounded table.
const maxAllRows = 5000

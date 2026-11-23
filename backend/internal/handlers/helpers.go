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

// seesAll: roles that may READ every person inside the businesses they can open (group-level + Komisaris). Business access itself is
// limited by allowedBusinessIDs; write powers stay with isGroupLevel.
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

// businessAllowed: may the caller open this business? Only super admin / HR admin reach every business; everybody else
// (Komisaris, Direktur, Manager, Leader, Karyawan) only the businesses on their account (more than one = multi-business).
func businessAllowed(c *gin.Context, bizID uint) bool {
	ids := allowedBusinessIDs(c)
	if ids == nil {
		return true
	}
	for _, id := range ids {
		if id == bizID {
			return true
		}
	}
	return false
}

// allowedBusinessIDs returns nil only for group-level users (super admin, HR admin); others get the businesses on their account.
func allowedBusinessIDs(c *gin.Context) []uint {
	if isGroupLevel(c) {
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

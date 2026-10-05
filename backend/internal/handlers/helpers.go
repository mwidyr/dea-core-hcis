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

// allowedBusinessIDs returns nil for group-level users (no restriction).
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

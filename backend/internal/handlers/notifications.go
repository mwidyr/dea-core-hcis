package handlers

import (
	"net/http"
	"strconv"
	"time"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm/clause"
)

// notify creates a notification; with a refKey it is idempotent per user. Returns true when a new row was created.
func notify(userID uint, kind, title, body, link, refKey string) bool {
	n := models.Notification{UserID: userID, Kind: kind, Title: title, Body: body, Link: link}
	if refKey != "" {
		n.RefKey = &refKey
	}
	res := database.DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&n)
	return res.RowsAffected > 0
}

func ListNotifications(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "30"))
	if limit < 1 || limit > 100 {
		limit = 30
	}
	l := []models.Notification{}
	database.DB.Where("user_id = ?", uid(c)).Order("id DESC").Limit(limit).Find(&l)
	var unread int64
	database.DB.Model(&models.Notification{}).Where("user_id = ? AND read_at IS NULL", uid(c)).Count(&unread)
	c.JSON(http.StatusOK, gin.H{"data": l, "unread": unread})
}

func MarkNotificationRead(c *gin.Context) {
	now := time.Now()
	database.DB.Model(&models.Notification{}).Where("id = ? AND user_id = ? AND read_at IS NULL", paramID(c), uid(c)).Update("read_at", now)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func MarkAllNotificationsRead(c *gin.Context) {
	database.DB.Model(&models.Notification{}).Where("user_id = ? AND read_at IS NULL", uid(c)).Update("read_at", time.Now())
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

package handlers

import (
	"fmt"
	"net/http"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
)

// canViewRosterAdjustment: the employee it is for, their superiors, anyone on its approval chain, and group-level roles.
func canViewRosterAdjustment(c *gin.Context, a models.RosterAdjustment) bool {
	if isGroupLevel(c) {
		return true
	}
	if me := myEmployeeID(c); me != nil && (*me == a.EmployeeID || inDownline(*me, a.EmployeeID)) {
		return true
	}
	if a.ApprovalID != nil {
		var n int64
		database.DB.Model(&models.ApprovalStep{}).Where("request_id = ? AND approver_user_id = ?", *a.ApprovalID, uid(c)).Count(&n)
		return n > 0
	}
	return false
}

func loadViewableAdjustment(c *gin.Context) (models.RosterAdjustment, bool) {
	var a models.RosterAdjustment
	if database.DB.Limit(1).Find(&a, paramID(c)).Error != nil || a.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "pengajuan tidak ditemukan"})
		return a, false
	}
	if !canViewRosterAdjustment(c, a) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Anda tidak berhak melihat lampiran ini"})
		return a, false
	}
	return a, true
}

func ListRosterAttachments(c *gin.Context) {
	a, ok := loadViewableAdjustment(c)
	if !ok {
		return
	}
	l := []models.RosterAdjustmentAttachment{}
	database.DB.Where("roster_adjustment_id = ?", a.ID).Order("id").Find(&l)
	c.JSON(http.StatusOK, l)
}

func DownloadRosterAttachment(c *gin.Context) {
	a, ok := loadViewableAdjustment(c)
	if !ok {
		return
	}
	var f models.RosterAdjustmentAttachment
	if database.DB.Where("id = ? AND roster_adjustment_id = ?", c.Param("aid"), a.ID).Limit(1).Find(&f).Error != nil || f.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "lampiran tidak ditemukan"})
		return
	}
	c.Header("Content-Type", f.MimeType)
	c.Header("Content-Disposition", fmt.Sprintf(`inline; filename=%q`, f.FileName))
	c.Header("X-Content-Type-Options", "nosniff")
	c.File(Store.Abs(f.LocalPath))
}

// DeleteRosterAttachment: requester or HR, while the request is still pending. Attachments are never mandatory.
func DeleteRosterAttachment(c *gin.Context) {
	a, ok := loadViewableAdjustment(c)
	if !ok {
		return
	}
	me := myEmployeeID(c)
	if !isGroupLevel(c) && (me == nil || *me != a.EmployeeID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "hanya pemohon yang dapat menghapus lampiran"})
		return
	}
	if a.Status != "Pending Approval" {
		c.JSON(http.StatusConflict, gin.H{"error": "lampiran tidak dapat dihapus setelah pengajuan diputuskan"})
		return
	}
	var f models.RosterAdjustmentAttachment
	if database.DB.Where("id = ? AND roster_adjustment_id = ?", c.Param("aid"), a.ID).Limit(1).Find(&f).Error != nil || f.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "lampiran tidak ditemukan"})
		return
	}
	database.DB.Delete(&f)
	Store.Remove(f.LocalPath)
	audit(c, "delete", "roster_attachment", f.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

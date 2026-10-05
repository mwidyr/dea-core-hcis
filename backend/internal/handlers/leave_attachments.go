package handlers

import (
	"fmt"
	"net/http"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
)

// loadViewableLeave loads the request and checks the caller may see it (requester, superiors, approvers, HR).
func loadViewableLeave(c *gin.Context) (models.LeaveRequest, bool) {
	var lr models.LeaveRequest
	if database.DB.Limit(1).Find(&lr, paramID(c)).Error != nil || lr.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "pengajuan tidak ditemukan"})
		return lr, false
	}
	if !canViewLeave(c, lr) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Anda tidak berhak melihat lampiran ini"})
		return lr, false
	}
	return lr, true
}

func ListLeaveAttachments(c *gin.Context) {
	lr, ok := loadViewableLeave(c)
	if !ok {
		return
	}
	l := []models.LeaveAttachment{}
	database.DB.Where("leave_request_id = ?", lr.ID).Order("id").Find(&l)
	c.JSON(http.StatusOK, l)
}

// UploadLeaveAttachment lets the requester (or HR) add a document while the request is still pending.
func UploadLeaveAttachment(c *gin.Context) {
	lr, ok := loadViewableLeave(c)
	if !ok {
		return
	}
	me := myEmployeeID(c)
	if !isGroupLevel(c) && (me == nil || *me != lr.EmployeeID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "hanya pemohon yang dapat menambah lampiran"})
		return
	}
	if lr.Status != "Pending Approval" {
		c.JSON(http.StatusConflict, gin.H{"error": "lampiran hanya dapat ditambah selama pengajuan menunggu persetujuan"})
		return
	}
	var n int64
	database.DB.Model(&models.LeaveAttachment{}).Where("leave_request_id = ?", lr.ID).Count(&n)
	if n >= 10 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "maksimal 10 lampiran"})
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
	rel, size, err := saveUpload(fh, fmt.Sprintf("leave/%d", lr.ID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "gagal menyimpan file"})
		return
	}
	a := models.LeaveAttachment{LeaveRequestID: lr.ID, FileName: fh.Filename, MimeType: mime, Size: size, LocalPath: rel, DriveStatus: "pending"}
	database.DB.Create(&a)
	audit(c, "upload", "leave_attachment", a.ID)
	c.JSON(http.StatusOK, a)
}

func DownloadLeaveAttachment(c *gin.Context) {
	lr, ok := loadViewableLeave(c)
	if !ok {
		return
	}
	var a models.LeaveAttachment
	if database.DB.Where("id = ? AND leave_request_id = ?", c.Param("aid"), lr.ID).Limit(1).Find(&a).Error != nil || a.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "lampiran tidak ditemukan"})
		return
	}
	c.Header("Content-Type", a.MimeType)
	c.Header("Content-Disposition", fmt.Sprintf(`inline; filename=%q`, a.FileName))
	c.Header("X-Content-Type-Options", "nosniff")
	c.File(Store.Abs(a.LocalPath))
}

func DeleteLeaveAttachment(c *gin.Context) {
	lr, ok := loadViewableLeave(c)
	if !ok {
		return
	}
	me := myEmployeeID(c)
	if !isGroupLevel(c) && (me == nil || *me != lr.EmployeeID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "hanya pemohon yang dapat menghapus lampiran"})
		return
	}
	if lr.Status != "Pending Approval" {
		c.JSON(http.StatusConflict, gin.H{"error": "lampiran tidak dapat dihapus setelah pengajuan diputuskan"})
		return
	}
	var a models.LeaveAttachment
	if database.DB.Where("id = ? AND leave_request_id = ?", c.Param("aid"), lr.ID).Limit(1).Find(&a).Error != nil || a.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "lampiran tidak ditemukan"})
		return
	}
	var lt models.LeaveType
	database.DB.Limit(1).Find(&lt, lr.TypeID)
	var n int64
	database.DB.Model(&models.LeaveAttachment{}).Where("leave_request_id = ?", lr.ID).Count(&n)
	if lt.RequiresAttachment && n <= 1 {
		c.JSON(http.StatusConflict, gin.H{"error": "jenis ini wajib memiliki minimal satu lampiran"})
		return
	}
	database.DB.Delete(&a)
	Store.Remove(a.LocalPath)
	audit(c, "delete", "leave_attachment", a.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

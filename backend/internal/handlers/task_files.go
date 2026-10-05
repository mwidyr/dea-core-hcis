package handlers

import (
	"fmt"
	"net/http"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
)

// Result files of a task. Viewable by everyone who can see the task (incl. its approvers, who validate the result);
// uploadable by the PIC, members and managers until the task is closed.

func canWorkOnFiles(c *gin.Context, t models.Task) bool {
	r := rolesOn(c, t)
	if r.Manager || r.PIC {
		return true
	}
	if me := myEmployeeID(c); me != nil {
		var n int64
		database.DB.Model(&models.TaskMember{}).Where("task_id = ? AND employee_id = ? AND role = 'member'", t.ID, *me).Count(&n)
		return n > 0
	}
	return false
}

func ListTaskAttachments(c *gin.Context) {
	t, ok := loadTask(c)
	if !ok {
		return
	}
	l := []models.TaskAttachment{}
	database.DB.Where("task_id = ?", t.ID).Order("id").Find(&l)
	c.JSON(http.StatusOK, l)
}

func UploadTaskAttachment(c *gin.Context) {
	t, ok := loadTask(c)
	if !ok {
		return
	}
	if !canWorkOnFiles(c, t) {
		c.JSON(http.StatusForbidden, gin.H{"error": "hanya PIC, anggota, atau pemberi tugas yang dapat melampirkan hasil"})
		return
	}
	if t.Status == "done" {
		c.JSON(http.StatusConflict, gin.H{"error": "tugas sudah selesai; buka kembali untuk menambah lampiran"})
		return
	}
	var n int64
	database.DB.Model(&models.TaskAttachment{}).Where("task_id = ?", t.ID).Count(&n)
	if n >= 20 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "maksimal 20 lampiran per tugas"})
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
	rel, size, err := saveUpload(fh, fmt.Sprintf("tasks/%d", t.ID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "gagal menyimpan file"})
		return
	}
	a := models.TaskAttachment{TaskID: t.ID, FileName: fh.Filename, MimeType: mime, Size: size, LocalPath: rel, DriveStatus: "pending"}
	database.DB.Create(&a)
	audit(c, "upload", "task_attachment", a.ID)
	c.JSON(http.StatusOK, a)
}

func DownloadTaskAttachment(c *gin.Context) {
	t, ok := loadTask(c)
	if !ok {
		return
	}
	var a models.TaskAttachment
	if database.DB.Where("id = ? AND task_id = ?", c.Param("aid"), t.ID).Limit(1).Find(&a).Error != nil || a.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "lampiran tidak ditemukan"})
		return
	}
	c.Header("Content-Type", a.MimeType)
	c.Header("Content-Disposition", fmt.Sprintf(`inline; filename=%q`, a.FileName))
	c.Header("X-Content-Type-Options", "nosniff")
	c.File(Store.Abs(a.LocalPath))
}

func DeleteTaskAttachment(c *gin.Context) {
	t, ok := loadTask(c)
	if !ok {
		return
	}
	if !canWorkOnFiles(c, t) {
		c.JSON(http.StatusForbidden, gin.H{"error": "tidak berwenang menghapus lampiran"})
		return
	}
	if t.Status == "done" || t.Status == "review" {
		c.JSON(http.StatusConflict, gin.H{"error": "lampiran tidak dapat dihapus setelah tugas diajukan atau selesai"})
		return
	}
	var a models.TaskAttachment
	if database.DB.Where("id = ? AND task_id = ?", c.Param("aid"), t.ID).Limit(1).Find(&a).Error != nil || a.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "lampiran tidak ditemukan"})
		return
	}
	database.DB.Delete(&a)
	Store.Remove(a.LocalPath)
	audit(c, "delete", "task_attachment", a.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

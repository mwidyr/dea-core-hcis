package handlers

import (
	"fmt"
	"mime/multipart"
	"net/http"
	"time"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
)

const maxAvatar = 2 << 20 // 2 MB

var avatarMime = map[string]bool{"image/jpeg": true, "image/png": true, "image/webp": true}

// checkAvatar validates a profile photo (JPG / PNG / WEBP, max 2 MB). On failure it answers the request and returns "".
func checkAvatar(c *gin.Context, fh *multipart.FileHeader) string {
	if fh.Size > maxAvatar {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "foto maksimal 2 MB"})
		return ""
	}
	mime, st, msg := checkUpload(fh)
	if st != 0 {
		c.JSON(st, gin.H{"error": msg})
		return ""
	}
	if !avatarMime[mime] {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"error": "foto harus berformat JPG, PNG, atau WEBP"})
		return ""
	}
	return mime
}

// canEditPhoto: the employee themself, HR admin and super admin.
func canEditPhoto(c *gin.Context, empID uint) bool {
	if isGroupLevel(c) {
		return true
	}
	me := myEmployeeID(c)
	return me != nil && *me == empID
}

func putEmployeePhoto(c *gin.Context, empID uint) {
	var emp models.Employee
	if database.DB.Select("id, avatar_path").Limit(1).Find(&emp, empID).Error != nil || emp.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "karyawan tidak ditemukan"})
		return
	}
	fh, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "pilih foto"})
		return
	}
	mime := checkAvatar(c, fh)
	if mime == "" {
		return
	}
	rel, _, err := saveUpload(fh, fmt.Sprintf("avatars/emp-%d", emp.ID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "gagal menyimpan foto"})
		return
	}
	at := time.Now().Unix()
	database.DB.Model(&models.Employee{}).Where("id = ?", emp.ID).Updates(map[string]any{"avatar_path": rel, "avatar_mime": mime, "avatar_at": at})
	if emp.AvatarPath != "" {
		Store.Remove(emp.AvatarPath)
	}
	audit(c, "photo", "employee", emp.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true, "avatar": at})
}

func removeEmployeePhoto(c *gin.Context, empID uint) {
	var emp models.Employee
	database.DB.Select("id, avatar_path").Limit(1).Find(&emp, empID)
	if emp.ID != 0 && emp.AvatarPath != "" {
		Store.Remove(emp.AvatarPath)
		database.DB.Model(&models.Employee{}).Where("id = ?", emp.ID).Updates(map[string]any{"avatar_path": "", "avatar_mime": "", "avatar_at": 0})
		audit(c, "photo_remove", "employee", emp.ID)
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// UploadEmployeeAvatar / DeleteEmployeeAvatar: set or remove an employee's photo (that employee, HR admin or super admin).
func UploadEmployeeAvatar(c *gin.Context) {
	if !canEditPhoto(c, paramID(c)) {
		c.JSON(http.StatusForbidden, gin.H{"error": "foto hanya dapat diubah oleh karyawan itu sendiri, HR, atau admin"})
		return
	}
	putEmployeePhoto(c, paramID(c))
}

func DeleteEmployeeAvatar(c *gin.Context) {
	if !canEditPhoto(c, paramID(c)) {
		c.JSON(http.StatusForbidden, gin.H{"error": "foto hanya dapat diubah oleh karyawan itu sendiri, HR, atau admin"})
		return
	}
	removeEmployeePhoto(c, paramID(c))
}

// UploadMyAvatar: the signed-in user sets their own photo. A linked account changes the employee's photo; an
// account without an employee record (e.g. the super admin login) keeps it on the account.
func UploadMyAvatar(c *gin.Context) {
	if me := myEmployeeID(c); me != nil {
		putEmployeePhoto(c, *me)
		return
	}
	fh, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "pilih foto"})
		return
	}
	mime := checkAvatar(c, fh)
	if mime == "" {
		return
	}
	var u models.User
	database.DB.Limit(1).Find(&u, uid(c))
	rel, _, err := saveUpload(fh, fmt.Sprintf("avatars/%d", uid(c)))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "gagal menyimpan foto"})
		return
	}
	old := u.AvatarPath
	at := time.Now().Unix()
	database.DB.Model(&u).Updates(map[string]any{"avatar_path": rel, "avatar_mime": mime, "avatar_at": at})
	if old != "" {
		Store.Remove(old)
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "avatar": at})
}

func DeleteMyAvatar(c *gin.Context) {
	if me := myEmployeeID(c); me != nil {
		removeEmployeePhoto(c, *me)
		return
	}
	var u models.User
	database.DB.Limit(1).Find(&u, uid(c))
	if u.ID != 0 && u.AvatarPath != "" {
		Store.Remove(u.AvatarPath)
		database.DB.Model(&u).Updates(map[string]any{"avatar_path": "", "avatar_mime": "", "avatar_at": 0})
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// EmployeeAvatar serves an employee's photo (any signed-in user: it appears on lists and boards).
func EmployeeAvatar(c *gin.Context) {
	var e models.Employee
	database.DB.Select("id, avatar_path, avatar_mime").Where("id = ? AND avatar_path <> ''", paramID(c)).Limit(1).Find(&e)
	if e.ID == 0 {
		c.Status(http.StatusNotFound)
		return
	}
	c.Header("Content-Type", e.AvatarMime)
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cache-Control", "private, max-age=300")
	c.File(Store.Abs(e.AvatarPath))
}

// avatarFlags: employee id → photo version for employees who have a photo.
func avatarFlags(empIDs []uint) map[uint]int64 {
	out := map[uint]int64{}
	if len(empIDs) == 0 {
		return out
	}
	var es []models.Employee
	database.DB.Select("id, avatar_at").Where("id IN ? AND avatar_path <> ''", empIDs).Find(&es)
	for _, e := range es {
		out[e.ID] = e.AvatarAt
	}
	return out
}

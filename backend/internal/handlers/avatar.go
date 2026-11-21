package handlers

import (
	"fmt"
	"net/http"
	"time"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
)

const maxAvatar = 2 << 20 // 2 MB

var avatarMime = map[string]bool{"image/jpeg": true, "image/png": true, "image/webp": true}

// UploadMyAvatar: the signed-in user sets their own profile photo (JPG / PNG / WEBP, max 2 MB).
func UploadMyAvatar(c *gin.Context) {
	fh, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "pilih foto"})
		return
	}
	if fh.Size > maxAvatar {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "foto maksimal 2 MB"})
		return
	}
	mime, st, msg := checkUpload(fh)
	if st != 0 {
		c.JSON(st, gin.H{"error": msg})
		return
	}
	if !avatarMime[mime] {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"error": "foto harus berformat JPG, PNG, atau WEBP"})
		return
	}
	var u models.User
	database.DB.Limit(1).Find(&u, uid(c))
	if u.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "akun tidak ditemukan"})
		return
	}
	rel, _, err := saveUpload(fh, fmt.Sprintf("avatars/%d", u.ID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "gagal menyimpan foto"})
		return
	}
	old := u.AvatarPath
	database.DB.Model(&u).Updates(map[string]any{"avatar_path": rel, "avatar_mime": mime, "avatar_at": time.Now().Unix()})
	if old != "" {
		Store.Remove(old)
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func DeleteMyAvatar(c *gin.Context) {
	var u models.User
	database.DB.Limit(1).Find(&u, uid(c))
	if u.ID != 0 && u.AvatarPath != "" {
		Store.Remove(u.AvatarPath)
		database.DB.Model(&u).Updates(map[string]any{"avatar_path": "", "avatar_mime": "", "avatar_at": time.Now().Unix()})
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// EmployeeAvatar serves the photo of the account linked to an employee (any signed-in user; it is shown on boards and lists).
func EmployeeAvatar(c *gin.Context) {
	var u models.User
	database.DB.Where("employee_id = ? AND avatar_path <> ''", paramID(c)).Limit(1).Find(&u)
	if u.ID == 0 {
		c.Status(http.StatusNotFound)
		return
	}
	c.Header("Content-Type", u.AvatarMime)
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cache-Control", "private, max-age=300")
	c.File(Store.Abs(u.AvatarPath))
}

// avatarFlags: employee id → avatar version (unix time) for employees whose account has a photo.
func avatarFlags(empIDs []uint) map[uint]int64 {
	out := map[uint]int64{}
	if len(empIDs) == 0 {
		return out
	}
	var us []models.User
	database.DB.Select("employee_id, avatar_at").Where("employee_id IN ? AND avatar_path <> ''", empIDs).Find(&us)
	for _, u := range us {
		if u.EmployeeID != nil {
			out[*u.EmployeeID] = u.AvatarAt
		}
	}
	return out
}

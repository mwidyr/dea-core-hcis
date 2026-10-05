package handlers

import (
	"fmt"
	"mime/multipart"
	"net/http"
	"strings"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/dea-core/hcis/backend/internal/storage"
	"github.com/gin-gonic/gin"
)

// Store is set from main. Files are written locally first; Drive sync is a later job
// that flips drive_status pending → synced and fills drive_file_id.
var Store storage.Local

const maxUpload = 10 << 20 // 10 MB

var allowedMime = map[string]bool{"image/jpeg": true, "image/png": true, "image/webp": true, "image/gif": true, "application/pdf": true}

func ListEmployeeDocuments(c *gin.Context) {
	l := []models.EmployeeDocument{}
	database.DB.Where("employee_id = ?", paramID(c)).Order("id").Find(&l)
	c.JSON(http.StatusOK, l)
}

// UploadEmployeeDocument takes multipart: label (what the photo is) + file.
func UploadEmployeeDocument(c *gin.Context) {
	empID := paramID(c)
	if database.DB.First(&models.Employee{}, empID).Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "karyawan tidak ditemukan"})
		return
	}
	label := strings.TrimSpace(c.PostForm("label"))
	if label == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "jenis foto/dokumen wajib diisi"})
		return
	}
	fh, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file wajib dipilih"})
		return
	}
	if fh.Size > maxUpload {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "ukuran file maksimal 10 MB"})
		return
	}
	f, err := fh.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file tidak bisa dibaca"})
		return
	}
	defer f.Close()
	head := make([]byte, 512)
	n, _ := f.Read(head)
	mime := http.DetectContentType(head[:n]) // sniffed, not trusted from the client
	if !allowedMime[mime] {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"error": "hanya gambar (JPG/PNG/WEBP/GIF) atau PDF"})
		return
	}
	f.Seek(0, 0)
	rel, size, err := Store.Save(fmt.Sprintf("employees/%d", empID), fh.Filename, f)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "gagal menyimpan file"})
		return
	}
	doc := models.EmployeeDocument{EmployeeID: empID, Label: label, FileName: fh.Filename, MimeType: mime, Size: size, LocalPath: rel, DriveStatus: "pending"}
	database.DB.Create(&doc)
	audit(c, "upload", "employee_document", doc.ID)
	c.JSON(http.StatusOK, doc)
}

func DownloadEmployeeDocument(c *gin.Context) {
	var d models.EmployeeDocument
	if database.DB.Where("id = ? AND employee_id = ?", c.Param("docId"), paramID(c)).First(&d).Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "dokumen tidak ditemukan"})
		return
	}
	c.Header("Content-Type", d.MimeType)
	c.Header("Content-Disposition", fmt.Sprintf(`inline; filename=%q`, d.FileName))
	c.Header("X-Content-Type-Options", "nosniff")
	c.File(Store.Abs(d.LocalPath))
}

func DeleteEmployeeDocument(c *gin.Context) {
	var d models.EmployeeDocument
	if database.DB.Where("id = ? AND employee_id = ?", c.Param("docId"), paramID(c)).First(&d).Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "dokumen tidak ditemukan"})
		return
	}
	database.DB.Delete(&d)
	Store.Remove(d.LocalPath)
	audit(c, "delete", "employee_document", d.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// checkUpload validates size and (sniffed) type. It returns the detected MIME type, or an HTTP status + message.
func checkUpload(fh *multipart.FileHeader) (mime string, status int, msg string) {
	if fh.Size > maxUpload {
		return "", http.StatusRequestEntityTooLarge, fmt.Sprintf("\"%s\": ukuran file maksimal 10 MB", fh.Filename)
	}
	f, err := fh.Open()
	if err != nil {
		return "", http.StatusBadRequest, "file tidak bisa dibaca"
	}
	defer f.Close()
	head := make([]byte, 512)
	n, _ := f.Read(head)
	mime = http.DetectContentType(head[:n]) // sniffed, not trusted from the client
	if !allowedMime[mime] {
		return "", http.StatusUnsupportedMediaType, fmt.Sprintf("\"%s\": hanya gambar (JPG/PNG/WEBP/GIF) atau PDF", fh.Filename)
	}
	return mime, 0, ""
}

// saveUpload stores an already-checked upload under sub and returns its relative path and size.
func saveUpload(fh *multipart.FileHeader, sub string) (rel string, size int64, err error) {
	f, err := fh.Open()
	if err != nil {
		return
	}
	defer f.Close()
	return Store.Save(sub, fh.Filename, f)
}

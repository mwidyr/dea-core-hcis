package handlers

import (
	"net/http"
	"regexp"
	"strings"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

var codeRe = regexp.MustCompile(`^[A-Z0-9]{2,10}$`)

// SaveBusiness creates (POST) or renames (PUT) a business. A new business gets a root
// L1 "Management" unit so the org tree can be built straight away.
func SaveBusiness(c *gin.Context) {
	var in struct {
		Name string `json:"name"`
		Code string `json:"code"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "data tidak valid"})
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	in.Code = strings.ToUpper(strings.TrimSpace(in.Code))
	if in.Name == "" || !codeRe.MatchString(in.Code) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "nama wajib; kode 2–10 huruf/angka"})
		return
	}
	id := paramID(c)
	var dup int64
	database.DB.Model(&models.Business{}).Where("(name = ? OR code = ?) AND id <> ?", in.Name, in.Code, id).Count(&dup)
	if dup > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "nama atau kode bisnis sudah dipakai"})
		return
	}
	var b models.Business
	if id != 0 {
		if database.DB.First(&b, id).Error != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "bisnis tidak ditemukan"})
			return
		}
		b.Name, b.Code = in.Name, in.Code
		database.DB.Save(&b)
	} else {
		b = models.Business{Name: in.Name, Code: in.Code, IsActive: true}
		err := database.DB.Transaction(func(tx *gorm.DB) error {
			if err := tx.Create(&b).Error; err != nil {
				return err
			}
			if err := tx.Create(&models.OrgUnit{BusinessID: b.ID, Level: 1, TypeName: "Management", Name: "Management", IsActive: true}).Error; err != nil {
				return err
			}
			database.EnsureDefaultCalendar(tx, b.ID) // so employees of a new business have a schedule from day one
			return nil
		})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}
	audit(c, "save", "business", b.ID)
	c.JSON(http.StatusOK, b)
}

func DeleteBusiness(c *gin.Context) {
	id := paramID(c)
	var emps int64
	database.DB.Model(&models.Employee{}).Where("business_id = ?", id).Count(&emps)
	if emps > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "bisnis masih memiliki karyawan"})
		return
	}
	database.DB.Transaction(func(tx *gorm.DB) error {
		tx.Where("business_id = ?", id).Delete(&models.Position{})
		tx.Where("business_id = ?", id).Delete(&models.OrgUnit{})
		tx.Where("business_id = ?", id).Delete(&models.Location{})
		tx.Exec("DELETE FROM user_businesses WHERE business_id = ?", id)
		return tx.Delete(&models.Business{}, id).Error
	})
	audit(c, "delete", "business", id)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

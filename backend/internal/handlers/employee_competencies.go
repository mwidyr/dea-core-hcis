package handlers

import (
	"net/http"
	"strings"
	"time"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
)

var competencyKinds = map[string]bool{"Pendidikan": true, "Sertifikasi": true, "Pelatihan": true, "Pengalaman Kerja": true, "Skill": true}

func ListEmployeeCompetencies(c *gin.Context) {
	l := []models.EmployeeCompetency{}
	database.DB.Where("employee_id = ?", paramID(c)).Order("CASE WHEN end_year = 0 THEN 9999 ELSE end_year END DESC, start_year DESC, id DESC").Find(&l)
	c.JSON(http.StatusOK, l)
}

// SaveEmployeeCompetency creates (POST) or updates (PUT .../competencies/:cid) one entry.
func SaveEmployeeCompetency(c *gin.Context) {
	empID := paramID(c)
	if database.DB.First(&models.Employee{}, empID).Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "karyawan tidak ditemukan"})
		return
	}
	var in models.EmployeeCompetency
	if err := c.ShouldBindJSON(&in); err != nil || strings.TrimSpace(in.Name) == "" || !competencyKinds[in.Kind] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "jenis (Pendidikan, Sertifikasi, Pelatihan, Pengalaman Kerja, atau Skill) dan nama wajib diisi"})
		return
	}
	maxYear := time.Now().Year() + 20
	for _, y := range []int{in.StartYear, in.EndYear} {
		if y != 0 && (y < 1950 || y > maxYear) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "tahun tidak valid"})
			return
		}
	}
	if in.StartYear != 0 && in.EndYear != 0 && in.EndYear < in.StartYear {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tahun selesai tidak boleh sebelum tahun mulai"})
		return
	}
	row := models.EmployeeCompetency{EmployeeID: empID}
	if cid := c.Param("cid"); cid != "" {
		if database.DB.Where("id = ? AND employee_id = ?", cid, empID).First(&row).Error != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "data kompetensi tidak ditemukan"})
			return
		}
	}
	row.Kind, row.Name, row.Institution = in.Kind, strings.TrimSpace(in.Name), strings.TrimSpace(in.Institution)
	row.StartYear, row.EndYear, row.CertNo, row.Note = in.StartYear, in.EndYear, strings.TrimSpace(in.CertNo), strings.TrimSpace(in.Note)
	if err := database.DB.Save(&row).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	audit(c, "save", "employee_competency", row.ID)
	c.JSON(http.StatusOK, row)
}

func DeleteEmployeeCompetency(c *gin.Context) {
	res := database.DB.Where("id = ? AND employee_id = ?", c.Param("cid"), paramID(c)).Delete(&models.EmployeeCompetency{})
	if res.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "data kompetensi tidak ditemukan"})
		return
	}
	audit(c, "delete", "employee_competency", paramID(c))
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

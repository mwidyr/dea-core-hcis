package handlers

import (
	"net/http"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// AddPlacement gives an employee an additional placement in ANOTHER business.
// Rule: one position per business — never a second position inside a business they already belong to.
func AddPlacement(c *gin.Context) {
	var in struct {
		BusinessID uint `json:"business_id"`
		PositionID uint `json:"position_id"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.BusinessID == 0 || in.PositionID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bisnis dan jabatan wajib dipilih"})
		return
	}
	var emp models.Employee
	if database.DB.Limit(1).Find(&emp, paramID(c)).Error != nil || emp.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "karyawan tidak ditemukan"})
		return
	}
	var pos models.Position
	if database.DB.Limit(1).Find(&pos, in.PositionID).Error != nil || pos.ID == 0 || pos.BusinessID != in.BusinessID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "jabatan tidak sesuai dengan bisnis"})
		return
	}
	var already int64
	database.DB.Model(&models.EmployeePlacement{}).Where("employee_id = ? AND business_id = ?", emp.ID, in.BusinessID).Count(&already)
	if already > 0 || emp.BusinessID == in.BusinessID {
		c.JSON(http.StatusConflict, gin.H{"error": "karyawan sudah berada di bisnis ini; satu karyawan hanya boleh memiliki satu jabatan per bisnis"})
		return
	}
	var held int64
	database.DB.Raw(`SELECT (SELECT COUNT(*) FROM employees WHERE position_id = ? AND id <> ?) +
		(SELECT COUNT(*) FROM employee_placements WHERE position_id = ? AND employee_id <> ?)`, pos.ID, emp.ID, pos.ID, emp.ID).Scan(&held)
	if held > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "jabatan ini sudah dipegang karyawan lain"})
		return
	}
	pl := models.EmployeePlacement{EmployeeID: emp.ID, BusinessID: in.BusinessID, PositionID: pos.ID}
	if err := database.DB.Create(&pl).Error; err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "penempatan di bisnis ini sudah ada"})
		return
	}
	// the employee's login can now switch to that business
	database.DB.Exec(`INSERT INTO user_businesses (user_id, business_id)
		SELECT id, ? FROM users WHERE employee_id = ? AND NOT EXISTS
		(SELECT 1 FROM user_businesses ub WHERE ub.user_id = users.id AND ub.business_id = ?)`, in.BusinessID, emp.ID, in.BusinessID)
	audit(c, "add_placement", "employee", emp.ID)
	c.JSON(http.StatusOK, pl)
}

func RemovePlacement(c *gin.Context) {
	empID := paramID(c)
	var pl models.EmployeePlacement
	if database.DB.Where("id = ? AND employee_id = ?", c.Param("pid"), empID).Limit(1).Find(&pl).Error != nil || pl.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "penempatan tidak ditemukan"})
		return
	}
	if pl.IsPrimary {
		c.JSON(http.StatusBadRequest, gin.H{"error": "penempatan utama tidak dapat dihapus; ubah lewat Edit karyawan"})
		return
	}
	database.DB.Transaction(func(tx *gorm.DB) error {
		tx.Delete(&pl)
		tx.Exec(`DELETE FROM user_businesses WHERE business_id = ? AND user_id IN (SELECT id FROM users WHERE employee_id = ?)`, pl.BusinessID, empID)
		return nil
	})
	audit(c, "remove_placement", "employee", empID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

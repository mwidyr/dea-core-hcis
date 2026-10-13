package handlers

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// syncCurrentContract keeps employees.contract_start / contract_end equal to the employee's current contract
// (the one with the latest start date), so the dashboard, reports and the "kontrak berakhir" alerts keep working
// from those two columns. Permanent (Tetap) employees carry no contract dates.
func syncCurrentContract(tx *gorm.DB, empID uint) error {
	var e models.Employee
	if err := tx.Select("id", "employee_type").First(&e, empID).Error; err != nil {
		return err
	}
	upd := map[string]any{"contract_start": nil, "contract_end": nil}
	if e.EmployeeType != "Tetap" {
		var cur models.EmployeeContract
		if tx.Where("employee_id = ?", empID).Order("start_date DESC, id DESC").Limit(1).Find(&cur).Error == nil && cur.ID != 0 {
			upd["contract_start"], upd["contract_end"] = cur.StartDate, cur.EndDate
		}
	}
	return tx.Model(&models.Employee{}).Where("id = ?", empID).Updates(upd).Error
}

// fillDOH sets the derived Date of Hire + contract count used by the employee detail page.
func fillDOH(e *models.Employee) {
	var n int64
	database.DB.Model(&models.EmployeeContract{}).Where("employee_id = ?", e.ID).Count(&n)
	e.ContractCount = int(n)
	if e.JoinDate != nil {
		e.DOH = e.JoinDate
		return
	}
	var first models.EmployeeContract
	if database.DB.Where("employee_id = ?", e.ID).Order("start_date").Limit(1).Find(&first).Error == nil && first.ID != 0 {
		e.DOH = &first.StartDate
	}
}

func ListEmployeeContracts(c *gin.Context) {
	l := []models.EmployeeContract{}
	database.DB.Where("employee_id = ?", paramID(c)).Order("start_date DESC, id DESC").Find(&l)
	counts := contractDocCounts("employee_id = ?", paramID(c))
	for i := range l {
		l[i].DocCount = counts[l[i].ID]
	}
	c.JSON(http.StatusOK, l)
}

func contractDocCounts(where string, args ...any) map[uint]int {
	type row struct {
		ContractID uint
		N          int
	}
	var rows []row
	database.DB.Table("employee_documents").Select("contract_id, count(*) AS n").Where("contract_id IS NOT NULL").Where(where, args...).Group("contract_id").Scan(&rows)
	out := map[uint]int{}
	for _, r := range rows {
		out[r.ContractID] = r.N
	}
	return out
}

// ContractDocCounts: contract id → number of documents attached to it, for every employee in the caller's business scope.
func ContractDocCounts(c *gin.Context) {
	type row struct {
		ContractID uint
		N          int
	}
	var rows []row
	q := database.DB.Table("employee_documents d").Joins("JOIN employees e ON e.id = d.employee_id").Where("d.contract_id IS NOT NULL")
	scopeBusiness(c, q, "e.business_id").Select("d.contract_id, count(*) AS n").Group("d.contract_id").Scan(&rows)
	out := map[uint]int{}
	for _, r := range rows {
		out[r.ContractID] = r.N
	}
	c.JSON(http.StatusOK, out)
}

type contractInput struct {
	Number    string     `json:"number"`
	StartDate *time.Time `json:"start_date"`
	EndDate   *time.Time `json:"end_date"`
	Note      string     `json:"note"`
}

// SaveEmployeeContract creates (POST) or updates (PUT .../contracts/:cid) one contract period.
func SaveEmployeeContract(c *gin.Context) {
	empID := paramID(c)
	if database.DB.First(&models.Employee{}, empID).Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "karyawan tidak ditemukan"})
		return
	}
	var in contractInput
	if err := c.ShouldBindJSON(&in); err != nil || in.StartDate == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tanggal mulai kontrak wajib diisi"})
		return
	}
	if in.EndDate != nil && in.EndDate.Before(*in.StartDate) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tanggal berakhir tidak boleh sebelum tanggal mulai"})
		return
	}
	ct := models.EmployeeContract{EmployeeID: empID}
	if cid := c.Param("cid"); cid != "" {
		if database.DB.Where("id = ? AND employee_id = ?", cid, empID).First(&ct).Error != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "kontrak tidak ditemukan"})
			return
		}
	}
	ct.Number, ct.StartDate, ct.EndDate, ct.Note = strings.TrimSpace(in.Number), *in.StartDate, in.EndDate, strings.TrimSpace(in.Note)
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&ct).Error; err != nil {
			return err
		}
		return syncCurrentContract(tx, empID)
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	audit(c, "save", "employee_contract", ct.ID)
	c.JSON(http.StatusOK, ct)
}

// DeleteEmployeeContract removes the period; its documents stay on the employee (they just lose the contract link).
func DeleteEmployeeContract(c *gin.Context) {
	empID := paramID(c)
	cid, _ := strconv.Atoi(c.Param("cid"))
	var ct models.EmployeeContract
	if database.DB.Where("id = ? AND employee_id = ?", cid, empID).First(&ct).Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "kontrak tidak ditemukan"})
		return
	}
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		tx.Model(&models.EmployeeDocument{}).Where("contract_id = ?", ct.ID).Update("contract_id", nil)
		if err := tx.Delete(&ct).Error; err != nil {
			return err
		}
		return syncCurrentContract(tx, empID)
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	audit(c, "delete", "employee_contract", ct.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

package handlers

import (
	"net/http"
	"strings"
	"time"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
)

// ---- holiday lookup used by leave calculations ----

type skippedDay struct {
	Date         string `json:"date"`
	Name         string `json:"name"`
	DeductsLeave bool   `json:"deducts_leave"`
}

type holidaySet []models.Holiday

func loadHolidays(from, to time.Time) holidaySet {
	var l []models.Holiday
	database.DB.Where("date >= ? AND date <= ?", day(from), day(to)).Find(&l)
	return l
}

// on returns the holiday applying to a business on a date (national, or that business's own).
func (h holidaySet) on(biz uint, d time.Time) (models.Holiday, bool) {
	key := day(d)
	var found models.Holiday
	ok := false
	for _, x := range h {
		if !day(x.Date).Equal(key) || (x.BusinessID != nil && *x.BusinessID != biz) {
			continue
		}
		if !ok {
			found, ok = x, true
		} else if x.DeductsLeave {
			found.DeductsLeave = true // a deducting holiday wins if two overlap
		}
	}
	return found, ok
}

func isWeekend(d time.Time) bool { w := d.Weekday(); return w == time.Saturday || w == time.Sunday }

// workDays counts Mon–Fri that are not holidays, and lists the weekday holidays skipped in the range.
func (h holidaySet) workDays(biz uint, a, b time.Time) (int, []skippedDay) {
	n := 0
	skipped := []skippedDay{}
	for d := day(a); !d.After(day(b)); d = d.AddDate(0, 0, 1) {
		if isWeekend(d) {
			continue
		}
		if hol, ok := h.on(biz, d); ok {
			skipped = append(skipped, skippedDay{d.Format("2006-01-02"), hol.Name, hol.DeductsLeave})
			continue
		}
		n++
	}
	return n, skipped
}

func (h holidaySet) nextWorkday(biz uint, d time.Time) time.Time {
	for i := 0; i < 60; i++ {
		d = day(d).AddDate(0, 0, 1)
		if _, hol := h.on(biz, d); !isWeekend(d) && !hol {
			return d
		}
	}
	return d
}

// collective = weekday "cuti bersama" (deducting holidays) in [from,to]; deducted from everyone's balance.
func (h holidaySet) collective(biz uint, from, to time.Time) int {
	n := 0
	for d := day(from); !d.After(day(to)); d = d.AddDate(0, 0, 1) {
		if hol, ok := h.on(biz, d); ok && hol.DeductsLeave && !isWeekend(d) {
			n++
		}
	}
	return n
}

// ---- management API ----

// canManageHolidays: super admin, or an employee whose position sits in an L1/L2 unit.
func canManageHolidays(c *gin.Context) bool {
	if role(c) == "super_admin" {
		return true
	}
	me := myEmployeeID(c)
	if me == nil {
		return false
	}
	var lvl int
	database.DB.Raw(`SELECT COALESCE(MIN(u.level), 99) FROM employees e JOIN org_units u ON u.id = e.unit_id WHERE e.id = ?`, *me).Scan(&lvl)
	return lvl <= 2
}

func ListHolidays(c *gin.Context) {
	year := today().Year()
	if y := c.Query("year"); y != "" {
		n := 0
		for _, ch := range y {
			n = n*10 + int(ch-'0')
		}
		year = n
	}
	q := database.DB.Where("date >= ? AND date <= ?", time.Date(year, 1, 1, 0, 0, 0, 0, jkt), time.Date(year, 12, 31, 0, 0, 0, 0, jkt))
	if c.Query("only_national") == "1" { // e.g. the date picker while a holiday is being set as nasional
		q = q.Where("business_id IS NULL")
	} else if b := c.Query("business_id"); b != "" && b != "0" {
		q = q.Where("business_id IS NULL OR business_id = ?", b)
	} else if ids := allowedBusinessIDs(c); ids != nil {
		q = q.Where("business_id IS NULL OR business_id IN ?", ids)
	}
	l := []models.Holiday{}
	q.Order("date").Find(&l)
	c.JSON(http.StatusOK, gin.H{"data": l, "can_manage": canManageHolidays(c)})
}

type holidayInput struct {
	Date         time.Time  `json:"date"`
	EndDate      *time.Time `json:"end_date"` // optional: creates one holiday per day up to here
	Name         string     `json:"name"`
	BusinessID   *uint      `json:"business_id"` // nil = nasional
	DeductsLeave bool       `json:"deducts_leave"`
}

func checkHolidayScope(c *gin.Context, biz *uint) bool {
	if biz == nil || role(c) == "super_admin" {
		return true
	}
	allowed := allowedBusinessIDs(c)
	if allowed == nil {
		return true
	}
	for _, id := range allowed {
		if id == *biz {
			return true
		}
	}
	return false
}

func CreateHoliday(c *gin.Context) {
	if !canManageHolidays(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "hanya Super Admin atau pejabat L1/L2 yang dapat mengatur hari libur"})
		return
	}
	var in holidayInput
	if err := c.ShouldBindJSON(&in); err != nil || strings.TrimSpace(in.Name) == "" || in.Date.IsZero() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tanggal dan nama wajib diisi"})
		return
	}
	if !checkHolidayScope(c, in.BusinessID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "bukan bisnis Anda"})
		return
	}
	start, end := day(in.Date), day(in.Date)
	if in.EndDate != nil {
		end = day(*in.EndDate)
	}
	if end.Before(start) || end.Sub(start) > 31*24*time.Hour {
		c.JSON(http.StatusBadRequest, gin.H{"error": "rentang tanggal tidak valid (maksimal 31 hari)"})
		return
	}
	created := []models.Holiday{}
	dups := 0
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		var n int64
		q := database.DB.Model(&models.Holiday{}).Where("date = ?", d)
		if in.BusinessID == nil {
			q = q.Where("business_id IS NULL")
		} else {
			q = q.Where("business_id = ?", *in.BusinessID)
		}
		if q.Count(&n); n > 0 {
			dups++
			continue
		}
		h := models.Holiday{Date: d, Name: strings.TrimSpace(in.Name), BusinessID: in.BusinessID, DeductsLeave: in.DeductsLeave, CreatedByUserID: uid(c)}
		database.DB.Create(&h)
		created = append(created, h)
		audit(c, "create", "holiday", h.ID)
	}
	if len(created) == 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "hari libur pada tanggal tersebut sudah ada"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"created": len(created), "duplicates_skipped": dups})
}

func UpdateHoliday(c *gin.Context) {
	if !canManageHolidays(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "tidak berwenang"})
		return
	}
	var in holidayInput
	if err := c.ShouldBindJSON(&in); err != nil || strings.TrimSpace(in.Name) == "" || in.Date.IsZero() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tanggal dan nama wajib diisi"})
		return
	}
	var h models.Holiday
	if database.DB.Limit(1).Find(&h, paramID(c)).Error != nil || h.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "hari libur tidak ditemukan"})
		return
	}
	if !checkHolidayScope(c, h.BusinessID) || !checkHolidayScope(c, in.BusinessID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "bukan bisnis Anda"})
		return
	}
	var n int64
	q := database.DB.Model(&models.Holiday{}).Where("date = ? AND id <> ?", day(in.Date), h.ID)
	if in.BusinessID == nil {
		q = q.Where("business_id IS NULL")
	} else {
		q = q.Where("business_id = ?", *in.BusinessID)
	}
	if q.Count(&n); n > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "hari libur pada tanggal tersebut sudah ada"})
		return
	}
	h.Date, h.Name, h.BusinessID, h.DeductsLeave = day(in.Date), strings.TrimSpace(in.Name), in.BusinessID, in.DeductsLeave
	database.DB.Save(&h)
	audit(c, "update", "holiday", h.ID)
	c.JSON(http.StatusOK, h)
}

func DeleteHoliday(c *gin.Context) {
	if !canManageHolidays(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "tidak berwenang"})
		return
	}
	var h models.Holiday
	if database.DB.Limit(1).Find(&h, paramID(c)).Error != nil || h.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "hari libur tidak ditemukan"})
		return
	}
	if !checkHolidayScope(c, h.BusinessID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "bukan bisnis Anda"})
		return
	}
	database.DB.Delete(&h)
	audit(c, "delete", "holiday", h.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

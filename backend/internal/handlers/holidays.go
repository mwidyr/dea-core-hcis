package handlers

import (
	"net/http"
	"strings"
	"time"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
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

// holCtx = who a holiday is evaluated for: their business, Lokasi Kerja (roster members: the roster's location) and
// whether they follow a roster.
type holCtx struct {
	Biz    uint
	Loc    *uint
	Roster bool
}

// applies: nasional (no business, no location) applies to all; business-scoped to that business; location-scoped
// only to employees at that location. Kind: 'semua' to everyone, 'non_roster' / 'roster' to that group only.
func holidayApplies(x models.Holiday, c holCtx) bool {
	switch x.Kind {
	case "non_roster":
		if c.Roster {
			return false
		}
	case "roster":
		if !c.Roster {
			return false
		}
	}
	if x.LocationID != nil {
		return c.Loc != nil && *c.Loc == *x.LocationID
	}
	return x.BusinessID == nil || *x.BusinessID == c.Biz
}

// on returns the holiday applying to the context on a date.
func (h holidaySet) on(c holCtx, d time.Time) (models.Holiday, bool) {
	key := day(d)
	var found models.Holiday
	ok := false
	for _, x := range h {
		if !day(x.Date).Equal(key) || !holidayApplies(x, c) {
			continue
		}
		if !ok {
			found, ok = x, true
		} else if x.DeductsLeave {
			found.DeductsLeave = true // a deducting holiday wins if two overlap
			found.Name = x.Name
		}
	}
	return found, ok
}

func isWeekend(d time.Time) bool { w := d.Weekday(); return w == time.Saturday || w == time.Sunday }

// workDays counts the days of the employee's work calendar (workDays "1,2,3,4,5", 0 = Sunday) that are not
// holidays, and lists the working-day holidays skipped in the range.
func (h holidaySet) workDays(c holCtx, workDays string, a, b time.Time) (int, []skippedDay) {
	n := 0
	skipped := []skippedDay{}
	for d := day(a); !d.After(day(b)); d = d.AddDate(0, 0, 1) {
		if !hasDay(workDays, d.Weekday()) {
			continue
		}
		if hol, ok := h.on(c, d); ok {
			skipped = append(skipped, skippedDay{d.Format("2006-01-02"), hol.Name, hol.DeductsLeave})
			continue
		}
		n++
	}
	return n, skipped
}

func (h holidaySet) nextWorkday(c holCtx, workDays string, d time.Time) time.Time {
	for i := 0; i < 60; i++ {
		d = day(d).AddDate(0, 0, 1)
		if _, hol := h.on(c, d); hasDay(workDays, d.Weekday()) && !hol {
			return d
		}
	}
	return d
}

// collective = working-day "cuti bersama" (deducting holidays) in [from,to]; deducted from non-roster balances.
func (h holidaySet) collective(c holCtx, workDays string, from, to time.Time) int {
	n := 0
	for d := day(from); !d.After(day(to)); d = d.AddDate(0, 0, 1) {
		if hol, ok := h.on(c, d); ok && hol.DeductsLeave && hasDay(workDays, d.Weekday()) {
			n++
		}
	}
	return n
}

// ---- management API ----

// canManageHolidays: only HR admin and super admin set the rules (holidays have no approval flow).
func canManageHolidays(c *gin.Context) bool { return isGroupLevel(c) }

type holidayView struct {
	models.Holiday
	LocationName string `json:"location_name"`
	BusinessName string `json:"business_name"`
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
		q = q.Where("business_id IS NULL AND location_id IS NULL")
	} else if l := c.Query("location_id"); l != "" && l != "0" {
		var loc models.Location
		database.DB.Limit(1).Find(&loc, l)
		q = q.Where("location_id = ? OR (location_id IS NULL AND (business_id IS NULL OR business_id = ?))", l, loc.BusinessID)
	} else if b := c.Query("business_id"); b != "" && b != "0" {
		q = q.Where("business_id IS NULL OR business_id = ?", b)
	} else if ids := allowedBusinessIDs(c); ids != nil {
		q = q.Where("business_id IS NULL OR business_id IN ?", ids)
	}
	if k := c.Query("kind"); k != "" {
		q = q.Where("kind = ?", k)
	}
	if k := c.Query("category"); k != "" {
		q = q.Where("category = ?", k)
	}
	rows := []models.Holiday{}
	q.Order("date").Find(&rows)
	locs, bizs := map[uint]string{}, map[uint]string{}
	var ls []models.Location
	database.DB.Select("id, name").Find(&ls)
	for _, x := range ls {
		locs[x.ID] = x.Name
	}
	var bs []models.Business
	database.DB.Select("id, name").Find(&bs)
	for _, x := range bs {
		bizs[x.ID] = x.Name
	}
	out := make([]holidayView, 0, len(rows))
	for _, h := range rows {
		v := holidayView{Holiday: h}
		if h.LocationID != nil {
			v.LocationName = locs[*h.LocationID]
		}
		if h.BusinessID != nil {
			v.BusinessName = bizs[*h.BusinessID]
		}
		out = append(out, v)
	}
	c.JSON(http.StatusOK, gin.H{"data": out, "can_manage": canManageHolidays(c)})
}

type holidayInput struct {
	Date         time.Time  `json:"date"`
	EndDate      *time.Time `json:"end_date"` // optional: creates one holiday per day up to here
	Name         string     `json:"name"`
	BusinessID   *uint      `json:"business_id"` // nil = nasional (unless a location is given)
	LocationID   *uint      `json:"location_id"` // Lokasi Kerja scope; implies the business
	Kind         string     `json:"kind"`        // semua | non_roster | roster
	Category     string     `json:"category"`    // libur_nasional | cuti_bersama | libur_perusahaan
	DeductsLeave bool       `json:"deducts_leave"`
}

var holidayKinds = map[string]bool{"semua": true, "non_roster": true, "roster": true}
var holidayCategories = map[string]bool{"libur_nasional": true, "cuti_bersama": true, "libur_perusahaan": true}

// normalizeHoliday validates kind/category/location and derives business + deducts_leave. Returns an error text.
func normalizeHoliday(in *holidayInput) string {
	if in.Kind == "" {
		in.Kind = "semua"
	}
	if !holidayKinds[in.Kind] {
		return "jenis hari libur tidak valid"
	}
	if in.Category == "" {
		in.Category = "libur_nasional"
		if in.DeductsLeave {
			in.Category = "cuti_bersama"
		}
	}
	if !holidayCategories[in.Category] {
		return "kategori hari libur tidak valid"
	}
	in.DeductsLeave = in.Category == "cuti_bersama"
	if in.LocationID != nil {
		var loc models.Location
		if database.DB.Limit(1).Find(&loc, *in.LocationID).Error != nil || loc.ID == 0 {
			return "lokasi kerja tidak ditemukan"
		}
		b := loc.BusinessID
		in.BusinessID = &b // a location belongs to exactly one business
	}
	return ""
}

func holidayDupQuery(d time.Time, in holidayInput) *gorm.DB {
	q := database.DB.Model(&models.Holiday{}).Where("date = ? AND kind = ?", d, in.Kind)
	if in.BusinessID == nil {
		q = q.Where("business_id IS NULL")
	} else {
		q = q.Where("business_id = ?", *in.BusinessID)
	}
	if in.LocationID == nil {
		q = q.Where("location_id IS NULL")
	} else {
		q = q.Where("location_id = ?", *in.LocationID)
	}
	return q
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
		c.JSON(http.StatusForbidden, gin.H{"error": "hanya Super Admin atau HR Admin yang dapat mengatur hari libur"})
		return
	}
	var in holidayInput
	if err := c.ShouldBindJSON(&in); err != nil || strings.TrimSpace(in.Name) == "" || in.Date.IsZero() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tanggal dan nama wajib diisi"})
		return
	}
	if msg := normalizeHoliday(&in); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
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
		if holidayDupQuery(d, in).Count(&n); n > 0 {
			dups++
			continue
		}
		h := models.Holiday{Date: d, Name: strings.TrimSpace(in.Name), BusinessID: in.BusinessID, LocationID: in.LocationID, Kind: in.Kind, Category: in.Category,
			DeductsLeave: in.DeductsLeave, CreatedByUserID: uid(c)}
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
	if msg := normalizeHoliday(&in); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	if !checkHolidayScope(c, h.BusinessID) || !checkHolidayScope(c, in.BusinessID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "bukan bisnis Anda"})
		return
	}
	var n int64
	if holidayDupQuery(day(in.Date), in).Where("id <> ?", h.ID).Count(&n); n > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "hari libur pada tanggal tersebut sudah ada"})
		return
	}
	h.Date, h.Name, h.BusinessID, h.LocationID = day(in.Date), strings.TrimSpace(in.Name), in.BusinessID, in.LocationID
	h.Kind, h.Category, h.DeductsLeave = in.Kind, in.Category, in.DeductsLeave
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

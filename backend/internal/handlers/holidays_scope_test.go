package handlers

import (
	"testing"
	"time"

	"github.com/dea-core/hcis/backend/internal/models"
)

func d8(y int, m time.Month, dd int) time.Time { return time.Date(y, m, dd, 0, 0, 0, 0, jkt) }
func u(n uint) *uint                           { return &n }

func TestHolidayApplicability(t *testing.T) {
	date := d8(2026, 11, 11) // Wednesday
	hs := holidaySet{
		{ID: 1, Date: date, Name: "Nasional", Kind: "semua"},
		{ID: 2, Date: date, Name: "Biz2", BusinessID: u(2), Kind: "semua"},
		{ID: 3, Date: date, Name: "Lokasi7", BusinessID: u(2), LocationID: u(7), Kind: "non_roster"},
	}
	cases := []struct {
		name string
		ctx  holCtx
		want string
	}{
		{"nasional on other business", holCtx{Biz: 1}, "Nasional"},
		{"business scoped beats nothing (same date, first wins)", holCtx{Biz: 2}, "Nasional"},
	}
	for _, c := range cases {
		if h, ok := hs.on(c.ctx, date); !ok || h.Name != c.want {
			t.Errorf("%s: got %q ok=%v", c.name, h.Name, ok)
		}
	}
	only := holidaySet{hs[2]}
	if _, ok := only.on(holCtx{Biz: 2, Loc: u(7)}, date); !ok {
		t.Error("location holiday must apply to non roster at that location")
	}
	if _, ok := only.on(holCtx{Biz: 2, Loc: u(8)}, date); ok {
		t.Error("location holiday must not apply at another location")
	}
	if _, ok := only.on(holCtx{Biz: 2}, date); ok {
		t.Error("location holiday must not apply to employee without location")
	}
	if _, ok := only.on(holCtx{Biz: 2, Loc: u(7), Roster: true}, date); ok {
		t.Error("non_roster kind must not apply to roster members")
	}
	ro := holidaySet{{Date: date, Name: "R", Kind: "roster"}}
	if _, ok := ro.on(holCtx{Biz: 1}, date); ok {
		t.Error("roster kind must not apply to non roster")
	}
	if _, ok := ro.on(holCtx{Biz: 1, Roster: true}, date); !ok {
		t.Error("roster kind applies (annotation) to roster members")
	}
	legacy := holidaySet{{Date: date, Name: "Old"}} // empty kind = semua
	if _, ok := legacy.on(holCtx{Biz: 1, Roster: true}, date); !ok {
		t.Error("empty kind behaves as semua")
	}
}

func testResolver(hs holidaySet, rosters map[uint]rosterSlot) *resolver {
	return &resolver{calendars: map[uint]models.WorkCalendar{}, defaults: map[uint]models.WorkCalendar{}, rosterOf: rosters, adjust: map[uint]map[string]string{}, hs: hs}
}

func TestWeekendLiburForNonRosterOffForRoster(t *testing.T) {
	sat := d8(2026, 11, 14)
	ro := models.Roster{Name: "R", WorkUnits: 4, OffUnits: 2, Unit: "hari", StartCycle: d8(2026, 11, 14)}
	r := testResolver(nil, map[uint]rosterSlot{2: {ro, d8(2026, 11, 8)}}) // pos on 14 Nov = 6 mod 6 = 0 → kerja; use 12 Nov for off
	reg := models.Employee{ID: 1, BusinessID: 1}
	if s := r.schedule(reg, sat); s.Status != "libur" {
		t.Errorf("non roster Saturday = %s, want libur", s.Status)
	}
	if s := r.schedule(reg, d8(2026, 11, 13)); s.Status != "kerja" {
		t.Errorf("non roster Friday = %s, want kerja", s.Status)
	}
	rosterEmp := models.Employee{ID: 2, BusinessID: 1}
	foundOff := false
	for i := 0; i < 6; i++ {
		if r.schedule(rosterEmp, d8(2026, 11, 8+i)).Status == "off" {
			foundOff = true
		}
		if r.schedule(rosterEmp, d8(2026, 11, 8+i)).Status == "libur" {
			t.Error("roster member must never be libur")
		}
	}
	if !foundOff {
		t.Error("roster pattern off day must be 'off'")
	}
}

func TestRosterHolidayIsAnnotationOnly(t *testing.T) {
	date := d8(2026, 11, 11)
	ro := models.Roster{Name: "R", WorkUnits: 6, OffUnits: 1, Unit: "hari", StartCycle: d8(2026, 11, 11), LocationID: u(7)}
	hs := holidaySet{{Date: date, Name: "Hari X", Kind: "semua", LocationID: u(7), BusinessID: u(1)}}
	r := testResolver(hs, map[uint]rosterSlot{2: {ro, ro.StartCycle}})
	if s := r.schedule(models.Employee{ID: 2, BusinessID: 1}, date); s.Status != "kerja" || s.Holiday != "Hari X" {
		t.Errorf("roster member on holiday: status=%s holiday=%q", s.Status, s.Holiday)
	}
	// non roster at location 7 → libur; at another location → kerja
	if s := r.schedule(models.Employee{ID: 1, BusinessID: 1, LocationID: u(7)}, date); s.Status != "libur" || s.Holiday != "Hari X" {
		t.Errorf("non roster at location: status=%s", s.Status)
	}
	if s := r.schedule(models.Employee{ID: 3, BusinessID: 1, LocationID: u(8)}, date); s.Status != "kerja" {
		t.Errorf("non roster at other location: status=%s", s.Status)
	}
}

func TestWorkDaysRespectsCalendar(t *testing.T) {
	// Mon 9 Nov .. Sun 15 Nov 2026
	a, b := d8(2026, 11, 9), d8(2026, 11, 15)
	hs := holidaySet{}
	c := holCtx{Biz: 1}
	if n, _ := hs.workDays(c, "1,2,3,4,5", a, b); n != 5 {
		t.Errorf("Mon-Fri = %d, want 5", n)
	}
	if n, _ := hs.workDays(c, "1,2,3,4,5,6", a, b); n != 6 {
		t.Errorf("Mon-Sat calendar = %d, want 6", n)
	}
	hs = holidaySet{{Date: d8(2026, 11, 14), Name: "Libur Sabtu", Kind: "semua"}}
	n, sk := hs.workDays(c, "1,2,3,4,5,6", a, b)
	if n != 5 || len(sk) != 1 {
		t.Errorf("Saturday holiday on Mon-Sat calendar: n=%d skipped=%d", n, len(sk))
	}
	if got := hs.nextWorkday(c, "1,2,3,4,5,6", d8(2026, 11, 13)); !got.Equal(d8(2026, 11, 16)) {
		t.Errorf("nextWorkday = %v", got)
	}
	cb := holidaySet{{Date: d8(2026, 11, 11), Kind: "semua", DeductsLeave: true}, {Date: d8(2026, 11, 14), Kind: "semua", DeductsLeave: true}}
	if n := cb.collective(c, "1,2,3,4,5", a, b); n != 1 {
		t.Errorf("collective on Mon-Fri = %d, want 1", n)
	}
	if n := cb.collective(c, "1,2,3,4,5,6", a, b); n != 2 {
		t.Errorf("collective on Mon-Sat = %d, want 2", n)
	}
}

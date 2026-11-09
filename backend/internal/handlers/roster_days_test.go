package handlers

import (
	"strings"
	"testing"
	"time"

	"github.com/dea-core/hcis/backend/internal/models"
)

// roster 4:2 starting 2026-11-09: 09-12 kerja, 13-14 off, 15-18 kerja, 19-20 off ...
func testSlot() rosterSlot {
	ro := models.Roster{WorkUnits: 4, OffUnits: 2, Unit: "hari"}
	return rosterSlot{ro, d8(2026, 11, 9)}
}

func TestNetChangeAndSuggestion(t *testing.T) {
	pat := testSlot().patternStatus
	if pat("2026-11-13") != "off" || pat("2026-11-12") != "kerja" {
		t.Fatal("pattern fixture wrong")
	}
	// two pattern-OFF days become kerja => N=2 compensating OFF days
	days := []adjDay{{Date: "2026-11-13", Kind: "kerja"}, {Date: "2026-11-14", Kind: "kerja"}}
	n, k := netChange(days, pat)
	if n != 2 || k != "off" {
		t.Fatalf("n=%d kind=%s", n, k)
	}
	sug := suggestCompensation(days, n, k, pat, map[string]bool{"2026-11-15": true})
	// after 14 Nov, skipping taken 15 Nov; pattern-kerja days: 16, 17
	if len(sug) != 2 || sug[0] != "2026-11-16" || sug[1] != "2026-11-17" {
		t.Fatalf("suggested %v", sug)
	}
	// kerja -> off => compensating KERJA days (pattern off days: 19, 20)
	days = []adjDay{{Date: "2026-11-10", Kind: "off"}, {Date: "2026-11-11", Kind: "off"}}
	n, k = netChange(days, pat)
	sug = suggestCompensation(days, n, k, pat, nil)
	if n != 2 || k != "kerja" || len(sug) != 2 || sug[0] != "2026-11-13" || sug[1] != "2026-11-14" {
		t.Fatalf("n=%d k=%s sug=%v", n, k, sug)
	}
	// mixed: one off->kerja and one kerja->off cancel out; no-op days do not count
	days = []adjDay{{Date: "2026-11-13", Kind: "kerja"}, {Date: "2026-11-10", Kind: "off"}, {Date: "2026-11-11", Kind: "kerja"}}
	if n, _ := netChange(days, pat); n != 0 {
		t.Fatalf("mixed n=%d", n)
	}
}

func TestValidateCompensation(t *testing.T) {
	pat := testSlot().patternStatus
	now := time.Date(2026, 11, 9, 10, 0, 0, 0, jkt)
	base := []adjDay{{Date: "2026-11-13", Kind: "kerja"}, {Date: "2026-11-14", Kind: "kerja"}}
	ok := append(append([]adjDay{}, base...), adjDay{Date: "2026-11-16", Kind: "off", IsCompensation: true}, adjDay{Date: "2026-11-17", Kind: "off", IsCompensation: true})
	if err := validateAdjustmentDays(ok, true, pat, now, true); err != nil {
		t.Fatal(err)
	}
	if err := validateAdjustmentDays(base, true, pat, now, true); err == nil || !strings.Contains(err.Error(), "harus 2") {
		t.Errorf("missing compensation should be rejected: %v", err)
	}
	if err := validateAdjustmentDays(ok[:3], true, pat, now, true); err == nil || !strings.Contains(err.Error(), "harus 2") {
		t.Errorf("mismatch should be rejected: %v", err)
	}
	if err := validateAdjustmentDays(ok, false, pat, now, true); err == nil {
		t.Error("compensation rows without the flag must be rejected")
	}
	if err := validateAdjustmentDays(base, false, pat, now, true); err != nil {
		t.Errorf("no compensation is optional: %v", err)
	}
	wrong := append(append([]adjDay{}, base...), adjDay{Date: "2026-11-19", Kind: "off", IsCompensation: true}, adjDay{Date: "2026-11-17", Kind: "off", IsCompensation: true})
	if err := validateAdjustmentDays(wrong, true, pat, now, true); err == nil { // 19 Nov is already OFF in the pattern
		t.Error("compensation on an already-off day must be rejected")
	}
	if err := validateAdjustmentDays([]adjDay{{Date: "2026-11-01", Kind: "off"}}, false, pat, now, true); err == nil {
		t.Error("too far in the past")
	}
	dup := []adjDay{{Date: "2026-11-13", Kind: "kerja"}, {Date: "2026-11-13", Kind: "off"}}
	if err := validateAdjustmentDays(dup, false, pat, now, true); err == nil {
		t.Error("duplicate date")
	}
	many := expandRange(d8(2026, 11, 9), d8(2027, 1, 20), "off")
	if err := validateAdjustmentDays(many, false, pat, now, true); err == nil {
		t.Error("more than 60 days")
	}
}

func TestFirstOverlap(t *testing.T) {
	req := []adjDay{{Date: "2026-11-20"}, {Date: "2026-11-12"}}
	if got := firstOverlap(req, map[string]bool{"2026-11-20": true, "2026-11-12": true}); got != "2026-11-12" {
		t.Errorf("got %q", got)
	}
	if got := firstOverlap(req, map[string]bool{"2026-11-13": true}); got != "" {
		t.Errorf("got %q", got)
	}
}

func TestPerDayResolverOverride(t *testing.T) {
	slot := testSlot()
	r := testResolver(nil, map[uint]rosterSlot{1: slot})
	r.adjust[1] = map[string]string{"2026-11-13": "kerja", "2026-11-10": "off"} // non-contiguous
	emp := models.Employee{ID: 1, BusinessID: 1}
	for date, want := range map[string]string{"2026-11-13": "kerja", "2026-11-14": "off", "2026-11-10": "off", "2026-11-11": "kerja"} {
		d, _ := parseDate(date)
		s := r.schedule(emp, d)
		if s.Status != want {
			t.Errorf("%s = %s, want %s", date, s.Status, want)
		}
		if s.Adjusted != (date == "2026-11-13" || date == "2026-11-10") {
			t.Errorf("%s adjusted flag = %v", date, s.Adjusted)
		}
	}
}

func TestBuildPreview(t *testing.T) {
	pat := testSlot().patternStatus
	p := buildPreview([]adjDay{{Date: "2026-11-13", Kind: "kerja"}, {Date: "2026-11-16", Kind: "kerja"}}, pat, map[string]bool{"2026-11-16": true})
	if p.N != 1 || p.Kind != "off" || len(p.Suggested) != 1 || p.Suggested[0] != "2026-11-17" {
		t.Fatalf("%+v", p)
	}
	if !p.Days[0].Changed || p.Days[1].Changed {
		t.Errorf("changed flags %+v", p.Days)
	}
}

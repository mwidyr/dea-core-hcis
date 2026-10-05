package handlers

import (
	"testing"
	"time"

	"github.com/dea-core/hcis/backend/internal/models"
)

func d(s string) time.Time { t, _ := time.ParseInLocation("2006-01-02", s, jkt); return t }

func TestOccursOn(t *testing.T) {
	daily := models.RecurringTask{Frequency: "daily"}
	weekly := models.RecurringTask{Frequency: "weekly", Weekday: 1}
	monthly := models.RecurringTask{Frequency: "monthly", DayOfMonth: 15}
	last := models.RecurringTask{Frequency: "monthly", DayOfMonth: 0}
	cases := []struct {
		r    models.RecurringTask
		day  string
		want bool
	}{
		{daily, "2026-10-05", true},  // Monday
		{daily, "2026-10-04", false}, // Sunday
		{daily, "2026-10-03", false}, // Saturday
		{weekly, "2026-10-05", true},
		{weekly, "2026-10-06", false},
		{monthly, "2026-10-15", true},
		{monthly, "2026-10-16", false},
		{last, "2026-02-28", true},
		{last, "2028-02-28", false}, // leap year: the 29th is the last day
		{last, "2028-02-29", true},
		{last, "2026-10-31", true},
		{last, "2026-10-30", false},
	}
	for _, c := range cases {
		if got := occursOn(c.r, d(c.day)); got != c.want {
			t.Errorf("%s %s: got %v want %v", c.r.Frequency, c.day, got, c.want)
		}
	}
}

func TestKPIScoreAndPeriod(t *testing.T) {
	if p, ok := parsePeriod("2026-Q3"); !ok || p.To.Format("2006-01-02") != "2026-09-30" {
		t.Errorf("Q3 end: %+v", p)
	}
	if p, ok := parsePeriod("2026-02"); !ok || p.To.Format("2006-01-02") != "2026-02-28" {
		t.Errorf("Feb end: %+v", p)
	}
	if _, ok := parsePeriod("2026-Q5"); ok {
		t.Error("Q5 must be invalid")
	}
}

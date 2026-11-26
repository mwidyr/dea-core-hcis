package handlers

import (
	"testing"
	"time"

	"github.com/dea-core/hcis/backend/internal/models"
)

func TestDayHoursOverride(t *testing.T) {
	cal := models.WorkCalendar{WorkDays: "1,2,3,4,5,6", StartTime: "08:00", EndTime: "16:00", BreakStart: "12:00", BreakEnd: "13:00",
		DayHours: `{"6":{"start":"08:00","end":"14:00","break_start":"","break_end":""}}`}
	if h, ok := dayHoursOf(cal, time.Saturday); !ok || h.End != "14:00" || h.BreakStart != "" {
		t.Fatalf("saturday should be 08-14 without break, got %+v ok=%v", h, ok)
	}
	if _, ok := dayHoursOf(cal, time.Monday); ok {
		t.Fatal("monday keeps the calendar's base hours")
	}
	if _, ok := dayHoursOf(models.WorkCalendar{}, time.Saturday); ok {
		t.Fatal("no overrides configured")
	}
}

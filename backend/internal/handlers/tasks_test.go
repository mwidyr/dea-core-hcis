package handlers

import (
	"math"
	"testing"
	"time"

	"github.com/dea-core/hcis/backend/internal/models"
)

func tp(s string) *time.Time {
	if s == "" {
		return nil
	}
	t := d(s)
	return &t
}

func TestTaskTimeliness(t *testing.T) {
	now := d("2026-10-14")
	cases := []struct {
		name             string
		status           string
		start, due, done string
		want             string
	}{
		{"to do whose start date has come is a late start", "todo", "2026-10-14", "2026-10-30", "", tmLateStart},
		{"to do started in the past", "todo", "2026-10-01", "2026-10-30", "", tmLateStart},
		{"to do that has not reached its start date is on track", "todo", "2026-10-20", "2026-10-30", "", tmOnTrack},
		{"to do without start date but past deadline is overdue", "todo", "", "2026-10-10", "", tmOverdue},
		{"to do without dates", "todo", "", "", "", tmNone},
		{"in progress past the deadline is overdue", "in_progress", "2026-10-01", "2026-10-13", "", tmOverdue},
		{"in progress due today is still on track", "in_progress", "2026-10-01", "2026-10-14", "", tmOnTrack},
		{"in progress before the deadline is on track", "in_progress", "2026-10-01", "2026-10-30", "", tmOnTrack},
		{"review past the deadline follows in progress: overdue", "review", "2026-10-01", "2026-10-13", "", tmOverdue},
		{"review before the deadline: on track", "review", "2026-10-01", "2026-10-30", "", tmOnTrack},
		{"done on the deadline day is on time", "done", "2026-10-01", "2026-10-10", "2026-10-10", tmDoneOnTime},
		{"done after the deadline is late", "done", "2026-10-01", "2026-10-10", "2026-10-11", tmDoneLate},
		{"done without a deadline", "done", "", "", "2026-10-11", tmDoneOnTime},
	}
	for _, c := range cases {
		if got := taskTimeliness(c.status, tp(c.start), tp(c.due), tp(c.done), now); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

func mk(id uint, parent *uint, status string, pct int, weight *float64) models.Task {
	return models.Task{ID: id, ParentID: parent, Status: status, ProgressPct: pct, Weight: weight}
}

func near(a, b float64) bool { return math.Abs(a-b) < 0.11 }

func TestProgressManualAndWeighted(t *testing.T) {
	p := uint(1)
	w := func(v float64) *float64 { return &v }

	// leaf: manual progress, done = 100 whatever was typed
	c := newTaskCalc([]models.Task{mk(1, nil, "in_progress", 40, nil), mk(2, nil, "done", 10, nil), mk(3, nil, "todo", 0, nil)})
	if c.progress(1) != 40 || c.progress(2) != 100 || c.progress(3) != 0 {
		t.Errorf("leaf progress: %v %v %v", c.progress(1), c.progress(2), c.progress(3))
	}

	// equal split when weights are missing
	c = newTaskCalc([]models.Task{mk(1, nil, "todo", 0, nil), mk(2, &p, "done", 0, nil), mk(3, &p, "in_progress", 50, nil), mk(4, &p, "todo", 0, nil), mk(5, &p, "todo", 0, nil)})
	if got := c.progress(1); !near(got, 37.5) {
		t.Errorf("equal split: got %v, want 37.5", got)
	}

	// weighted: 70% done child + 30% child at 50% = 85
	c = newTaskCalc([]models.Task{mk(1, nil, "todo", 0, nil), mk(2, &p, "done", 0, w(70)), mk(3, &p, "in_progress", 50, w(30))})
	if got := c.progress(1); !near(got, 85) {
		t.Errorf("weighted: got %v, want 85", got)
	}

	// weights count only when EVERY sibling has one; otherwise equal
	c = newTaskCalc([]models.Task{mk(1, nil, "todo", 0, nil), mk(2, &p, "done", 0, w(70)), mk(3, &p, "todo", 0, nil)})
	if got := c.progress(1); !near(got, 50) {
		t.Errorf("partial weights fall back to equal: got %v, want 50", got)
	}

	// nested: parent 1 → child 2 (weight 50, itself a parent of two equal leaves, one done) + child 3 (weight 50, 100% leaf)
	two := uint(2)
	c = newTaskCalc([]models.Task{mk(1, nil, "todo", 0, nil), mk(2, &p, "todo", 0, w(50)), mk(3, &p, "done", 0, w(50)), mk(4, &two, "done", 0, nil), mk(5, &two, "todo", 0, nil)})
	if got := c.progress(1); !near(got, 75) {
		t.Errorf("nested: got %v, want 75", got)
	}
}

func TestLeafSharesFollowSiblingWeights(t *testing.T) {
	pid := uint(9)
	top := uint(1)
	w := func(v float64) *float64 { return &v }
	mkp := func(id uint, parent *uint, wt *float64) models.Task {
		x := mk(id, parent, "todo", 0, wt)
		x.ProjectID = &pid
		return x
	}
	c := newTaskCalc([]models.Task{mkp(1, nil, nil), mkp(2, &top, w(75)), mkp(3, &top, w(25))})
	sh := c.leafShares(pid)
	if !near(sh[2]*100, 75) || !near(sh[3]*100, 25) {
		t.Errorf("leaf shares: %v", sh)
	}
}

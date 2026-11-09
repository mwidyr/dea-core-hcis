package handlers

import (
	"testing"
	"time"
)

func dt(s string) time.Time { t, _ := time.ParseInLocation("2006-01-02", s, jkt); return t }

// brute walks every day from..ce and counts.
func bruteCycle(in rosterCycleInput) (cycWork, cumWork, cumOff, cumCuti, cycCuti int, cs, ce time.Time, no int) {
	W, L := in.Work*in.Mult, (in.Work+in.Off)*in.Mult
	st := func(d time.Time) bool {
		if k, ok := in.Adjust[d.Format("2006-01-02")]; ok {
			return k == "kerja"
		}
		return floorMod(daysBetween(in.Anchor, d), L) < W
	}
	idx := floorDiv(daysBetween(in.Anchor, in.Ref), L)
	cs = in.Anchor.AddDate(0, 0, idx*L)
	ce = cs.AddDate(0, 0, L-1)
	no = idx + 1
	cutis := map[string]bool{}
	for _, c := range in.CutiDays {
		cutis[c] = true
	}
	for d := cs; !d.After(ce); d = d.AddDate(0, 0, 1) {
		if st(d) {
			cycWork++
			if cutis[d.Format("2006-01-02")] {
				cycCuti++
			}
		}
	}
	from := in.Anchor
	if in.DOH != nil && day(*in.DOH).After(from) {
		from = day(*in.DOH)
	}
	for d := from; !d.After(ce); d = d.AddDate(0, 0, 1) {
		if st(d) {
			cumWork++
			if cutis[d.Format("2006-01-02")] {
				cumCuti++
			}
		} else {
			cumOff++
		}
	}
	return
}

func TestBuildRosterCycleStats(t *testing.T) {
	d := func(s string) *time.Time { x := dt(s); return &x }
	adj := map[string]string{"2026-03-03": "off", "2026-03-05": "kerja", "2026-03-04": "kerja"} // 03-04: pattern may already be kerja
	cases := []struct {
		name string
		in   rosterCycleInput
	}{
		{"4:2 DOH after anchor", rosterCycleInput{Work: 4, Off: 2, Mult: 1, Anchor: dt("2026-01-01"), DOH: d("2026-02-10"), Ref: dt("2026-03-15")}},
		{"4:2 DOH before anchor", rosterCycleInput{Work: 4, Off: 2, Mult: 1, Anchor: dt("2026-01-01"), DOH: d("2025-06-01"), Ref: dt("2026-03-15")}},
		{"6:4 DOH nil", rosterCycleInput{Work: 6, Off: 4, Mult: 1, Anchor: dt("2026-02-03"), Ref: dt("2026-03-31")}},
		{"adjustments + cuti", rosterCycleInput{Work: 4, Off: 2, Mult: 1, Anchor: dt("2026-01-01"), DOH: d("2026-01-20"), Ref: dt("2026-03-04"), Adjust: adj, CutiDays: []string{"2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-02"}}},
		{"weeks 2:1", rosterCycleInput{Work: 2, Off: 1, Mult: 7, Anchor: dt("2026-01-05"), DOH: d("2026-02-02"), Ref: dt("2026-04-01")}},
		{"ref on cycle boundary", rosterCycleInput{Work: 4, Off: 2, Mult: 1, Anchor: dt("2026-01-01"), Ref: dt("2026-01-07")}},
		{"DOH after cycle end", rosterCycleInput{Work: 4, Off: 2, Mult: 1, Anchor: dt("2026-01-01"), DOH: d("2026-06-01"), Ref: dt("2026-01-03")}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := buildRosterCycleStats(c.in)
			cw, kw, ko, kc, cc, cs, ce, no := bruteCycle(c.in)
			L := (c.in.Work + c.in.Off) * c.in.Mult
			if got.CycleWork != cw || got.CycleOff != L-cw || got.CycleCuti != cc || got.CycleNo != no ||
				got.CycleStart != cs.Format("2006-01-02") || got.CycleEnd != ce.Format("2006-01-02") {
				t.Errorf("cycle mismatch: %+v vs work=%d cuti=%d no=%d %s..%s", got, cw, cc, no, cs.Format("2006-01-02"), ce.Format("2006-01-02"))
			}
			if got.CumWork != kw || got.CumOff != ko || got.CumCuti != kc {
				t.Errorf("cumulative mismatch: got %d/%d/%d want %d/%d/%d", got.CumWork, got.CumOff, got.CumCuti, kw, ko, kc)
			}
		})
	}
}

func TestRosterCycleDOHFallback(t *testing.T) {
	got := buildRosterCycleStats(rosterCycleInput{Work: 4, Off: 2, Mult: 1, Anchor: dt("2026-01-01"), Ref: dt("2026-01-03")})
	if got.DOH != nil || got.AccumFrom != "2026-01-01" || got.CumWork != 4 || got.CumOff != 2 {
		t.Errorf("unexpected %+v", got)
	}
	got = buildRosterCycleStats(rosterCycleInput{Work: 4, Off: 2, Mult: 1, Anchor: dt("2026-01-01"), DOH: func() *time.Time { x := dt("2026-01-03"); return &x }(), Ref: dt("2026-01-03")})
	if got.AccumFrom != "2026-01-03" || got.CumWork != 2 || got.CumOff != 2 { // days 3,4 work; 5,6 off
		t.Errorf("unexpected %+v", got)
	}
	if buildRosterCycleStats(rosterCycleInput{Work: 0, Off: 0, Mult: 1}) != nil {
		t.Error("expected nil for empty roster")
	}
}

package handlers

import (
	"sort"
	"time"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
)

// Roster accumulation on the Rekap Absensi page (client: "akumulatif roster: dari DOH sampai selesai cycle berapa
// cuti dan off-nya"). Only used by AttendanceRecap — buildRecap (dashboard/KPI/reports) is untouched.
//
// ASSUMPTION: the date a person joined the roster is not stored, so accumulation starts at
// max(DOH, member's start-cycle anchor). Pattern days are counted in closed form (k full cycles + remainder),
// then corrected per day for approved roster adjustments / compensation (roster_adjustment_days).
// Holidays never change roster status (annotation only), so they are ignored here.

// rosterCycleStats is embedded (as a pointer) in recapRow: nil for non-roster members, so their JSON is unchanged.
type rosterCycleStats struct {
	DOH        *string `json:"doh,omitempty"`
	AccumFrom  string  `json:"accum_from"` // actual accumulation start = max(DOH, start cycle)
	CycleNo    int     `json:"cycle_no"`
	CycleStart string  `json:"cycle_start"`
	CycleEnd   string  `json:"cycle_end"`
	CycleWork  int     `json:"cycle_work"`
	CycleOff   int     `json:"cycle_off"`
	CycleCuti  int     `json:"cycle_cuti"`
	CumWork    int     `json:"cum_work"`
	CumOff     int     `json:"cum_off"`
	CumCuti    int     `json:"cum_cuti"`
}

type rosterCycleInput struct {
	Work, Off int       // roster units (days or weeks)
	Mult      int       // 1 for days, 7 for weeks
	Anchor    time.Time // the member's cycle start
	DOH       *time.Time
	Ref       time.Time         // the day whose cycle is reported
	Adjust    map[string]string // approved per-day override: YYYY-MM-DD → kerja|off
	CutiDays  []string          // approved cuti dates (YYYY-MM-DD)
}

func floorDiv(a, b int) int {
	q := a / b
	if a%b != 0 && (a < 0) != (b < 0) {
		q--
	}
	return q
}

func daysBetween(a, b time.Time) int {
	return int(day(b).Sub(day(a)).Hours()/24 + 0.5*sign(day(b).Sub(day(a))))
}

func sign(d time.Duration) float64 {
	if d < 0 {
		return -1
	}
	return 1
}

// patternWork = work days among the first n days after the anchor (n >= 0).
func patternWork(n, L, W int) int {
	if n <= 0 {
		return 0
	}
	r := n % L
	if r > W {
		r = W
	}
	return n/L*W + r
}

func buildRosterCycleStats(in rosterCycleInput) *rosterCycleStats {
	W, L := in.Work*in.Mult, (in.Work+in.Off)*in.Mult
	if in.Mult <= 0 || in.Work <= 0 || L <= 0 {
		return nil
	}
	anchor, ref := day(in.Anchor), day(in.Ref)
	idx := floorDiv(daysBetween(anchor, ref), L)
	cs := anchor.AddDate(0, 0, idx*L)
	ce := cs.AddDate(0, 0, L-1)
	from := anchor
	st := &rosterCycleStats{CycleNo: idx + 1, CycleStart: cs.Format("2006-01-02"), CycleEnd: ce.Format("2006-01-02"), CycleWork: W, CycleOff: L - W}
	if in.DOH != nil {
		d := day(*in.DOH)
		s := d.Format("2006-01-02")
		st.DOH = &s
		if d.After(from) {
			from = d
		}
	}
	st.AccumFrom = from.Format("2006-01-02")
	// pattern status of a date (periodic in both directions)
	patWork := func(d time.Time) bool { return floorMod(daysBetween(anchor, d), L) < W }
	status := func(d time.Time) bool { // true = kerja
		if k, ok := in.Adjust[d.Format("2006-01-02")]; ok {
			return k == "kerja"
		}
		return patWork(d)
	}
	// correction of the pattern count by approved per-day overrides inside [a,b]
	correct := func(a, b time.Time) int {
		n := 0
		for ds, k := range in.Adjust {
			d, err := time.ParseInLocation("2006-01-02", ds, jkt)
			if err != nil || d.Before(a) || d.After(b) {
				continue
			}
			if (k == "kerja") != patWork(d) {
				if k == "kerja" {
					n++
				} else {
					n--
				}
			}
		}
		return n
	}
	cuti := func(a, b time.Time) int {
		n := 0
		seen := map[string]bool{}
		for _, ds := range in.CutiDays {
			d, err := time.ParseInLocation("2006-01-02", ds, jkt)
			if err != nil || seen[ds] || d.Before(a) || d.After(b) {
				continue
			}
			seen[ds] = true
			if status(d) {
				n++
			}
		}
		return n
	}
	st.CycleWork += correct(cs, ce)
	st.CycleOff = L - st.CycleWork
	st.CycleCuti = cuti(cs, ce)
	if !from.After(ce) {
		n := daysBetween(from, ce) + 1
		w := patternWork(daysBetween(anchor, ce)+1, L, W) - patternWork(daysBetween(anchor, from), L, W) + correct(from, ce)
		st.CumWork, st.CumOff, st.CumCuti = w, n-w, cuti(from, ce)
	}
	return st
}

func floorMod(a, b int) int { return ((a % b) + b) % b }

// rosterCycleBatch fills roster stats for the given recap rows (roster members only) using a fixed number of queries.
func rosterCycleBatch(rows []recapRow, emps []models.Employee, res *resolver, first, last time.Time) {
	ref := today()
	if ref.Before(first) {
		ref = first
	}
	if ref.After(last) {
		ref = last
	}
	var ids []uint
	for _, e := range emps {
		if _, ok := res.rosterOf[e.ID]; ok {
			ids = append(ids, e.ID)
		}
	}
	if len(ids) == 0 {
		return
	}
	// DOH: join date, else earliest contract start — one batch query
	doh := map[uint]time.Time{}
	var cs []struct {
		EmployeeID uint
		Start      time.Time
	}
	database.DB.Raw(`SELECT employee_id, MIN(start_date) AS start FROM employee_contracts WHERE employee_id IN ? GROUP BY employee_id`, ids).Scan(&cs)
	for _, c := range cs {
		doh[c.EmployeeID] = c.Start
	}
	for _, e := range emps {
		if e.JoinDate != nil {
			doh[e.ID] = *e.JoinDate
		}
	}
	// widest window needed: [min(accumulation start), ref + 400d] (a cycle end is always within one cycle of ref)
	lo, hi := ref, ref.AddDate(0, 0, 400)
	for _, id := range ids {
		s := res.rosterOf[id].start
		if d, ok := doh[id]; ok && day(d).After(day(s)) {
			s = d
		}
		if day(s).Before(lo) {
			lo = day(s)
		}
	}
	var adj []models.RosterAdjustmentDay
	database.DB.Raw(`SELECT d.* FROM roster_adjustment_days d JOIN roster_adjustments a ON a.id = d.roster_adjustment_id
		WHERE a.status = 'Disetujui' AND d.employee_id IN ? AND d.date >= ? AND d.date <= ? ORDER BY a.id, d.id`,
		ids, lo.Format("2006-01-02"), hi.Format("2006-01-02")).Scan(&adj)
	adjOf := map[uint]map[string]string{}
	for _, a := range adj {
		if adjOf[a.EmployeeID] == nil {
			adjOf[a.EmployeeID] = map[string]string{}
		}
		adjOf[a.EmployeeID][a.Date] = a.Kind
	}
	var ls []struct {
		EmployeeID uint
		StartDate  time.Time
		EndDate    time.Time
	}
	database.DB.Raw(`SELECT l.employee_id, l.start_date, l.end_date FROM leave_requests l JOIN leave_types t ON t.id = l.type_id
		WHERE l.status = 'Disetujui' AND t.category = 'cuti' AND l.employee_id IN ? AND l.start_date <= ? AND l.end_date >= ?`, ids, hi, lo).Scan(&ls)
	cutiOf := map[uint][]string{}
	for _, l := range ls {
		for d := day(l.StartDate); !d.After(day(l.EndDate)); d = d.AddDate(0, 0, 1) {
			cutiOf[l.EmployeeID] = append(cutiOf[l.EmployeeID], d.Format("2006-01-02"))
		}
	}
	idx := map[uint]int{}
	for i := range rows {
		idx[rows[i].EmployeeID] = i
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	for _, id := range ids {
		slot := res.rosterOf[id]
		mult := 1
		if slot.ro.Unit == "minggu" {
			mult = 7
		}
		in := rosterCycleInput{Work: slot.ro.WorkUnits, Off: slot.ro.OffUnits, Mult: mult, Anchor: slot.start, Ref: ref, Adjust: adjOf[id], CutiDays: cutiOf[id]}
		if d, ok := doh[id]; ok {
			in.DOH = &d
		}
		if i, ok := idx[id]; ok {
			rows[i].rosterCycleStats = buildRosterCycleStats(in)
		}
	}
}

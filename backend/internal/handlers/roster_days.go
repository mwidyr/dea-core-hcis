package handlers

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

// ---- roster adjustment days: pure logic (no DB) ----
//
// A request is a list of days {date, kind}. Optional compensation keeps the cycle total unchanged:
// netChange = (days turned into kerja that the pattern has as off) - (days turned into off that the pattern has as kerja).
//   net > 0 → N = net extra work days → N compensating OFF days; net < 0 → N = -net extra off days → N compensating KERJA days.
// Compensating days are ordinary day rows flagged IsCompensation; the server always recomputes N.

const (
	maxAdjustDays = 60
	maxPastDays   = 7
)

type adjDay struct {
	Date           string `json:"date"` // YYYY-MM-DD
	Kind           string `json:"kind"` // kerja | off
	IsCompensation bool   `json:"is_compensation"`
}

// patternFn = the roster PATTERN status of a date (kerja | off), ignoring adjustments and holidays.
type patternFn func(date string) string

func (s rosterSlot) patternStatus(date string) string {
	d, ok := parseDate(date)
	if !ok {
		return "off"
	}
	pat := s.ro
	pat.StartCycle = s.start
	if rosterWorking(pat, d) {
		return "kerja"
	}
	return "off"
}

func opposite(kind string) string {
	if kind == "kerja" {
		return "off"
	}
	return "kerja"
}

// netChange returns N (days the cycle gains/loses) and the kind of the compensating days (opposite of the change).
// Compensation days in the input are ignored.
func netChange(days []adjDay, pat patternFn) (n int, compKind string) {
	net := 0
	for _, d := range days {
		if d.IsCompensation {
			continue
		}
		p := pat(d.Date)
		switch {
		case d.Kind == "kerja" && p == "off":
			net++
		case d.Kind == "off" && p == "kerja":
			net--
		}
	}
	if net > 0 {
		return net, "off"
	}
	if net < 0 {
		return -net, "kerja"
	}
	return 0, ""
}

func addDays(date string, n int) string {
	d, ok := parseDate(date)
	if !ok {
		return date
	}
	return d.AddDate(0, 0, n).Format("2006-01-02")
}

func maxDate(days []adjDay) string {
	m := ""
	for _, d := range days {
		if d.Date > m {
			m = d.Date
		}
	}
	return m
}

// suggestCompensation picks n dates AFTER the last requested date where the pattern differs from compKind
// (so the compensation really changes the cycle), skipping taken dates (request + other pending days).
func suggestCompensation(days []adjDay, n int, compKind string, pat patternFn, taken map[string]bool) []string {
	out := []string{}
	last := maxDate(days)
	if n <= 0 || last == "" {
		return out
	}
	for i := 1; i <= 366 && len(out) < n; i++ {
		d := addDays(last, i)
		if taken[d] || pat(d) == compKind {
			continue
		}
		out = append(out, d)
	}
	return out
}

// validateAdjustmentDays checks a whole request. strictPast: every day must be within the allowed past window
// (new payload); legacy range payloads only require the end date to be (kept as before).
func validateAdjustmentDays(days []adjDay, compensate bool, pat patternFn, now time.Time, strictPast bool) error {
	if len(days) == 0 {
		return fmt.Errorf("pilih minimal satu tanggal")
	}
	if len(days) > maxAdjustDays {
		return fmt.Errorf("maksimal %d tanggal per pengajuan", maxAdjustDays)
	}
	limit := day(now).AddDate(0, 0, -maxPastDays).Format("2006-01-02")
	seen := map[string]bool{}
	comps, base := []adjDay{}, []adjDay{}
	for _, d := range days {
		if _, ok := parseDate(d.Date); !ok {
			return fmt.Errorf("format tanggal tidak valid: %s", d.Date)
		}
		if d.Kind != "kerja" && d.Kind != "off" {
			return fmt.Errorf("jenis hari %s harus Kerja atau Libur (OFF)", d.Date)
		}
		if seen[d.Date] {
			return fmt.Errorf("tanggal %s terisi lebih dari sekali", d.Date)
		}
		seen[d.Date] = true
		if strictPast && d.Date < limit {
			return fmt.Errorf("tanggal %s lebih dari %d hari yang lalu", d.Date, maxPastDays)
		}
		if d.IsCompensation {
			comps = append(comps, d)
		} else {
			base = append(base, d)
		}
	}
	if !strictPast && maxDate(days) < limit {
		return fmt.Errorf("penyesuaian tidak boleh untuk tanggal lebih dari %d hari yang lalu", maxPastDays)
	}
	if len(base) == 0 {
		return fmt.Errorf("pilih minimal satu tanggal yang disesuaikan")
	}
	if !compensate {
		if len(comps) > 0 {
			return fmt.Errorf("tanggal pengganti hanya dapat diisi bila Kompensasi hari libur dicentang")
		}
		return nil
	}
	n, ck := netChange(base, pat)
	if len(comps) != n {
		if n == 0 {
			return fmt.Errorf("tidak ada perubahan total siklus, tanggal pengganti tidak diperlukan")
		}
		return fmt.Errorf("jumlah tanggal pengganti harus %d hari (sesuai perubahan total siklus), Anda mengisi %d", n, len(comps))
	}
	for _, c := range comps {
		if c.Kind != ck {
			return fmt.Errorf("tanggal pengganti %s harus berjenis %s", c.Date, map[string]string{"kerja": "Kerja", "off": "Libur (OFF)"}[ck])
		}
		if pat(c.Date) == ck {
			return fmt.Errorf("tanggal pengganti %s tidak mengubah total siklus (jadwal polanya sudah %s)", c.Date, map[string]string{"kerja": "Kerja", "off": "OFF"}[ck])
		}
	}
	return nil
}

// firstOverlap returns the first requested date that is already used by another pending request ("" = none).
func firstOverlap(req []adjDay, existing map[string]bool) string {
	ds := make([]string, 0, len(req))
	for _, d := range req {
		ds = append(ds, d.Date)
	}
	sort.Strings(ds)
	for _, d := range ds {
		if existing[d] {
			return d
		}
	}
	return ""
}

// expandRange turns a legacy start/end + kind payload into day rows.
func expandRange(start, end time.Time, kind string) []adjDay {
	out := []adjDay{}
	for d := day(start); !d.After(day(end)); d = d.AddDate(0, 0, 1) {
		out = append(out, adjDay{Date: d.Format("2006-01-02"), Kind: kind})
	}
	return out
}

// summarizeDays: min/max, uniform kind ("campuran" when mixed) and a short text for approval summaries.
func summarizeDays(days []adjDay) (min, max, kind string) {
	for i, d := range days {
		if i == 0 || d.Date < min {
			min = d.Date
		}
		if d.Date > max {
			max = d.Date
		}
		if i == 0 {
			kind = d.Kind
		} else if kind != d.Kind {
			kind = "campuran"
		}
	}
	return
}

func daysSummaryText(days []adjDay) string {
	ds := append([]adjDay(nil), days...)
	sort.Slice(ds, func(i, j int) bool { return ds[i].Date < ds[j].Date })
	kerja, off, comp := 0, 0, 0
	parts := []string{}
	for _, d := range ds {
		if d.Kind == "kerja" {
			kerja++
		} else {
			off++
		}
		if d.IsCompensation {
			comp++
		}
		if len(parts) < 4 {
			t, _ := parseDate(d.Date)
			parts = append(parts, t.Format("02/01/06"))
		}
	}
	txt := strings.Join(parts, ", ")
	if len(ds) > 4 {
		txt += fmt.Sprintf(" +%d", len(ds)-4)
	}
	txt += fmt.Sprintf(" (%d Kerja, %d Libur", kerja, off)
	if comp > 0 {
		txt += fmt.Sprintf(", %d pengganti", comp)
	}
	return txt + ")"
}

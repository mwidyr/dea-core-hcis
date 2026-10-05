package handlers

import (
	"math"
	"sort"
	"time"

	"github.com/dea-core/hcis/backend/internal/models"
)

// ---- progress & status of tasks ----
//
//   leaf task          → 100% when done, otherwise 0%
//   parent (has kids)  → average of its children's progress (4 sub-tasks, 1 done → 25%), applied recursively
//   parent status      → derived from the progress (never set by hand)
//   project            → weighted average of its top-level tasks when every one has a weight ("bobot"),
//                        otherwise a plain average

type taskCalc struct {
	tasks map[uint]models.Task
	kids  map[uint][]uint
	prog  map[uint]float64
	stat  map[uint]string
}

func newTaskCalc(ts []models.Task) *taskCalc {
	c := &taskCalc{tasks: map[uint]models.Task{}, kids: map[uint][]uint{}, prog: map[uint]float64{}, stat: map[uint]string{}}
	for _, t := range ts {
		c.tasks[t.ID] = t
	}
	for _, t := range ts {
		if t.ParentID != nil {
			if _, ok := c.tasks[*t.ParentID]; ok {
				c.kids[*t.ParentID] = append(c.kids[*t.ParentID], t.ID)
			}
		}
	}
	return c
}

func (c *taskCalc) isParent(id uint) bool { return len(c.kids[id]) > 0 }

func (c *taskCalc) progress(id uint) float64 {
	if v, ok := c.prog[id]; ok {
		return v
	}
	var p float64
	if ks := c.kids[id]; len(ks) > 0 {
		for _, k := range ks {
			p += c.progress(k)
		}
		p /= float64(len(ks))
	} else if c.tasks[id].Status == "done" {
		p = 100
	}
	p = math.Round(p*10) / 10
	c.prog[id] = p
	return p
}

// status returns the effective status (a parent's is derived from its children).
func (c *taskCalc) status(id uint) string {
	if v, ok := c.stat[id]; ok {
		return v
	}
	s := c.tasks[id].Status
	if ks := c.kids[id]; len(ks) > 0 {
		p := c.progress(id)
		switch {
		case p >= 100:
			s = "done"
		case p > 0:
			s = "in_progress"
		default:
			s = "todo"
			for _, k := range ks {
				if ks := c.status(k); ks == "in_progress" || ks == "review" {
					s = "in_progress"
				}
			}
		}
	}
	c.stat[id] = s
	return s
}

// counts = direct children and how many of them are done.
func (c *taskCalc) counts(id uint) (total, done int) {
	for _, k := range c.kids[id] {
		total++
		if c.status(k) == "done" {
			done++
		}
	}
	return
}

func (c *taskCalc) descendants(id uint) []uint {
	var out []uint
	for _, k := range c.kids[id] {
		out = append(out, k)
		out = append(out, c.descendants(k)...)
	}
	return out
}

// depthOf = 1 for a top-level task.
func (c *taskCalc) depthOf(id uint) int {
	d := 1
	for cur := c.tasks[id]; cur.ParentID != nil && d < 50; d++ {
		cur = c.tasks[*cur.ParentID]
	}
	return d
}

func (c *taskCalc) subtreeHeight(id uint) int {
	h := 0
	for _, k := range c.kids[id] {
		if x := c.subtreeHeight(k); x > h {
			h = x
		}
	}
	return h + 1
}

// ---- projects ----

// topLevel returns the project's top-level tasks sorted by id.
func (c *taskCalc) topLevel(projectID uint) []uint {
	var ids []uint
	for id, t := range c.tasks {
		if t.ProjectID != nil && *t.ProjectID == projectID && t.ParentID == nil {
			ids = append(ids, id)
		}
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	return ids
}

// topShares: each top-level task's share of the project (sums to 1) — by weight if all are weighted, else equal.
func (c *taskCalc) topShares(top []uint) map[uint]float64 {
	out := map[uint]float64{}
	if len(top) == 0 {
		return out
	}
	weighted, sum := true, 0.0
	for _, id := range top {
		w := c.tasks[id].Weight
		if w == nil || *w <= 0 {
			weighted = false
			break
		}
		sum += *w
	}
	for _, id := range top {
		if weighted {
			out[id] = *c.tasks[id].Weight / sum
		} else {
			out[id] = 1 / float64(len(top))
		}
	}
	return out
}

func (c *taskCalc) projectProgress(projectID uint) (progress float64, top int, weighted bool) {
	ids := c.topLevel(projectID)
	if len(ids) == 0 {
		return 0, 0, false
	}
	shares := c.topShares(ids)
	weighted = true
	for _, id := range ids {
		if w := c.tasks[id].Weight; w == nil || *w <= 0 {
			weighted = false
		}
	}
	for _, id := range ids {
		progress += shares[id] * c.progress(id)
	}
	return math.Round(progress*10) / 10, len(ids), weighted
}

// leafShare = a leaf's share of the whole project: its top-level share split equally down the tree.
func (c *taskCalc) leafShares(projectID uint) map[uint]float64 {
	out := map[uint]float64{}
	var walk func(id uint, share float64)
	walk = func(id uint, share float64) {
		ks := c.kids[id]
		if len(ks) == 0 {
			out[id] = share
			return
		}
		for _, k := range ks {
			walk(k, share/float64(len(ks)))
		}
	}
	top := c.topLevel(projectID)
	for id, sh := range c.topShares(top) {
		walk(id, sh)
	}
	return out
}

// effectiveDates: a leaf's own start/due, else the nearest ancestor's, else nil.
func (c *taskCalc) effectiveDates(id uint) (*time.Time, *time.Time) {
	var s, d *time.Time
	for cur, i := c.tasks[id], 0; i < 50; i++ {
		if s == nil {
			s = cur.StartDate
		}
		if d == nil {
			d = cur.DueDate
		}
		if cur.ParentID == nil || (s != nil && d != nil) {
			break
		}
		cur = c.tasks[*cur.ParentID]
	}
	if s == nil {
		s = d
	}
	if d == nil {
		d = s
	}
	return s, d
}

type curvePoint struct {
	Date   string   `json:"date"`
	Plan   float64  `json:"plan"`
	Actual *float64 `json:"actual"`
}

// projectCurve builds the weekly Kurva-S: planned cumulative % (each leaf's share spread evenly over its
// start..due) versus actual cumulative % (a leaf's share counts from the day it was completed).
func (c *taskCalc) projectCurve(p models.Project, now time.Time) (pts []curvePoint, ok bool) {
	shares := c.leafShares(p.ID)
	if len(shares) == 0 {
		return nil, false
	}
	var from, to *time.Time
	if p.StartDate != nil {
		d := day(*p.StartDate)
		from = &d
	}
	if p.EndDate != nil {
		d := day(*p.EndDate)
		to = &d
	}
	type leaf struct {
		share      float64
		start, due time.Time
		doneAt     *time.Time
	}
	var leaves []leaf
	for id, sh := range shares {
		s, d := c.effectiveDates(id)
		if s == nil || d == nil {
			if p.StartDate == nil || p.EndDate == nil {
				continue
			}
			s, d = p.StartDate, p.EndDate
		}
		l := leaf{share: sh, start: day(*s), due: day(*d)}
		if l.due.Before(l.start) {
			l.due = l.start
		}
		if t := c.tasks[id]; t.Status == "done" && t.CompletedAt != nil {
			dd := day(*t.CompletedAt)
			l.doneAt = &dd
		}
		leaves = append(leaves, l)
		if from == nil || l.start.Before(*from) {
			x := l.start
			from = &x
		}
		if to == nil || l.due.After(*to) {
			x := l.due
			to = &x
		}
	}
	if from == nil || to == nil || len(leaves) == 0 {
		return nil, false
	}
	round1 := func(v float64) float64 { return math.Round(v*1000) / 10 } // share (0..1) → percent with 1 decimal
	at := func(t time.Time) curvePoint {
		var plan, actual float64
		for _, l := range leaves {
			span := l.due.Sub(l.start).Hours()/24 + 1
			frac := (t.Sub(l.start).Hours()/24 + 1) / span
			plan += l.share * math.Min(1, math.Max(0, frac))
			if l.doneAt != nil && !l.doneAt.After(t) {
				actual += l.share
			}
		}
		pt := curvePoint{Date: t.Format("2006-01-02"), Plan: round1(plan)}
		if !t.After(day(now)) {
			a := round1(actual)
			pt.Actual = &a
		}
		return pt
	}
	for t := *from; t.Before(*to); t = t.AddDate(0, 0, 7) {
		pts = append(pts, at(t))
	}
	pts = append(pts, at(*to))
	return pts, true
}

package approval

import (
	"log"
	"sort"

	"github.com/dea-core/hcis/backend/internal/models"
	"gorm.io/gorm"
)

// Step kinds of a configured flow (stored in ApprovalFlowStep.Kind and copied to ApprovalStep.Kind).
const (
	KindDirectManager = "direct_manager" // the requester's superior (employees.manager_id)
	KindPosition      = "position"       // holder of a given jabatan
	KindHR            = "hr"             // the HR admin
	KindHRSuperior    = "hr_superior"    // the HR admin's own superior (else a super admin)
)

// FlowKey is a request type a flow can be configured for.
type FlowKey struct {
	Key   string `json:"key"`
	Label string `json:"label"`
}

// FlowKeys lists the request-type keys. Types without a flow (and unknown keys) keep the legacy n+1 behaviour.
var FlowKeys = []FlowKey{
	{"leave:cuti_tahunan", "Cuti tahunan (non roster)"},
	{"leave:izin", "Izin"},
	{"leave:sakit", "Sakit"},
	{"leave:roster", "Cuti tahunan anggota roster"},
	{"roster", "Penyesuaian jadwal roster"},
	{"attendance_manual", "Absensi manual"},
	{"attendance_location", "Absensi di luar lokasi"},
}

func ValidFlowKey(k string) bool {
	for _, f := range FlowKeys {
		if f.Key == k {
			return true
		}
	}
	return false
}

func ValidStepKind(k string) bool {
	return k == KindDirectManager || k == KindPosition || k == KindHR || k == KindHRSuperior
}

// LeaveFlowKey derives the flow key of a leave request from the leave type category and roster membership.
// Annual leave (cuti) by a roster member has its own key; unknown categories have none (legacy n+1).
func LeaveFlowKey(category string, rosterMember bool) string {
	switch category {
	case "cuti":
		if rosterMember {
			return "leave:roster"
		}
		return "leave:cuti_tahunan"
	case "izin":
		return "leave:izin"
	case "sakit":
		return "leave:sakit"
	}
	return ""
}

// defaultFlows: seeded once per key.
var defaultFlows = []struct {
	Key   string
	Name  string
	Steps []string
}{
	{"leave:cuti_tahunan", "Default Cuti Tahunan", []string{KindDirectManager, KindHR, KindHRSuperior}},
	{"leave:izin", "Default Izin", []string{KindDirectManager, KindHR, KindHRSuperior}},
	{"leave:roster", "Default Cuti Roster", []string{KindDirectManager, KindHR, KindHRSuperior}},
	{"roster", "Default Penyesuaian Roster", []string{KindDirectManager, KindHR, KindHRSuperior}},
	{"leave:sakit", "Default Sakit", []string{KindDirectManager}},
}

// EnsureDefaultFlows creates the default flow of a key once: only when no flow exists for it and it was never
// seeded before (a default an admin deleted stays deleted). Safe to run on every start.
func EnsureDefaultFlows(db *gorm.DB) {
	for _, d := range defaultFlows {
		var seeded, existing int64
		db.Model(&models.ApprovalFlowSeed{}).Where("key = ?", d.Key).Count(&seeded)
		if seeded > 0 {
			continue
		}
		db.Model(&models.ApprovalFlow{}).Where("request_type = ?", d.Key).Count(&existing)
		if existing == 0 {
			f := models.ApprovalFlow{Name: d.Name, RequestType: d.Key, IsActive: true}
			if err := db.Create(&f).Error != nil; err {
				continue
			}
			for i, k := range d.Steps {
				db.Create(&models.ApprovalFlowStep{FlowID: f.ID, Level: i + 1, Kind: k})
			}
			log.Println("approval: default flow seeded for", d.Key)
		}
		db.Create(&models.ApprovalFlowSeed{Key: d.Key})
	}
}

// FlowCandidate is the part of a flow that decides whether it applies (pure, so the ranking is testable).
type FlowCandidate struct {
	ID         uint
	BusinessID *uint
	Requesters []uint // requester position ids; empty = everyone
}

// PickFlow returns the most specific candidate for a requester: (requester position match) beats (business
// match) beats the generic flow; ties go to the lowest id. Flows that list other requester positions, or another
// business, do not apply. ok=false means no flow (legacy n+1).
func PickFlow(cands []FlowCandidate, businessID uint, positions []uint) (id uint, ok bool) {
	have := map[uint]bool{}
	for _, p := range positions {
		have[p] = true
	}
	best, bestScore := uint(0), -1
	sorted := append([]FlowCandidate(nil), cands...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].ID < sorted[j].ID })
	for _, c := range sorted {
		if c.BusinessID != nil && *c.BusinessID != businessID {
			continue
		}
		score := 0
		if len(c.Requesters) > 0 {
			match := false
			for _, p := range c.Requesters {
				if have[p] {
					match = true
				}
			}
			if !match {
				continue
			}
			score += 2
		}
		if c.BusinessID != nil {
			score++
		}
		if score > bestScore {
			best, bestScore = c.ID, score
		}
	}
	return best, bestScore >= 0
}

// StepLookup answers "who is this step's approver (user id, 0 = nobody)". avoid holds users that must not be
// picked (the requester and approvers already on the chain) so a holder/ancestor can be skipped over.
type StepLookup interface {
	DirectManager() uint
	PositionHolder(positionID uint, avoid map[uint]bool) uint
	HR() uint
	HRSuperior() uint // the HR approver's own superior, or a super admin when there is none
}

// ResolvedStep is one step of a resolved chain.
type ResolvedStep struct {
	UserID     uint
	Kind       string
	PositionID *uint
}

// ResolveSteps walks the configured steps in order: a step that resolves to nobody, to the requester, or to a
// user already on the chain is skipped. An empty result means the caller must use the fallback approver.
func ResolveSteps(steps []models.ApprovalFlowStep, requesterUser uint, lk StepLookup) []ResolvedStep {
	sorted := append([]models.ApprovalFlowStep(nil), steps...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Level < sorted[j].Level })
	seen := map[uint]bool{requesterUser: true}
	var out []ResolvedStep
	for _, s := range sorted {
		var uid uint
		var pos *uint
		switch s.Kind {
		case KindDirectManager:
			uid = lk.DirectManager()
		case KindPosition:
			if s.ApproverPositionID != nil {
				pos = s.ApproverPositionID
				uid = lk.PositionHolder(*s.ApproverPositionID, seen)
			}
		case KindHR:
			uid = lk.HR()
		case KindHRSuperior:
			uid = lk.HRSuperior()
		}
		if uid == 0 || seen[uid] {
			log.Printf("approval: flow step %d (%s) skipped (vacant or duplicate)", s.Level, s.Kind)
			continue
		}
		seen[uid] = true
		out = append(out, ResolvedStep{UserID: uid, Kind: s.Kind, PositionID: pos})
	}
	return out
}

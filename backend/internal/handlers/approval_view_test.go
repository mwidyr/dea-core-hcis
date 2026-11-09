package handlers

import (
	"testing"

	"github.com/dea-core/hcis/backend/internal/models"
)

func up(n uint) *uint { return &n }

func TestBuildChain(t *testing.T) {
	steps := []models.ApprovalStep{
		{Level: 2, ApproverUserID: 20, Kind: "fallback", Status: "Waiting"},
		{Level: 1, ApproverUserID: 10, Kind: "n+1", Status: "Approved"},
	}
	got := buildChain(steps, map[uint]string{10: "Budi", 20: "Sari"})
	if len(got) != 2 || got[0].Name != "Budi" || got[0].Level != 1 || got[0].Status != "Approved" || got[1].Name != "Sari" || got[1].Kind != "fallback" {
		t.Fatalf("chain not ordered/resolved: %+v", got)
	}
	if len(buildChain(nil, nil)) != 0 {
		t.Fatal("empty chain must be empty, not nil-panic")
	}
}

func TestCanSeeApproval(t *testing.T) {
	r := &models.ApprovalRequest{RequesterUserID: 5, RequesterEmployeeID: up(1), Steps: []models.ApprovalStep{{ApproverUserID: 10}}}
	cases := []struct {
		name     string
		group    bool
		actor    uint
		emp      *uint
		downline bool
		want     bool
	}{
		{"group-level", true, 99, nil, false, true},
		{"requester by account", false, 5, nil, false, true},
		{"requester by employee record (request filed by someone else)", false, 77, up(1), false, true},
		{"approver on the chain", false, 10, up(3), false, true},
		{"requester's superior", false, 40, up(4), true, true},
		{"unrelated colleague", false, 41, up(6), false, false},
		{"nobody without employee", false, 42, nil, false, false},
	}
	for _, c := range cases {
		if got := canSeeApproval(c.group, c.actor, c.emp, r, c.downline); got != c.want {
			t.Errorf("%s: got %v want %v", c.name, got, c.want)
		}
	}
}

func TestDashboardView(t *testing.T) {
	cases := []struct {
		canTeam, canPersonal bool
		asked, want          string
	}{
		{true, false, "me", "team"}, // super admin is forced to the team view
		{true, true, "me", "me"},    // manager / HR can switch to Personal
		{true, true, "team", "team"},
		{false, true, "team", "me"}, // no team: Personal only
		{false, true, "", "me"},
		{true, true, "", "team"},
	}
	for _, c := range cases {
		if got := dashboardView(c.canTeam, c.canPersonal, c.asked); got != c.want {
			t.Errorf("%+v: got %s", c, got)
		}
	}
}

func TestCanCancelAdjustment(t *testing.T) {
	a := models.RosterAdjustment{EmployeeID: 1, Status: "Pending Approval"}
	if !canCancelAdjustment(false, up(1), a) {
		t.Error("requester may cancel")
	}
	if !canCancelAdjustment(true, nil, a) {
		t.Error("HR/super admin may cancel")
	}
	if canCancelAdjustment(false, up(2), a) {
		t.Error("a direct manager (not the requester) may not cancel")
	}
	a.Status = "Disetujui"
	if canCancelAdjustment(true, nil, a) {
		t.Error("only pending requests can be cancelled")
	}
}

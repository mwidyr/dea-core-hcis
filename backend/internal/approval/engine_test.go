package approval

import (
	"testing"

	"github.com/dea-core/hcis/backend/internal/models"
)

func u(n uint) *uint { return &n }

func TestMayDecide(t *testing.T) {
	cases := []struct {
		name                   string
		stepApprover, actor    uint
		role                   string
		requesterUser          uint
		requesterEmp, actorEmp *uint
		want                   error
	}{
		{"the step approver decides", 10, 10, "manager", 5, u(1), u(2), nil},
		{"a super admin may act on someone else's request", 10, 99, "super_admin", 5, u(1), u(3), nil},
		{"an unrelated manager may not", 10, 11, "manager", 5, u(1), u(4), ErrNotAllowed},
		{"the requester may not approve their own request", 5, 5, "manager", 5, u(1), u(1), ErrSelfApproval},
		{"a super admin may not approve their own request", 99, 99, "super_admin", 99, u(7), u(7), ErrSelfApproval},
		{"a super admin may not approve a request filed for their own employee record", 10, 99, "super_admin", 5, u(7), u(7), ErrSelfApproval},
		{"HR who filed leave for someone else may not decide it (no employee link needed)", 10, 5, "hr_admin", 5, u(1), nil, ErrSelfApproval},
		{"actor without employee record is judged by user id only", 10, 10, "manager", 5, u(1), nil, nil},
	}
	for _, c := range cases {
		if got := MayDecide(c.stepApprover, c.actor, c.role, c.requesterUser, c.requesterEmp, c.actorEmp); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

func TestCanDecideNow(t *testing.T) {
	mk := func(status string, level int, stepStatus string) *models.ApprovalRequest {
		return &models.ApprovalRequest{Status: status, CurrentLevel: level, RequesterUserID: 5, RequesterEmployeeID: u(1),
			Steps: []models.ApprovalStep{{Level: 1, ApproverUserID: 10, Status: Approved}, {Level: 2, ApproverUserID: 20, Status: stepStatus}}}
	}
	cases := []struct {
		name  string
		req   *models.ApprovalRequest
		actor uint
		role  string
		emp   *uint
		want  bool
	}{
		{"current approver", mk(Pending, 2, Pending), 20, "manager", u(2), true},
		{"earlier approver no longer decides", mk(Pending, 2, Pending), 10, "manager", u(3), false},
		{"super admin may decide", mk(Pending, 2, Pending), 99, "super_admin", u(9), true},
		{"requester never", mk(Pending, 2, Pending), 5, "super_admin", u(1), false},
		{"requester by employee record never", mk(Pending, 2, Pending), 99, "super_admin", u(1), false},
		{"already decided", mk(Approved, 2, Approved), 20, "manager", u(2), false},
		{"waiting step is not decidable", mk(Pending, 2, "Waiting"), 20, "manager", u(2), false},
	}
	for _, c := range cases {
		if got := CanDecideNow(c.req, c.actor, c.role, c.emp); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

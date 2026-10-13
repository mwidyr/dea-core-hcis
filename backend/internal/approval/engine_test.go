package approval

import "testing"

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

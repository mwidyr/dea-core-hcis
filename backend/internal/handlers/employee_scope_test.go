package handlers

import "testing"

func TestEmployeeVisible(t *testing.T) {
	// 1 (director) -> 2 (manager) -> 3, 4 (staff); 5 is another manager under 1
	parent := map[uint]uint{2: 1, 3: 2, 4: 2, 5: 1}
	below := func(me, target uint) bool {
		for p, ok := parent[target]; ok; p, ok = parent[p] {
			if p == me {
				return true
			}
		}
		return false
	}
	u := func(n uint) *uint { return &n }
	cases := []struct {
		name   string
		group  bool
		me     *uint
		target uint
		want   bool
	}{
		{"self", false, u(2), 2, true},
		{"direct report", false, u(2), 3, true},
		{"downline of downline", false, u(1), 3, true},
		{"superior hidden", false, u(2), 1, false},
		{"peer hidden", false, u(2), 5, false},
		{"staff peer hidden", false, u(3), 4, false},
		{"leaf sees self only", false, u(3), 3, true},
		{"no employee link", false, nil, 3, false},
		{"group sees all", true, nil, 5, true},
	}
	for _, tc := range cases {
		if got := employeeVisible(tc.group, tc.me, tc.target, below); got != tc.want {
			t.Errorf("%s: got %v want %v", tc.name, got, tc.want)
		}
	}
}

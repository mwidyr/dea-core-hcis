package handlers

import "testing"

func TestValidateFlow(t *testing.T) {
	exists := func(id uint) bool { return id < 100 }
	p := func(n uint) *uint { return &n }
	mk := func(kind string, pos *uint) flowInput {
		in := flowInput{Name: "x", RequestType: "roster"}
		in.Steps = append(in.Steps, struct {
			Kind               string `json:"kind"`
			ApproverPositionID *uint  `json:"approver_position_id"`
		}{kind, pos})
		return in
	}
	ok := mk("direct_manager", nil)
	if m := validateFlow(&ok, exists); m != "" {
		t.Errorf("valid flow rejected: %s", m)
	}
	for name, in := range map[string]flowInput{
		"position needs id":      mk("position", nil),
		"position must exist":    mk("position", p(500)),
		"other kinds forbid pos": mk("hr", p(1)),
		"unknown kind":           mk("boss", nil),
		"no steps":               {Name: "x", RequestType: "roster"},
		"unknown type":           {Name: "x", RequestType: "nope"},
		"no name":                {RequestType: "roster"},
	} {
		in := in
		if validateFlow(&in, exists) == "" {
			t.Errorf("%s: expected rejection", name)
		}
	}
	d := mk("hr", nil)
	d.RequesterPositionIDs = []uint{3, 3, 4}
	validateFlow(&d, exists)
	if len(d.RequesterPositionIDs) != 2 {
		t.Errorf("requester positions must be de-duplicated, got %v", d.RequesterPositionIDs)
	}
	if scopeSig(nil, []uint{2, 1}) != scopeSig(nil, []uint{1, 2}) {
		t.Error("scope signature must ignore order")
	}
}

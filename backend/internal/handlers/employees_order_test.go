package handlers

import "testing"

func TestEmployeeOrderIsWhitelisted(t *testing.T) {
	cases := []struct{ sort, dir, want string }{
		{"", "", "employees.name ASC"},
		{"name", "desc", "employees.name DESC"},
		{"tenure", "asc", "employees.join_date DESC NULLS LAST, employees.name"},
		{"tenure", "desc", "employees.join_date ASC NULLS LAST, employees.name"},
		{"contract_end", "", "employees.contract_end ASC NULLS LAST, employees.name"},
		{"contract_end", "desc", "employees.contract_end DESC NULLS LAST, employees.name"},
		{"password; DROP TABLE employees", "asc", "employees.name ASC"}, // anything else falls back to the default
	}
	for _, c := range cases {
		if got := employeeOrder(c.sort, c.dir); got != c.want {
			t.Errorf("employeeOrder(%q,%q) = %q, want %q", c.sort, c.dir, got, c.want)
		}
	}
}

func TestStatusKeepsLogin(t *testing.T) {
	for status, want := range map[string]bool{"Aktif": true, "Non aktif": true, "Suspend": false, "Tidak Bekerja": false, "": false} {
		if got := statusKeepsLogin(status); got != want {
			t.Errorf("statusKeepsLogin(%q) = %v, want %v", status, got, want)
		}
	}
}

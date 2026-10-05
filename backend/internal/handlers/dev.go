package handlers

import (
	"net/http"
	"sort"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
)

// DevLoginEnabled mirrors config.DevLogin. These handlers are only routed when it is true (see router), and the
// public attendance endpoint checks it too. It bypasses passwords on purpose — never enable it in production.
var DevLoginEnabled bool

type devAccount struct {
	ID       uint     `json:"id"`
	Name     string   `json:"name"`
	Email    string   `json:"email"`
	Role     string   `json:"role"`
	NIK      string   `json:"nik"`
	Position string   `json:"position"`
	Business []string `json:"businesses"`
	HasEmp   bool     `json:"has_employee"`
}

// DevAccounts lists the active accounts for the "pick an account" panel on the login / attendance pages.
func DevAccounts(c *gin.Context) {
	var us []models.User
	database.DB.Preload("Businesses").Where("is_active = true").Find(&us)
	emps := map[uint]models.Employee{}
	var es []models.Employee
	database.DB.Preload("Position").Find(&es)
	for _, e := range es {
		emps[e.ID] = e
	}
	rank := map[string]int{"super_admin": 0, "hr_admin": 1, "manager": 2, "employee": 3}
	out := make([]devAccount, 0, len(us))
	for _, u := range us {
		a := devAccount{ID: u.ID, Name: u.Name, Email: u.Email, Role: u.Role}
		for _, b := range u.Businesses {
			a.Business = append(a.Business, b.Code)
		}
		if u.EmployeeID != nil {
			if e, ok := emps[*u.EmployeeID]; ok {
				a.HasEmp, a.NIK = true, e.NIK
				if e.Position != nil {
					a.Position = e.Position.Title
				}
			}
		}
		out = append(out, a)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if rank[out[i].Role] != rank[out[j].Role] {
			return rank[out[i].Role] < rank[out[j].Role]
		}
		return out[i].Name < out[j].Name
	})
	c.JSON(http.StatusOK, out)
}

// DevLogin signs the caller in as the given user — no password.
func DevLogin(c *gin.Context) {
	var in struct {
		UserID uint `json:"user_id"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.UserID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id wajib diisi"})
		return
	}
	var u models.User
	if database.DB.Preload("Businesses").Where("is_active = true").Limit(1).Find(&u, in.UserID).Error != nil || u.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "akun tidak ditemukan atau nonaktif"})
		return
	}
	c.JSON(http.StatusOK, issueSession(&u))
}

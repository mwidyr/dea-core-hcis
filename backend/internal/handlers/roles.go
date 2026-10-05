package handlers

import (
	"net/http"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/perm"
	"github.com/gin-gonic/gin"
)

func editableRole(c *gin.Context) (string, bool) {
	r := c.Param("role")
	for _, x := range perm.Roles {
		if x == r && r != "super_admin" {
			return r, true
		}
	}
	c.JSON(http.StatusBadRequest, gin.H{"error": "role tidak dapat diubah (Super Admin selalu memiliki semua izin)"})
	return "", false
}

// GetRolePermissions returns the full matrix: permission definitions plus what every role holds.
func GetRolePermissions(c *gin.Context) {
	roles := gin.H{}
	for _, r := range perm.Roles {
		roles[r] = perm.For(r)
	}
	c.JSON(http.StatusOK, gin.H{"permissions": perm.Defs, "roles": roles, "role_list": perm.Roles})
}

func SetRolePermissions(c *gin.Context) {
	role, ok := editableRole(c)
	if !ok {
		return
	}
	var in struct {
		Permissions []string `json:"permissions"`
	}
	if c.ShouldBindJSON(&in) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "data tidak valid"})
		return
	}
	for _, k := range in.Permissions {
		if !perm.Valid(k) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "izin tidak dikenal: " + k})
			return
		}
		if perm.IsLocked(k) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "izin \"" + k + "\" hanya untuk Super Admin"})
			return
		}
	}
	if err := perm.Set(database.DB, role, in.Permissions); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "gagal menyimpan izin"})
		return
	}
	audit(c, "update", "role_permissions:"+role, 0)
	c.JSON(http.StatusOK, gin.H{"role": role, "permissions": perm.For(role)})
}

func ResetRolePermissions(c *gin.Context) {
	role, ok := editableRole(c)
	if !ok {
		return
	}
	if err := perm.Reset(database.DB, role); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "gagal mengembalikan izin"})
		return
	}
	audit(c, "reset", "role_permissions:"+role, 0)
	c.JSON(http.StatusOK, gin.H{"role": role, "permissions": perm.For(role)})
}

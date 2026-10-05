package handlers

import (
	"net/http"
	"strings"
	"time"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/middleware"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/dea-core/hcis/backend/internal/perm"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

func Login(c *gin.Context) {
	var in struct {
		Email    string `json:"email" binding:"required"`
		Password string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email dan password wajib diisi"})
		return
	}
	// brute-force protection: only FAILED attempts count (shared with the public attendance page)
	ident := strings.ToLower(strings.TrimSpace(in.Email))
	ipKey, acctKey := "ip:"+c.ClientIP(), "acct:"+ident
	if limiter.over(ipKey, 20, 5*time.Minute) || limiter.over(acctKey, 5, 15*time.Minute) {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Terlalu banyak percobaan gagal. Coba lagi dalam beberapa menit."})
		return
	}
	var u models.User
	if err := database.DB.Preload("Businesses").Where("lower(email) = ? AND is_active = true", ident).First(&u).Error; err != nil ||
		bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(in.Password)) != nil {
		limiter.add(ipKey)
		limiter.add(acctKey)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "email atau password salah"})
		return
	}
	limiter.reset(acctKey)
	c.JSON(http.StatusOK, issueSession(&u))
}

// issueSession signs a 24 h token for the user and returns the login response body.
func issueSession(u *models.User) gin.H {
	claims := middleware.Claims{UserID: u.ID, Email: u.Email, Role: u.Role, Name: u.Name,
		RegisteredClaims: jwt.RegisteredClaims{ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour))}}
	tok, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(middleware.JWTSecret))
	return gin.H{"token": tok, "user": userView(u)}
}

func Me(c *gin.Context) {
	var u models.User
	if err := database.DB.Preload("Businesses").First(&u, uid(c)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user tidak ditemukan"})
		return
	}
	c.JSON(http.StatusOK, userView(&u))
}

func ChangePassword(c *gin.Context) {
	var in struct {
		Old string `json:"old_password" binding:"required"`
		New string `json:"new_password" binding:"required,min=6"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "password baru minimal 6 karakter"})
		return
	}
	var u models.User
	database.DB.First(&u, uid(c))
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(in.Old)) != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "password lama salah"})
		return
	}
	h, _ := bcrypt.GenerateFromPassword([]byte(in.New), bcrypt.DefaultCost)
	database.DB.Model(&u).Update("password_hash", string(h))
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func userView(u *models.User) gin.H {
	return gin.H{"id": u.ID, "email": u.Email, "name": u.Name, "role": u.Role, "employee_id": u.EmployeeID, "businesses": u.Businesses, "permissions": perm.For(u.Role)}
}

// Businesses returns the businesses the caller may switch to.
func Businesses(c *gin.Context) {
	var list []models.Business
	q := database.DB.Where("is_active = true").Order("id")
	if ids := allowedBusinessIDs(c); ids != nil {
		q = q.Where("id IN ?", ids)
	}
	q.Find(&list)
	c.JSON(http.StatusOK, list)
}

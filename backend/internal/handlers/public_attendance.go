package handlers

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

// The public attendance page needs no session: the employee proves who they are with NIK/email +
// password on every tap. Because it is unauthenticated it is rate-limited per IP and per account.

type attemptLimiter struct {
	mu   sync.Mutex
	hits map[string][]time.Time
}

var limiter = &attemptLimiter{hits: map[string][]time.Time{}}

// over reports whether key already has >= max events in the window; add records one event.
func (l *attemptLimiter) over(key string, max int, window time.Duration) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	cut := time.Now().Add(-window)
	kept := l.hits[key][:0]
	for _, t := range l.hits[key] {
		if t.After(cut) {
			kept = append(kept, t)
		}
	}
	l.hits[key] = kept
	return len(kept) >= max
}

func (l *attemptLimiter) add(key string) {
	l.mu.Lock()
	l.hits[key] = append(l.hits[key], time.Now())
	l.mu.Unlock()
}

func (l *attemptLimiter) reset(key string) {
	l.mu.Lock()
	delete(l.hits, key)
	l.mu.Unlock()
}

// PublicClock gives the browser the authoritative server time, so the on-screen clock cannot drift
// from (or be faked relative to) the time actually recorded.
func PublicClock(c *gin.Context) {
	now := time.Now()
	c.JSON(http.StatusOK, gin.H{"now": now.UTC().Format(time.RFC3339Nano), "ms": now.UnixMilli(), "timezone": "Asia/Jakarta"})
}

func PublicAttendance(c *gin.Context) {
	var in struct {
		Identifier string   `json:"identifier"`
		Password   string   `json:"password"`
		DevUserID  uint     `json:"dev_user_id"` // DEV_LOGIN only: tap as this user without a password
		Action     string   `json:"action"`
		Lat        *float64 `json:"lat"`
		Lng        *float64 `json:"lng"`
		Accuracy   *float64 `json:"accuracy"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || (in.Action != "in" && in.Action != "out") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "NIK/email, password, dan aksi (tap in / tap out) wajib diisi"})
		return
	}
	if in.DevUserID != 0 && DevLoginEnabled { // local-development shortcut: no password, otherwise identical rules (GPS, schedule, …)
		var du models.User
		database.DB.Where("is_active = true").Limit(1).Find(&du, in.DevUserID)
		if du.ID == 0 || du.EmployeeID == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "akun uji tidak valid atau tidak terhubung ke data karyawan"})
			return
		}
		tapAs(c, du, in.Action, in.Lat, in.Lng, in.Accuracy)
		return
	}
	if strings.TrimSpace(in.Identifier) == "" || in.Password == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "NIK/email, password, dan aksi (tap in / tap out) wajib diisi"})
		return
	}
	ident := strings.ToLower(strings.TrimSpace(in.Identifier))
	ip := c.ClientIP()
	ipKey, acctKey := "ip:"+ip, "acct:"+ident
	// only FAILED logins count: an office behind one NAT IP must be able to tap in all at once at 08:00
	if limiter.over(ipKey, 20, 5*time.Minute) || limiter.over(acctKey, 5, 15*time.Minute) {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Terlalu banyak percobaan gagal. Coba lagi dalam beberapa menit."})
		return
	}
	badLogin := func() {
		limiter.add(ipKey)
		limiter.add(acctKey)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "NIK/email atau password salah"})
	}

	// identifier = email, or the NIK of the employee that owns the account
	var u models.User
	database.DB.Where(`is_active = true AND (lower(email) = ? OR employee_id IN (SELECT id FROM employees WHERE lower(nik) = ?))`, ident, ident).Limit(1).Find(&u)
	if u.ID == 0 || bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(in.Password)) != nil {
		badLogin()
		return
	}
	limiter.reset(acctKey) // correct credentials clear the failure counter
	tapAs(c, u, in.Action, in.Lat, in.Lng, in.Accuracy)
}

// tapAs runs the tap for an already-authenticated user and writes the HTTP response.
func tapAs(c *gin.Context, u models.User, action string, lat, lng, acc *float64) {
	if u.EmployeeID == nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Akun ini tidak terhubung ke data karyawan, tidak dapat absen."})
		return
	}
	var emp models.Employee
	database.DB.Preload("Position").Limit(1).Find(&emp, *u.EmployeeID)
	if emp.ID == 0 || emp.Status != "Aktif" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Karyawan tidak aktif, tidak dapat absen."})
		return
	}
	res, terr := performTap(tapRequest{Emp: emp, Action: action, Lat: lat, Lng: lng, Acc: acc, IP: c.ClientIP(), Now: time.Now()})
	if terr != nil {
		c.JSON(terr.Status, gin.H{"error": terr.Msg, "name": emp.Name})
		return
	}
	database.DB.Create(&models.AuditLog{UserID: u.ID, Action: "tap_" + action, Entity: "attendance", EntityID: emp.NIK})
	res["name"], res["nik"] = emp.Name, emp.NIK
	if emp.Position != nil {
		res["position"] = emp.Position.Title
	}
	c.JSON(http.StatusOK, res)
}

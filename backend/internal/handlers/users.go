package handlers

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

var validRole = map[string]bool{"super_admin": true, "hr_admin": true, "manager": true, "employee": true}

type userRow struct {
	models.User
	EmployeeName string `json:"employee_name"`
}

func ListUsers(c *gin.Context) {
	var us []models.User
	database.DB.Preload("Businesses").Order("name").Find(&us)
	names := map[uint]string{}
	var emps []models.Employee
	database.DB.Select("id, name").Find(&emps)
	for _, e := range emps {
		names[e.ID] = e.Name
	}
	out := make([]userRow, 0, len(us))
	for _, u := range us {
		v := userRow{User: u}
		if u.EmployeeID != nil {
			v.EmployeeName = names[*u.EmployeeID]
		}
		out = append(out, v)
	}
	c.JSON(http.StatusOK, out)
}

type userInput struct {
	Email       string `json:"email"`
	Name        string `json:"name"`
	Password    string `json:"password"`
	Role        string `json:"role"`
	EmployeeID  *uint  `json:"employee_id"`
	BusinessIDs []uint `json:"business_ids"`
	IsActive    *bool  `json:"is_active"`
}

func hashPw(p string) string {
	h, _ := bcrypt.GenerateFromPassword([]byte(p), bcrypt.DefaultCost)
	return string(h)
}

func CreateUser(c *gin.Context) {
	var in userInput
	if err := c.ShouldBindJSON(&in); err != nil || !validRole[in.Role] || len(in.Password) < 6 || !strings.Contains(in.Email, "@") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email valid, password minimal 6 karakter, dan role wajib diisi"})
		return
	}
	in.Email = strings.ToLower(strings.TrimSpace(in.Email))
	var dup int64
	database.DB.Model(&models.User{}).Where("email = ?", in.Email).Count(&dup)
	if dup > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "email sudah dipakai"})
		return
	}
	u := models.User{Email: in.Email, Name: strings.TrimSpace(in.Name), Role: in.Role, PasswordHash: hashPw(in.Password), IsActive: true}
	bizIDs := in.BusinessIDs
	if in.EmployeeID != nil {
		var e models.Employee
		if database.DB.Limit(1).Find(&e, *in.EmployeeID).Error != nil || e.ID == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "karyawan tidak ditemukan"})
			return
		}
		var taken int64
		database.DB.Model(&models.User{}).Where("employee_id = ?", e.ID).Count(&taken)
		if taken > 0 {
			c.JSON(http.StatusConflict, gin.H{"error": "karyawan ini sudah punya akun"})
			return
		}
		u.EmployeeID = &e.ID
		if u.Name == "" {
			u.Name = e.Name
		}
		bizIDs = append(bizIDs, e.BusinessID)
	}
	if u.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "nama wajib diisi"})
		return
	}
	if err := database.DB.Create(&u).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	setUserBusinesses(u.ID, bizIDs)
	audit(c, "create", "user", u.ID)
	c.JSON(http.StatusOK, u)
}

func setUserBusinesses(userID uint, ids []uint) {
	database.DB.Exec("DELETE FROM user_businesses WHERE user_id = ?", userID)
	seen := map[uint]bool{}
	for _, id := range ids {
		if id != 0 && !seen[id] {
			seen[id] = true
			database.DB.Exec("INSERT INTO user_businesses (user_id, business_id) VALUES (?, ?)", userID, id)
		}
	}
}

// UpdateUser edits name/role/active/businesses and optionally resets the password.
func UpdateUser(c *gin.Context) {
	var in userInput
	if err := c.ShouldBindJSON(&in); err != nil || (in.Role != "" && !validRole[in.Role]) || (in.Password != "" && len(in.Password) < 6) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "data tidak valid (password minimal 6 karakter)"})
		return
	}
	var u models.User
	if database.DB.Limit(1).Find(&u, paramID(c)).Error != nil || u.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "user tidak ditemukan"})
		return
	}
	if u.ID == uid(c) && ((in.IsActive != nil && !*in.IsActive) || (in.Role != "" && in.Role != u.Role)) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Anda tidak dapat menonaktifkan atau mengubah role akun sendiri"})
		return
	}
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if in.Name != "" {
			u.Name = strings.TrimSpace(in.Name)
		}
		if in.Role != "" {
			u.Role = in.Role
		}
		if in.IsActive != nil {
			u.IsActive = *in.IsActive
		}
		if in.Password != "" {
			u.PasswordHash = hashPw(in.Password)
		}
		return tx.Omit("Businesses").Save(&u).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if in.BusinessIDs != nil {
		setUserBusinesses(u.ID, in.BusinessIDs)
	}
	audit(c, "update", "user", u.ID)
	c.JSON(http.StatusOK, u)
}

func ListAudit(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 200 {
		size = 20
	}
	q := database.DB.Table("audit_logs a").Joins("LEFT JOIN users u ON u.id = a.user_id")
	if s := c.Query("q"); s != "" {
		like := "%" + s + "%"
		q = q.Where("a.action ILIKE ? OR a.entity ILIKE ? OR u.name ILIKE ?", like, like, like)
	}
	var total int64
	q.Count(&total)
	type row struct {
		ID        uint      `json:"id"`
		UserName  string    `json:"user_name"`
		Action    string    `json:"action"`
		Entity    string    `json:"entity"`
		EntityID  string    `json:"entity_id"`
		CreatedAt time.Time `json:"created_at"`
	}
	rows := []row{}
	q.Select("a.id, u.name AS user_name, a.action, a.entity, a.entity_id, a.created_at").Order("a.id DESC").Limit(size).Offset((page - 1) * size).Scan(&rows)
	c.JSON(http.StatusOK, gin.H{"data": rows, "total": total, "page": page, "page_size": size})
}

// EmployeeDocLabels: which document labels each employee has (for the Kontrak & Dokumen checklist).
func EmployeeDocLabels(c *gin.Context) {
	type row struct {
		EmployeeID uint
		Label      string
	}
	var rows []row
	q := database.DB.Table("employee_documents d").Joins("JOIN employees e ON e.id = d.employee_id")
	scopeBusiness(c, q, "e.business_id").Select("d.employee_id, d.label").Scan(&rows)
	out := map[uint][]string{}
	for _, r := range rows {
		out[r.EmployeeID] = append(out[r.EmployeeID], r.Label)
	}
	c.JSON(http.StatusOK, out)
}

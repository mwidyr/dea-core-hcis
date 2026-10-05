package database

import (
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"log"
	"regexp"
	"strings"
	"time"

	"github.com/dea-core/hcis/backend/internal/models"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// seed_org.json is extracted from the CORE prototype (V113 orgDemoData):
// per business → units [level,type,name,parent], positions [title,unit,levelClass,reportsTo,holder?],
// locations [name,type,city].
//
//go:embed seed_org.json
var orgSeed []byte

type seedBusiness struct {
	Code      string     `json:"code"`
	Units     [][]string `json:"units"`
	Positions [][]string `json:"positions"`
	Locations [][]string `json:"locations"`
}

// Known contract / join info from the prototype's Karyawan table (V84).
var knownEmp = map[string]struct {
	Type, Join, ContractEnd string
}{
	"Abdul Haq":                {"Tetap", "2020-06-01", ""},
	"Riska Irawan":             {"Tetap", "2021-02-01", ""},
	"Asri Alfisyar Rahma":      {"Kontrak", "2023-07-01", "2026-10-18"},
	"Maulana Syawal":           {"Tetap", "2022-09-01", ""},
	"Rivaldy Alnuari Ramadhan": {"Kontrak", "2025-03-01", "2026-12-31"},
}

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

// Initial passwords for the first-time seed (set from config before Connect). Empty = development defaults, or random in production.
var SeedAdminPassword, SeedEmployeePassword string
var SeedProduction bool

func randomPassword() string {
	b := make([]byte, 12)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func Seed(db *gorm.DB) {
	var n int64
	db.Model(&models.Business{}).Count(&n)
	if n > 0 {
		return
	}
	var data map[string]seedBusiness
	if err := json.Unmarshal(orgSeed, &data); err != nil {
		log.Fatal("seed: bad org seed:", err)
	}
	log.Println("Seeding organisation data from prototype…")

	empByName := map[string]*models.Employee{}
	placed := map[[2]uint]bool{} // (employee, business) already has a placement
	posByBizTitle := map[uint]map[string]*models.Position{}

	order := []string{"DEA Global", "DGN Parts", "Mocco Coffee", "Angsana Farm", "Tiga Nata Ruang", "Angkasa Yudistira Travel", "JalanUmroh", "Rotienak"}
	for _, name := range order {
		d := data[name]
		biz := models.Business{Code: d.Code, Name: name, IsActive: true}
		db.Create(&biz)

		// units (parents referenced by name → create in listed order, parents come first)
		unitByName := map[string]*models.OrgUnit{}
		for _, u := range d.Units {
			unit := &models.OrgUnit{BusinessID: biz.ID, Level: levelNum(u[0]), TypeName: u[1], Name: u[2], IsActive: true}
			if p, ok := unitByName[u[3]]; ok {
				unit.ParentID = &p.ID
			}
			db.Create(unit)
			unitByName[u[2]] = unit
		}
		var locs []*models.Location
		for _, l := range d.Locations {
			loc := &models.Location{BusinessID: biz.ID, Name: l[0], TypeName: l[1], City: l[2], RadiusM: 100, IsActive: true}
			db.Create(loc)
			locs = append(locs, loc)
		}

		posByBizTitle[biz.ID] = map[string]*models.Position{}
		for _, p := range d.Positions {
			pos := &models.Position{BusinessID: biz.ID, Title: p[0], LevelClass: p[2]}
			unit, ok := unitByName[p[1]]
			if !ok { // position references a unit missing from the unit list — create under Management
				unit = &models.OrgUnit{BusinessID: biz.ID, Level: 3, TypeName: "Bagian", Name: p[1], IsActive: true}
				if root := firstRoot(unitByName); root != nil {
					unit.ParentID = &root.ID
				}
				db.Create(unit)
				unitByName[p[1]] = unit
			}
			pos.UnitID = &unit.ID
			db.Create(pos)
			posByBizTitle[biz.ID][p[0]] = pos
		}
		// reporting line
		for _, p := range d.Positions {
			if p[3] == "" || p[3] == "-" {
				continue
			}
			if parent, ok := posByBizTitle[biz.ID][p[3]]; ok {
				db.Model(posByBizTitle[biz.ID][p[0]]).Update("reports_to_id", parent.ID)
				posByBizTitle[biz.ID][p[0]].ReportsToID = &parent.ID
			}
		}
		// employees = position holders (dedupe by name → extra position = additional placement)
		for _, p := range d.Positions {
			if len(p) < 5 {
				continue
			}
			holder := cleanHolder(p[4])
			if holder == "" || holder == "-" || strings.EqualFold(holder, "Vacant") {
				continue
			}
			pos := posByBizTitle[biz.ID][p[0]]
			if e, ok := empByName[holder]; ok {
				// one position per business: a second position in the same business is not allowed
				if placed[[2]uint{e.ID, biz.ID}] {
					log.Printf("seed: %s already has a position in %s, skipping %q (left vacant)", holder, name, p[0])
					continue
				}
				placed[[2]uint{e.ID, biz.ID}] = true
				db.Create(&models.EmployeePlacement{EmployeeID: e.ID, BusinessID: biz.ID, PositionID: pos.ID})
				continue
			}
			e := &models.Employee{BusinessID: biz.ID, Name: holder, PositionID: &pos.ID, UnitID: pos.UnitID,
				EmployeeType: "Tetap", Status: "Aktif", IsActive: true}
			if len(locs) > 0 {
				e.LocationID = &locs[0].ID
			}
			if k, ok := knownEmp[holder]; ok {
				e.EmployeeType = k.Type
				e.JoinDate = parseDate(k.Join)
				if k.ContractEnd != "" {
					e.ContractEnd = parseDate(k.ContractEnd)
				}
			}
			e.Email = slugRe.ReplaceAllString(strings.ToLower(holder), ".") + "@" + slugRe.ReplaceAllString(strings.ToLower(name), "") + ".local"
			db.Create(e)
			db.Create(&models.EmployeePlacement{EmployeeID: e.ID, BusinessID: biz.ID, PositionID: pos.ID, IsPrimary: true})
			placed[[2]uint{e.ID, biz.ID}] = true
			empByName[holder] = e
		}
	}

	// n+1 manager: holder of the position this one reports to (same business)
	var emps []models.Employee
	db.Find(&emps)
	for _, e := range emps {
		if e.PositionID == nil {
			continue
		}
		cur := *e.PositionID
		for depth := 0; depth < 10; depth++ { // climb until a filled position is found
			var pos models.Position
			if db.Limit(1).Find(&pos, cur); pos.ID == 0 || pos.ReportsToID == nil {
				break
			}
			var mgr models.Employee
			if err := db.Where("position_id = ?", *pos.ReportsToID).Limit(1).Find(&mgr).Error; err == nil && mgr.ID != 0 && mgr.ID != e.ID {
				db.Model(&models.Employee{}).Where("id = ?", e.ID).Update("manager_id", mgr.ID)
				break
			}
			cur = *pos.ReportsToID
		}
	}

	// accounts
	var all []models.Business
	db.Find(&all)
	hash := func(pw string) string {
		h, _ := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
		return string(h)
	}
	adminPw := SeedAdminPassword
	if adminPw == "" {
		adminPw = "admin123"
		if SeedProduction {
			adminPw = randomPassword()
			log.Printf("=== PASSWORD AWAL admin@dea.local: %s  (catat sekarang, tidak ditampilkan lagi; ganti setelah login) ===", adminPw)
		}
	}
	empPw := func(models.Employee) string {
		switch {
		case SeedEmployeePassword != "":
			return SeedEmployeePassword
		case SeedProduction:
			return randomPassword() // unusable until HR sets one in Settings → User & Hak Akses
		}
		return "password123"
	}
	admin := models.User{Email: "admin@dea.local", Name: "Super Admin", Role: "super_admin", PasswordHash: hash(adminPw), IsActive: true, Businesses: all}
	db.Create(&admin)
	db.Find(&emps)
	for _, e := range emps {
		role := "employee"
		var cnt int64
		db.Model(&models.Employee{}).Where("manager_id = ?", e.ID).Count(&cnt)
		if cnt > 0 {
			role = "manager"
		}
		if e.Name == "Asri Alfisyar Rahma" { // Manager HCGA
			role = "hr_admin"
		}
		eid := e.ID
		u := models.User{Email: e.Email, Name: e.Name, Role: role, EmployeeID: &eid, PasswordHash: hash(empPw(e)), IsActive: true}
		db.Create(&u)
		var biz models.Business
		db.First(&biz, e.BusinessID)
		db.Model(&u).Association("Businesses").Append(&biz)
	}
	if SeedProduction {
		log.Printf("Seed done: %d businesses, %d employees (production: akun karyawan memakai password acak/SEED_EMPLOYEE_PASSWORD — HR perlu mengatur password di Settings).", len(all), len(emps))
	} else {
		log.Printf("Seed done: %d businesses, %d employees. Login: admin@dea.local / admin123 (employees: <email> / password123)", len(all), len(emps))
	}
}

func levelNum(s string) int {
	n := 0
	for _, c := range s {
		if c >= '0' && c <= '9' {
			n = n*10 + int(c-'0')
		}
	}
	if n == 0 {
		return 1
	}
	return n
}

func firstRoot(m map[string]*models.OrgUnit) *models.OrgUnit {
	for _, u := range m {
		if u.Level == 1 {
			return u
		}
	}
	return nil
}

// "Annisa Nevelfia / Network Engineer" → "Annisa Nevelfia"
func cleanHolder(s string) string {
	if i := strings.Index(s, " / "); i >= 0 {
		s = s[:i]
	}
	return strings.TrimSpace(s)
}

func parseDate(s string) *time.Time {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return nil
	}
	return &t
}

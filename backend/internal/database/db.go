package database

import (
	"fmt"
	"log"
	"strings"

	"github.com/dea-core/hcis/backend/internal/config"
	"github.com/dea-core/hcis/backend/internal/models"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

func Connect(cfg *config.Config) {
	dsn := fmt.Sprintf(
		"host=%s user=%s password=%s dbname=%s port=%s sslmode=disable TimeZone=Asia/Jakarta",
		cfg.DBHost, cfg.DBUser, cfg.DBPassword, cfg.DBName, cfg.DBPort,
	)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Warn)})
	if err != nil {
		log.Fatal("Failed to connect to database:", err)
	}
	DB = db
	log.Println("Database connected successfully")

	migrate(db)
	Seed(db)
	seedLeaveTypes(db)
	SeedWorkDefaults(db)
	var ks int64
	if db.Model(&models.KPISettings{}).Count(&ks); ks == 0 {
		db.Create(&models.KPISettings{WeightKPI: 50, WeightTask: 30, WeightAttendance: 20, CompanyTarget: 90, GoodMin: 90, AttentionMin: 70})
	}
}

func migrate(db *gorm.DB) {
	// rule: an employee holds ONE position per business. Clean legacy duplicates (keep the primary,
	// else the oldest) before AutoMigrate creates the unique index.
	if db.Migrator().HasTable(&models.EmployeePlacement{}) {
		db.Exec(`DELETE FROM employee_placements a USING employee_placements b
			WHERE a.id <> b.id AND a.employee_id = b.employee_id AND a.business_id = b.business_id
			AND ((b.is_primary AND NOT a.is_primary) OR (a.is_primary = b.is_primary AND b.id < a.id))`)
	}
	// one-time backfill when the requires_attachment column is first created
	freshAttachmentFlag := db.Migrator().HasTable(&models.LeaveType{}) && !db.Migrator().HasColumn(&models.LeaveType{}, "requires_attachment")
	err := db.AutoMigrate(
		&models.Business{},
		&models.OrgUnit{},
		&models.Position{},
		&models.Location{},
		&models.Employee{},
		&models.EmployeePlacement{},
		&models.EmployeeDocument{},
		&models.User{},
		&models.AuditLog{},
		&models.ApprovalRequest{},
		&models.ApprovalStep{},
		&models.LeaveType{},
		&models.LeaveBalance{},
		&models.LeaveRequest{},
		&models.LeaveAttachment{},
		&models.LeaveGrant{},
		&models.Holiday{},
		&models.WorkCalendar{},
		&models.Roster{},
		&models.RosterAssignment{},
		&models.RosterAdjustment{},
		&models.Notification{},
		&models.Project{},
		&models.ProjectDocument{},
		&models.Task{},
		&models.TaskMember{},
		&models.TaskAttachment{},
		&models.TaskComment{},
		&models.KPISettings{},
		&models.DeptKPI{},
		&models.EmployeeKPI{},
		&models.RecurringTask{},
		&models.DriveSetting{},
		&models.DriveFolder{},
		&models.KPIPeriodClose{},
		&models.KPISnapshot{},
		&models.KPIDeptSnapshot{},
		&models.AttendanceRecord{},
		&models.ManualAttendance{},
	)
	if err != nil {
		log.Fatal("Migration failed:", err)
	}
	if freshAttachmentFlag {
		db.Exec("UPDATE leave_types SET requires_attachment = true WHERE category = 'sakit'")
	}
	// backfill for rows created before the status column existed
	db.Exec("UPDATE employees SET status = CASE WHEN is_active THEN 'Aktif' ELSE 'Tidak Bekerja' END WHERE status IS NULL OR status = ''")
	log.Println("Database migrated successfully")
}

// leave types are global master data; created once, editable in Settings
func seedLeaveTypes(db *gorm.DB) {
	var n int64
	db.Model(&models.LeaveType{}).Count(&n)
	if n > 0 {
		return
	}
	db.Create(&[]models.LeaveType{
		{Name: "Cuti Tahunan", Category: "cuti", DefaultDays: 12, DeductsBalance: true, IsActive: true},
		{Name: "Izin", Category: "izin", IsActive: true},
		{Name: "Sakit", Category: "sakit", RequiresAttachment: true, IsActive: true},
	})
}

// Approximate city-centre coordinates so GPS attendance works out of the box; admins refine them
// per location (Setup Organisasi → Lokasi). Only fills locations that have no coordinates yet.
var cityCoords = map[string][2]float64{
	"bekasi": {-6.2383, 106.9756}, "banjarmasin": {-3.3194, 114.5908}, "aceh": {5.5483, 95.3238},
	"palembang": {-2.9761, 104.7754}, "lampung": {-5.3971, 105.2668},
}

// SeedWorkDefaults is idempotent: default calendar per business, NIK for every employee, location coordinates.
func SeedWorkDefaults(db *gorm.DB) {
	var businesses []models.Business
	db.Order("id").Find(&businesses)
	for _, b := range businesses {
		EnsureDefaultCalendar(db, b.ID)
	}
	// NIK: <business code>-0001… assigned to employees that do not have one yet
	for _, b := range businesses {
		var emps []models.Employee
		db.Where("business_id = ? AND (nik IS NULL OR nik = '')", b.ID).Order("id").Find(&emps)
		if len(emps) == 0 {
			continue
		}
		var n int64
		db.Model(&models.Employee{}).Where("business_id = ? AND nik <> ''", b.ID).Count(&n)
		for _, e := range emps {
			n++
			db.Model(&models.Employee{}).Where("id = ?", e.ID).Update("nik", fmt.Sprintf("%s-%04d", b.Code, n))
		}
	}
	var locs []models.Location
	db.Where("latitude IS NULL OR longitude IS NULL").Find(&locs)
	for _, l := range locs {
		key := strings.ToLower(strings.TrimSpace(l.City))
		if c, ok := cityCoords[key]; ok {
			db.Model(&models.Location{}).Where("id = ?", l.ID).Updates(map[string]any{"latitude": c[0], "longitude": c[1], "radius_m": 200})
		}
	}
}

// EnsureDefaultCalendar creates "Kantor Reguler" (Mon–Fri 08:00–17:00) when the business has no calendar.
func EnsureDefaultCalendar(db *gorm.DB, businessID uint) {
	var n int64
	db.Model(&models.WorkCalendar{}).Where("business_id = ?", businessID).Count(&n)
	if n == 0 {
		db.Create(&models.WorkCalendar{BusinessID: businessID, Name: "Kantor Reguler", WorkDays: "1,2,3,4,5", StartTime: "08:00", EndTime: "17:00",
			BreakStart: "12:00", BreakEnd: "13:00", ToleranceMin: 10, RequireGPS: true, IsDefault: true, IsActive: true})
	}
}

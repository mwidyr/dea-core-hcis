// Package perm holds the role → permission matrix. super_admin always has everything; the other roles are editable
// by a super admin (Settings → Role & Izin). Data scope (which businesses / people a role sees) is still decided by
// the role itself — permissions only switch features on or off.
package perm

import (
	"sync"

	"gorm.io/gorm"
)

type Def struct {
	Key    string `json:"key"`
	Label  string `json:"label"`
	Group  string `json:"group"`
	Hint   string `json:"hint"`
	Locked bool   `json:"locked"` // only super_admin, cannot be granted
}

var Defs = []Def{
	{Key: "reports.view", Label: "Melihat laporan", Group: "Laporan", Hint: "Membuka halaman Laporan; data tetap dibatasi sesuai cakupan peran (tim sendiri / bisnis yang diizinkan)"},
	{Key: "reports.export", Label: "Ekspor laporan (Excel/PDF)", Group: "Laporan"},
	{Key: "employees.manage", Label: "Kelola karyawan", Group: "Organisasi", Hint: "Tambah/ubah/hapus karyawan, penempatan, dan dokumen"},
	{Key: "org.manage", Label: "Kelola struktur organisasi", Group: "Organisasi", Hint: "Unit, jabatan, dan lokasi"},
	{Key: "business.manage", Label: "Kelola bisnis", Group: "Organisasi"},
	{Key: "leave.admin", Label: "Kelola saldo & jenis cuti", Group: "Kehadiran"},
	{Key: "kpi.settings", Label: "Atur bobot & ambang KPI", Group: "KPI"},
	{Key: "kpi.period", Label: "Tutup / buka periode KPI", Group: "KPI"},
	{Key: "users.manage", Label: "Kelola user & password", Group: "Pengaturan"},
	{Key: "audit.view", Label: "Melihat audit log", Group: "Pengaturan"},
	{Key: "drive.manage", Label: "Kelola sinkronisasi Google Drive", Group: "Pengaturan", Hint: "Menghubungkan akun, melihat status, menjalankan ulang sinkronisasi"},
	{Key: "roles.manage", Label: "Kelola role & izin", Group: "Pengaturan", Locked: true},
}

var Roles = []string{"super_admin", "hr_admin", "manager", "employee"}

// defaults replicate the behaviour before the editor existed.
func defaults(role string) map[string]bool {
	m := map[string]bool{}
	for _, d := range Defs {
		switch role {
		case "super_admin":
			m[d.Key] = true
		case "hr_admin":
			m[d.Key] = !d.Locked
		case "manager":
			m[d.Key] = d.Key == "reports.view" || d.Key == "reports.export"
		}
	}
	return m
}

// RolePermission is one granted permission of a role.
type RolePermission struct {
	ID         uint   `gorm:"primaryKey"`
	Role       string `gorm:"uniqueIndex:idx_role_perm"`
	Permission string `gorm:"uniqueIndex:idx_role_perm"`
}

var (
	mu    sync.RWMutex
	cache = map[string]map[string]bool{}
)

// seeded remembers which permission keys already received their defaults, so a permission added in a later release
// gets its defaults once without overriding what an admin customised (or removed) for the older ones.
type seeded struct {
	Key string `gorm:"primaryKey"`
}

func (seeded) TableName() string { return "perm_seeded" }

// addedLater lists keys introduced after the first release of the matrix (existing installs have not seeded them yet).
var addedLater = map[string]bool{"drive.manage": true}

// Init migrates the tables, seeds defaults (once per permission) and loads the cache.
func Init(db *gorm.DB) error {
	if err := db.AutoMigrate(&RolePermission{}, &seeded{}); err != nil {
		return err
	}
	var granted, marks int64
	db.Model(&RolePermission{}).Count(&granted)
	db.Model(&seeded{}).Count(&marks)
	if marks == 0 && granted > 0 { // matrix created before seeded-tracking existed: everything but the later additions is done
		for _, d := range Defs {
			if !addedLater[d.Key] {
				db.Create(&seeded{Key: d.Key})
			}
		}
	}
	for _, d := range Defs {
		var done int64
		db.Model(&seeded{}).Where("key = ?", d.Key).Count(&done)
		if done > 0 {
			continue
		}
		for _, r := range Roles {
			if defaults(r)[d.Key] {
				db.Create(&RolePermission{Role: r, Permission: d.Key})
			}
		}
		db.Create(&seeded{Key: d.Key})
	}
	return Reload(db)
}

func Reload(db *gorm.DB) error {
	var rows []RolePermission
	if err := db.Find(&rows).Error; err != nil {
		return err
	}
	m := map[string]map[string]bool{}
	for _, r := range rows {
		if m[r.Role] == nil {
			m[r.Role] = map[string]bool{}
		}
		m[r.Role][r.Permission] = true
	}
	mu.Lock()
	cache = m
	mu.Unlock()
	return nil
}

func Valid(key string) bool {
	for _, d := range Defs {
		if d.Key == key {
			return true
		}
	}
	return false
}

func IsLocked(key string) bool {
	for _, d := range Defs {
		if d.Key == key {
			return d.Locked
		}
	}
	return false
}

func Has(role, key string) bool {
	if role == "super_admin" {
		return true
	}
	mu.RLock()
	defer mu.RUnlock()
	return cache[role][key]
}

// For lists the permissions of a role (for the frontend).
func For(role string) []string {
	out := []string{}
	for _, d := range Defs {
		if Has(role, d.Key) {
			out = append(out, d.Key)
		}
	}
	return out
}

// Set replaces the editable permissions of a role (never super_admin, never locked ones).
func Set(db *gorm.DB, role string, keys []string) error {
	want := map[string]bool{}
	for _, k := range keys {
		if Valid(k) && !IsLocked(k) {
			want[k] = true
		}
	}
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("role = ?", role).Delete(&RolePermission{}).Error; err != nil {
			return err
		}
		for k := range want {
			if err := tx.Create(&RolePermission{Role: role, Permission: k}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	return Reload(db)
}

// Reset restores a role's default permissions.
func Reset(db *gorm.DB, role string) error {
	keys := []string{}
	for k, ok := range defaults(role) {
		if ok {
			keys = append(keys, k)
		}
	}
	return Set(db, role, keys)
}

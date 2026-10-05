package main

import (
	"github.com/gin-gonic/gin"
	"log"

	"github.com/dea-core/hcis/backend/internal/config"
	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/handlers"
	"github.com/dea-core/hcis/backend/internal/middleware"
	"github.com/dea-core/hcis/backend/internal/perm"
	"github.com/dea-core/hcis/backend/internal/router"
	"github.com/dea-core/hcis/backend/internal/storage"
)

func main() {
	cfg := config.Load()
	if problems := cfg.Validate(); len(problems) > 0 {
		for _, p := range problems {
			log.Println("KONFIGURASI TIDAK AMAN:", p)
		}
		log.Fatal("server tidak dijalankan karena APP_ENV=production dengan konfigurasi tidak aman")
	}
	if cfg.Production() {
		gin.SetMode(gin.ReleaseMode)
	}
	database.SeedAdminPassword, database.SeedEmployeePassword, database.SeedProduction = cfg.SeedAdminPassword, cfg.SeedEmployeePassword, cfg.Production()
	middleware.JWTSecret = cfg.JWTSecret
	handlers.Store = storage.Local{Root: cfg.UploadDir}
	handlers.DevLoginEnabled = cfg.DevLogin
	if cfg.DevLogin {
		log.Println("WARNING: DEV_LOGIN=true — passwordless account picker is ENABLED. Local development only; never enable in production.")
	}
	database.Connect(cfg)
	handlers.InitDrive(cfg)
	if err := perm.Init(database.DB); err != nil {
		log.Fatal("permission matrix:", err)
	}
	go handlers.StartRosterReminderJob() // hourly jobs: reminders, recurring tasks, KPI auto-close (idempotent)
	go handlers.StartDriveSyncJob()      // uploads local files to Google Drive when enabled and connected
	r := router.Setup(cfg)
	log.Printf("dea-core-hcis backend listening on :%s", cfg.Port)
	log.Fatal(r.Run(":" + cfg.Port))
}

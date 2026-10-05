package config

import (
	"log"
	"os"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	// AppEnv: development (default) | production. Production refuses unsafe settings (see Validate).
	AppEnv         string
	TrustedProxies string // comma separated IPs/CIDRs of the reverse proxy whose X-Forwarded-For is believed
	// Initial passwords used ONLY when the database is seeded for the first time. Empty in production = random.
	SeedAdminPassword    string
	SeedEmployeePassword string
	DBHost               string
	DBUser               string
	DBPassword           string
	DBName               string
	DBPort               string
	JWTSecret            string
	Port                 string
	FrontendOrigin       string
	UploadDir            string
	// DevLogin enables the quick "pick an account" shortcuts (login without a password). LOCAL DEVELOPMENT ONLY:
	// it must stay false in production — it is an authentication bypass by design.
	DevLogin bool
	// Google Drive sync (Phase 8, OAuth user account). Disabled = files stay on local disk only.
	GDriveEnabled      bool
	GDriveClientID     string
	GDriveClientSecret string
	GDriveRedirectURL  string // must be registered as an authorized redirect URI in the Google Cloud OAuth client
	GDriveRefreshToken string // optional: skip the in-app "Hubungkan" flow
	GDriveRootFolderID string // optional: use this existing folder as root instead of creating "CORE HCIS"
	GDriveAPIBase      string // test overrides, leave empty
	GDriveUploadBase   string
	GDriveAuthURL      string
	GDriveTokenURL     string
}

func Load() *Config {
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using environment variables")
	}
	return &Config{
		AppEnv:               getEnv("APP_ENV", "development"),
		TrustedProxies:       getEnv("TRUSTED_PROXIES", "127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"),
		SeedAdminPassword:    getEnv("SEED_ADMIN_PASSWORD", ""),
		SeedEmployeePassword: getEnv("SEED_EMPLOYEE_PASSWORD", ""),
		DBHost:               getEnv("DB_HOST", "localhost"),
		DBUser:               getEnv("DB_USER", "postgres"),
		DBPassword:           getEnv("DB_PASSWORD", "postgres"),
		DBName:               getEnv("DB_NAME", "dea_hcis"),
		DBPort:               getEnv("DB_PORT", "5432"),
		JWTSecret:            getEnv("JWT_SECRET", "super-secret-key-change-in-production"),
		Port:                 getEnv("PORT", "8080"),
		FrontendOrigin:       getEnv("FRONTEND_ORIGIN", ""),
		UploadDir:            getEnv("UPLOAD_DIR", "./uploads"),
		DevLogin:             getEnv("DEV_LOGIN", "false") == "true",
		GDriveEnabled:        getEnv("GDRIVE_ENABLED", "false") == "true",
		GDriveClientID:       getEnv("GDRIVE_CLIENT_ID", ""),
		GDriveClientSecret:   getEnv("GDRIVE_CLIENT_SECRET", ""),
		GDriveRedirectURL:    getEnv("GDRIVE_REDIRECT_URL", "http://localhost:8080/api/drive/callback"),
		GDriveRefreshToken:   getEnv("GDRIVE_REFRESH_TOKEN", ""),
		GDriveRootFolderID:   getEnv("GDRIVE_ROOT_FOLDER_ID", ""),
		GDriveAPIBase:        getEnv("GDRIVE_API_BASE", ""),
		GDriveUploadBase:     getEnv("GDRIVE_UPLOAD_BASE", ""),
		GDriveAuthURL:        getEnv("GDRIVE_AUTH_URL", ""),
		GDriveTokenURL:       getEnv("GDRIVE_TOKEN_URL", ""),
	}
}

func (c *Config) Production() bool { return c.AppEnv == "production" }

// Validate stops the server from starting in production with settings that are only acceptable on a laptop.
func (c *Config) Validate() []string {
	var bad []string
	if !c.Production() {
		return bad
	}
	if len(c.JWTSecret) < 32 || strings.Contains(strings.ToLower(c.JWTSecret), "change") || c.JWTSecret == "super-secret-key-change-in-production" {
		bad = append(bad, "JWT_SECRET harus diisi acak minimal 32 karakter (mis. `openssl rand -hex 32`)")
	}
	if c.DevLogin {
		bad = append(bad, "DEV_LOGIN harus false di production (melewati login)")
	}
	if c.DBPassword == "postgres" || c.DBPassword == "" {
		bad = append(bad, "DB_PASSWORD tidak boleh kosong/`postgres` di production")
	}
	return bad
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

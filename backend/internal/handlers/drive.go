package handlers

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/dea-core/hcis/backend/internal/config"
	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/drive"
	"github.com/dea-core/hcis/backend/internal/middleware"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// Google Drive sync (Phase 8). Files are always written to local disk first (storage.Local) and stay the source of
// truth for downloads; this job copies them to Drive in the background:
//
//	<root "CORE HCIS"> / <Business> / <Tab> / <Year> / <file name>
//
// where Tab is the app tab the file belongs to (Karyawan, Cuti & Izin, Tugas, Proyek) and Year is the year it was uploaded.
// Deleting a file in the app never deletes the Drive copy (the Drive side is the archive).

var (
	driveCfg     drive.Config
	driveEnabled bool
	envToken     string
	driveRun     sync.Mutex // one sync run at a time
	lastDriveRun struct {
		At     time.Time
		Synced int
		Failed int
		Err    string
	}
	lastDriveMu sync.Mutex
)

const driveRootName = "CORE HCIS"

func InitDrive(c *config.Config) {
	driveEnabled = c.GDriveEnabled
	envToken = c.GDriveRefreshToken
	driveCfg = drive.Config{ClientID: c.GDriveClientID, ClientSecret: c.GDriveClientSecret, RedirectURL: c.GDriveRedirectURL, RootFolderID: c.GDriveRootFolderID,
		AuthURL: c.GDriveAuthURL, TokenURL: c.GDriveTokenURL, APIBase: c.GDriveAPIBase, UploadBase: c.GDriveUploadBase}
	if driveEnabled && !driveCfg.Configured() {
		fmt.Println("WARNING: GDRIVE_ENABLED=true but GDRIVE_CLIENT_ID / GDRIVE_CLIENT_SECRET are empty — Drive sync is idle.")
	}
}

// ---- token at rest: AES-GCM keyed from the JWT secret ----

func aead() cipher.AEAD {
	k := sha256.Sum256([]byte("drive-token:" + middleware.JWTSecret))
	b, _ := aes.NewCipher(k[:])
	g, _ := cipher.NewGCM(b)
	return g
}

func sealToken(t string) string {
	g := aead()
	nonce := make([]byte, g.NonceSize())
	io.ReadFull(rand.Reader, nonce)
	return base64.StdEncoding.EncodeToString(g.Seal(nonce, nonce, []byte(t), nil))
}

func openToken(s string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(s)
	g := aead()
	if err != nil || len(raw) < g.NonceSize() {
		return "", fmt.Errorf("token tersimpan tidak valid")
	}
	pt, err := g.Open(nil, raw[:g.NonceSize()], raw[g.NonceSize():], nil)
	if err != nil {
		return "", fmt.Errorf("token tidak dapat dibuka (JWT_SECRET berubah?) — hubungkan ulang akun Drive")
	}
	return string(pt), nil
}

func driveSetting() (models.DriveSetting, bool) {
	var s models.DriveSetting
	if database.DB.Limit(1).Find(&s).Error != nil || s.ID == 0 {
		return s, false
	}
	return s, true
}

// refreshToken: the connection made in the app, else GDRIVE_REFRESH_TOKEN from the environment.
func refreshToken() (string, error) {
	if s, ok := driveSetting(); ok && s.RefreshToken != "" {
		return openToken(s.RefreshToken)
	}
	if envToken != "" {
		return envToken, nil
	}
	return "", fmt.Errorf("akun Google Drive belum dihubungkan")
}

func driveReady() (*drive.Client, error) {
	if !driveEnabled {
		return nil, fmt.Errorf("sinkronisasi Drive dinonaktifkan (GDRIVE_ENABLED=false)")
	}
	if !driveCfg.Configured() {
		return nil, fmt.Errorf("GDRIVE_CLIENT_ID / GDRIVE_CLIENT_SECRET belum diisi")
	}
	tok, err := refreshToken()
	if err != nil {
		return nil, err
	}
	return drive.New(driveCfg, tok), nil
}

// ---- folders ----

var badName = regexp.MustCompile(`[\x00-\x1f/\\]+`)

func cleanName(s string, max int) string {
	s = strings.TrimSpace(badName.ReplaceAllString(s, " "))
	if r := []rune(s); len(r) > max {
		s = string(r[:max])
	}
	if s == "" {
		s = "tanpa nama"
	}
	return s
}

func cachedFolder(key string) string {
	var f models.DriveFolder
	if database.DB.Where("path_key = ?", key).Limit(1).Find(&f).Error == nil && f.ID != 0 {
		return f.FolderID
	}
	return ""
}

func folderStep(ctx context.Context, cl *drive.Client, key, parent, name string) (string, error) {
	if id := cachedFolder(key); id != "" {
		return id, nil
	}
	id, err := cl.EnsureFolder(ctx, parent, name)
	if err != nil {
		return "", err
	}
	database.DB.Create(&models.DriveFolder{PathKey: key, FolderID: id})
	return id, nil
}

func forgetFolders(keys ...string) {
	database.DB.Where("path_key IN ?", keys).Delete(&models.DriveFolder{})
}

// folderFor resolves root / business / tab / year (creating what is missing).
func folderFor(ctx context.Context, cl *drive.Client, bizID uint, bizName, tab string, year int) (string, error) {
	root := driveCfg.RootFolderID
	if root == "" {
		var err error
		if root, err = folderStep(ctx, cl, "root", "", driveRootName); err != nil {
			return "", err
		}
	}
	kb := fmt.Sprintf("b%d", bizID)
	biz, err := folderStep(ctx, cl, kb, root, cleanName(bizName, 100))
	if err != nil {
		return "", err
	}
	kt := kb + "/" + tab
	t, err := folderStep(ctx, cl, kt, biz, tab)
	if err != nil {
		return "", err
	}
	return folderStep(ctx, cl, fmt.Sprintf("%s/%d", kt, year), t, fmt.Sprintf("%d", year))
}

// ---- what to sync ----

type driveItem struct {
	Table      string
	Tab        string
	ID         uint
	BusinessID uint
	CreatedAt  time.Time
	LocalPath  string
	MimeType   string
	FileName   string
	A, B, C    string // name parts, see displayName
	Attempts   int
}

const dueClause = `COALESCE(x.drive_status,'pending') IN ('pending','failed') AND (x.drive_next_try IS NULL OR x.drive_next_try <= now())`

func pendingItems(limit int) []driveItem {
	var out []driveItem
	q := func(table, tab, sql string) {
		var rows []driveItem
		database.DB.Raw(sql+" AND "+dueClause+" ORDER BY x.id LIMIT ?", limit).Scan(&rows)
		for i := range rows {
			rows[i].Table, rows[i].Tab = table, tab
		}
		out = append(out, rows...)
	}
	q("employee_documents", "Karyawan", `SELECT x.id, e.business_id, x.created_at, x.local_path, x.mime_type, x.file_name, e.name AS a, x.label AS b, '' AS c, COALESCE(x.drive_attempts,0) AS attempts
		FROM employee_documents x JOIN employees e ON e.id = x.employee_id WHERE 1=1`)
	q("leave_attachments", "Cuti & Izin", `SELECT x.id, l.business_id, x.created_at, x.local_path, x.mime_type, x.file_name, e.name AS a, COALESCE(t.name,'') AS b, to_char(l.start_date,'YYYY-MM-DD') AS c, COALESCE(x.drive_attempts,0) AS attempts
		FROM leave_attachments x JOIN leave_requests l ON l.id = x.leave_request_id JOIN employees e ON e.id = l.employee_id LEFT JOIN leave_types t ON t.id = l.type_id WHERE 1=1`)
	q("task_attachments", "Tugas", `SELECT x.id, t.business_id, x.created_at, x.local_path, x.mime_type, x.file_name, t.title AS a, '#' || t.id AS b, '' AS c, COALESCE(x.drive_attempts,0) AS attempts
		FROM task_attachments x JOIN tasks t ON t.id = x.task_id WHERE 1=1`)
	q("project_documents", "Proyek", `SELECT x.id, p.business_id, x.created_at, x.local_path, x.mime_type, x.file_name, p.name AS a, x.label AS b, '' AS c, COALESCE(x.drive_attempts,0) AS attempts
		FROM project_documents x JOIN projects p ON p.id = x.project_id WHERE 1=1`)
	return out
}

// displayName is the file name in Drive; it carries enough context to be understood outside the app.
func displayName(it driveItem) string {
	parts := []string{}
	switch it.Tab {
	case "Karyawan":
		parts = []string{it.A, it.B}
	case "Cuti & Izin":
		parts = []string{it.A, it.B, it.C}
	case "Tugas":
		parts = []string{it.B, it.A}
	case "Proyek":
		parts = []string{it.A, it.B}
	}
	keep := []string{}
	for _, p := range parts {
		if strings.TrimSpace(p) != "" {
			keep = append(keep, strings.TrimSpace(p))
		}
	}
	keep = append(keep, it.FileName)
	return cleanName(strings.Join(keep, " - "), 200)
}

func isAuthErr(err error) bool {
	s := err.Error()
	return strings.Contains(s, "invalid_grant") || strings.Contains(s, "invalid_client") || strings.Contains(s, "unauthorized_client") || strings.Contains(s, "Drive API 401")
}

func backoff(attempts int) time.Duration {
	d := time.Duration(1<<uint(min(attempts, 8))) * 5 * time.Minute
	if d > 6*time.Hour {
		d = 6 * time.Hour
	}
	return d
}

func markFailed(it driveItem, msg string, wait time.Duration) {
	if len(msg) > 300 {
		msg = msg[:300]
	}
	next := time.Now().Add(wait)
	database.DB.Table(it.Table).Where("id = ?", it.ID).Updates(map[string]any{"drive_status": "failed", "drive_error": msg, "drive_attempts": it.Attempts + 1, "drive_next_try": next})
}

func syncOne(ctx context.Context, cl *drive.Client, it driveItem, bizName string) error {
	f, err := os.Open(Store.Abs(it.LocalPath))
	if err != nil {
		markFailed(it, "file lokal tidak ditemukan", 24*time.Hour)
		return nil
	}
	defer f.Close()
	year := it.CreatedAt.In(jkt).Year()
	name := displayName(it)
	var id, link string
	for try := 0; try < 2; try++ {
		var folder string
		folder, err = folderFor(ctx, cl, it.BusinessID, bizName, it.Tab, year)
		if err == nil {
			f.Seek(0, io.SeekStart)
			id, link, err = cl.Upload(ctx, folder, name, it.MimeType, f)
		}
		if err != nil && drive.IsNotFound(err) && try == 0 { // a folder was deleted by hand: forget the cache and rebuild once
			kb := fmt.Sprintf("b%d", it.BusinessID)
			forgetFolders("root", kb, kb+"/"+it.Tab, fmt.Sprintf("%s/%s/%d", kb, it.Tab, year))
			continue
		}
		break
	}
	if err != nil {
		return err
	}
	now := time.Now()
	database.DB.Table(it.Table).Where("id = ?", it.ID).Updates(map[string]any{"drive_status": "synced", "drive_file_id": id, "drive_url": link, "drive_error": "", "drive_attempts": 0, "drive_next_try": nil, "drive_synced_at": now})
	return nil
}

// RunDriveSync uploads due files (at most limit per table) and returns how many succeeded / failed.
func RunDriveSync(limit int) (synced, failed int, err error) {
	if !driveRun.TryLock() {
		return 0, 0, fmt.Errorf("sinkronisasi sedang berjalan")
	}
	defer driveRun.Unlock()
	defer func() {
		lastDriveMu.Lock()
		lastDriveRun.At, lastDriveRun.Synced, lastDriveRun.Failed = time.Now(), synced, failed
		lastDriveRun.Err = ""
		if err != nil {
			lastDriveRun.Err = err.Error()
		}
		lastDriveMu.Unlock()
	}()
	cl, err := driveReady()
	if err != nil {
		return 0, 0, err
	}
	biz := map[uint]string{}
	var bs []models.Business
	database.DB.Select("id, name").Find(&bs)
	for _, b := range bs {
		biz[b.ID] = b.Name
	}
	for _, it := range pendingItems(limit) {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		e := syncOne(ctx, cl, it, biz[it.BusinessID])
		cancel()
		if e != nil {
			if isAuthErr(e) { // the connection itself is broken: stop without penalising the files
				return synced, failed, fmt.Errorf("akses Google ditolak — hubungkan ulang akun Drive (%v)", e)
			}
			markFailed(it, e.Error(), backoff(it.Attempts))
			failed++
			continue
		}
		var st string
		database.DB.Table(it.Table).Select("drive_status").Where("id = ?", it.ID).Scan(&st)
		if st == "synced" {
			synced++
		} else {
			failed++
		}
	}
	return synced, failed, nil
}

// StartDriveSyncJob checks for new files every minute while Drive is enabled and connected.
func StartDriveSyncJob() {
	time.Sleep(20 * time.Second)
	for {
		if driveEnabled && driveCfg.Configured() {
			if _, err := refreshToken(); err == nil {
				RunDriveSync(50)
			}
		}
		time.Sleep(time.Minute)
	}
}

// ---- endpoints ----

type tabCount struct {
	Tab     string `json:"tab"`
	Pending int64  `json:"pending"`
	Synced  int64  `json:"synced"`
	Failed  int64  `json:"failed"`
}

type driveFailure struct {
	Tab      string `json:"tab"`
	ID       uint   `json:"id"`
	FileName string `json:"file_name"`
	Error    string `json:"error"`
	Attempts int    `json:"attempts"`
}

func DriveStatus(c *gin.Context) {
	out := gin.H{"enabled": driveEnabled, "configured": driveCfg.Configured(), "redirect_url": driveCfg.RedirectURL, "scope": driveCfg.Scope(),
		"custom_root": driveCfg.RootFolderID != "", "structure": driveRootName + " / [Bisnis] / [Tab] / [Tahun] / [Nama file]"}
	connected := false
	if s, ok := driveSetting(); ok && s.RefreshToken != "" {
		connected = true
		out["email"], out["connected_at"], out["connected_scope"] = s.Email, s.ConnectedAt, s.Scope
		out["source"] = "app"
	} else if envToken != "" {
		connected = true
		out["source"] = "env"
	}
	out["connected"] = connected
	if id := cachedFolder("root"); id != "" {
		out["root_url"] = "https://drive.google.com/drive/folders/" + id
	} else if driveCfg.RootFolderID != "" {
		out["root_url"] = "https://drive.google.com/drive/folders/" + driveCfg.RootFolderID
	}
	counts := []tabCount{}
	fails := []driveFailure{}
	for _, t := range []struct{ table, tab string }{{"employee_documents", "Karyawan"}, {"leave_attachments", "Cuti & Izin"}, {"task_attachments", "Tugas"}, {"project_documents", "Proyek"}} {
		tc := tabCount{Tab: t.tab}
		database.DB.Table(t.table).Where("COALESCE(drive_status,'pending') = 'pending'").Count(&tc.Pending)
		database.DB.Table(t.table).Where("drive_status = 'synced'").Count(&tc.Synced)
		database.DB.Table(t.table).Where("drive_status = 'failed'").Count(&tc.Failed)
		counts = append(counts, tc)
		var fs []driveFailure
		database.DB.Table(t.table).Select("id, file_name, drive_error AS error, COALESCE(drive_attempts,0) AS attempts").Where("drive_status = 'failed'").Order("id DESC").Limit(10).Scan(&fs)
		for i := range fs {
			fs[i].Tab = t.tab
		}
		fails = append(fails, fs...)
	}
	out["counts"], out["failures"] = counts, fails
	lastDriveMu.Lock()
	out["last_run"] = gin.H{"at": lastDriveRun.At, "synced": lastDriveRun.Synced, "failed": lastDriveRun.Failed, "error": lastDriveRun.Err}
	lastDriveMu.Unlock()
	c.JSON(http.StatusOK, out)
}

func driveState(userID uint) string {
	t, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"purpose": "drive", "uid": userID, "exp": time.Now().Add(10 * time.Minute).Unix()}).SignedString([]byte(middleware.JWTSecret))
	return t
}

func validState(s string) bool {
	tok, err := jwt.Parse(s, func(t *jwt.Token) (any, error) { return []byte(middleware.JWTSecret), nil }, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil || !tok.Valid {
		return false
	}
	m, _ := tok.Claims.(jwt.MapClaims)
	return m["purpose"] == "drive"
}

// DriveConnect returns the Google consent URL for the signed-in admin.
func DriveConnect(c *gin.Context) {
	if !driveEnabled || !driveCfg.Configured() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "isi GDRIVE_ENABLED=true, GDRIVE_CLIENT_ID dan GDRIVE_CLIENT_SECRET di backend/.env lalu restart server"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"url": driveCfg.AuthCodeURL(driveState(uid(c)))})
}

func frontendBase() string {
	if o := os.Getenv("FRONTEND_ORIGIN"); o != "" {
		return strings.TrimRight(strings.Split(o, ",")[0], "/")
	}
	return "http://localhost:5173"
}

// DriveCallback is Google's redirect target (public; protected by the signed state).
func DriveCallback(c *gin.Context) {
	back := func(status string) {
		c.Redirect(http.StatusFound, frontendBase()+"/settings?tab=drive&drive="+url.QueryEscape(status))
	}
	if e := c.Query("error"); e != "" {
		back("ditolak")
		return
	}
	if !validState(c.Query("state")) || c.Query("code") == "" {
		back("state-tidak-valid")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()
	tok, err := driveCfg.Exchange(ctx, c.Query("code"))
	if err != nil {
		back("gagal")
		return
	}
	email, err := drive.New(driveCfg, tok).Email(ctx)
	if err != nil {
		back("gagal")
		return
	}
	database.DB.Where("1 = 1").Delete(&models.DriveSetting{})
	database.DB.Where("1 = 1").Delete(&models.DriveFolder{}) // a different account/root: forget cached folders
	database.DB.Create(&models.DriveSetting{RefreshToken: sealToken(tok), Email: email, Scope: driveCfg.Scope(), ConnectedAt: time.Now()})
	database.DB.Create(&models.AuditLog{Action: "connect", Entity: "google_drive", EntityID: email})
	go RunDriveSync(50)
	back("terhubung")
}

func DriveDisconnect(c *gin.Context) {
	database.DB.Where("1 = 1").Delete(&models.DriveSetting{})
	audit(c, "disconnect", "google_drive", 0)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func DriveSyncNow(c *gin.Context) {
	s, f, err := RunDriveSync(100)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error(), "synced": s, "failed": f})
		return
	}
	c.JSON(http.StatusOK, gin.H{"synced": s, "failed": f})
}

// DriveRetryFailed puts failed files back in the queue immediately.
func DriveRetryFailed(c *gin.Context) {
	var n int64
	for _, t := range []string{"employee_documents", "leave_attachments", "task_attachments", "project_documents"} {
		r := database.DB.Table(t).Where("drive_status = 'failed'").Updates(map[string]any{"drive_status": "pending", "drive_attempts": 0, "drive_next_try": nil, "drive_error": ""})
		n += r.RowsAffected
	}
	c.JSON(http.StatusOK, gin.H{"requeued": n})
}

package handlers

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Clock-out summary ("Ringkasan hari ini"): after Tap Out the employee sees what was done, what is still open and what
// should move to tomorrow. A day's report runs from the previous tap out (or midnight) up to this tap out, so work done in the
// evening — after tapping out — falls into the NEXT working day's report.

// TapSecret signs the short-lived token the clock-out screen uses to act on tasks (the page itself has no login session).
var TapSecret []byte

const tapTokenTTL = 20 * time.Minute

func signTapToken(empID uint, exp time.Time) string {
	payload := fmt.Sprintf("%d:%d", empID, exp.Unix())
	mac := hmac.New(sha256.New, append([]byte("tap-summary:"), TapSecret...))
	mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// verifyTapToken returns the employee the token was issued for.
func verifyTapToken(tok string, now time.Time) (uint, bool) {
	parts := strings.Split(tok, ".")
	if len(parts) != 2 || len(TapSecret) == 0 {
		return 0, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return 0, false
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return 0, false
	}
	mac := hmac.New(sha256.New, append([]byte("tap-summary:"), TapSecret...))
	mac.Write(raw)
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return 0, false
	}
	f := strings.SplitN(string(raw), ":", 2)
	if len(f) != 2 {
		return 0, false
	}
	id, err1 := strconv.ParseUint(f[0], 10, 64)
	exp, err2 := strconv.ParseInt(f[1], 10, 64)
	if err1 != nil || err2 != nil || now.Unix() > exp {
		return 0, false
	}
	return uint(id), true
}

type summaryTask struct {
	ID         uint     `json:"id"`
	Title      string   `json:"title"`
	Project    string   `json:"project"`
	Due        string   `json:"due"`
	Status     string   `json:"status"`
	Progress   float64  `json:"progress"`
	Timeliness string   `json:"timeliness"`
	Label      string   `json:"timeliness_label"`
	Changes    []string `json:"changes,omitempty"` // what was done to it inside the report window
	Movable    bool     `json:"movable"`           // its deadline / start date is today or earlier: it can be moved to the next working day
}

type daySummary struct {
	Date        string        `json:"date"`
	From        time.Time     `json:"from"`
	To          time.Time     `json:"to"`
	NextWorkday string        `json:"next_workday"`
	Done        []summaryTask `json:"done"`       // finished inside the window
	Worked      []summaryTask `json:"worked"`     // touched inside the window (progress, status, edits)
	Unfinished  []summaryTask `json:"unfinished"` // still open and needing attention tomorrow
}

func nextWorkday(emp models.Employee, after time.Time) time.Time {
	after = day(after)
	res := newResolver(after, after.AddDate(0, 0, 21))
	for i := 1; i <= 14; i++ {
		d := after.AddDate(0, 0, i)
		if res.schedule(emp, d).Status == "kerja" {
			return d
		}
	}
	return after.AddDate(0, 0, 1)
}

// buildDaySummary: the report of work date `date`, up to `until` (the tap out moment, or now).
func buildDaySummary(emp models.Employee, date, until time.Time) daySummary {
	date = day(date)
	from := date
	var prev models.AttendanceRecord
	if database.DB.Where("employee_id = ? AND date < ? AND check_out_at IS NOT NULL", emp.ID, date).Order("date DESC").Limit(1).Find(&prev).Error == nil && prev.ID != 0 && prev.CheckOutAt != nil && prev.CheckOutAt.After(date.AddDate(0, 0, -2)) {
		from = *prev.CheckOutAt // evening work after the previous tap out belongs to this day's report
	}
	out := daySummary{Date: date.Format("2006-01-02"), From: from, To: until, Done: []summaryTask{}, Worked: []summaryTask{}, Unfinished: []summaryTask{}}
	nxt := nextWorkday(emp, date)
	out.NextWorkday = nxt.Format("2006-01-02")

	var u models.User
	database.DB.Where("employee_id = ? AND is_active = true", emp.ID).Limit(1).Find(&u)
	var tasks []models.Task
	database.DB.Where("pic_id = ?", emp.ID).Find(&tasks)
	calc := map[uint]*taskCalc{}
	projects := map[uint]string{}
	var ps []models.Project
	database.DB.Select("id, name").Find(&ps)
	for _, p := range ps {
		projects[p.ID] = p.Name
	}
	var changes map[uint][]string
	if u.ID != 0 {
		changes = map[uint][]string{}
		var hs []models.TaskHistory
		database.DB.Where("user_id = ? AND created_at > ? AND created_at <= ?", u.ID, from, until).Order("id").Find(&hs)
		for _, h := range hs {
			txt := h.Field
			switch h.Field {
			case "progress", "status", "due_date", "start_date":
				txt = fmt.Sprintf("%s %s → %s", fieldLabelID[h.Field], orDash(h.OldValue), orDash(h.NewValue))
			case "created":
				txt = "tugas dibuat"
			case "deadline_request":
				txt = "pengajuan perubahan deadline"
			default:
				txt = fieldLabelID[h.Field]
				if txt == "" {
					txt = h.Field + " diubah"
				}
			}
			changes[h.TaskID] = append(changes[h.TaskID], txt)
		}
	}
	for _, t := range tasks {
		cc := calc[t.BusinessID]
		if cc == nil {
			cc = calcFor(t.BusinessID)
			calc[t.BusinessID] = cc
		}
		if cc.isParent(t.ID) {
			continue
		}
		tm := taskTimeliness(cc.status(t.ID), t.StartDate, t.DueDate, t.CompletedAt, until)
		row := summaryTask{ID: t.ID, Title: t.Title, Project: projects[ptrU(t.ProjectID)], Due: histDate(t.DueDate), Status: statusText(t.Status), Progress: cc.progress(t.ID), Timeliness: tm, Label: timelinessLabel[tm], Changes: changes[t.ID]}
		inWindowDone := t.Status == "done" && t.CompletedAt != nil && t.CompletedAt.After(from) && !t.CompletedAt.After(until)
		switch {
		case inWindowDone:
			out.Done = append(out.Done, row)
		case t.Status == "done":
			continue
		default:
			dueNow := t.DueDate != nil && day(*t.DueDate).Before(nxt)
			startNow := t.Status == "todo" && t.StartDate != nil && !day(*t.StartDate).After(date)
			row.Movable = (dueNow || startNow) && t.Status != "review"
			if len(row.Changes) > 0 {
				out.Worked = append(out.Worked, row)
			}
			if row.Movable || tm == tmOverdue || tm == tmLateStart || len(row.Changes) > 0 {
				out.Unfinished = append(out.Unfinished, row)
			}
		}
	}
	rank := map[string]int{tmOverdue: 0, tmLateStart: 1, tmOnTrack: 2, "": 3}
	sort.SliceStable(out.Unfinished, func(i, j int) bool { return rank[out.Unfinished[i].Timeliness] < rank[out.Unfinished[j].Timeliness] })
	if len(out.Unfinished) > 12 {
		out.Unfinished = out.Unfinished[:12]
	}
	return out
}

var fieldLabelID = map[string]string{"progress": "progress", "status": "status", "due_date": "deadline", "start_date": "mulai", "title": "nama tugas diubah", "priority": "prioritas diubah", "pic": "PIC diubah", "description": "deskripsi diubah"}

// DaySummary (logged in): GET /attendance/day-summary?date=YYYY-MM-DD — the caller's own report.
func DaySummary(c *gin.Context) {
	me := myEmployeeID(c)
	if me == nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "akun tidak terhubung ke karyawan"})
		return
	}
	var emp models.Employee
	database.DB.Limit(1).Find(&emp, *me)
	d := today()
	if v, ok := parseDate(c.Query("date")); ok {
		d = v
	}
	until := time.Now()
	var rec models.AttendanceRecord
	if database.DB.Where("employee_id = ? AND date = ? AND check_out_at IS NOT NULL", emp.ID, day(d)).Limit(1).Find(&rec).Error == nil && rec.ID != 0 && rec.CheckOutAt != nil {
		until = *rec.CheckOutAt
	}
	c.JSON(http.StatusOK, buildDaySummary(emp, d, until))
}

// PublicMoveTomorrow: POST /public/move-tomorrow {token, task_id} — from the clock-out screen. A task whose START date has
// passed gets a new start date (next working day); a deadline that falls before then goes through the normal
// deadline-change approval, so the rule "deadline changes need approval" holds here too.
func PublicMoveTomorrow(c *gin.Context) {
	var in struct {
		Token  string `json:"token"`
		TaskID uint   `json:"task_id"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.TaskID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "data tidak valid"})
		return
	}
	empID, ok := verifyTapToken(in.Token, time.Now())
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Sesi ringkasan sudah berakhir. Tap Out lagi atau buka aplikasi untuk memindahkan tugas."})
		return
	}
	key := "move:" + strconv.Itoa(int(empID))
	if limiter.over(key, 40, 20*time.Minute) {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Terlalu banyak permintaan. Coba lagi nanti."})
		return
	}
	limiter.add(key)
	var emp models.Employee
	if database.DB.Limit(1).Find(&emp, empID).Error != nil || emp.ID == 0 || emp.Status != "Aktif" {
		c.JSON(http.StatusForbidden, gin.H{"error": "karyawan tidak aktif"})
		return
	}
	var t models.Task
	if database.DB.Limit(1).Find(&t, in.TaskID).Error != nil || t.ID == 0 || t.PICID != emp.ID {
		c.JSON(http.StatusForbidden, gin.H{"error": "hanya PIC yang dapat memindahkan tugasnya"})
		return
	}
	if t.Status != "todo" && t.Status != "in_progress" || calcFor(t.BusinessID).isParent(t.ID) {
		c.JSON(http.StatusConflict, gin.H{"error": "tugas ini tidak dapat dipindahkan (sudah diajukan/selesai atau tugas induk)"})
		return
	}
	var u models.User
	database.DB.Where("employee_id = ? AND is_active = true", emp.ID).Limit(1).Find(&u)
	nxt := nextWorkday(emp, today())
	res := gin.H{"ok": true, "next_workday": nxt.Format("2006-01-02")}
	var msgs []string
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if t.Status == "todo" && t.StartDate != nil && !day(*t.StartDate).After(today()) { // start date already passed: start tomorrow
			old := histDate(t.StartDate)
			ns := nxt
			if err := tx.Model(&models.Task{}).Where("id = ?", t.ID).Update("start_date", ns).Error; err != nil {
				return err
			}
			logTask(tx, t.ID, u.ID, "start_date", old, ns.Format("2006-01-02"), "dipindahkan ke hari kerja berikutnya dari ringkasan clock-out")
			res["start_moved"] = true
			msgs = append(msgs, "tanggal mulai dipindah ke "+ns.Format("02/01"))
		}
		if t.DueDate != nil && day(*t.DueDate).Before(nxt) {
			var pending int64
			tx.Model(&models.TaskDeadlineRequest{}).Where("task_id = ? AND status = 'Pending Approval'", t.ID).Count(&pending)
			if pending > 0 {
				msgs = append(msgs, "sudah ada pengajuan deadline yang menunggu approval")
			} else {
				if _, err := createDeadlineRequest(tx, t, nxt, "Dipindahkan ke hari kerja berikutnya dari ringkasan clock-out", u.ID); err != nil {
					return err
				}
				res["request_created"] = true
				msgs = append(msgs, "pengajuan deadline "+nxt.Format("02/01")+" dikirim ke atasan untuk approval")
			}
		}
		return nil
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(msgs) == 0 {
		msgs = append(msgs, "deadline dan tanggal mulai tugas ini sudah di hari kerja berikutnya atau lebih, tidak perlu dipindah")
	}
	res["message"] = strings.Join(msgs, "; ")
	c.JSON(http.StatusOK, res)
}

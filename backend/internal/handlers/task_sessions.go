package handlers

import (
	"net/http"
	"time"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Work sessions ("Aktivitas / Tugas Harian"): Mulai/Lanjutkan opens a session, Pause or Selesai closes it.
// Only one session can run per person at a time; starting another one pauses the first.

type sessionView struct {
	ID        uint       `json:"id"`
	StartedAt time.Time  `json:"started_at"`
	EndedAt   *time.Time `json:"ended_at"`
}

// closeOpenSessions ends every running session of a task (completion) or of a person (starting something else).
func closeOpenSessions(tx *gorm.DB, taskID, employeeID uint) {
	q := tx.Model(&models.TaskSession{}).Where("ended_at IS NULL")
	if taskID != 0 {
		q = q.Where("task_id = ?", taskID)
	}
	if employeeID != 0 {
		q = q.Where("employee_id = ?", employeeID)
	}
	q.Update("ended_at", time.Now())
}

// canLogSession: the PIC or a member (not a watcher / manager looking in) may log work time.
func canLogSession(c *gin.Context, t models.Task) bool {
	me := myEmployeeID(c)
	if me == nil {
		return false
	}
	if t.PICID == *me {
		return true
	}
	var n int64
	database.DB.Model(&models.TaskMember{}).Where("task_id = ? AND employee_id = ? AND role = 'member'", t.ID, *me).Count(&n)
	return n > 0
}

func StartTaskSession(c *gin.Context) {
	t, ok := loadTask(c)
	if !ok {
		return
	}
	if !canLogSession(c, t) {
		c.JSON(http.StatusForbidden, gin.H{"error": "hanya PIC atau anggota tugas yang dapat mencatat pengerjaan"})
		return
	}
	if calcFor(t.BusinessID).isParent(t.ID) {
		c.JSON(http.StatusConflict, gin.H{"error": "tugas induk tidak dikerjakan langsung; mulai dari sub tugasnya"})
		return
	}
	if t.Status != "todo" && t.Status != "in_progress" {
		c.JSON(http.StatusConflict, gin.H{"error": "tugas sudah diajukan atau selesai"})
		return
	}
	me := *myEmployeeID(c)
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		closeOpenSessions(tx, 0, me) // one running session per person
		now := time.Now()
		if err := tx.Create(&models.TaskSession{TaskID: t.ID, EmployeeID: me, StartedAt: now}).Error; err != nil {
			return err
		}
		if t.Status == "todo" && t.PICID == me {
			t.Status = "in_progress"
			logTask(tx, t.ID, uid(c), "status", statusText("todo"), statusText("in_progress"), "dimulai dari Aktivitas")
		}
		if t.ActualStart == nil {
			t.ActualStart = &now
		}
		return tx.Save(&t).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "gagal memulai"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func PauseTaskSession(c *gin.Context) {
	t, ok := loadTask(c)
	if !ok {
		return
	}
	if !canLogSession(c, t) {
		c.JSON(http.StatusForbidden, gin.H{"error": "hanya PIC atau anggota tugas yang dapat mencatat pengerjaan"})
		return
	}
	closeOpenSessions(database.DB, t.ID, *myEmployeeID(c))
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type activityRow struct {
	taskView
	Sessions   []sessionView `json:"sessions"`
	Minutes    int           `json:"minutes"` // worked on the chosen day
	Running    bool          `json:"running"`
	CanSession bool          `json:"can_session"`
	CanFinish  bool          `json:"can_finish"`
}

// ActivityList: my tasks for one day — what I own (PIC) or was named a member of, that is planned, overdue, worked on or finished that day.
func ActivityList(c *gin.Context) {
	me := myEmployeeID(c)
	if me == nil {
		c.JSON(http.StatusOK, gin.H{"data": []activityRow{}, "running_task_id": 0})
		return
	}
	d := today()
	if v, ok := parseDate(c.Query("date")); ok {
		d = v
	}
	from, to := day(d), day(d).AddDate(0, 0, 1)
	isToday := day(d).Equal(today())
	var ts []models.Task
	database.DB.Where(`(pic_id = ? OR EXISTS (SELECT 1 FROM task_members tm WHERE tm.task_id = tasks.id AND tm.employee_id = ? AND tm.role = 'member'))
		AND NOT EXISTS (SELECT 1 FROM tasks k WHERE k.parent_id = tasks.id)
		AND (
		  EXISTS (SELECT 1 FROM task_sessions s WHERE s.task_id = tasks.id AND s.employee_id = ? AND s.started_at >= ? AND s.started_at < ?)
		  OR (tasks.status = 'done' AND tasks.completed_at >= ? AND tasks.completed_at < ?)
		  OR (tasks.status <> 'done' AND (
		       (tasks.start_date IS NOT NULL AND tasks.due_date IS NOT NULL AND tasks.start_date <= ? AND tasks.due_date >= ?)
		    OR tasks.start_date = ? OR tasks.due_date = ?
		    OR (? AND (tasks.start_date IS NULL OR tasks.start_date <= ?) AND (tasks.due_date IS NULL OR tasks.due_date < ?))))
		)`, *me, *me, *me, from, to, from, to, from, from, from, from, isToday, from, from).
		Order("tasks.due_date ASC NULLS LAST, tasks.id").Limit(300).Find(&ts)

	views := decorateTasks(c, ts, calcsFor(ts))
	ids := make([]uint, 0, len(ts))
	for _, t := range ts {
		ids = append(ids, t.ID)
	}
	byTask := map[uint][]models.TaskSession{}
	if len(ids) > 0 {
		var ss []models.TaskSession
		database.DB.Where("task_id IN ? AND employee_id = ? AND ((started_at >= ? AND started_at < ?) OR ended_at IS NULL)", ids, *me, from, to).Order("started_at").Find(&ss)
		for _, s := range ss {
			byTask[s.TaskID] = append(byTask[s.TaskID], s)
		}
	}
	now := time.Now()
	running := uint(0)
	out := make([]activityRow, 0, len(views))
	for _, v := range views {
		r := activityRow{taskView: v, Sessions: []sessionView{}}
		for _, s := range byTask[v.ID] {
			r.Sessions = append(r.Sessions, sessionView{s.ID, s.StartedAt, s.EndedAt})
			end := now
			if s.EndedAt != nil {
				end = *s.EndedAt
			} else {
				r.Running, running = true, v.ID
			}
			if end.After(s.StartedAt) {
				r.Minutes += int(end.Sub(s.StartedAt).Minutes())
			}
		}
		r.CanSession = (v.Status == "todo" || v.Status == "in_progress") && canLogSession(c, v.Task)
		r.CanFinish = r.CanSession && v.PICID == *me
		out = append(out, r)
	}
	c.JSON(http.StatusOK, gin.H{"data": out, "running_task_id": running, "date": from.Format("2006-01-02")})
}

// MyAttendanceToday feeds the "Sedang Bekerja" pill: tap-in time, place, and whether the day is closed.
func MyAttendanceToday(c *gin.Context) {
	me := myEmployeeID(c)
	if me == nil {
		c.JSON(http.StatusOK, gin.H{"applicable": false})
		return
	}
	var emp models.Employee
	database.DB.Preload("Position").Limit(1).Find(&emp, *me)
	if emp.ID == 0 || (emp.Position != nil && noAttendanceClass(emp.Position.LevelClass)) {
		c.JSON(http.StatusOK, gin.H{"applicable": false})
		return
	}
	var rec models.AttendanceRecord
	database.DB.Where("employee_id = ? AND date = ?", emp.ID, today()).Limit(1).Find(&rec)
	out := gin.H{"applicable": true, "state": "none", "server_time": time.Now()}
	if rec.ID != 0 && rec.CheckInAt != nil {
		out["state"] = "working"
		out["check_in"] = rec.CheckInAt
		if rec.InLocationID != nil {
			var loc models.Location
			database.DB.Select("id, name").Limit(1).Find(&loc, *rec.InLocationID)
			out["location"] = loc.Name
		}
		if rec.CheckOutAt != nil {
			out["state"], out["check_out"], out["work_minutes"] = "done", rec.CheckOutAt, rec.WorkMinutes
		}
	}
	c.JSON(http.StatusOK, out)
}

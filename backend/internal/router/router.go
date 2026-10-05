package router

import (
	"strings"

	"github.com/dea-core/hcis/backend/internal/config"
	"github.com/dea-core/hcis/backend/internal/handlers"
	"github.com/dea-core/hcis/backend/internal/middleware"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func Setup(cfg *config.Config) *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery(), gin.Logger())
	// believe X-Forwarded-For only from the reverse proxy (needed for the per-IP login limits)
	var proxies []string
	for _, p := range strings.Split(cfg.TrustedProxies, ",") {
		if p = strings.TrimSpace(p); p != "" {
			proxies = append(proxies, p)
		}
	}
	r.SetTrustedProxies(proxies)
	r.Use(func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("Referrer-Policy", "same-origin")
		c.Next()
	})
	r.MaxMultipartMemory = 12 << 20

	origins := []string{"http://localhost:5173", "http://localhost:3000"}
	for _, o := range strings.Split(cfg.FrontendOrigin, ",") {
		if o = strings.TrimSpace(o); o != "" {
			origins = append(origins, o)
		}
	}
	r.Use(cors.New(cors.Config{
		AllowOrigins:     origins,
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		AllowCredentials: true,
	}))

	api := r.Group("/api")
	api.GET("/health", func(c *gin.Context) { c.JSON(200, gin.H{"status": "ok"}) })
	api.POST("/auth/login", handlers.Login)
	if cfg.DevLogin { // local development only: pick-an-account login without a password (404 when disabled)
		api.GET("/dev/accounts", handlers.DevAccounts)
		api.POST("/dev/login", handlers.DevLogin)
	}

	// public attendance page (no session): identity = NIK/email + password on every tap
	api.GET("/public/clock", handlers.PublicClock)
	api.POST("/public/attendance", handlers.PublicAttendance)
	api.GET("/drive/callback", handlers.DriveCallback) // Google redirects the browser here; the signed state protects it

	auth := api.Group("", middleware.AuthMiddleware())
	auth.GET("/auth/me", handlers.Me)
	auth.PUT("/auth/password", handlers.ChangePassword)
	auth.GET("/businesses", handlers.Businesses)

	auth.GET("/leave/types", handlers.ListLeaveTypes)
	auth.GET("/leave/requests", handlers.ListLeaveRequests)
	auth.POST("/leave/requests", handlers.CreateLeaveRequest)
	auth.POST("/leave/requests/:id/cancel", handlers.CancelLeaveRequest)
	auth.GET("/leave/calc", handlers.LeaveCalc)
	auth.GET("/leave/roster-window", handlers.RosterWindow)
	auth.GET("/notifications", handlers.ListNotifications)
	auth.POST("/notifications/read-all", handlers.MarkAllNotificationsRead)
	auth.POST("/notifications/:id/read", handlers.MarkNotificationRead)
	auth.GET("/leave/requests/:id/attachments", handlers.ListLeaveAttachments)
	auth.POST("/leave/requests/:id/attachments", handlers.UploadLeaveAttachment)
	auth.GET("/leave/requests/:id/attachments/:aid/file", handlers.DownloadLeaveAttachment)
	auth.DELETE("/leave/requests/:id/attachments/:aid", handlers.DeleteLeaveAttachment)
	auth.POST("/leave/balances/:id/grant", handlers.GrantLeave)
	auth.GET("/holidays", handlers.ListHolidays)
	auth.POST("/holidays", handlers.CreateHoliday)
	auth.PUT("/holidays/:id", handlers.UpdateHoliday)
	auth.DELETE("/holidays/:id", handlers.DeleteHoliday)
	auth.GET("/leave/balances", handlers.LeaveBalances)
	auth.GET("/leave/summary", handlers.LeaveSummary)
	auth.GET("/approvers", handlers.Approvers)
	auth.GET("/approvals/inbox", handlers.ApprovalInbox)
	auth.GET("/approvals/:id", handlers.GetApproval)
	auth.GET("/approvals/count", handlers.ApprovalCount)
	auth.GET("/approvals/history", handlers.ApprovalHistory)
	auth.GET("/approvals/mine", handlers.MyApprovalRequests)
	auth.POST("/approvals/:id/approve", handlers.ApproveRequest)
	auth.POST("/approvals/:id/reject", handlers.RejectRequest)

	auth.GET("/attendance/daily", handlers.AttendanceDaily)
	auth.GET("/attendance/recap", handlers.AttendanceRecap)
	auth.GET("/attendance/schedule", handlers.AttendanceSchedule)
	auth.GET("/attendance/manual", handlers.ListManualAttendance)
	auth.POST("/attendance/manual", handlers.CreateManualAttendance)
	auth.POST("/attendance/manual/:id/cancel", handlers.CancelManualAttendance)
	auth.GET("/work-calendars", handlers.ListWorkCalendars)
	auth.POST("/work-calendars", handlers.SaveWorkCalendar)
	auth.PUT("/work-calendars/:id", handlers.SaveWorkCalendar)
	auth.DELETE("/work-calendars/:id", handlers.DeleteWorkCalendar)
	auth.GET("/rosters", handlers.ListRosters)
	auth.POST("/rosters", handlers.SaveRoster)
	auth.PUT("/rosters/:id", handlers.SaveRoster)
	auth.DELETE("/rosters/:id", handlers.DeleteRoster)
	auth.PUT("/rosters/:id/employees", handlers.SetRosterEmployees)
	auth.GET("/roster-adjustments", handlers.ListRosterAdjustments)
	auth.POST("/roster-adjustments", handlers.CreateRosterAdjustment)
	auth.POST("/roster-adjustments/:id/cancel", handlers.CancelRosterAdjustment)

	auth.GET("/tasks", handlers.ListTasks)
	auth.GET("/tasks/assignees", handlers.TaskAssignees)
	auth.POST("/tasks", handlers.CreateTask)
	auth.GET("/tasks/:id", handlers.GetTask)
	auth.PUT("/tasks/:id", handlers.UpdateTask)
	auth.DELETE("/tasks/:id", handlers.DeleteTask)
	auth.POST("/tasks/:id/status", handlers.SetTaskStatus)
	auth.POST("/tasks/:id/complete", handlers.CompleteTask)
	auth.POST("/tasks/:id/cancel-completion", handlers.CancelCompletion)
	auth.POST("/tasks/:id/reopen", handlers.ReopenTask)
	auth.POST("/tasks/:id/comments", handlers.AddTaskComment)
	auth.GET("/tasks/:id/attachments", handlers.ListTaskAttachments)
	auth.POST("/tasks/:id/attachments", handlers.UploadTaskAttachment)
	auth.GET("/tasks/:id/attachments/:aid/file", handlers.DownloadTaskAttachment)
	auth.DELETE("/tasks/:id/attachments/:aid", handlers.DeleteTaskAttachment)
	auth.GET("/projects", handlers.ListProjects)
	auth.POST("/projects", handlers.CreateProject)
	auth.GET("/projects/:id", handlers.GetProject)
	auth.PUT("/projects/:id", handlers.UpdateProject)
	auth.DELETE("/projects/:id", handlers.DeleteProject)
	auth.PUT("/projects/:id/weights", handlers.SetProjectWeights)
	auth.GET("/projects/:id/curve", handlers.ProjectCurve)
	auth.GET("/projects/:id/documents", handlers.ListProjectDocuments)
	auth.POST("/projects/:id/documents", handlers.UploadProjectDocument)
	auth.GET("/projects/:id/documents/:did/file", handlers.DownloadProjectDocument)
	auth.DELETE("/projects/:id/documents/:did", handlers.DeleteProjectDocument)

	auth.GET("/kpi/settings", handlers.GetKPISettings)
	auth.GET("/kpi/scorecard", handlers.Scorecard)
	auth.GET("/kpi/scorecard/:id", handlers.ScorecardDetail)
	auth.GET("/kpi/items", handlers.ListKPIItems)
	auth.POST("/kpi/items", handlers.CreateKPIItem)
	auth.PUT("/kpi/items/:id", handlers.UpdateKPIItem)
	auth.DELETE("/kpi/items/:id", handlers.DeleteKPIItem)
	auth.GET("/kpi/task-options", handlers.KPITaskOptions)
	auth.GET("/kpi/history/:id", handlers.KPIHistory)
	auth.GET("/recurring-tasks", handlers.ListRecurringTasks)
	auth.POST("/recurring-tasks", handlers.CreateRecurringTask)
	auth.PUT("/recurring-tasks/:id", handlers.UpdateRecurringTask)
	auth.DELETE("/recurring-tasks/:id", handlers.DeleteRecurringTask)
	auth.GET("/kpi/departments", handlers.ListDeptKPIs)
	auth.POST("/kpi/departments", handlers.CreateDeptKPI)
	auth.PUT("/kpi/departments/:id", handlers.UpdateDeptKPI)
	auth.DELETE("/kpi/departments/:id", handlers.DeleteDeptKPI)

	auth.GET("/org/units", handlers.ListUnits)
	auth.GET("/org/positions", handlers.ListPositions)
	auth.GET("/org/locations", handlers.ListLocations)
	auth.GET("/employees", handlers.ListEmployees)
	auth.GET("/employees/contract-expiring", handlers.ContractExpiring)
	auth.GET("/employees/:id", handlers.GetEmployee)

	admin := auth.Group("", middleware.RequireRole("super_admin", "hr_admin"))
	admin.POST("/admin/run-reminders", handlers.RunRemindersNow)
	auth.POST("/org/units", middleware.RequirePerm("org.manage"), handlers.SaveUnit)
	auth.PUT("/org/units/:id", middleware.RequirePerm("org.manage"), handlers.SaveUnit)
	auth.DELETE("/org/units/:id", middleware.RequirePerm("org.manage"), handlers.DeleteUnit)
	auth.POST("/org/positions", middleware.RequirePerm("org.manage"), handlers.SavePosition)
	auth.PUT("/org/positions/:id", middleware.RequirePerm("org.manage"), handlers.SavePosition)
	auth.DELETE("/org/positions/:id", middleware.RequirePerm("org.manage"), handlers.DeletePosition)
	auth.POST("/org/locations", middleware.RequirePerm("org.manage"), handlers.SaveLocation)
	auth.PUT("/org/locations/:id", middleware.RequirePerm("org.manage"), handlers.SaveLocation)
	auth.DELETE("/org/locations/:id", middleware.RequirePerm("org.manage"), handlers.DeleteLocation)
	auth.POST("/employees", middleware.RequirePerm("employees.manage"), handlers.SaveEmployee)
	auth.PUT("/employees/:id", middleware.RequirePerm("employees.manage"), handlers.SaveEmployee)
	auth.PATCH("/employees/:id/status", middleware.RequirePerm("employees.manage"), handlers.SetEmployeeStatus)
	auth.POST("/employees/:id/placements", middleware.RequirePerm("employees.manage"), handlers.AddPlacement)
	auth.DELETE("/employees/:id/placements/:pid", middleware.RequirePerm("employees.manage"), handlers.RemovePlacement)
	auth.DELETE("/employees/:id", middleware.RequirePerm("employees.manage"), handlers.DeleteEmployee)
	auth.GET("/employees/:id/documents", middleware.RequirePerm("employees.manage"), handlers.ListEmployeeDocuments)
	auth.POST("/employees/:id/documents", middleware.RequirePerm("employees.manage"), handlers.UploadEmployeeDocument)
	auth.GET("/employees/:id/documents/:docId/file", middleware.RequirePerm("employees.manage"), handlers.DownloadEmployeeDocument)
	auth.DELETE("/employees/:id/documents/:docId", middleware.RequirePerm("employees.manage"), handlers.DeleteEmployeeDocument)
	auth.GET("/employees/doc-labels", middleware.RequirePerm("employees.manage"), handlers.EmployeeDocLabels)
	auth.PUT("/leave/balances/:id", middleware.RequirePerm("leave.admin"), handlers.AdjustLeaveBalance)
	auth.POST("/leave/types", middleware.RequirePerm("leave.admin"), handlers.SaveLeaveType)
	auth.PUT("/leave/types/:id", middleware.RequirePerm("leave.admin"), handlers.SaveLeaveType)
	auth.GET("/users", middleware.RequirePerm("users.manage"), handlers.ListUsers)
	auth.POST("/users", middleware.RequirePerm("users.manage"), handlers.CreateUser)
	auth.PUT("/users/:id", middleware.RequirePerm("users.manage"), handlers.UpdateUser)
	auth.GET("/audit", middleware.RequirePerm("audit.view"), handlers.ListAudit)
	auth.PUT("/kpi/settings", middleware.RequirePerm("kpi.settings"), handlers.SaveKPISettings)
	auth.GET("/kpi/periods", middleware.RequirePerm("kpi.period"), handlers.ListKPIPeriods)
	auth.POST("/kpi/periods/close", middleware.RequirePerm("kpi.period"), handlers.CloseKPIPeriod)
	auth.POST("/kpi/periods/reopen", middleware.RequirePerm("kpi.period"), handlers.ReopenKPIPeriod)
	auth.POST("/businesses", middleware.RequirePerm("business.manage"), handlers.SaveBusiness)
	auth.PUT("/businesses/:id", middleware.RequirePerm("business.manage"), handlers.SaveBusiness)
	auth.DELETE("/businesses/:id", middleware.RequirePerm("business.manage"), handlers.DeleteBusiness)
	auth.GET("/dashboard", handlers.Dashboard)
	auth.GET("/drive/status", middleware.RequirePerm("drive.manage"), handlers.DriveStatus)
	auth.GET("/drive/connect", middleware.RequirePerm("drive.manage"), handlers.DriveConnect)
	auth.POST("/drive/disconnect", middleware.RequirePerm("drive.manage"), handlers.DriveDisconnect)
	auth.POST("/drive/sync", middleware.RequirePerm("drive.manage"), handlers.DriveSyncNow)
	auth.POST("/drive/retry", middleware.RequirePerm("drive.manage"), handlers.DriveRetryFailed)
	auth.GET("/reports/:type", middleware.RequirePerm("reports.view"), handlers.GetReport)
	auth.GET("/roles/permissions", middleware.RequirePerm("roles.manage"), handlers.GetRolePermissions)
	auth.PUT("/roles/permissions/:role", middleware.RequirePerm("roles.manage"), handlers.SetRolePermissions)
	auth.POST("/roles/permissions/:role/reset", middleware.RequirePerm("roles.manage"), handlers.ResetRolePermissions)
	return r
}

package handlers

import (
	"net/http"

	"github.com/dea-core/hcis/backend/internal/approval"
	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// decorate fills requester / approver display names.
func decorate(reqs []models.ApprovalRequest) {
	ids := map[uint]bool{}
	for _, r := range reqs {
		ids[r.RequesterUserID] = true
		for _, s := range r.Steps {
			ids[s.ApproverUserID] = true
			if s.ActedByUserID != nil {
				ids[*s.ActedByUserID] = true
			}
		}
	}
	var keys []uint
	for k := range ids {
		keys = append(keys, k)
	}
	var users []models.User
	if len(keys) > 0 {
		database.DB.Select("id, name").Where("id IN ?", keys).Find(&users)
	}
	name := map[uint]string{}
	for _, u := range users {
		name[u.ID] = u.Name
	}
	empIDs := []uint{}
	for _, r := range reqs {
		if r.RequesterEmployeeID != nil {
			empIDs = append(empIDs, *r.RequesterEmployeeID)
		}
	}
	type empInfo struct{ nik, position string }
	emps := map[uint]empInfo{}
	if len(empIDs) > 0 {
		var es []models.Employee
		database.DB.Preload("Position").Select("id, nik, position_id").Where("id IN ?", empIDs).Find(&es)
		for _, e := range es {
			info := empInfo{nik: e.NIK}
			if e.Position != nil {
				info.position = e.Position.Title
			}
			emps[e.ID] = info
		}
	}
	for i := range reqs {
		reqs[i].RequesterName = name[reqs[i].RequesterUserID]
		if reqs[i].RequesterEmployeeID != nil {
			info := emps[*reqs[i].RequesterEmployeeID]
			reqs[i].RequesterNIK, reqs[i].RequesterPosition = info.nik, info.position
		}
		for j := range reqs[i].Steps {
			s := &reqs[i].Steps[j]
			s.ApproverName = name[s.ApproverUserID]
			if s.ActedByUserID != nil {
				s.ActedByName = name[*s.ActedByUserID]
			}
		}
	}
}

func pendingForMe(c *gin.Context) *gorm.DB {
	q := database.DB.Model(&models.ApprovalRequest{}).Where("status = ?", approval.Pending)
	if role(c) == "super_admin" { // super admin can act on everything except what they filed themselves
		q = q.Where("requester_user_id <> ?", uid(c))
		if me := myEmployeeID(c); me != nil {
			q = q.Where("requester_employee_id IS NULL OR requester_employee_id <> ?", *me)
		}
	} else {
		q = q.Where(`EXISTS (SELECT 1 FROM approval_steps s WHERE s.request_id = approval_requests.id
			AND s.level = approval_requests.current_level AND s.status = 'Pending' AND s.approver_user_id = ?)`, uid(c))
	}
	return q
}

// ApprovalInbox: requests waiting for my decision ("Approval Saya").
func ApprovalInbox(c *gin.Context) {
	l := []models.ApprovalRequest{}
	scopeBusiness(c, pendingForMe(c), "approval_requests.business_id").Preload("Steps", func(db *gorm.DB) *gorm.DB { return db.Order("level") }).Order("created_at DESC").Find(&l)
	decorate(l)
	c.JSON(http.StatusOK, l)
}

func ApprovalCount(c *gin.Context) {
	var n int64
	pendingForMe(c).Count(&n)
	c.JSON(http.StatusOK, gin.H{"inbox": n})
}

// ApprovalHistory: decided requests. Group-level roles see all in scope; everyone else sees the requests they
// took part in as approver, the ones they filed themselves, and the ones filed by people below them
// (mirrors canSeeApproval). Optional filters: status (Approved|Rejected|Cancelled) and type (request_type).
func ApprovalHistory(c *gin.Context) {
	q := scopeBusiness(c, database.DB.Model(&models.ApprovalRequest{}), "approval_requests.business_id").Where("status <> ?", approval.Pending)
	if v := c.Query("status"); v != "" {
		q = q.Where("approval_requests.status = ?", v)
	}
	if v := c.Query("type"); v != "" {
		q = q.Where("approval_requests.request_type = ?", v)
	}
	if !isGroupLevel(c) {
		me := myEmployeeID(c)
		cond := `approval_requests.requester_user_id = ? OR EXISTS (SELECT 1 FROM approval_steps s WHERE s.request_id = approval_requests.id AND (s.acted_by_user_id = ? OR s.approver_user_id = ?))`
		args := []any{uid(c), uid(c), uid(c)}
		if me != nil {
			cond += " OR approval_requests.requester_employee_id = ? OR approval_requests.requester_employee_id IN " + downlineSQL
			args = append(args, *me, *me)
		}
		q = q.Where("("+cond+")", args...)
	}
	l := []models.ApprovalRequest{}
	q.Preload("Steps", func(db *gorm.DB) *gorm.DB { return db.Order("level") }).Order("COALESCE(decided_at, created_at) DESC").Limit(1000).Find(&l)
	decorate(l)
	c.JSON(http.StatusOK, l)
}

// MyApprovalRequests: what I submitted, with the approval chain and progress.
func MyApprovalRequests(c *gin.Context) {
	l := []models.ApprovalRequest{}
	database.DB.Where("requester_user_id = ?", uid(c)).Preload("Steps", func(db *gorm.DB) *gorm.DB { return db.Order("level") }).Order("created_at DESC").Limit(1000).Find(&l)
	decorate(l)
	c.JSON(http.StatusOK, l)
}

func decide(approve bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		var in struct {
			Note string `json:"note"`
		}
		c.ShouldBindJSON(&in)
		if !approve && in.Note == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "alasan penolakan wajib diisi"})
			return
		}
		var out *models.ApprovalRequest
		err := database.DB.Transaction(func(tx *gorm.DB) (e error) {
			out, e = approval.Act(tx, paramID(c), uid(c), role(c), approve, in.Note)
			return
		})
		if err != nil {
			code := http.StatusBadRequest
			if err == approval.ErrNotAllowed || err == approval.ErrSelfApproval {
				code = http.StatusForbidden
			} else if err == approval.ErrNotPending {
				code = http.StatusConflict
			}
			c.JSON(code, gin.H{"error": err.Error()})
			return
		}
		audit(c, map[bool]string{true: "approve", false: "reject"}[approve], "approval_request", out.ID)
		c.JSON(http.StatusOK, out)
	}
}

var ApproveRequest = decide(true)
var RejectRequest = decide(false)

// Approvers previews the resolved approval chain (the exact chain Submit would build) and lists people who can be assigned instead.
func Approvers(c *gin.Context) {
	empID := uint(0)
	if v := c.Query("employee_id"); v != "" {
		empID = func() uint {
			var n uint
			for _, ch := range v {
				n = n*10 + uint(ch-'0')
			}
			return n
		}()
	}
	me := myEmployeeID(c)
	if empID == 0 && me != nil {
		empID = *me
	}
	if empID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "karyawan tidak ditemukan"})
		return
	}
	// only for people the caller may act for: group-level, themselves, their subordinates, or (task assignment) their superiors
	if !mayPreviewApprovers(c, me, empID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "tidak berwenang"})
		return
	}
	var emp models.Employee
	database.DB.Limit(1).Find(&emp, empID)
	var ru models.User
	database.DB.Where("employee_id = ?", empID).Limit(1).Find(&ru)
	// ?request= roster | attendance_manual | attendance_location | leave (+ leave_type_id): same flow key as Submit uses
	flowKey := ""
	switch rq := c.Query("request"); rq {
	case "roster", "attendance_manual", "attendance_location":
		flowKey = rq
	case "leave":
		var lt models.LeaveType
		if database.DB.Limit(1).Find(&lt, c.Query("leave_type_id")).Error == nil && lt.ID != 0 {
			flowKey = approval.LeaveFlowKey(lt.Category, rosterMemberSet()[empID])
		}
	}
	in := approval.SubmitInput{Type: "leave", RequesterUserID: ru.ID, RequesterEmployeeID: &empID, BusinessID: emp.BusinessID, FlowKey: flowKey}
	type person struct {
		UserID uint   `json:"user_id"`
		Name   string `json:"name"`
		Role   string `json:"role,omitempty"`
	}
	type chainPerson struct {
		person
		Level    int    `json:"level"`
		Kind     string `json:"kind"`
		Position string `json:"position,omitempty"`
	}
	nplus := []person{}
	chain := []chainPerson{}
	flowID, steps := approval.PreviewSteps(database.DB, in)
	for i, st := range steps {
		var u models.User
		database.DB.Select("id, name, role").First(&u, st.UserID)
		nplus = append(nplus, person{u.ID, u.Name, u.Role})
		cp := chainPerson{person: person{u.ID, u.Name, u.Role}, Level: i + 1, Kind: st.Kind}
		if st.PositionID != nil {
			var p models.Position
			database.DB.Select("id, title").Limit(1).Find(&p, *st.PositionID)
			cp.Position = p.Title
		}
		chain = append(chain, cp)
	}
	cands := []person{}
	var us []models.User
	database.DB.Where(`is_active = true AND role IN ('manager','hr_admin','super_admin') AND id <> ?
		AND (role IN ('hr_admin','super_admin') OR id IN (SELECT user_id FROM user_businesses WHERE business_id = ?))`, ru.ID, emp.BusinessID).Order("name").Find(&us)
	for _, u := range us {
		cands = append(cands, person{u.ID, u.Name, u.Role})
	}
	c.JSON(http.StatusOK, gin.H{"nplus1": nplus, "chain": chain, "flow_id": flowID, "flow_key": flowKey, "candidates": cands, "max_levels": maxApprovalLevels(empID)})
}

func mayPreviewApprovers(c *gin.Context, me *uint, empID uint) bool {
	if isGroupLevel(c) {
		return true
	}
	if me == nil {
		return false
	}
	if *me == empID || inDownline(*me, empID) {
		return true
	}
	for _, id := range uplineIDs(*me) {
		if id == empID {
			return true
		}
	}
	return false
}

// GetApproval returns one request with its chain (requester, approvers, their superiors, HR may view).
func GetApproval(c *gin.Context) {
	var r models.ApprovalRequest
	if database.DB.Preload("Steps", func(db *gorm.DB) *gorm.DB { return db.Order("level") }).Limit(1).Find(&r, paramID(c)).Error != nil || r.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "pengajuan tidak ditemukan"})
		return
	}
	me := myEmployeeID(c)
	inDown := false
	if !isGroupLevel(c) && me != nil && r.RequesterEmployeeID != nil {
		inDown = inDownline(*me, *r.RequesterEmployeeID)
	}
	if !canSeeApproval(isGroupLevel(c), uid(c), me, &r, inDown) {
		c.JSON(http.StatusForbidden, gin.H{"error": "tidak berwenang"})
		return
	}
	r.CanDecide = approval.CanDecideNow(&r, uid(c), role(c), me)
	l := []models.ApprovalRequest{r}
	decorate(l)
	c.JSON(http.StatusOK, l[0])
}

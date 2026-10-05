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
	for i := range reqs {
		reqs[i].RequesterName = name[reqs[i].RequesterUserID]
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
	if role(c) != "super_admin" { // super admin can act on everything
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

// ApprovalHistory: decided requests I took part in (group-level roles see all in scope).
func ApprovalHistory(c *gin.Context) {
	q := scopeBusiness(c, database.DB.Model(&models.ApprovalRequest{}), "approval_requests.business_id").Where("status <> ?", approval.Pending)
	if !isGroupLevel(c) {
		q = q.Where("EXISTS (SELECT 1 FROM approval_steps s WHERE s.request_id = approval_requests.id AND s.acted_by_user_id = ?)", uid(c))
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
			if err == approval.ErrNotAllowed {
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

// Approvers previews the n+1 approver for an employee and lists people who can be assigned instead.
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
	if empID == 0 {
		if m := myEmployeeID(c); m != nil {
			empID = *m
		}
	}
	var emp models.Employee
	database.DB.Limit(1).Find(&emp, empID)
	var ru models.User
	database.DB.Where("employee_id = ?", empID).Limit(1).Find(&ru)
	in := approval.SubmitInput{Type: "leave", RequesterUserID: ru.ID, RequesterEmployeeID: &empID}
	type person struct {
		UserID uint   `json:"user_id"`
		Name   string `json:"name"`
		Role   string `json:"role,omitempty"`
	}
	nplus := []person{}
	for _, id := range approval.Preview(database.DB, in) {
		var u models.User
		database.DB.Select("id, name, role").First(&u, id)
		nplus = append(nplus, person{u.ID, u.Name, u.Role})
	}
	cands := []person{}
	var us []models.User
	database.DB.Where(`is_active = true AND role IN ('manager','hr_admin','super_admin') AND id <> ?
		AND (role IN ('hr_admin','super_admin') OR id IN (SELECT user_id FROM user_businesses WHERE business_id = ?))`, ru.ID, emp.BusinessID).Order("name").Find(&us)
	for _, u := range us {
		cands = append(cands, person{u.ID, u.Name, u.Role})
	}
	c.JSON(http.StatusOK, gin.H{"nplus1": nplus, "candidates": cands})
}

// GetApproval returns one request with its chain (requester, approvers, their superiors, HR may view).
func GetApproval(c *gin.Context) {
	var r models.ApprovalRequest
	if database.DB.Preload("Steps", func(db *gorm.DB) *gorm.DB { return db.Order("level") }).Limit(1).Find(&r, paramID(c)).Error != nil || r.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "pengajuan tidak ditemukan"})
		return
	}
	allowed := isGroupLevel(c) || r.RequesterUserID == uid(c)
	for _, s := range r.Steps {
		allowed = allowed || s.ApproverUserID == uid(c)
	}
	if !allowed && r.RequesterEmployeeID != nil {
		if me := myEmployeeID(c); me != nil {
			allowed = inDownline(*me, *r.RequesterEmployeeID)
		}
	}
	if !allowed {
		c.JSON(http.StatusForbidden, gin.H{"error": "tidak berwenang"})
		return
	}
	l := []models.ApprovalRequest{r}
	decorate(l)
	c.JSON(http.StatusOK, l[0])
}

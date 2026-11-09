package handlers

import (
	"sort"

	"github.com/dea-core/hcis/backend/internal/approval"
	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
)

// chainStep is one step of an approval chain as shown (read only) to everyone who may see a request,
// including the requester: who decides, what kind of step it is, and where it stands.
type chainStep struct {
	Level  int    `json:"level"`
	Name   string `json:"name"`
	Kind   string `json:"kind"`   // n+1 | assigned | fallback | direct_manager | position | hr | hr_superior
	Status string `json:"status"` // Pending | Waiting | Approved | Rejected | Cancelled
}

// buildChain orders steps by level and resolves approver names.
func buildChain(steps []models.ApprovalStep, names map[uint]string) []chainStep {
	out := make([]chainStep, 0, len(steps))
	for _, s := range steps {
		out = append(out, chainStep{Level: s.Level, Name: names[s.ApproverUserID], Kind: s.Kind, Status: s.Status})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Level < out[j].Level })
	return out
}

// loadChains returns the chain of each approval id (two queries, whatever the number of requests).
func loadChains(ids []uint) map[uint][]chainStep {
	out := map[uint][]chainStep{}
	if len(ids) == 0 {
		return out
	}
	var steps []models.ApprovalStep
	database.DB.Where("request_id IN ?", ids).Order("level").Find(&steps)
	uids := []uint{}
	for _, s := range steps {
		uids = append(uids, s.ApproverUserID)
	}
	names := map[uint]string{}
	if len(uids) > 0 {
		var us []models.User
		database.DB.Select("id, name").Where("id IN ?", uids).Find(&us)
		for _, u := range us {
			names[u.ID] = u.Name
		}
	}
	by := map[uint][]models.ApprovalStep{}
	for _, s := range steps {
		by[s.RequestID] = append(by[s.RequestID], s)
	}
	for id, l := range by {
		out[id] = buildChain(l, names)
	}
	return out
}

// pendingInfo: who has to decide a pending request right now, and who filed it.
type pendingInfo struct {
	RequestID           uint
	ApproverUserID      uint
	ApproverName        string
	RequesterUserID     uint
	RequesterEmployeeID *uint
}

func loadPending(ids []uint) map[uint]pendingInfo {
	out := map[uint]pendingInfo{}
	if len(ids) == 0 {
		return out
	}
	var rows []pendingInfo
	database.DB.Raw(`SELECT s.request_id, s.approver_user_id, u.name AS approver_name, r.requester_user_id, r.requester_employee_id
		FROM approval_steps s JOIN approval_requests r ON r.id = s.request_id JOIN users u ON u.id = s.approver_user_id
		WHERE s.request_id IN ? AND s.status = 'Pending' AND s.level = r.current_level AND r.status = 'Pending'`, ids).Scan(&rows)
	for _, r := range rows {
		out[r.RequestID] = r
	}
	return out
}

// mayDecide applies the single approval rule (approval.MayDecide) to a pending request.
func (p pendingInfo) mayDecide(c *gin.Context, me *uint) bool {
	return approval.MayDecide(p.ApproverUserID, uid(c), role(c), p.RequesterUserID, p.RequesterEmployeeID, me) == nil
}

// canSeeApproval is the visibility rule for one request: group-level roles, the requester (by account or
// employee record), the approvers on its chain, and the requester's superiors.
func canSeeApproval(isGroup bool, actor uint, actorEmp *uint, r *models.ApprovalRequest, requesterInDownline bool) bool {
	if isGroup || r.RequesterUserID == actor {
		return true
	}
	if actorEmp != nil && r.RequesterEmployeeID != nil && *actorEmp == *r.RequesterEmployeeID {
		return true
	}
	for _, s := range r.Steps {
		if s.ApproverUserID == actor {
			return true
		}
	}
	return requesterInDownline
}

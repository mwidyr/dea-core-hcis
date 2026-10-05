// Package approval is the generic approval engine used by leave, manual attendance, tasks,
// employee changes and rosters.
//
// Rule (agreed with the client): a request goes to the requester's n+1 (direct manager).
// A request may instead carry an ASSIGNED approver; if so that person decides alone and the
// n+1 step is not needed. If nobody can be resolved the request falls back to an HR admin
// (then a super admin) so it never gets stuck.
package approval

import (
	"errors"
	"time"

	"github.com/dea-core/hcis/backend/internal/models"
	"gorm.io/gorm"
)

const (
	Pending   = "Pending"
	Approved  = "Approved"
	Rejected  = "Rejected"
	Cancelled = "Cancelled"
)

// Levels = how many n+1 steps a request type needs (n+1 only, by default).
var Levels = map[string]int{}

func levelsFor(t string, override int) int {
	if override > 0 {
		return override
	}
	return levels(t)
}

func levels(t string) int {
	if n, ok := Levels[t]; ok && n > 0 {
		return n
	}
	return 1
}

// Hooks apply the outcome to the business object (inside the same transaction).
type Hook func(tx *gorm.DB, req *models.ApprovalRequest, outcome string) error

var Hooks = map[string]Hook{}

type SubmitInput struct {
	Type                string
	RefID               uint
	BusinessID          uint
	RequesterEmployeeID *uint
	RequesterUserID     uint
	Title, Summary      string
	AssignedUserID      *uint
	Levels              int // n+1 levels for this request (0 = the type's default)
}

var (
	ErrNotPending = errors.New("pengajuan sudah diproses")
	ErrNotAllowed = errors.New("Anda bukan approver untuk pengajuan ini")
)

func userOfEmployee(tx *gorm.DB, empID uint) uint {
	var u models.User
	if tx.Where("employee_id = ? AND is_active = true", empID).Limit(1).Find(&u).Error == nil {
		return u.ID
	}
	return 0
}

// fallbackUser: an HR admin, else a super admin (never the requester).
func fallbackUser(tx *gorm.DB, exclude uint) uint {
	for _, role := range []string{"hr_admin", "super_admin"} {
		var u models.User
		if tx.Where("role = ? AND is_active = true AND id <> ?", role, exclude).Order("id").Limit(1).Find(&u).Error == nil && u.ID != 0 {
			return u.ID
		}
	}
	return 0
}

// chain returns the approver chain as (userID, kind).
func chain(tx *gorm.DB, in SubmitInput) [][2]any {
	if in.AssignedUserID != nil && *in.AssignedUserID != in.RequesterUserID {
		return [][2]any{{*in.AssignedUserID, "assigned"}} // assigned approver replaces the n+1 chain
	}
	var out [][2]any
	seen := map[uint]bool{in.RequesterUserID: true}
	cur := in.RequesterEmployeeID
	for i := 0; i < levelsFor(in.Type, in.Levels) && cur != nil; i++ {
		var e models.Employee
		if tx.Select("id, manager_id").Limit(1).Find(&e, *cur).Error != nil || e.ManagerID == nil {
			break
		}
		cur = e.ManagerID
		if uid := userOfEmployee(tx, *cur); uid != 0 && !seen[uid] {
			seen[uid] = true
			out = append(out, [2]any{uid, "n+1"})
		}
	}
	if len(out) == 0 { // no manager / manager has no account
		if f := fallbackUser(tx, in.RequesterUserID); f != 0 {
			out = append(out, [2]any{f, "fallback"})
		}
	}
	return out
}

// Preview returns who would approve, without creating anything (for the request form).
func Preview(tx *gorm.DB, in SubmitInput) []uint {
	var ids []uint
	for _, s := range chain(tx, in) {
		ids = append(ids, s[0].(uint))
	}
	return ids
}

func Submit(tx *gorm.DB, in SubmitInput) (*models.ApprovalRequest, error) {
	steps := chain(tx, in)
	if len(steps) == 0 {
		return nil, errors.New("tidak ada approver yang dapat ditentukan")
	}
	req := &models.ApprovalRequest{BusinessID: in.BusinessID, RequestType: in.Type, RefID: in.RefID,
		RequesterEmployeeID: in.RequesterEmployeeID, RequesterUserID: in.RequesterUserID,
		Title: in.Title, Summary: in.Summary, Status: Pending, AssignedUserID: in.AssignedUserID, CurrentLevel: 1}
	if err := tx.Create(req).Error; err != nil {
		return nil, err
	}
	for i, s := range steps {
		st := "Waiting"
		if i == 0 {
			st = Pending
		}
		if err := tx.Create(&models.ApprovalStep{RequestID: req.ID, Level: i + 1, ApproverUserID: s[0].(uint), Kind: s[1].(string), Status: st}).Error; err != nil {
			return nil, err
		}
	}
	return req, nil
}

// Act records a decision by userID (super admins may act on any pending step).
func Act(tx *gorm.DB, reqID, userID uint, role string, approve bool, note string) (*models.ApprovalRequest, error) {
	var req models.ApprovalRequest
	if err := tx.Preload("Steps").First(&req, reqID).Error; err != nil {
		return nil, errors.New("pengajuan tidak ditemukan")
	}
	if req.Status != Pending {
		return nil, ErrNotPending
	}
	var cur *models.ApprovalStep
	for i := range req.Steps {
		if req.Steps[i].Level == req.CurrentLevel && req.Steps[i].Status == Pending {
			cur = &req.Steps[i]
		}
	}
	if cur == nil || (cur.ApproverUserID != userID && role != "super_admin") {
		return nil, ErrNotAllowed
	}
	now := time.Now()
	cur.ActedByUserID, cur.ActedAt, cur.Note = &userID, &now, note
	outcome := ""
	if approve {
		cur.Status = Approved
		if req.CurrentLevel >= len(req.Steps) {
			outcome = Approved
		} else { // hand over to the next level
			req.CurrentLevel++
			tx.Model(&models.ApprovalStep{}).Where("request_id = ? AND level = ?", req.ID, req.CurrentLevel).Update("status", Pending)
		}
	} else {
		cur.Status = Rejected
		outcome = Rejected
	}
	if err := tx.Save(cur).Error; err != nil {
		return nil, err
	}
	req.Steps = nil
	if outcome != "" {
		req.Status, req.DecidedAt, req.DecisionNote = outcome, &now, note
	}
	if err := tx.Omit("Steps").Save(&req).Error; err != nil {
		return nil, err
	}
	if outcome != "" {
		if h := Hooks[req.RequestType]; h != nil {
			if err := h(tx, &req, outcome); err != nil {
				return nil, err
			}
		}
	}
	return &req, nil
}

// Cancel lets the requester withdraw a pending request.
func Cancel(tx *gorm.DB, reqID, userID uint) (*models.ApprovalRequest, error) {
	var req models.ApprovalRequest
	if err := tx.First(&req, reqID).Error; err != nil {
		return nil, errors.New("pengajuan tidak ditemukan")
	}
	if req.RequesterUserID != userID {
		return nil, ErrNotAllowed
	}
	if req.Status != Pending {
		return nil, ErrNotPending
	}
	now := time.Now()
	req.Status, req.DecidedAt = Cancelled, &now
	tx.Model(&models.ApprovalStep{}).Where("request_id = ? AND status IN ('Pending','Waiting')", req.ID).Update("status", Cancelled)
	if err := tx.Save(&req).Error; err != nil {
		return nil, err
	}
	if h := Hooks[req.RequestType]; h != nil {
		if err := h(tx, &req, Cancelled); err != nil {
			return nil, err
		}
	}
	return &req, nil
}

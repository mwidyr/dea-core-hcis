package handlers

import (
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/dea-core/hcis/backend/internal/approval"
	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type flowStepView struct {
	models.ApprovalFlowStep
	PositionTitle string `json:"position_title,omitempty"`
}

type flowView struct {
	models.ApprovalFlow
	Steps              []flowStepView `json:"steps"`
	RequesterPositions []uint         `json:"requester_position_ids"`
	RequesterTitles    []string       `json:"requester_titles"`
	IsDefault          bool           `json:"is_default"` // no requester scoping and no business: the generic flow of the type
}

// ListApprovalFlows returns every flow with its ordered steps and requester positions (HR / super admin only).
func ListApprovalFlows(c *gin.Context) {
	var flows []models.ApprovalFlow
	database.DB.Preload("Steps").Preload("Requesters").Order("request_type, id").Find(&flows)
	var pos []models.Position
	database.DB.Select("id, title").Find(&pos)
	title := map[uint]string{}
	for _, p := range pos {
		title[p.ID] = p.Title
	}
	out := make([]flowView, 0, len(flows))
	for _, f := range flows {
		v := flowView{ApprovalFlow: f, RequesterPositions: []uint{}, RequesterTitles: []string{}}
		sort.Slice(f.Steps, func(i, j int) bool { return f.Steps[i].Level < f.Steps[j].Level })
		v.Steps = []flowStepView{}
		for _, s := range f.Steps {
			sv := flowStepView{ApprovalFlowStep: s}
			if s.ApproverPositionID != nil {
				sv.PositionTitle = title[*s.ApproverPositionID]
			}
			v.Steps = append(v.Steps, sv)
		}
		for _, r := range f.Requesters {
			v.RequesterPositions = append(v.RequesterPositions, r.PositionID)
			v.RequesterTitles = append(v.RequesterTitles, title[r.PositionID])
		}
		v.IsDefault = len(f.Requesters) == 0 && f.BusinessID == nil
		out = append(out, v)
	}
	c.JSON(http.StatusOK, gin.H{"data": out, "types": approval.FlowKeys})
}

type flowInput struct {
	ID          uint   `json:"id"`
	Name        string `json:"name"`
	RequestType string `json:"request_type"`
	BusinessID  *uint  `json:"business_id"`
	IsActive    *bool  `json:"is_active"`
	Steps       []struct {
		Kind               string `json:"kind"`
		ApproverPositionID *uint  `json:"approver_position_id"`
	} `json:"steps"`
	RequesterPositionIDs []uint `json:"requester_position_ids"`
}

// validateFlow checks the input (pure apart from the position lookup `exists`) and returns a user-facing error.
func validateFlow(in *flowInput, exists func(uint) bool) string {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return "nama flow wajib diisi"
	}
	if !approval.ValidFlowKey(in.RequestType) {
		return "jenis pengajuan tidak dikenal"
	}
	if len(in.Steps) == 0 {
		return "flow minimal punya satu langkah"
	}
	if len(in.Steps) > 10 {
		return "maksimal 10 langkah"
	}
	for i, s := range in.Steps {
		if !approval.ValidStepKind(s.Kind) {
			return fmt.Sprintf("langkah %d: jenis tidak valid", i+1)
		}
		if s.Kind == approval.KindPosition {
			if s.ApproverPositionID == nil || !exists(*s.ApproverPositionID) {
				return fmt.Sprintf("langkah %d: pilih jabatan approver yang valid", i+1)
			}
		} else if s.ApproverPositionID != nil {
			return fmt.Sprintf("langkah %d: jabatan hanya untuk jenis \"Jabatan tertentu\"", i+1)
		}
	}
	seen := map[uint]bool{}
	uniq := []uint{}
	for _, p := range in.RequesterPositionIDs {
		if !exists(p) {
			return "jabatan pemohon tidak valid"
		}
		if !seen[p] {
			seen[p] = true
			uniq = append(uniq, p)
		}
	}
	in.RequesterPositionIDs = uniq
	return ""
}

func scopeSig(business *uint, reqs []uint) string {
	r := append([]uint(nil), reqs...)
	sort.Slice(r, func(i, j int) bool { return r[i] < r[j] })
	b := uint(0)
	if business != nil {
		b = *business
	}
	return fmt.Sprint(b, r)
}

// SaveApprovalFlow creates (no id) or replaces (id) one flow with its steps and requester positions.
func SaveApprovalFlow(c *gin.Context) {
	var in flowInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "data tidak valid"})
		return
	}
	exists := func(id uint) bool {
		var n int64
		database.DB.Model(&models.Position{}).Where("id = ?", id).Count(&n)
		return n > 0
	}
	if msg := validateFlow(&in, exists); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	if in.BusinessID != nil {
		var n int64
		database.DB.Model(&models.Business{}).Where("id = ?", *in.BusinessID).Count(&n)
		if n == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "bisnis tidak valid"})
			return
		}
	}
	var same []models.ApprovalFlow
	database.DB.Preload("Requesters").Where("request_type = ? AND id <> ?", in.RequestType, in.ID).Find(&same)
	sig := scopeSig(in.BusinessID, in.RequesterPositionIDs)
	for _, f := range same {
		ids := []uint{}
		for _, r := range f.Requesters {
			ids = append(ids, r.PositionID)
		}
		if scopeSig(f.BusinessID, ids) == sig {
			c.JSON(http.StatusConflict, gin.H{"error": fmt.Sprintf("sudah ada flow dengan cakupan yang sama (\"%s\")", f.Name)})
			return
		}
	}
	active := true
	if in.IsActive != nil {
		active = *in.IsActive
	}
	var saved models.ApprovalFlow
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if in.ID != 0 {
			if tx.Limit(1).Find(&saved, in.ID).Error != nil || saved.ID == 0 {
				return fmt.Errorf("flow tidak ditemukan")
			}
			saved.Name, saved.RequestType, saved.BusinessID, saved.IsActive = in.Name, in.RequestType, in.BusinessID, active
			if err := tx.Save(&saved).Error; err != nil {
				return err
			}
			tx.Where("flow_id = ?", saved.ID).Delete(&models.ApprovalFlowStep{})
			tx.Where("flow_id = ?", saved.ID).Delete(&models.ApprovalFlowRequester{})
		} else {
			saved = models.ApprovalFlow{Name: in.Name, RequestType: in.RequestType, BusinessID: in.BusinessID, IsActive: active}
			if err := tx.Create(&saved).Error; err != nil {
				return err
			}
		}
		for i, s := range in.Steps {
			if err := tx.Create(&models.ApprovalFlowStep{FlowID: saved.ID, Level: i + 1, Kind: s.Kind, ApproverPositionID: s.ApproverPositionID}).Error; err != nil {
				return err
			}
		}
		for _, p := range in.RequesterPositionIDs {
			if err := tx.Create(&models.ApprovalFlowRequester{FlowID: saved.ID, PositionID: p}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	audit(c, "save", "approval_flow", saved.ID)
	c.JSON(http.StatusOK, gin.H{"id": saved.ID})
}

// DeleteApprovalFlow removes a flow. In-flight requests keep their stored steps (flow_id is only a snapshot).
func DeleteApprovalFlow(c *gin.Context) {
	id := paramID(c)
	var f models.ApprovalFlow
	if database.DB.Limit(1).Find(&f, id).Error != nil || f.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "flow tidak ditemukan"})
		return
	}
	database.DB.Transaction(func(tx *gorm.DB) error {
		tx.Where("flow_id = ?", id).Delete(&models.ApprovalFlowStep{})
		tx.Where("flow_id = ?", id).Delete(&models.ApprovalFlowRequester{})
		return tx.Delete(&models.ApprovalFlow{}, id).Error
	})
	audit(c, "delete", "approval_flow", id)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

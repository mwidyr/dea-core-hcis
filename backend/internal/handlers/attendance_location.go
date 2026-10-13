package handlers

import (
	"fmt"
	"strings"

	"github.com/dea-core/hcis/backend/internal/approval"
	"github.com/dea-core/hcis/backend/internal/models"
	"gorm.io/gorm"
)

// Out-of-radius taps ("absen di luar lokasi"): the employee confirms on /absen, the tap is stored with the photo,
// distance and reason, and a request goes to the superior (n+1, else HR / admin). Until it is approved the day
// shows "Menunggu Approval Lokasi" and does not count as present. Rejecting (or withdrawing) voids that tap.

func submitLocationApproval(tx *gorm.DB, rec *models.AttendanceRecord, kind string, r tapRequest, o *outsideInfo) error {
	var u models.User
	tx.Where("employee_id = ? AND is_active = true", r.Emp.ID).Limit(1).Find(&u)
	if u.ID == 0 {
		return fmt.Errorf("akun karyawan tidak ditemukan (approver tidak dapat ditentukan)")
	}
	verb := map[string]string{"in": "Tap In", "out": "Tap Out"}[kind]
	summary := fmt.Sprintf("%s %s · %d m dari %s (radius %d m)", verb, r.Now.In(jkt).Format("02/01 15:04"), o.Distance, o.Place, o.Radius)
	if strings.TrimSpace(r.Reason) != "" {
		summary += " · alasan: " + strings.TrimSpace(r.Reason)
	}
	req, err := approval.Submit(tx, approval.SubmitInput{Type: "attendance_location", RefID: rec.ID, BusinessID: rec.BusinessID, RequesterEmployeeID: &r.Emp.ID, RequesterUserID: u.ID,
		Title: "Absen di Luar Lokasi — " + r.Emp.Name, Summary: summary})
	if err != nil {
		return err
	}
	if kind == "in" {
		rec.InLocApprovalID = &req.ID
	} else {
		rec.OutLocApprovalID = &req.ID
	}
	return tx.Save(rec).Error
}

// locationApprovalHook applies the decision to the tap (the side — in or out — is found from the approval id).
func locationApprovalHook(tx *gorm.DB, req *models.ApprovalRequest, outcome string) error {
	var rec models.AttendanceRecord
	if tx.Limit(1).Find(&rec, req.RefID).Error != nil || rec.ID == 0 {
		return nil // the record is gone (employee deleted); nothing to apply
	}
	kind := ""
	switch {
	case rec.InLocApprovalID != nil && *rec.InLocApprovalID == req.ID:
		kind = "in"
	case rec.OutLocApprovalID != nil && *rec.OutLocApprovalID == req.ID:
		kind = "out"
	default:
		return nil
	}
	var pu models.User
	tx.Where("employee_id = ? AND is_active = true", rec.EmployeeID).Limit(1).Find(&pu)
	verb := map[string]string{"in": "Tap In", "out": "Tap Out"}[kind]
	when := rec.Date.Format("02/01/2006")

	if outcome == approval.Approved {
		if kind == "in" {
			rec.InLocStatus = "approved"
		} else {
			rec.OutLocStatus = "approved"
		}
		if pu.ID != 0 {
			notify(pu.ID, "attendance_location", verb+" di luar lokasi disetujui", when, "/attendance", fmt.Sprintf("att-loc-ok:%d", req.ID))
		}
		return tx.Save(&rec).Error
	}

	// rejected or withdrawn: that tap is voided
	var files []models.AttendancePhoto
	tx.Where("record_id = ? AND kind = ?", rec.ID, kind).Find(&files)
	tx.Where("record_id = ? AND kind = ?", rec.ID, kind).Delete(&models.AttendancePhoto{})
	for _, f := range files {
		Store.Remove(f.LocalPath)
	}
	if kind == "in" {
		if rec.CheckOutAt == nil && rec.Source == "kiosk" { // nothing else on the day: drop the row, the employee may tap in again
			if err := tx.Delete(&rec).Error; err != nil {
				return err
			}
		} else {
			rec.CheckInAt, rec.InLat, rec.InLng, rec.InAccuracy, rec.InDistance, rec.InLocationID = nil, nil, nil, nil, nil, nil
			rec.InLocStatus, rec.InLocApprovalID, rec.LateMinutes = "rejected", nil, 0
			if err := tx.Save(&rec).Error; err != nil {
				return err
			}
		}
	} else {
		rec.CheckOutAt, rec.OutLat, rec.OutLng, rec.OutAccuracy, rec.OutDistance, rec.OutLocationID = nil, nil, nil, nil, nil, nil
		rec.OutLocStatus, rec.OutLocApprovalID, rec.WorkMinutes, rec.EarlyLeaveMinutes = "rejected", nil, 0, 0
		if err := tx.Save(&rec).Error; err != nil {
			return err
		}
	}
	if pu.ID != 0 {
		body := when
		if outcome == approval.Rejected && strings.TrimSpace(req.DecisionNote) != "" {
			body += " — " + req.DecisionNote
		}
		title := verb + " di luar lokasi ditolak"
		if outcome == approval.Cancelled {
			title = verb + " di luar lokasi dibatalkan"
		}
		notify(pu.ID, "attendance_location", title, body, "/attendance", fmt.Sprintf("att-loc-no:%d", req.ID))
	}
	return nil
}

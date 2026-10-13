package handlers

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	_ "image/png" // registers the PNG decoder
	"mime/multipart"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/dea-core/hcis/backend/internal/database"
	"github.com/dea-core/hcis/backend/internal/models"
	"github.com/gin-gonic/gin"
	xdraw "golang.org/x/image/draw"
	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/gobold"
	"golang.org/x/image/font/gofont/goregular"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
	"gorm.io/gorm"
)

// Attendance photos: every tap in / tap out carries a camera photo. The SERVER decodes it, shrinks it and burns the
// timestamp bar into the pixels (server clock, validated GPS, employee), so the stamp cannot be faked by the client.

const (
	maxPhotoUpload = 8 << 20    // bytes sent by the browser
	maxPhotoPixels = 40_000_000 // decompression-bomb guard (width × height)
	photoMaxEdge   = 1280       // stored size: longest edge in pixels
	photoMinEdge   = 200
)

type stampInfo struct {
	Name, NIK, Action, Place string // Action: in | out
	At                       time.Time
	Lat, Lng, Acc            *float64
}

// decodePhoto validates and decodes the uploaded photo (JPEG or PNG, sniffed from the bytes, not the file name).
func decodePhoto(fh *multipart.FileHeader) (image.Image, *tapError) {
	if fh == nil {
		return nil, fail(http.StatusBadRequest, "Foto wajib diambil sebelum Tap In/Out.")
	}
	if fh.Size > maxPhotoUpload {
		return nil, fail(http.StatusRequestEntityTooLarge, "Ukuran foto terlalu besar (maksimal 8 MB).")
	}
	f, err := fh.Open()
	if err != nil {
		return nil, fail(http.StatusBadRequest, "Foto tidak bisa dibaca.")
	}
	defer f.Close()
	head := make([]byte, 512)
	n, _ := f.Read(head)
	if mt := http.DetectContentType(head[:n]); mt != "image/jpeg" && mt != "image/png" {
		return nil, fail(http.StatusUnsupportedMediaType, "Foto harus berupa gambar JPEG atau PNG.")
	}
	f.Seek(0, 0)
	cfg, _, err := image.DecodeConfig(f)
	if err != nil {
		return nil, fail(http.StatusBadRequest, "File foto rusak atau tidak dikenali.")
	}
	if cfg.Width*cfg.Height > maxPhotoPixels {
		return nil, fail(http.StatusRequestEntityTooLarge, "Resolusi foto terlalu besar.")
	}
	if cfg.Width < photoMinEdge || cfg.Height < photoMinEdge {
		return nil, fail(http.StatusBadRequest, "Foto terlalu kecil.")
	}
	f.Seek(0, 0)
	img, _, err := image.Decode(f)
	if err != nil {
		return nil, fail(http.StatusBadRequest, "File foto rusak atau tidak dikenali.")
	}
	return img, nil
}

var (
	fontOnce         sync.Once
	fontReg, fontBld *opentype.Font
	fontErr          error
)

func loadFonts() error {
	fontOnce.Do(func() {
		if fontReg, fontErr = opentype.Parse(goregular.TTF); fontErr != nil {
			return
		}
		fontBld, fontErr = opentype.Parse(gobold.TTF)
	})
	return fontErr
}

var (
	photoDays   = []string{"Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"}
	photoMonths = []string{"Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"}
)

// stampLines builds the text burned into the photo.
func stampLines(in stampInfo) []string {
	at := in.At.In(jkt)
	who := in.Name
	if in.NIK != "" {
		who += " (" + in.NIK + ")"
	}
	act := "TAP IN"
	if in.Action == "out" {
		act = "TAP OUT"
	}
	lines := []string{
		who + " · " + act,
		fmt.Sprintf("%s, %02d %s %d · %s WIB", photoDays[at.Weekday()], at.Day(), photoMonths[at.Month()-1], at.Year(), at.Format("15:04:05")),
	}
	var where []string
	if in.Place != "" {
		where = append(where, in.Place)
	}
	if in.Lat != nil && in.Lng != nil {
		c := fmt.Sprintf("%.6f, %.6f", *in.Lat, *in.Lng)
		if in.Acc != nil {
			c += fmt.Sprintf(" (±%.0f m)", *in.Acc)
		}
		where = append(where, c)
	}
	if len(where) > 0 {
		lines = append(lines, strings.Join(where, " · "))
	}
	return lines
}

// fitText shrinks the face until s fits in maxW pixels (never below minPx), then truncates with an ellipsis.
func fitText(f *opentype.Font, s string, px, minPx float64, maxW int) (font.Face, string, error) {
	for {
		face, err := opentype.NewFace(f, &opentype.FaceOptions{Size: px, DPI: 72, Hinting: font.HintingFull})
		if err != nil {
			return nil, s, err
		}
		if (&font.Drawer{Face: face}).MeasureString(s).Ceil() <= maxW || px <= minPx {
			r := []rune(s)
			for len(r) > 1 && (&font.Drawer{Face: face}).MeasureString(string(r)).Ceil() > maxW {
				r = r[:len(r)-1]
				s = string(r) + "…"
			}
			return face, s, nil
		}
		face.Close()
		px -= 1
	}
}

// stampPhoto scales src to at most photoMaxEdge, draws the timestamp bar along the bottom and returns a JPEG.
func stampPhoto(src image.Image, in stampInfo) ([]byte, error) {
	if err := loadFonts(); err != nil {
		return nil, err
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if m := max(w, h); m > photoMaxEdge {
		w, h = w*photoMaxEdge/m, h*photoMaxEdge/m
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), src, b, xdraw.Src, nil)

	lines := stampLines(in)
	px := max(float64(w)/32, 13)
	lineH := px * 1.4
	pad := px * 0.7
	barH := int(lineH*float64(len(lines)) + pad*1.2)
	draw.Draw(dst, image.Rect(0, h-barH, w, h), &image.Uniform{color.RGBA{0, 0, 0, 185}}, image.Point{}, draw.Over)
	y := float64(h-barH) + pad*0.6 + px
	for i, ln := range lines {
		ft := fontReg
		if i == 0 {
			ft = fontBld
		}
		face, text, err := fitText(ft, ln, px, 10, w-int(pad*2))
		if err != nil {
			return nil, err
		}
		d := &font.Drawer{Dst: dst, Src: image.White, Face: face, Dot: fixed.P(int(pad), int(y))}
		d.DrawString(text)
		face.Close()
		y += lineH
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: 85}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// savePhoto writes the stamped JPEG and its row inside the caller's transaction; it returns the stored path
// so the caller can remove the file if the transaction later fails.
func savePhoto(tx *gorm.DB, recID uint, kind string, data []byte, at time.Time) (string, error) {
	at = at.In(jkt)
	rel, size, err := Store.Save(fmt.Sprintf("attendance/%d/%02d", at.Year(), int(at.Month())), fmt.Sprintf("%d-%s.jpg", recID, kind), bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	tx.Where("record_id = ? AND kind = ?", recID, kind).Delete(&models.AttendancePhoto{}) // a re-tap replaces the previous photo row
	if err := tx.Create(&models.AttendancePhoto{RecordID: recID, Kind: kind, LocalPath: rel, Size: size}).Error; err != nil {
		Store.Remove(rel)
		return "", err
	}
	return rel, nil
}

// AttendancePhoto serves one stamped photo (?kind=in|out) to anyone who may see that employee's attendance.
func AttendancePhoto(c *gin.Context) {
	kind := c.DefaultQuery("kind", "in")
	if kind != "in" && kind != "out" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "kind harus in atau out"})
		return
	}
	var rec models.AttendanceRecord
	if database.DB.First(&rec, paramID(c)).Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "data absensi tidak ditemukan"})
		return
	}
	me := myEmployeeID(c)
	if !isGroupLevel(c) && !(me != nil && (*me == rec.EmployeeID || inDownlineOf(*me, rec.EmployeeID))) {
		c.JSON(http.StatusForbidden, gin.H{"error": "tidak berhak melihat foto ini"})
		return
	}
	var p models.AttendancePhoto
	if database.DB.Where("record_id = ? AND kind = ?", rec.ID, kind).Limit(1).Find(&p).Error != nil || p.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "foto tidak tersedia"})
		return
	}
	c.Header("Content-Type", "image/jpeg")
	c.Header("Cache-Control", "private, max-age=3600")
	c.Header("X-Content-Type-Options", "nosniff")
	c.File(Store.Abs(p.LocalPath))
}

// photoFlags tells, per attendance record id, which photos exist (for the daily list).
func photoFlags(recIDs []uint) map[uint]map[string]bool {
	out := map[uint]map[string]bool{}
	if len(recIDs) == 0 {
		return out
	}
	var ps []models.AttendancePhoto
	database.DB.Select("record_id", "kind").Where("record_id IN ?", recIDs).Find(&ps)
	for _, p := range ps {
		if out[p.RecordID] == nil {
			out[p.RecordID] = map[string]bool{}
		}
		out[p.RecordID][p.Kind] = true
	}
	return out
}

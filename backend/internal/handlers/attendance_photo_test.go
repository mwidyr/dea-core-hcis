package handlers

import (
	"bytes"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"mime/multipart"
	"strings"
	"testing"
	"time"
)

func solid(w, h int, c color.Color) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(img, img.Bounds(), &image.Uniform{c}, image.Point{}, draw.Src)
	return img
}

func jpegBytes(t *testing.T, img image.Image) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := jpeg.Encode(&b, img, nil); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func fileHeader(t *testing.T, name string, data []byte) *multipart.FileHeader {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile("photo", name)
	fw.Write(data)
	mw.Close()
	form, err := multipart.NewReader(&buf, mw.Boundary()).ReadForm(1 << 20)
	if err != nil {
		t.Fatal(err)
	}
	return form.File["photo"][0]
}

func TestStampLines(t *testing.T) {
	lat, lng, acc := -6.2383, 106.9756, 12.4
	lines := stampLines(stampInfo{Name: "Rivaldy", NIK: "DEA-0011", Action: "in", At: time.Date(2026, 10, 9, 8, 3, 21, 0, jkt), Lat: &lat, Lng: &lng, Acc: &acc, Place: "Kantor Bekasi"})
	if len(lines) != 3 {
		t.Fatalf("want 3 lines, got %v", lines)
	}
	for i, want := range []string{"Rivaldy (DEA-0011) · TAP IN", "Jumat, 09 Okt 2026 · 08:03:21 WIB", "Kantor Bekasi · -6.238300, 106.975600 (±12 m)"} {
		if lines[i] != want {
			t.Errorf("line %d = %q, want %q", i, lines[i], want)
		}
	}
	if got := stampLines(stampInfo{Name: "X", Action: "out", At: time.Now()}); !strings.HasSuffix(got[0], "TAP OUT") || len(got) != 2 {
		t.Errorf("tap out without GPS: %v", got)
	}
}

func TestStampPhotoShrinksAndBurnsBar(t *testing.T) {
	out, err := stampPhoto(solid(2000, 1500, color.White), stampInfo{Name: "Rivaldy", NIK: "DEA-0011", Action: "in", At: time.Now()})
	if err != nil {
		t.Fatal(err)
	}
	img, err := jpeg.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("result is not a JPEG: %v", err)
	}
	if b := img.Bounds(); b.Dx() != 1280 || b.Dy() != 960 {
		t.Errorf("size = %dx%d, want 1280x960", b.Dx(), b.Dy())
	}
	r, g, bl, _ := img.At(1270, 955).RGBA() // bottom-right corner lies inside the bar, right of the text
	if lum := (r + g + bl) / 3 >> 8; lum > 120 {
		t.Errorf("bar not darkened at the bottom (luminance %d)", lum)
	}
	if r, _, _, _ := img.At(640, 100).RGBA(); r>>8 < 240 {
		t.Errorf("picture area must stay untouched")
	}
}

func TestDecodePhoto(t *testing.T) {
	if _, terr := decodePhoto(nil); terr == nil {
		t.Error("missing photo must be refused")
	}
	if _, terr := decodePhoto(fileHeader(t, "x.jpg", []byte("this is not an image, just text renamed to .jpg"))); terr == nil {
		t.Error("text renamed to .jpg must be refused")
	}
	if _, terr := decodePhoto(fileHeader(t, "tiny.jpg", jpegBytes(t, solid(50, 50, color.Black)))); terr == nil {
		t.Error("tiny photo must be refused")
	}
	if _, terr := decodePhoto(fileHeader(t, "ok.jpg", jpegBytes(t, solid(640, 480, color.Black)))); terr != nil {
		t.Errorf("valid photo refused: %v", terr)
	}
}

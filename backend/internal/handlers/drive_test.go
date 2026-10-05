package handlers

import (
	"strings"
	"testing"
	"time"

	"github.com/dea-core/hcis/backend/internal/middleware"
)

func TestDisplayNameByTab(t *testing.T) {
	cases := []struct {
		it   driveItem
		want string
	}{
		{driveItem{Tab: "Karyawan", A: "Budi", B: "KTP", FileName: "ktp.png"}, "Budi - KTP - ktp.png"},
		{driveItem{Tab: "Cuti & Izin", A: "Budi", B: "Sakit", C: "2026-10-20", FileName: "surat.pdf"}, "Budi - Sakit - 2026-10-20 - surat.pdf"},
		{driveItem{Tab: "Tugas", A: "Rapikan stok", B: "#7", FileName: "foto.png"}, "#7 - Rapikan stok - foto.png"},
		{driveItem{Tab: "Proyek", A: "Migrasi", B: "", FileName: "kontrak.pdf"}, "Migrasi - kontrak.pdf"},
	}
	for _, c := range cases {
		if got := displayName(c.it); got != c.want {
			t.Errorf("%s: got %q want %q", c.it.Tab, got, c.want)
		}
	}
	if got := cleanName("a/b\\c", 50); strings.ContainsAny(got, `/\`) {
		t.Errorf("slashes must not survive: %q", got)
	}
	if got := cleanName(strings.Repeat("x", 500), 200); len([]rune(got)) != 200 {
		t.Errorf("name must be capped, got %d", len(got))
	}
}

func TestTokenSealRoundTrip(t *testing.T) {
	middleware.JWTSecret = "secret-one"
	sealed := sealToken("refresh-abc")
	if strings.Contains(sealed, "refresh-abc") {
		t.Fatal("token stored in clear text")
	}
	if got, err := openToken(sealed); err != nil || got != "refresh-abc" {
		t.Fatalf("round trip: %q %v", got, err)
	}
	middleware.JWTSecret = "secret-two" // a changed secret must fail loudly, not return garbage
	if _, err := openToken(sealed); err == nil {
		t.Fatal("expected failure with a different secret")
	}
}

func TestBackoffGrowsAndCaps(t *testing.T) {
	if backoff(0) != 5*time.Minute || backoff(1) != 10*time.Minute || backoff(20) != 6*time.Hour {
		t.Errorf("backoff: %v %v %v", backoff(0), backoff(1), backoff(20))
	}
}

func TestDriveStateRejectsForgery(t *testing.T) {
	middleware.JWTSecret = "s"
	if !validState(driveState(1)) || validState("nonsense") {
		t.Fatal("state validation")
	}
}

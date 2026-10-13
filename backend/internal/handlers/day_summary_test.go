package handlers

import (
	"strings"
	"testing"
	"time"
)

func TestTapTokenRoundTripExpiryAndTampering(t *testing.T) {
	TapSecret = []byte("unit-test-secret")
	now := time.Now()
	tok := signTapToken(42, now.Add(tapTokenTTL))

	if id, ok := verifyTapToken(tok, now); !ok || id != 42 {
		t.Fatalf("valid token rejected: id=%d ok=%v", id, ok)
	}
	if _, ok := verifyTapToken(tok, now.Add(tapTokenTTL+time.Minute)); ok {
		t.Error("expired token accepted")
	}
	// the payload names employee 42; swapping it for 43 without the signature must fail
	parts := strings.Split(tok, ".")
	forged := signTapToken(43, now.Add(tapTokenTTL))
	if _, ok := verifyTapToken(strings.Split(forged, ".")[0]+"."+parts[1], now); ok {
		t.Error("token with a swapped payload accepted")
	}
	for _, bad := range []string{"", "abc", "a.b", tok + "x", "." + parts[1], parts[0] + "."} {
		if _, ok := verifyTapToken(bad, now); ok {
			t.Errorf("garbage token accepted: %q", bad)
		}
	}
	TapSecret = []byte("another-secret")
	if _, ok := verifyTapToken(tok, now); ok {
		t.Error("token signed with a different secret accepted")
	}
	TapSecret = nil
	if _, ok := verifyTapToken(tok, now); ok {
		t.Error("tokens must be refused when no secret is configured")
	}
}

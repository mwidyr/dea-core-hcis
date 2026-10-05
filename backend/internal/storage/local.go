// Package storage keeps uploaded files on local disk. Google Drive sync (Phase 8) runs
// afterwards as a background job: the local copy is always written first and stays the
// source of truth for serving; Drive is a backup that records drive_file_id per file.
package storage

import (
	"crypto/rand"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

type Local struct{ Root string }

var unsafe = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

// Save writes r under <Root>/<sub>/<random>_<name> and returns the path relative to Root.
func (l Local) Save(sub, name string, r io.Reader) (rel string, size int64, err error) {
	b := make([]byte, 8)
	if _, err = rand.Read(b); err != nil {
		return
	}
	clean := unsafe.ReplaceAllString(filepath.Base(name), "_")
	rel = filepath.Join(sub, hex.EncodeToString(b)+"_"+clean)
	abs := l.Abs(rel)
	if err = os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return
	}
	f, err := os.Create(abs)
	if err != nil {
		return
	}
	defer f.Close()
	size, err = io.Copy(f, r)
	return
}

// Abs resolves a relative path, refusing anything that escapes Root.
func (l Local) Abs(rel string) string {
	abs := filepath.Join(l.Root, filepath.Clean("/"+rel))
	if !strings.HasPrefix(abs, filepath.Clean(l.Root)) {
		return filepath.Join(l.Root, "invalid")
	}
	return abs
}

func (l Local) Remove(rel string) error { return os.Remove(l.Abs(rel)) }

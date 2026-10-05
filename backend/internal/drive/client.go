// Package drive is a small Google Drive v3 client (OAuth user account, REST via net/http). It only needs three things:
// find-or-create a folder, upload a file, and read the account e-mail. Base URLs are configurable so tests can point at a fake.
package drive

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"strings"
	"sync"
	"time"

	"golang.org/x/oauth2"
)

type Config struct {
	ClientID     string
	ClientSecret string
	RedirectURL  string
	RootFolderID string // optional: an existing folder to use as the root (needs the full "drive" scope)
	// overridable endpoints (tests); empty = Google
	AuthURL, TokenURL, APIBase, UploadBase string
}

const (
	ScopeFile  = "https://www.googleapis.com/auth/drive.file" // only files/folders this app created
	ScopeFull  = "https://www.googleapis.com/auth/drive"      // needed to write inside a pre-existing root folder
	FolderMime = "application/vnd.google-apps.folder"
)

func (c Config) apiBase() string { return orDefault(c.APIBase, "https://www.googleapis.com/drive/v3") }
func (c Config) uploadBase() string {
	return orDefault(c.UploadBase, "https://www.googleapis.com/upload/drive/v3")
}
func orDefault(v, d string) string {
	if v != "" {
		return v
	}
	return d
}

// Scope: the narrow scope is enough when the app creates its own root folder.
func (c Config) Scope() string {
	if c.RootFolderID != "" {
		return ScopeFull
	}
	return ScopeFile
}

func (c Config) Configured() bool { return c.ClientID != "" && c.ClientSecret != "" }

func (c Config) oauth() *oauth2.Config {
	ep := oauth2.Endpoint{AuthURL: orDefault(c.AuthURL, "https://accounts.google.com/o/oauth2/v2/auth"), TokenURL: orDefault(c.TokenURL, "https://oauth2.googleapis.com/token")}
	return &oauth2.Config{ClientID: c.ClientID, ClientSecret: c.ClientSecret, RedirectURL: c.RedirectURL, Endpoint: ep, Scopes: []string{c.Scope()}}
}

// AuthCodeURL builds the Google consent URL; offline access + consent prompt guarantee a refresh token.
func (c Config) AuthCodeURL(state string) string {
	return c.oauth().AuthCodeURL(state, oauth2.AccessTypeOffline, oauth2.SetAuthURLParam("prompt", "consent"))
}

// Exchange trades the authorization code for a refresh token.
func (c Config) Exchange(ctx context.Context, code string) (string, error) {
	tok, err := c.oauth().Exchange(ctx, code)
	if err != nil {
		return "", err
	}
	if tok.RefreshToken == "" {
		return "", fmt.Errorf("Google tidak mengembalikan refresh token — cabut akses aplikasi di akun Google lalu hubungkan ulang")
	}
	return tok.RefreshToken, nil
}

// Client talks to Drive with an auto-refreshing access token.
type Client struct {
	cfg  Config
	http *http.Client
}

func New(cfg Config, refreshToken string) *Client {
	ctx := context.Background()
	return &Client{cfg: cfg, http: cfg.oauth().Client(ctx, &oauth2.Token{RefreshToken: refreshToken, Expiry: time.Now().Add(-time.Hour)})}
}

type apiError struct {
	Status int
	Body   string
}

func (e *apiError) Error() string {
	return fmt.Sprintf("Drive API %d: %s", e.Status, strings.TrimSpace(e.Body))
}

// IsNotFound reports a 404 (e.g. a folder deleted by hand).
func IsNotFound(err error) bool { e, ok := err.(*apiError); return ok && e.Status == 404 }

func (c *Client) do(req *http.Request, out any) error {
	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		return &apiError{res.StatusCode, string(b)}
	}
	if out != nil {
		return json.Unmarshal(b, out)
	}
	return nil
}

func esc(s string) string { return strings.NewReplacer(`\`, `\\`, `'`, `\'`).Replace(s) }

// Email returns the connected account's address (also proves the token works).
func (c *Client) Email(ctx context.Context) (string, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, c.cfg.apiBase()+"/about?fields=user(emailAddress)", nil)
	var out struct {
		User struct{ EmailAddress string } `json:"user"`
	}
	if err := c.do(req, &out); err != nil {
		return "", err
	}
	return out.User.EmailAddress, nil
}

var folderMu sync.Mutex // find-or-create must not race with itself

// EnsureFolder returns the id of a folder called name inside parent (parent "" = My Drive root), creating it if needed.
func (c *Client) EnsureFolder(ctx context.Context, parent, name string) (string, error) {
	folderMu.Lock()
	defer folderMu.Unlock()
	q := fmt.Sprintf("name = '%s' and mimeType = '%s' and trashed = false", esc(name), FolderMime)
	if parent != "" {
		q += fmt.Sprintf(" and '%s' in parents", esc(parent))
	} else {
		q += " and 'root' in parents"
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, c.cfg.apiBase()+"/files?fields=files(id)&pageSize=1&q="+url.QueryEscape(q), nil)
	var found struct{ Files []struct{ ID string } }
	if err := c.do(req, &found); err != nil {
		return "", err
	}
	if len(found.Files) > 0 {
		return found.Files[0].ID, nil
	}
	meta := map[string]any{"name": name, "mimeType": FolderMime}
	if parent != "" {
		meta["parents"] = []string{parent}
	}
	b, _ := json.Marshal(meta)
	req, _ = http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.apiBase()+"/files?fields=id", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	var made struct{ ID string }
	if err := c.do(req, &made); err != nil {
		return "", err
	}
	return made.ID, nil
}

// Upload stores the file in the folder and returns its id and web link.
func (c *Client) Upload(ctx context.Context, parent, name, mime string, r io.Reader) (id, link string, err error) {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	metaHdr := textproto.MIMEHeader{"Content-Type": {"application/json; charset=UTF-8"}}
	pw, _ := mw.CreatePart(metaHdr)
	meta, _ := json.Marshal(map[string]any{"name": name, "parents": []string{parent}})
	pw.Write(meta)
	if mime == "" {
		mime = "application/octet-stream"
	}
	fw, _ := mw.CreatePart(textproto.MIMEHeader{"Content-Type": {mime}})
	if _, err = io.Copy(fw, r); err != nil {
		return
	}
	mw.Close()
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.uploadBase()+"/files?uploadType=multipart&fields=id,webViewLink", &body)
	req.Header.Set("Content-Type", "multipart/related; boundary="+mw.Boundary())
	var out struct{ ID, WebViewLink string }
	if err = c.do(req, &out); err != nil {
		return
	}
	return out.ID, out.WebViewLink, nil
}

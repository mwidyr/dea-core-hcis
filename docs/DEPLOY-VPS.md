# Deploy ke VPS lewat IP publik (gaya ayt-sales: tanpa Docker, tanpa domain)

Stack: **PostgreSQL + backend Go (systemd) + Nginx** (menyajikan React & meneruskan `/api`) — sama seperti panduan di `ayt-sales`. Untuk jalur Docker + domain lihat `docs/DEPLOY.md`.

File siap pakai di repo: `deploy/vps/hcis-backend.service`, `deploy/vps/nginx-hcis.conf`, `deploy/vps/backend.env.example`, `deploy/vps/update.sh`, `deploy/vps/backup.sh`.

> ### Baca dulu: batasan memakai `http://IP`
> | Hal | Akibat tanpa HTTPS | Solusi |
> |---|---|---|
> | **Absensi GPS (`/absen`)** | Browser **memblokir lokasi** di situs HTTP biasa (hanya HTTPS/localhost) → tap in/out gagal | HTTPS gratis tanpa beli domain: bagian **10** (`IP.sslip.io` + Let's Encrypt) |
> | **Google Drive (OAuth)** | Google menolak redirect URI berupa IP / `http://` | Perlu HTTPS dulu (bagian 10), lalu bagian 11 |
> | Password & token | Terkirim tanpa enkripsi | OK untuk uji internal singkat; pasang HTTPS sebelum dipakai karyawan |
>
> Jadi: jalankan bagian 1–9 untuk melihat aplikasi hidup di `http://IP`, lalu **segera** lanjut ke bagian 10 sebelum dipakai absen.

Ganti `IP_VPS` di bawah dengan IP publik VPS Anda (mis. `203.0.113.10`).

---

## 1. Siapkan VPS (Ubuntu 22.04/24.04, minimal 2 GB RAM)
```bash
ssh root@IP_VPS
adduser deploy && usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy      # pakai SSH key yang sama
exit
ssh deploy@IP_VPS

sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential ufw rsync
sudo timedatectl set-timezone Asia/Jakarta

# firewall: SSH + web
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable

# swap 2 GB (membantu build Go & Node bila RAM ≤ 2 GB)
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```
> Port **5432 (Postgres) dan 8080 (backend) JANGAN dibuka** di firewall — hanya Nginx yang diakses publik. Cek juga firewall di panel penyedia VPS (security group) agar 80/443 terbuka.

---

## 2. Install dependensi
**Go (versi sama dengan `backend/go.mod`, saat ini 1.26):**
```bash
wget https://go.dev/dl/go1.26.8.linux-amd64.tar.gz       # jika 404, ambil versi 1.26.x terbaru di https://go.dev/dl/
sudo rm -rf /usr/local/go && sudo tar -C /usr/local -xzf go1.26.8.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc && source ~/.bashrc
go version
```
**Node.js (via nvm):**
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 22
node --version
```
**PostgreSQL & Nginx:**
```bash
sudo apt install -y postgresql postgresql-contrib nginx
sudo systemctl enable --now postgresql nginx
```

---

## 3. Database
```bash
DBPASS=$(openssl rand -hex 24); echo "DB_PASSWORD = $DBPASS     <- catat, dipakai di langkah 5"
DBPASS=P@ssw0rd1234; echo "DB_PASSWORD = $DBPASS"     <- catat, dipakai di langkah 5"
sudo -u postgres psql -c "CREATE USER hcis WITH PASSWORD '$DBPASS';" -c "CREATE DATABASE dea_hcis OWNER hcis;"
```
(Tabel dibuat otomatis oleh backend saat pertama kali jalan.)

---

## 4. Ambil kode dari GitHub
Repo: `git@github.com:mwidyr/dea-core-hcis.git` (private → pakai *deploy key* read-only):
```bash
ssh-keygen -t ed25519 -f ~/.ssh/hcis_deploy -N "" -C "vps-deploy"
cat ~/.ssh/hcis_deploy.pub                      # salin
```
GitHub → repo → **Settings → Deploy keys → Add deploy key** → tempel (jangan centang *Allow write access*).
```bash
printf 'Host github.com\n  IdentityFile ~/.ssh/hcis_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config
sudo mkdir -p /var/www/dea-core-hcis && sudo chown deploy:deploy /var/www/dea-core-hcis
git clone git@github.com:mwidyr/dea-core-hcis.git /var/www/dea-core-hcis
```

---

## 5. User layanan, folder, dan file konfigurasi
```bash
sudo useradd --system --home /var/lib/hcis --shell /usr/sbin/nologin hcis
sudo mkdir -p /var/lib/hcis/uploads /etc/hcis
sudo chown -R hcis:hcis /var/lib/hcis

cd /var/www/dea-core-hcis
sudo cp deploy/vps/backend.env.example /etc/hcis/backend.env
sudo chown root:hcis /etc/hcis/backend.env && sudo chmod 640 /etc/hcis/backend.env
sudo nano /etc/hcis/backend.env
```
Isi minimal:

| Variabel | Nilai |
|---|---|
| `DB_PASSWORD` | password dari langkah 3 |
| `JWT_SECRET` | `openssl rand -hex 32` (≥ 32 karakter, jangan diganti-ganti) |
| `FRONTEND_ORIGIN` | `http://IP_VPS` (nanti `https://…sslip.io`) |
| `SEED_ADMIN_PASSWORD` | password awal `admin@dea.local` (kosong = acak, tercetak sekali di log) |
| `SEED_EMPLOYEE_PASSWORD` | password awal semua karyawan (kosong = acak; HR mengatur di Settings) |

Server **menolak start** bila `JWT_SECRET` lemah, `DB_PASSWORD` kosong/`postgres`, atau ada `DEV_LOGIN=true`.

---

## 6. Build & jalankan backend (systemd)
```bash
cd /var/www/dea-core-hcis/backend
go build -o hcis-backend ./cmd/server
sudo chown hcis:hcis hcis-backend

sudo cp ../deploy/vps/hcis-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hcis-backend

sudo systemctl status hcis-backend            # harus "active (running)"
sudo journalctl -u hcis-backend -n 50 --no-pager | grep -i "PASSWORD AWAL\|Seed done\|listening"
curl -s http://127.0.0.1:8080/api/health      # {"status":"ok"}
```
Pada start pertama database terisi data awal (8 bisnis, struktur, 20 karyawan). Jika `SEED_ADMIN_PASSWORD` kosong, **catat password admin dari log** (hanya tampil sekali).
Log langsung: `sudo journalctl -u hcis-backend -f`.

---

## 7. Build frontend
```bash
cd /var/www/dea-core-hcis/frontend
npm ci
npm run build          # hasil: frontend/dist
```
Bila build "Killed" karena RAM: pastikan swap aktif, atau build di laptop lalu salin: `rsync -avz --delete frontend/dist/ deploy@IP_VPS:/var/www/dea-core-hcis/frontend/dist/`.

---

## 8. Nginx
```bash
sudo cp /var/www/dea-core-hcis/deploy/vps/nginx-hcis.conf /etc/nginx/sites-available/hcis
sudo ln -sf /etc/nginx/sites-available/hcis /etc/nginx/sites-enabled/hcis
sudo rm -f /etc/nginx/sites-enabled/default           # situs bawaan nginx
sudo nginx -t && sudo systemctl reload nginx
```
Konfigurasi memakai `default_server` sehingga **diakses lewat IP** tanpa domain, `client_max_body_size 12m` (upload 10 MB), cache aset Vite, dan header keamanan dasar (HSTS belum dipasang selama HTTP).

---

## 9. Coba & langkah wajib setelah deploy
1. Buka **`http://IP_VPS`** → login `admin@dea.local` (password dari `SEED_ADMIN_PASSWORD` / log).
2. **Ganti password admin:** Settings → User & Hak Akses → Reset password pada `admin@dea.local`.
3. Atur password karyawan (jika `SEED_EMPLOYEE_PASSWORD` kosong) di Settings → User & Hak Akses.
4. Cek: `curl -s http://IP_VPS/api/health`, dan `http://IP_VPS/api/dev/accounts` harus **404**.
5. Lengkapi master data (lokasi + koordinat/radius, kalender kerja, hari libur) lalu jalankan checklist `docs/TESTING.md`.

---

## 10. HTTPS gratis tanpa domain (wajib untuk GPS absen)
`sslip.io` adalah layanan DNS gratis: nama `203-0-113-10.sslip.io` otomatis mengarah ke IP `203.0.113.10`. Let's Encrypt bisa menerbitkan sertifikat resmi untuk nama itu.

```bash
# nama host dari IP Anda (titik → strip):
HOST=$(curl -s ifconfig.me | tr . -).sslip.io ; echo $HOST      # mis. 203-0-113-10.sslip.io
dig +short $HOST                                                 # harus menampilkan IP VPS

sudo sed -i "s/server_name _;/server_name $HOST;/" /etc/nginx/sites-available/hcis
sudo nginx -t && sudo systemctl reload nginx

sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d $HOST --agree-tos -m EMAIL_ANDA --redirect
```
Lalu ubah `/etc/hcis/backend.env`: `FRONTEND_ORIGIN=https://<HOST>` → `sudo systemctl restart hcis-backend`. Akses mulai sekarang: **`https://<HOST>`** (http otomatis dialihkan). Certbot memperbarui sertifikat otomatis (`systemctl list-timers | grep certbot`). Setelah HTTPS aktif boleh menambahkan header HSTS di blok `server` yang diubah certbot: `add_header Strict-Transport-Security "max-age=31536000" always;`.

Catatan jujur:
- `sslip.io` dipakai bersama banyak orang sehingga kadang kena **batas Let's Encrypt** (error "too many certificates"). Coba lagi besok, atau pakai alternatif `nip.io`, atau beli domain murah (±Rp 15–150 rb/tahun) lalu ganti `HOST` dengan domain itu — langkahnya sama.
- Jika IP VPS berubah, nama host harus diganti dan sertifikat dibuat ulang. Gunakan IP statis.
- Domain sendiri tetap pilihan terbaik untuk jangka panjang (nama yang rapi, Google OAuth lebih pasti diterima).

---

## 11. Google Drive (setelah HTTPS aktif)
1. Google Cloud Console → enable **Google Drive API** → OAuth consent screen → **Publishing status: In production** (jika *Testing*, token kedaluwarsa 7 hari).
2. Credentials → **OAuth client ID → Web application** → Authorized redirect URI: `https://<HOST>/api/drive/callback` (persis sama). *Jika Google menolak host `*.sslip.io`, Anda membutuhkan domain sendiri.*
3. Edit `/etc/hcis/backend.env`:
   ```
   GDRIVE_ENABLED=true
   GDRIVE_CLIENT_ID=....apps.googleusercontent.com
   GDRIVE_CLIENT_SECRET=...
   GDRIVE_REDIRECT_URL=https://<HOST>/api/drive/callback
   ```
   lalu `sudo systemctl restart hcis-backend`.
4. Aplikasi → **Settings → Google Drive → Hubungkan Google Drive**. Struktur: `CORE HCIS / <Bisnis> / <Tab> / <Tahun> / <Nama file>`.

---

## 12. Update, backup, restore
**Update rilis** (setelah `git push` dari laptop):
```bash
cd /var/www/dea-core-hcis && ./deploy/vps/update.sh
```
Skrip: backup → `git pull` → build backend & restart → `npm ci && npm run build` → reload nginx → cek health. Tabel/kolom baru dibuat otomatis saat backend start.

**Backup harian** (database + file unggahan, simpan 14 hari di `/var/backups/hcis`):
```bash
sudo crontab -e
0 2 * * * /var/www/dea-core-hcis/deploy/vps/backup.sh >> /var/log/hcis-backup.log 2>&1
```
Salin juga ke luar VPS, mis. dari laptop: `ssh deploy@IP_VPS "sudo tar -C /var/backups -czf - hcis" > hcis-backups-$(date +%F).tgz`.

**Restore** (menimpa data!):
```bash
sudo systemctl stop hcis-backend
sudo -u postgres psql -c "DROP DATABASE dea_hcis;" -c "CREATE DATABASE dea_hcis OWNER hcis;"
gunzip -c /var/backups/hcis/hcis-YYYYmmdd-HHMM.sql.gz | sudo -u postgres psql dea_hcis >/dev/null
sudo rm -rf /var/lib/hcis/uploads && sudo tar -C /var/lib/hcis -xzf /var/backups/hcis/hcis-YYYYmmdd-HHMM.uploads.tgz
sudo chown -R hcis:hcis /var/lib/hcis
sudo systemctl start hcis-backend
```
Latih restore sekali di awal.

---

## Troubleshooting
| Gejala | Cek / solusi |
|---|---|
| `502 Bad Gateway` | backend mati: `sudo systemctl status hcis-backend`, `sudo journalctl -u hcis-backend -n 80` |
| Backend gagal start: `KONFIGURASI TIDAK AMAN` | perbaiki `/etc/hcis/backend.env` (JWT_SECRET ≥ 32, DB_PASSWORD) |
| `password authentication failed for user "hcis"` | `DB_PASSWORD` tidak sama dengan langkah 3: `sudo -u postgres psql -c "ALTER USER hcis PASSWORD '...';"` |
| `permission denied` saat upload | `sudo chown -R hcis:hcis /var/lib/hcis` |
| Halaman putih / 404 saat refresh | pastikan `frontend/dist` terisi (`ls frontend/dist`) dan config nginx dari repo dipakai |
| `/absen` tidak minta lokasi | situs masih HTTP → lanjut bagian 10 |
| Login 429 | batas anti-brute-force (5 gagal/akun per 15 menit); tunggu atau `sudo systemctl restart hcis-backend` |
| Upload > 10 MB gagal | memang dibatasi (Nginx 12 MB, aplikasi 10 MB) |
| Perubahan frontend tidak terlihat | hard reload (Ctrl/Cmd+Shift+R); `index.html` sudah no-cache |

## Checklist keamanan (mode IP)
- [ ] Hanya port 22/80/443 terbuka; 5432 & 8080 tertutup (`sudo ufw status`, cek panel VPS)
- [ ] `/etc/hcis/backend.env` ber-permission 640 (`root:hcis`), tidak ada di Git
- [ ] Password admin & karyawan sudah diganti dari nilai awal
- [ ] `/api/dev/accounts` → 404
- [ ] HTTPS aktif sebelum dipakai karyawan (bagian 10)
- [ ] Backup harian berjalan dan tersalin keluar server; restore pernah dicoba
- [ ] Login SSH memakai key (nonaktifkan password: `PasswordAuthentication no` di `/etc/ssh/sshd_config`)

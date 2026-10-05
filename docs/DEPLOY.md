# Deploy ke VPS — langkah demi langkah

Arsitektur produksi (semua dalam Docker, hanya port 80/443 yang terbuka):

```
Internet ──443──▶ Caddy (HTTPS otomatis + file React) ──/api──▶ backend Go ──▶ PostgreSQL
                                                              └─▶ volume uploads (file lokal) ──▶ Google Drive (sinkron)
```

File yang sudah disiapkan di repo: `docker-compose.prod.yml`, `deploy/Dockerfile.web`, `deploy/Caddyfile`, `.env.prod.example`, `deploy/backup.sh`, `deploy/restore.sh`, `deploy/update.sh`.

---

## 0. Yang dibutuhkan
| Kebutuhan | Rekomendasi |
|---|---|
| VPS | Ubuntu 22.04/24.04, minimal **2 vCPU / 2 GB RAM / 25 GB disk** (build Go + Node butuh RAM; tambahkan swap bila hanya 1–2 GB) |
| Domain / subdomain | mis. `hcis.perusahaan.co.id`, **A record** mengarah ke IP VPS (tunggu DNS menyebar: `dig +short hcis.perusahaan.co.id`) |
| HTTPS | Wajib — absensi GPS (`/absen`) hanya bisa meminta lokasi di HTTPS. Caddy mengurus sertifikat Let's Encrypt otomatis (port 80 & 443 harus terbuka) |
| Akun GitHub | repo **private** |
| (Opsional) Google Cloud | untuk sinkronisasi Drive, lihat bagian 8 |

---

## 1. Hubungkan proyek ke GitHub (dari laptop)
Folder `dea-core-hcis` saat ini **belum menjadi repository git**.

1. Buat repo kosong **private** di GitHub (tanpa README/.gitignore): `https://github.com/new` → nama mis. `dea-core-hcis`.
2. Di laptop, dari folder proyek:
   ```bash
   cd ~/Downloads/dea-core-hcis
   git init -b main
   git add .
   git status            # PERIKSA: tidak boleh ada .env, .env.prod, uploads/, node_modules/, dist/
   git commit -m "Initial commit: CORE HCIS"
   git remote add origin git@github.com:<akun-anda>/dea-core-hcis.git     # SSH, atau pakai URL https://…
   git push -u origin main
   ```
3. Autentikasi push:
   - **SSH (disarankan):** `ssh-keygen -t ed25519 -C "laptop"` → salin isi `~/.ssh/id_ed25519.pub` ke GitHub → *Settings → SSH and GPG keys → New SSH key*.
   - **HTTPS:** buat *Personal Access Token* (fine-grained, akses repo ini, permission *Contents: read/write*) dan pakai sebagai password saat diminta.
4. Yang **tidak** ikut ter-commit (sudah di `.gitignore`): `.env`, `.env.prod`, `uploads/`, `backups/`, `node_modules/`, `dist/`. File `.env.example` / `.env.prod.example` boleh (isinya hanya placeholder).
5. Setelah ini setiap perubahan: `git add -A && git commit -m "…" && git push`.

> Jangan pernah commit kunci Google, password, atau JWT secret. Kalau terlanjur, anggap bocor dan ganti nilainya.

---

## 2. Siapkan VPS
```bash
ssh root@IP_VPS

# user biasa + sudo
adduser deploy && usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy      # pakai SSH key yang sama
# (opsional tapi disarankan) nonaktifkan login root & password: edit /etc/ssh/sshd_config → PermitRootLogin no, PasswordAuthentication no → systemctl restart ssh

# firewall: hanya SSH, HTTP, HTTPS
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw --force enable

# update + zona waktu
apt update && apt -y upgrade
timedatectl set-timezone Asia/Jakarta

# swap 2 GB (jika RAM ≤ 2 GB)
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Docker + compose plugin + git
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
apt -y install git
exit
```
Login ulang sebagai `deploy`: `ssh deploy@IP_VPS` lalu cek `docker version` dan `docker compose version`.

---

## 3. Ambil kode dari GitHub di VPS
Repo private → pakai **deploy key** (read-only) agar VPS tidak memegang akun pribadi Anda:
```bash
ssh-keygen -t ed25519 -f ~/.ssh/hcis_deploy -N "" -C "vps-deploy"
cat ~/.ssh/hcis_deploy.pub          # salin
```
GitHub → repo → *Settings → Deploy keys → Add deploy key* → tempel (biarkan **Allow write access** tidak dicentang).
```bash
cat >> ~/.ssh/config <<'CFG'
Host github.com
  IdentityFile ~/.ssh/hcis_deploy
  IdentitiesOnly yes
CFG
git clone git@github.com:<akun-anda>/dea-core-hcis.git
cd dea-core-hcis
```

---

## 4. Isi konfigurasi produksi
```bash
cp .env.prod.example .env.prod
chmod 600 .env.prod
# buat rahasia acak:
openssl rand -hex 24     # → DB_PASSWORD
openssl rand -hex 32     # → JWT_SECRET
nano .env.prod
```
| Variabel | Isi |
|---|---|
| `DOMAIN` | domain Anda, tanpa `https://` |
| `DB_USER`, `DB_NAME` | boleh dibiarkan (`hcis`, `dea_hcis`) |
| `DB_PASSWORD` | hasil `openssl rand -hex 24` |
| `JWT_SECRET` | hasil `openssl rand -hex 32` (≥ 32 karakter; **jangan diganti-ganti**, lihat catatan di bawah) |
| `SEED_ADMIN_PASSWORD` | password awal `admin@dea.local`. Kosong = dibuat acak dan dicetak **sekali** di log |
| `SEED_EMPLOYEE_PASSWORD` | password awal semua akun karyawan. Kosong = acak (HR harus mengatur password tiap karyawan di Settings) |
| `GDRIVE_*` | biarkan dulu `GDRIVE_ENABLED=false`; diisi di bagian 8 |

> Server **menolak start** jika `APP_ENV=production` dengan `JWT_SECRET` lemah, `DB_PASSWORD` kosong/`postgres`, atau `DEV_LOGIN=true`. `DEV_LOGIN` tidak diteruskan ke container produksi sama sekali.
> Mengganti `JWT_SECRET` kemudian = semua pengguna logout dan akun Google Drive harus dihubungkan ulang (token Drive terenkripsi dengan kunci turunan secret ini).

---

## 5. Jalankan
```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.prod ps          # semua "Up"/"healthy"
docker compose -f docker-compose.prod.yml --env-file .env.prod logs backend | grep -i "PASSWORD AWAL\|Seed done\|listening"
```
Build pertama 3–8 menit. Pada start pertama database otomatis dibuat + diisi data awal (8 bisnis, struktur organisasi, 20 karyawan dari prototype). Jika `SEED_ADMIN_PASSWORD` kosong, **catat password admin dari log** (hanya tampil sekali).

Cek:
```bash
curl -s https://DOMAIN/api/health          # {"status":"ok"}
```
Buka `https://DOMAIN` → login `admin@dea.local`. Sertifikat HTTPS dibuat otomatis beberapa detik setelah request pertama; jika gagal, cek DNS dan port 80/443 (`docker compose … logs web`).

---

## 6. Setelah deploy (wajib, 10 menit)
1. Login admin → ganti password lewat **Settings → User & Hak Akses → Reset password** pada baris `admin@dea.local` (password tidak boleh tetap nilai awal).
2. **Akun karyawan:** jika `SEED_EMPLOYEE_PASSWORD` kosong, buka **Settings → User & Hak Akses** dan atur password tiap karyawan (atau set password awal yang sama lalu minta mereka menggantinya).
3. Periksa data master: bisnis, lokasi (koordinat + radius untuk GPS absen), kalender kerja, hari libur, jenis cuti, bobot KPI (Settings → KPI).
4. **Role & Izin:** tinjau matriks di Settings → Role & Izin.
5. Jalankan checklist **Smoke test produksi** di `docs/TESTING.md` bagian 20.
6. Pasang backup otomatis (bagian 7).

---

## 7. Backup & restore
```bash
./deploy/backup.sh         # hasil: backups/hcis-YYYYmmdd-HHMM.sql.gz (database) + .uploads.tgz (file), simpan 14 hari
```
Jadwalkan harian jam 02:00:
```bash
crontab -e
0 2 * * * cd /home/deploy/dea-core-hcis && ./deploy/backup.sh >> backups/backup.log 2>&1
```
**Salin backup ke luar VPS** (backup di server yang sama tidak menolong jika server hilang), mis. dari laptop:
`rsync -avz deploy@IP_VPS:/home/deploy/dea-core-hcis/backups/ ~/hcis-backups/` atau pakai `rclone` ke bucket/Drive.

Restore (menimpa data saat ini!):
```bash
./deploy/restore.sh backups/hcis-20261005-0200
```
**Latih restore sekali** di awal (misalnya di VPS uji) — backup yang belum pernah dites belum bisa dipercaya. Skrip ini sudah diuji: database kembali ke kondisi saat backup dan login tetap berfungsi.

Catatan: file yang sudah tersinkron ke Google Drive juga ada di Drive, tetapi database (yang mencatat ID file) hanya ada di backup.

---

## 8. Google Drive (opsional, bisa kapan saja)
1. [Google Cloud Console](https://console.cloud.google.com) → buat/pilih project → **APIs & Services → Library → Google Drive API → Enable**.
2. **OAuth consent screen**: isi nama aplikasi & email. **Publishing status harus "In production"** — bila tetap "Testing", refresh token **kedaluwarsa tiap 7 hari** dan sinkronisasi berhenti. (Workspace: pilih *Internal*.)
3. **Credentials → Create credentials → OAuth client ID → Web application**. Authorized redirect URI: `https://DOMAIN/api/drive/callback` (harus sama persis).
4. Di VPS edit `.env.prod`:
   ```
   GDRIVE_ENABLED=true
   GDRIVE_CLIENT_ID=...apps.googleusercontent.com
   GDRIVE_CLIENT_SECRET=...
   ```
   lalu `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d`.
5. Buka **Settings → Google Drive → Hubungkan Google Drive**, pilih akun Google penyimpan, izinkan. Struktur: `CORE HCIS / <Bisnis> / <Tab> / <Tahun> / <Nama file>`.
6. Uji: unggah satu dokumen, klik **Sinkronkan Sekarang**, cek foldernya di Drive.

---

## 9. Update aplikasi (rilis baru)
Di laptop: `git add -A && git commit -m "…" && git push`. Di VPS:
```bash
cd ~/dea-core-hcis && ./deploy/update.sh
```
Skrip membuat backup, `git pull`, membangun ulang image, dan me-restart container. Skema database ikut diperbarui otomatis saat backend start (AutoMigrate; hanya menambah tabel/kolom). Downtime ±10–30 detik.

**Rollback:** `git log --oneline` → `git checkout <commit-lama>` → `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build`. Jika rilis mengubah data, restore backup yang dibuat `update.sh` (bagian 7). Kembali ke terbaru: `git checkout main`.

---

## 10. Operasional harian
| Perlu | Perintah |
|---|---|
| Status | `docker compose -f docker-compose.prod.yml --env-file .env.prod ps` |
| Log backend | `docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f --tail=100 backend` |
| Log HTTPS/proxy | `… logs -f web` |
| Restart | `… restart backend` |
| Masuk database | `… exec postgres psql -U hcis dea_hcis` |
| Disk | `df -h`; `docker system df`; bersihkan: `docker image prune -f` |
| Hentikan semua (data tetap) | `… down`  — **jangan** pakai `down -v` (menghapus database & file) |

Pantau: disk (file unggahan + backup bertambah), `last_run` di Settings → Google Drive, dan notifikasi bell admin.

---

## 11. Troubleshooting
| Gejala | Penyebab / solusi |
|---|---|
| Backend restart terus | `logs backend`: `KONFIGURASI TIDAK AMAN` → perbaiki `.env.prod`; `password authentication failed` → `DB_PASSWORD` diubah setelah volume dibuat (ubah password di Postgres atau hapus volume bila belum ada data penting) |
| Browser: sertifikat tidak valid | DNS belum mengarah ke VPS / port 80-443 tertutup (`ufw status`, firewall penyedia VPS). Lihat `logs web` |
| Halaman putih setelah update | cache browser: hard reload (Ctrl/Cmd+Shift+R) |
| `/absen` tidak minta lokasi | harus HTTPS; izinkan lokasi di browser; di lokasi kantor pastikan koordinat & radius benar (Org → Lokasi) |
| Upload ditolak | hanya JPG/PNG/WEBP/GIF/PDF, maks 10 MB; request body dibatasi 12 MB di Caddy |
| 429 "Terlalu banyak percobaan gagal" saat login | batas anti-brute-force (5 gagal/akun per 15 menit, 20 gagal/IP per 5 menit); tunggu atau restart backend untuk mengosongkan |
| Drive: "akses Google ditolak" | token dicabut/kedaluwarsa (consent screen masih *Testing*?) → Hubungkan ulang |
| Drive: file "Gagal ke Drive" | lihat pesan di Settings → Google Drive; perbaiki lalu **Ulangi yang Gagal** |
| Jam/tanggal salah | `timedatectl`; aplikasi memakai WIB (UTC+7) |

---

## 12. Checklist keamanan produksi
- [ ] Hanya port 22/80/443 terbuka (`ufw status`); Postgres & backend **tidak** dipublish (sudah demikian di compose)
- [ ] Login SSH memakai key, root login dimatikan
- [ ] `.env.prod` ber-permission 600 dan tidak ada di Git
- [ ] Password admin dan semua karyawan sudah diganti dari nilai awal
- [ ] `https://DOMAIN/api/dev/accounts` → **404**
- [ ] Backup harian berjalan **dan** tersalin ke luar VPS; restore pernah dicoba
- [ ] Google consent screen *In production*; client secret tidak pernah di-commit
- [ ] Update OS berkala (`apt upgrade`) dan `./deploy/update.sh` untuk rilis aplikasi

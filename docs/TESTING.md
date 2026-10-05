# Panduan Uji Fitur — CORE HCIS

Dokumen ini untuk menguji **semua fitur** secara manual (UAT) per modul. Centang `[ ]` → `[x]` saat lolos. Kolom **Harapan** adalah hasil yang benar; jika berbeda, catat sebagai bug.

> Lingkungan: uji di **lokal/staging** dengan data seed. Di produksi jalankan hanya bagian **20. Smoke test produksi** (jangan membuat data uji di data nyata).

## 0. Persiapan

**Jalankan lokal** (lihat README): Postgres → `cd backend && go run ./cmd/server` → `cd frontend && npm run dev` → `http://localhost:5173`.
Untuk memilih akun tanpa mengetik password, isi `backend/.env` dengan `DEV_LOGIN=true` (hanya lokal!).

**Akun seed** (lingkungan lokal):

| Peran | Email | Password | Catatan hierarki |
|---|---|---|---|
| Super Admin | `admin@dea.local` | `admin123` | semua akses |
| HR Admin | `asri.alfisyar.rahma@deaglobal.local` | `password123` | NIK DEA-0006, atasan: Abdul Haq |
| Manager L1 | `muhamad.agus.muharrom@deaglobal.local` | `password123` | DEA-0001, puncak organisasi |
| Manager | `riska.irawan@deaglobal.local` | `password123` | DEA-0003, atasan: Agus; bawahan: Abdul Rahmat, Hendrik, Annisa |
| Manager | `abdul.rahmat@deaglobal.local` | `password123` | DEA-0010, atasan: Riska; bawahan: Rivaldy |
| Karyawan | `rivaldy.alnuari.ramadhan@deaglobal.local` | `password123` | DEA-0011, atasan: Abdul Rahmat |
| Manager | `abdul.haq@deaglobal.local` | `password123` | DEA-0002; bawahan: Lukmanul Hakim, Asri |
| Karyawan | `abdullah.fawwaz.zanki@deaglobal.local` | `password123` | DEA-0005, atasan: Lukmanul Hakim |

NIK juga dapat dipakai di halaman `/absen` (mis. `DEA-0011`). Email karyawan lain: `<nama.dengan.titik>@deaglobal.local`.

**Tips pengujian**
- Gunakan **jendela/profil browser berbeda** (atau mode incognito) untuk tiap akun — login disimpan di localStorage.
- Reset data uji: hentikan server, hapus database (`docker compose down -v` hanya untuk lokal!) lalu jalankan lagi — seed dibuat ulang.
- GPS tanpa pergi ke kantor: Chrome DevTools → ⋮ → *More tools → Sensors → Location* → isi koordinat lokasi kerja.
- File uji: gambar PNG/JPG kecil dan PDF < 10 MB. Untuk uji penolakan: file `.txt`/`.exe` yang diganti nama menjadi `.pdf`.
- Tanggal "hari ini" mempengaruhi absensi, roster, dan reminder; catat tanggal saat menguji.

---

## 1. Login & akun
- [ ] **1.1** Login `admin@dea.local` / `admin123` → masuk Dashboard. *Harapan:* nama & role tampil di pojok kanan atas.
- [ ] **1.2** Password salah → pesan "email atau password salah", tidak masuk.
- [ ] **1.3** Ikon mata di kolom password menampilkan/menyembunyikan teks (halaman login, dan form set/reset password di Settings).
- [ ] **1.4** Salah password 6× berturut-turut untuk email yang sama → percobaan ke-6 mendapat **429** "Terlalu banyak percobaan gagal". Login benar sesudah tunggu/restart berhasil.
- [ ] **1.5** Logout (ikon di pojok kanan) → kembali ke login; membuka URL internal langsung → diarahkan ke login.
- [ ] **1.6** (lokal, `DEV_LOGIN=true`) Halaman login menampilkan daftar akun yang bisa diklik; tanpa flag → daftar tidak muncul dan `/api/dev/accounts` = 404.
- [ ] **1.7** Reset password (Settings → User & Hak Akses → baris user → Reset) lalu login memakai password baru; password lama gagal.

## 2. Multi-bisnis (business switcher)
- [ ] **2.1** Admin/HR melihat pilihan **Semua Bisnis** + 8 bisnis di header; ganti bisnis → semua tabel (Karyawan, Tugas, KPI, Laporan, Dashboard) ikut terfilter.
- [ ] **2.2** Manager/karyawan hanya melihat bisnis miliknya (tanpa "Semua Bisnis" jika hanya satu).
- [ ] **2.3** Saat bisnis dipilih di header, form tambah (karyawan, tugas, unit…) **mengunci bisnis** tersebut (tidak otomatis ke DEA Global).

## 3. Setup Organisasi (menu *Setup Organisasi*)
- [ ] **3.1** Tab **Bisnis**: tambah bisnis baru, ubah, nonaktifkan/hapus (hapus ditolak bila masih punya data).
- [ ] **3.2** Tab **Unit Organisasi**: tambah unit L1/L2/L3 dengan induk; level mengikuti induk; ubah & hapus (ditolak bila punya anak/karyawan).
- [ ] **3.3** Tab **Jabatan**: tambah jabatan (unit, kelas level, atasan jabatan); kolom pemegang menunjukkan nama atau **Vacant**.
- [ ] **3.4** Tab **Lokasi**: tambah lokasi dengan kota; koordinat & radius dipakai absensi GPS.
- [ ] **3.5** Tab **Bagan Organisasi**: nama bisnis di puncak tiap bagan, garis penyambung L1→L2→L3, posisi rata tengah, tiap bisnis terpisah jelas.
- [ ] **3.6** Pagination/pencarian/ukuran halaman (10/20/kustom) berfungsi di setiap tabel.
- [ ] **3.7** Login sebagai Manager → tombol tambah/ubah **tidak muncul** (tanpa izin `org.manage`).

## 4. Karyawan
- [ ] **4.1** Daftar: cari nama/NIK/email, filter status/tipe, pagination 10/20/kustom, kartu statistik (aktif, tetap, kontrak, multi-bisnis, kontrak berakhir).
- [ ] **4.2** **Tambah karyawan**: isi nama, bisnis, unit, jabatan, lokasi, tipe (Tetap/Kontrak + tanggal kontrak), tempat & tanggal lahir → NIK `<KODE>-000N` otomatis; akun login dibuat/ditautkan sesuai pengaturan.
- [ ] **4.3** **Ubah** karyawan → NIK **tidak berubah**.
- [ ] **4.4** **Multi-bisnis:** tambah penempatan di bisnis lain → berhasil. Tambah penempatan **kedua di bisnis yang sama** (jabatan lain) → **ditolak**.
- [ ] **4.5** **Status:** ubah ke Suspend/Tidak Bekerja (dengan catatan) → hilang dari daftar aktif, tidak bisa absen; kembalikan ke Aktif.
- [ ] **4.6** **Dokumen:** unggah KTP, KK, dan label lain (bebas) → thumbnail tampil, bisa dibuka & dihapus. Unggah file `.txt` bernama `.pdf` → **ditolak** (jenis file dicek isi, bukan nama).
- [ ] **4.7** Hapus karyawan: ditolak bila masih PIC tugas terbuka; berhasil bila bersih (dengan konfirmasi).
- [ ] **4.8** Karyawan biasa membuka `/employees` → hanya melihat data sesuai izin; tombol kelola tidak ada.

## 5. Kontrak & Dokumen (menu *Kontrak & Dokumen*)
- [ ] **5.1** Karyawan kontrak yang akan berakhir tampil dengan sisa hari (badge); yang sudah lewat ditandai.
- [ ] **5.2** Checklist kelengkapan dokumen (KTP/KK/…) per karyawan sesuai unggahan di 4.6.
- [ ] **5.3** Karyawan kontrak yang berakhir ≤ 30 hari muncul di Dashboard ("kontrak berakhir").

## 6. Setup Waktu Kerja (menu *Setup Waktu Kerja*)
**Hari Libur**
- [ ] **6.1** (Admin / L1 / L2) tambah **hari libur nasional**, dan **hari libur bisnis** (hanya untuk satu bisnis).
- [ ] **6.2** Jenis **Libur biasa — tidak potong cuti** vs **Cuti bersama — potong cuti**. Cuti bersama langsung mengurangi saldo cuti tahunan semua karyawan 1 hari kerja (cek di Cuti & Izin → Saldo); menghapusnya mengembalikan saldo.
- [ ] **6.3** Manager L3/karyawan tidak bisa menambah hari libur (tombol tidak ada / 403).
- [ ] **6.4** **Date picker** di seluruh form menandai hari libur yang sudah diatur.

**Kalender Kerja**
- [ ] **6.5** Buat kalender (hari kerja, jam masuk/pulang, istirahat, toleransi telat); tetapkan ke karyawan; kalender default per bisnis tersedia.

**Roster**
- [ ] **6.6** Buat roster (mis. 4 minggu kerja : 2 minggu libur; juga 6:4 atau kustom) dengan **start cycle per karyawan**; pratinjau siklus menampilkan blok KERJA/OFF benar.
- [ ] **6.7** Atasan langsung boleh mengatur roster bawahannya.
- [ ] **6.8** **Penyesuaian Roster:** ajukan geser jadwal (kerja↔libur untuk tanggal tertentu) → masuk approval; setelah disetujui, jadwal harian/absensi mengikuti penyesuaian.

## 7. Absensi (menu *Absensi*) & halaman publik `/absen`
**Halaman `/absen` (tanpa login)**
- [ ] **7.1** Jam berjalan real-time. Masukkan NIK (atau email) + password, pilih **Tap In** → berhasil bila GPS dalam radius lokasi; nama & jam tampil.
- [ ] **7.2** GPS di luar radius → ditolak dengan jarak; akurasi GPS buruk (> 300 m) → ditolak; izin lokasi ditolak browser → pesan jelas.
- [ ] **7.3** Tap Out setelah Tap In; Tap In dua kali → pesan sudah absen.
- [ ] **7.4** Password salah 5× → dibatasi sementara (429). Karyawan **Suspend/Tidak Bekerja** → tidak bisa absen.
- [ ] **7.5** Karyawan **sedang cuti disetujui** → tap ditolak/ditandai sesuai aturan; hari libur/OFF roster → tercatat "Kerja Hari Libur" bila tetap absen.
- [ ] **7.6** Terlambat dihitung dari jam masuk kalender + toleransi.

**Menu Absensi**
- [ ] **7.7** Tab **Harian**: kartu ringkasan (hadir, terlambat, tidak hadir, cuti/izin/sakit, kerja hari libur) dan tabel per karyawan; filter tanggal.
- [ ] **7.8** Tab **Rekap**: rentang tanggal → hari kerja, hadir, telat, tidak hadir, cuti/izin/sakit, jam kerja, persentase.
- [ ] **7.9** Tab **Jadwal / Shift**: jadwal tiap karyawan sesuai kalender/roster.
- [ ] **7.10** Tab **Absensi Manual:** karyawan mengajukan koreksi (lupa tap) dengan alasan → atasan menyetujui di Approval → catatan absensi terbentuk. Ditolak → tidak ada perubahan.
- [ ] **7.11** Cakupan data: karyawan hanya melihat dirinya; manager melihat bawahan; HR/admin semua.

## 8. Cuti & Izin (menu *Cuti & Izin*)
- [ ] **8.1** Tab **Data**: ajukan **Cuti Tahunan** (tanggal mulai–selesai). Hari dihitung **hanya hari kerja** (akhir pekan & hari libur tidak dihitung); pratinjau jumlah hari muncul.
- [ ] **8.2** **Sakit** wajib lampiran (surat dokter); **Izin/Cuti** boleh melampirkan dokumen; lampiran bisa dibuka oleh atasan/approver.
- [ ] **8.3** Saldo: tab **Saldo** — karyawan hanya melihat saldo sendiri; atasan melihat bawahan + dirinya; HR semua. Saldo = awal + tambahan − terpakai − pending.
- [ ] **8.4** **Tambah cuti** (grant): atasan memberi tambahan ke bawahan; L1 boleh ke dirinya sendiri; karyawan biasa tidak bisa. Tercatat di audit log.
- [ ] **8.5** Pengajuan melebihi saldo → ditolak. Tanggal bertabrakan dengan pengajuan lain → ditolak.
- [ ] **8.6** Approval: atasan (n+1) menyetujui → status **Disetujui**, saldo terpakai bertambah; menolak → saldo kembali; membatalkan pengajuan sendiri saat Pending → status Dibatalkan.
- [ ] **8.7** **Approver ditentukan (assigned):** pilih approver saat mengajukan → hanya approver itu yang cukup menyetujui (n+1 tidak perlu).
- [ ] **8.8** Cuti disetujui muncul sebagai Cuti/Izin/Sakit di **Absensi** pada tanggal tersebut (tidak dihitung tidak hadir).
- [ ] **8.9** **Aturan roster** (karyawan roster, lihat 6.6): cuti tahunan saat masa **KERJA** → ditolak; cuti yang menempel **tepat setelah masa OFF** → diterima; cuti tepat **sebelum** OFF → ditolak. Hanya hari kerja roster yang dihitung. Sakit/Izin tidak dibatasi. Karyawan non-roster tidak terpengaruh.
- [ ] **8.10** **Reminder roster:** jalankan `POST /api/admin/run-reminders` (admin) menjelang OFF (H-7/H-1) → notifikasi bell muncul + banner di halaman Cuti & Izin; tautan membuka form dengan tanggal awal terisi.

## 9. Approval (menu *Approval Saya*, *Riwayat Approval*)
- [ ] **9.1** **Menunggu Saya**: daftar pengajuan yang perlu keputusan (cuti, absensi manual, roster, penyelesaian tugas); badge angka di sidebar.
- [ ] **9.2** Setujui/Tolak dengan catatan; pengaju mendapat notifikasi.
- [ ] **9.3** **Berjenjang:** tugas dengan 2–3 tingkat → muncul ke approver berikutnya hanya setelah tingkat sebelumnya setuju; satu penolakan menghentikan alur.
- [ ] **9.4** Tanpa atasan (puncak organisasi) → jatuh ke HR, lalu super admin (fallback).
- [ ] **9.5** Tab **Pengajuan Saya** menampilkan status & posisi antrean; **Riwayat Approval** memuat semua keputusan.

## 10. Tugas (menu *Tugas*)
- [ ] **10.1** Buat tugas: nama, deskripsi, prioritas, **satu PIC**, pemberi tugas (siapa saja, termasuk via chat/call), mulai/deadline. Atasan boleh menugaskan diri sendiri atau bawahan; karyawan hanya diri sendiri.
- [ ] **10.2** **Anggota** (boleh bekerja/unggah) dan **Pengamat** (hanya memantau). Pengamat tidak bisa mengubah status.
- [ ] **10.3** **Sub tugas** (maks 5 tingkat): induk dengan 4 sub tugas, 1 selesai → induk **25%**; progres induk = rata-rata anak (rekursif); status induk otomatis.
- [ ] **10.4** **Approval penyelesaian**: PIC klik Selesaikan → status *Menunggu Approval*; atasan setuju → *Selesai*; tolak → kembali *In Progress* + alasan di komentar; PIC bisa menarik pengajuan.
- [ ] **10.5** **Lampiran hasil wajib** (`require_result`): selesaikan tanpa lampiran → ditolak. Unggah/hapus lampiran & komentar bekerja.
- [ ] **10.6** Tampilan **List / Board / Kalender / Gantt**; cakupan Tugas Saya / Saya Berikan / Saya Terlibat / Saya Amati / Tugas Tim / Semua; filter status, deadline, prioritas, proyek; pencarian; pengelompokan.
- [ ] **10.7** Buka kembali tugas selesai (atasan/pemberi tugas); hapus tugas induk menghapus anak (dengan konfirmasi).
- [ ] **10.8** **Terkait KPI:** pilih KPI otomatis milik PIC di form → tugas selesai tepat waktu menambah actual KPI (lihat 13.5).
- [ ] **10.9** **Reminder deadline:** tugas jatuh tempo H-3/H-1/hari-H → notifikasi ke PIC; terlambat +1/+3/+7 hari → ke PIC & pemberi tugas (jalankan `run-reminders`; tidak dobel bila dijalankan ulang). Tugas yang selesai/menunggu approval tidak diingatkan.

## 11. Tugas Rutin (tab *Tugas Rutin* di menu Tugas)
- [ ] **11.1** Buat template **harian** (Sen–Jum), **mingguan** (pilih hari), **bulanan** (tanggal 1–28 atau akhir bulan), deadline = N hari setelah dibuat, tanggal mulai (tidak boleh di masa lalu) & berakhir.
- [ ] **11.2** Template yang jatuh hari ini langsung menghasilkan tugas biasa untuk PIC + notifikasi "Tugas rutin"; menjalankan job berulang **tidak membuat duplikat**.
- [ ] **11.3** **Tautkan ke KPI** (isi judul KPI otomatis PIC, tak peka huruf besar/kecil) → tugas yang dibuat otomatis terkait ke KPI bulan/kuartal tersebut.
- [ ] **11.4** Jeda/Aktifkan; Edit; Hapus (tugas yang sudah dibuat tetap ada). Hanya admin/pembuat/atasan PIC yang boleh mengelola; PIC harus diri sendiri/bawahan.

## 12. Proyek (menu *Proyek*)
- [ ] **12.1** Buat proyek (nama, pemilik, periode) oleh admin/HR atau atasan; karyawan biasa tidak bisa.
- [ ] **12.2** Tab **WBS & Bobot**: tugas induk dengan bobot; progres proyek = rata-rata berbobot jika **semua** tugas induk berbobot, selain itu rata-rata biasa.
- [ ] **12.3** Tab **Gantt** dan **Kurva-S** (rencana vs aktual per minggu) menyesuaikan tanggal & penyelesaian tugas.
- [ ] **12.4** Tab **Dokumen**: unggah/unduh/hapus dokumen proyek.
- [ ] **12.5** Daftar proyek: progres, jumlah tugas open/selesai/terlambat.

## 13. KPI & Scorecard (menu *KPI & Scorecard*)
- [ ] **13.1** **Settings → KPI:** bobot KPI/Tugas/Absensi harus berjumlah 100 (selain itu ditolak); ambang Good/Attention dan target perusahaan tersimpan.
- [ ] **13.2** **KPI Departemen** (admin/HR/L1/L2 mengelola; atasan lain hanya melihat; karyawan biasa tidak melihat tab): buat objective dengan target, actual **manual** atau **skor tim**; Company KPI = rata-rata berbobot.
- [ ] **13.3** **KPI Karyawan:** atasan **Assign KPI** ke bawahan (tidak ke diri sendiri); metode manual atau otomatis (tugas tepat waktu); lebih kecil lebih baik didukung.
- [ ] **13.4** Skor item = actual/target×100 (maks 120). Contoh: target 12, actual 3 → 25%.
- [ ] **13.5** KPI otomatis: tautkan tugas lalu selesaikan tepat waktu → "n/m tugas tertaut selesai" dan skor naik.
- [ ] **13.6** **Scorecard:** skor akhir = KPI/Tugas/Absensi sesuai bobot (komponen tanpa data tidak dihitung); status Good ≥ 90, Attention ≥ 70, selain itu Critical; peringkat; **Detail** menampilkan radar, rincian KPI, tugas dengan label tepat waktu/terlambat/belum selesai, dan rekap absensi. Karyawan melihat dirinya sendiri; atasan melihat bawahan; admin semua.
- [ ] **13.7** Ganti periode bulanan/kuartalan lewat pemilih periode.
- [ ] **13.8** **Tutup periode (HR):** Scorecard → *Tutup Periode* → banner "Periode ditutup"; skor **beku** (menambah tugas/absensi sesudahnya tidak mengubah skor); tambah/ubah/hapus KPI pada periode itu ditolak (409); grafik **Riwayat skor akhir** tampil di Detail.
- [ ] **13.9** **Buka kembali:** skor dihitung ulang dari data terkini; periode itu tidak ditutup otomatis lagi.
- [ ] **13.10** **Tutup otomatis:** bulan/kuartal yang sudah berakhir ditutup otomatis sehari setelah hari terakhir (tgl 2) dan admin/HR menerima notifikasi (jalankan `run-reminders` untuk memicu).

## 14. Dashboard (menu *Dashboard*)
- [ ] **14.1** Kartu: karyawan aktif, hadir/terlambat hari ini, tugas terlambat, tugas saya, skor KPI bulan ini.
- [ ] **14.2** Chip **Perlu perhatian** (kontrak, tugas terlambat, cuti menunggu, approval untuk saya, posisi vacant) bisa diklik ke halaman terkait.
- [ ] **14.3** Grafik: kehadiran 7 hari, status tugas, tugas dibuat vs selesai, sebaran KPI; daftar sedang cuti, proyek aktif, performa terbaik/terendah.
- [ ] **14.4** Cakupan: admin/HR = seluruh bisnis terpilih; manager = tim sendiri; karyawan = data sendiri. Ganti bisnis di header memfilter angka.

## 15. Laporan (menu *Laporan*)
- [ ] **15.1** Enam laporan tampil dengan data benar: **Karyawan, Rekap Absensi, Cuti & Izin, Tugas, Proyek, KPI & Scorecard**; filter (unit, tipe, rentang tanggal ≤ 1 tahun, status, jenis cuti, periode) mengubah hasil.
- [ ] **15.2** Ringkasan di atas tabel cocok dengan jumlah baris.
- [ ] **15.3** **Excel**: file `.xlsx` terunduh, header merah, filter & freeze baris judul, isi sama dengan layar.
- [ ] **15.4** **PDF**: terunduh, judul/ringkasan/tabel rapi, footer tanggal cetak.
- [ ] **15.5** Pencarian & pagination di tabel laporan.
- [ ] **15.6** Karyawan biasa: menu Laporan tidak ada; `/reports` menampilkan "tidak memiliki izin".
- [ ] **15.7** Manager hanya melihat data timnya; ekspor tercatat di Audit Log.

## 16. Role & Izin (Settings → *Role & Izin*, hanya Super Admin)
- [ ] **16.1** Matriks menampilkan 12 izin per role; Super Admin terkunci; "Kelola role & izin" tidak bisa diberikan ke role lain.
- [ ] **16.2** Cabut **Ekspor laporan** dari Manager → Simpan → login Manager: tombol Excel/PDF hilang, `format=xlsx` = 403. **Bawaan** mengembalikan.
- [ ] **16.3** Cabut **Kelola user & password** dari HR → HR mendapat 403 di daftar user; tab Settings terkait hilang.
- [ ] **16.4** Berikan **Melihat laporan** ke Karyawan → menu Laporan muncul (data hanya miliknya).
- [ ] **16.5** Perubahan berlaku **langsung** (muat ulang halaman, tanpa login ulang).
- [ ] **16.6** HR Admin tidak bisa membuka tab Role & Izin / endpoint-nya (403).

## 17. Settings lainnya
- [ ] **17.1** **User & Hak Akses:** buat user baru (pilih role, bisnis, tautkan karyawan), ubah role/aktif, reset password (ikon mata).
- [ ] **17.2** **Master Data:** tambah/ubah jenis cuti (kategori cuti/izin/sakit, jatah, wajib lampiran).
- [ ] **17.3** **Workflow Approval:** ringkasan aturan n+1 / assigned tampil.
- [ ] **17.4** **Audit Log:** aksi penting (login tidak termasuk) tercatat dengan waktu, user, entitas: tambah/ubah karyawan, grant cuti, tutup/buka periode KPI, ekspor laporan, ubah izin role, hubungkan Drive.

## 18. Google Drive (Settings → *Google Drive*)
> Butuh kunci OAuth asli (lihat `docs/DEPLOY.md` bagian 8). Pada produksi uji dengan Drive uji dahulu.
- [ ] **18.1** Tanpa konfigurasi → panel menjelaskan cara mengisi `.env`; dengan konfigurasi → tombol **Hubungkan Google Drive**.
- [ ] **18.2** Hubungkan akun → kembali ke Settings dengan banner hijau, email akun tampil, status *Terhubung*.
- [ ] **18.3** Unggah dokumen karyawan, lampiran cuti, lampiran tugas, dan dokumen proyek → di Drive terbentuk `CORE HCIS / <Bisnis> / <Tab> / <Tahun> / <Nama file>` (Tab: Karyawan, Cuti & Izin, Tugas, Proyek). File lokal tetap bisa diunduh dari aplikasi.
- [ ] **18.4** Status di bawah thumbnail berubah *Menunggu ke Drive* → *Tersimpan di Drive* (≤ 1 menit atau **Sinkronkan Sekarang**).
- [ ] **18.5** File yang diunggah **sebelum** akun terhubung ikut terunggah setelah terhubung.
- [ ] **18.6** Simulasi gagal (putus internet/akun dicabut) → *Gagal ke Drive* + pesan; **Ulangi yang Gagal** setelah diperbaiki → berhasil.
- [ ] **18.7** Hapus folder tahun di Drive secara manual lalu unggah file baru → folder dibuat ulang otomatis.
- [ ] **18.8** **Putuskan** → sinkronisasi berhenti; file baru tetap *Menunggu*; hubungkan lagi → terkirim. Menghapus file di aplikasi **tidak** menghapus salinan di Drive.
- [ ] **18.9** HR dengan izin `drive.manage` melihat tab; karyawan/manager tidak.

## 19. Notifikasi (ikon lonceng)
- [ ] **19.1** Notifikasi muncul untuk: tugas baru/rutin, deadline & terlambat, roster OFF, periode KPI ditutup, approval masuk/diputuskan.
- [ ] **19.2** Klik notifikasi membuka halaman terkait (deep link), menandai terbaca; "Tandai semua dibaca".
- [ ] **19.3** Menjalankan job berulang tidak membuat notifikasi dobel.

## 20. Smoke test produksi (setelah deploy — 15 menit, tanpa membuat data nyata)
- [ ] **20.1** `https://DOMAIN` terbuka dengan gembok HTTPS; `http://DOMAIN` dialihkan ke HTTPS.
- [ ] **20.2** `https://DOMAIN/api/health` → `{"status":"ok"}`.
- [ ] **20.3** `https://DOMAIN/api/dev/accounts` → **404** (DEV_LOGIN mati).
- [ ] **20.4** `admin123` / `password123` **ditolak**; login dengan password baru berhasil.
- [ ] **20.5** 6× salah password → 429.
- [ ] **20.6** Header respons mengandung `Strict-Transport-Security` dan `X-Frame-Options: DENY` (`curl -sI https://DOMAIN`).
- [ ] **20.7** `/absen` di HP: meminta izin lokasi dan dapat Tap In di lokasi kantor (gunakan akun Anda sendiri; Tap Out sesudahnya).
- [ ] **20.8** Unggah satu dokumen kecil → muncul & bisa diunduh; (jika Drive aktif) tersinkron.
- [ ] **20.9** Akses antar-peran: karyawan membuka `/settings` dan `/reports` → ditolak; manager tidak melihat data di luar timnya.
- [ ] **20.10** Jalankan `./deploy/backup.sh` → dua file terbentuk; salin keluar server.
- [ ] **20.11** Port 5432/8080 tidak bisa diakses dari luar (`nmap` atau `curl http://IP:8080` timeout).
- [ ] **20.12** Reboot VPS → semua container kembali otomatis (`restart: unless-stopped`) dan aplikasi pulih.

## 21. Lintas fitur (regresi cepat, ±30 menit)
Skenario ujung ke ujung dengan akun seed:
1. **Rivaldy** mengajukan Cuti Tahunan 2 hari kerja → **Abdul Rahmat** menyetujui di *Approval Saya* → saldo Rivaldy berkurang 2, Absensi menampilkan Cuti pada tanggal itu, Dashboard menghitung "sedang cuti".
2. **Abdul Rahmat** assign KPI otomatis "Laporan Mingguan" (target 4) ke Rivaldy dan membuat **Tugas Rutin** mingguan tertaut KPI itu → tugas muncul di Rivaldy → Rivaldy menyelesaikan tepat waktu → Abdul menyetujui → skor KPI naik di Scorecard dan Dashboard.
3. **HR (Asri)** menutup periode bulan lalu → Scorecard beku, grafik riwayat muncul; Laporan KPI periode itu sama dengan Scorecard.
4. **Admin** mencabut izin ekspor Manager → Abdul tidak bisa mengekspor; mengembalikan ke **Bawaan**.
5. Unggah lampiran tugas oleh Rivaldy → sinkron ke `CORE HCIS / DEA Global / Tugas / <tahun>`.

---

### Catatan bug
Format laporan bug: *modul · langkah · akun · hasil sebenarnya vs harapan · tangkapan layar · tanggal/jam* (jam membantu mencocokkan log backend).

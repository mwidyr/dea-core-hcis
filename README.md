# DEA Core HCIS

CORE Business Operations Platform (HCIS) for PT DEA Global — quotation QUO-2026-009 (14 modules).
Full roadmap: [docs/development-plan.md](docs/development-plan.md).

**Stack:** React 18 + Vite + TS + Tailwind (frontend) · Go + Gin + GORM (backend) · PostgreSQL · Google Drive (Phase 8, file backup)

## Run locally

```bash
# 1. database
docker compose up -d postgres            # postgres on :5432, db dea_hcis

# 2. backend  (auto-migrates + seeds on first start)
cd backend && go run ./cmd/server        # :8080

# 3. frontend
cd frontend && npm install && npm run dev   # :5173, proxies /api → :8080
```

Seed data comes from the prototype (`CORE_Business_Operations_Platform_V113`): 8 businesses, org units, positions, locations, 20 employees.

| Account | Password |
|---|---|
| `admin@dea.local` (super_admin) | `admin123` |
| any employee email or NIK (e.g. `DEA-0004`), e.g. `asri.alfisyar.rahma@deaglobal.local` (hr_admin), `maulana.syawal@deaglobal.local` | `password123` |

Change these before production. Env vars: see `backend/.env.example`.

**Quick account picker (local dev only):** start the backend with `DEV_LOGIN=true` (a local `backend/.env` containing that line is enough) and the login page and `/absen` list every account to click — no password. It is an authentication bypass by design: it is **off by default**, routes return 404 when off, the backend logs a warning when on, and it must never be enabled in production.

## Dokumentasi
- [docs/DEPLOY.md](docs/DEPLOY.md) — deploy ke VPS (GitHub, Docker, HTTPS, backup, update, troubleshooting)
- [docs/TESTING.md](docs/TESTING.md) — panduan uji semua fitur per modul + smoke test produksi
- [docs/development-plan.md](docs/development-plan.md) — rencana & keputusan desain

## Layout
```
backend/   cmd/server, internal/{config,database,handlers,middleware,models,router}
frontend/  src/{components,pages,services,store,types}
docs/      development-plan.md
```

## Status
- ✅ Phase 0 scaffold · Phase 1 auth, business/org CRUD + chart, Settings (users, roles, leave-type master, audit log)
- ✅ Phase 2 employees (status, birth data, photos/documents) + Kontrak & Dokumen checklist
- ✅ Phase 4 approval engine (n+1, assigned approver overrides n+1, HR fallback) · Phase 3 **Cuti & Izin** (requests, balances, scorecards)
- ✅ Hari libur (nasional/organisasi, potong cuti / tidak) in Setup Waktu Kerja; leave attachments; multi-business placements
- ✅ Phase 3 complete: Kalender Kerja, Roster, Absensi (GPS tap in/out at `/absen` without login, daily/recap/shift views, manual attendance). Approved leave shows as Cuti/Izin/Sakit in attendance.
- ✅ Phase 5: Tugas (List/Board/Kalender/Gantt, PIC + anggota + pengamat, sub tugas dengan progres bertingkat, approval penyelesaian) dan Proyek (WBS berbobot, Gantt, Kurva-S, dokumen)
- ✅ Phase 6: KPI & Scorecard (KPI departemen, KPI karyawan manual/otomatis dari tugas, scorecard KPI+Tugas+Absensi)
- ✅ Phase 6b: reminder deadline tugas, Tugas Rutin (template berulang), snapshot & tutup periode KPI (manual HR + otomatis)
- ✅ Phase 7: Dashboard analitik, Laporan (6 jenis, ekspor Excel/PDF), editor Role & Izin
- ✅ Phase 8: sinkronisasi Google Drive (OAuth) — `CORE HCIS / Bisnis / Tab / Tahun / Nama file`; setup di `backend/.env.example` lalu Settings → Google Drive
- ✅ Phase 9 (sebagian): hardening produksi (`APP_ENV=production`, rahasia wajib kuat, password seed acak, anti-brute-force login, header keamanan), Docker produksi + HTTPS (Caddy), backup/restore, panduan deploy & uji
- ⏳ Sisa Phase 9: uji beban, uji penetrasi/ZAP, CI (GitHub Actions)
- Remaining sidebar modules show a placeholder naming their phase.


┌──────────┬──────────────────────────┬──────────────────────────────────────────┬───────────────┬──────────────┐
│   NIK    │           Nama           │                  Email                   │     Peran     │    Atasan    │
├──────────┼──────────────────────────┼──────────────────────────────────────────┼───────────────┼──────────────┤
│ DEA-0001 │ Muhamad Agus Muharrom    │ muhamad.agus.muharrom@deaglobal.local    │ Direktur (L1) │ –            │
├──────────┼──────────────────────────┼──────────────────────────────────────────┼───────────────┼──────────────┤
│ DEA-0002 │ Abdul Haq                │ abdul.haq@deaglobal.local                │ Manager       │ Direktur     │
├──────────┼──────────────────────────┼──────────────────────────────────────────┼───────────────┼──────────────┤
│ DEA-0003 │ Riska Irawan             │ riska.irawan@deaglobal.local             │ Manager (L2)  │ Direktur     │
├──────────┼──────────────────────────┼──────────────────────────────────────────┼───────────────┼──────────────┤
│ DEA-0004 │ Lukmanul Hakim           │ lukmanul.hakim@deaglobal.local           │ Manager       │ Abdul Haq    │
├──────────┼──────────────────────────┼──────────────────────────────────────────┼───────────────┼──────────────┤
│ DEA-0005 │ Abdullah Fawwaz Zanki    │ abdullah.fawwaz.zanki@deaglobal.local    │ Karyawan      │ Lukmanul     │
├──────────┼──────────────────────────┼──────────────────────────────────────────┼───────────────┼──────────────┤
│ DEA-0006 │ Asri Alfisyar Rahma      │ asri.alfisyar.rahma@deaglobal.local      │ HR Admin      │ Abdul Haq    │
├──────────┼──────────────────────────┼──────────────────────────────────────────┼───────────────┼──────────────┤
│ DEA-0007 │ Rafiah                   │ rafiah@deaglobal.local                   │ Karyawan      │ Asri         │
├──────────┼──────────────────────────┼──────────────────────────────────────────┼───────────────┼──────────────┤
│ DEA-0010 │ Abdul Rahmat             │ abdul.rahmat@deaglobal.local             │ Manager       │ Riska        │
├──────────┼──────────────────────────┼──────────────────────────────────────────┼───────────────┼──────────────┤
│ DEA-0011 │ Rivaldy Alnuari Ramadhan │ rivaldy.alnuari.ramadhan@deaglobal.local │ Karyawan      │ Abdul Rahmat │
├──────────┼──────────────────────────┼──────────────────────────────────────────┼───────────────┼──────────────┤
│ DEA-0012 │ Hendrik                  │ hendrik@deaglobal.local                  │ Manager       │ Riska        │
├──────────┼──────────────────────────┼──────────────────────────────────────────┼───────────────┼──────────────┤
│ DEA-0013 │ Akhmad Sulistiyo         │ akhmad.sulistiyo@deaglobal.local         │ Karyawan      │ Hendrik      │
└──────────┴──────────────────────────┴──────────────────────────────────────────┴───────────────┴──────────────┘

Karyawan lain mengikuti pola yang sama.

Cara mengatur GPS di komputer (wajib untuk uji lokasi):
- Buka DevTools (F12), lalu menu ⋮ → More tools → Sensors → Location → Other….
- Lokasi di kantor (valid): Latitude -6.2384, Longitude 106.9757. Ini berada sekitar 16 m dari titik "Bekasi" bawaan.
- Lokasi jauh (harus ditolak): Latitude -6.30, Longitude 107.0.
- Pada kunjungan pertama, browser meminta izin lokasi, jadi klik Izinkan.
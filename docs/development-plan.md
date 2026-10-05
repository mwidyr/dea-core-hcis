# DEA Core HCIS — Development Plan (Draft)

## Context
Quotation QUO-2026-009 (PT DEA Global, Rp 15.000.000, 14 modules, 1–2 months from DP, 50/50 payment at go-live) covers
the **CORE Business Operations Platform (HCIS)**. The HTML file `CORE_Business_Operations_Platform_V113_Cuti_Izin_Update.html`
(~800 KB, 77 `<script>` blocks, V1→V113 patched layer on layer, data hardcoded, no backend) is the **UI/behaviour spec**, not code to
reuse. Goal: turn it into a real app under `dea-core-hcis/` as the parent repo:

```
dea-core-hcis/
├── backend/    Go + Gin + PostgreSQL (+ Google Drive later)   [mirror ../Documents/ayt-sales/backend]
├── frontend/   React 18 + Vite + TS + Tailwind + zustand + axios + recharts + react-router + lucide  [mirror ayt-sales/frontend]
├── docker-compose.yml  (postgres + backend)
├── docs/       (this plan, ERD, API list, module↔prototype map)
└── README.md
```
Current state: `dea-core-hcis` only has a GoLand stub (`go.mod` `module dea-core-hcis`, `main.go` hello-world). Move into `backend/`
(`github.com/dea-core/hcis/backend` style module path, same as ayt-sales' `github.com/ayt-sales/backend`).

Conventions copied from ayt-sales: `cmd/server/main.go`, `internal/{config,database,handlers,middleware,models,router}`, `migrations/`,
JWT auth middleware, Gin + gin-contrib/cors, `services/api.ts` axios client, `store/auth.ts` zustand, `pages/`, `components/{Layout,ui}`,
`utils/export.ts` (jspdf + autotable) for PDF export, multi-stage Dockerfile.

## Quotation scope → modules (14)
| # | Module (quotation) | Prototype view id(s) | Price |
|---|---|---|---|
| 1 | Dashboard & Analytics | `dashboard` | 1.2M |
| 2 | Employee Management 360 (+contract & docs) | `employees`, `contract` | 1.1M |
| 3 | Leave (Cuti & Izin) + balance | `leave` | 1.4M |
| 4 | Attendance (GPS check-in/out, rekap, shift, manual) | `attendance` | 1.5M |
| 5 | Task Mgmt (List/Kanban/Calendar/Gantt; Mine/Team/All) | `tasks16`, `mytasks`, `teamtasks`, `alltasks` | 1.0M |
| 6 | Project Mgmt (stages, Gantt, S-Curve, docs) | `projects16` | 1.1M |
| 7 | Approval & Workflow (multi-level) | `approval`, `approvalhistory` | 1.5M |
| 8 | Organization Setup L1–L10, positions, locations, org chart | `companymaster` | 1.1M |
| 9 | Reporting & Export (PDF/Excel) | `reports` | 0.8M |
| 10 | Calendar & Schedule (work calendar, holidays, rosters Reguler/6/8 week) | `worksetup` | 0.6M |
| 11 | Settings & Role Mgmt, master data, audit log | `settings` | 0.8M |
| 12 | Login & User Mgmt, profile, notifications | (login not in prototype) | 0.6M |
| 13 | Multi-Business (business switcher) | global header filter | 0.8M |
| 14 | KPI & Performance (dept KPI, employee KPI, scorecard) | `deptkpi`, `employeekpi`, `scorecard` | 1.5M |

Out of scope per quotation T&C #8: hosting/domain/SSL, training, **data migration**, external integrations. Google Drive is a
later introduction (see Phase 8) — flag it to the client as possibly an extra since "akses/integrasi eksternal" is excluded.

## Key findings from the prototype (drive the design)
- **Businesses (8)**: DEA Global, DGN Parts, Mocco Coffee, Angsana Farm, Tiga Nata Ruang, Angkasa Yudistira Travel, JalanUmroh, Rotienak.
  Each has own units; prototype renames "Department" → "Unit Organisasi". Business is a parent filter; Unit depends on it.
  → every business-scoped table carries `business_id`; API scopes by the user's allowed businesses (+ "Semua Bisnis" for group-level roles).
- **Org**: L1 Management → L2 Fungsi → L3 Bagian / Business Unit (up to L10); positions have level class (Direksi, GM/Business Head,
  Manager/Head, Coordinator/Team Leader, Supervisor, Staff, Non-Staff/Operator), parent position (reporting line) and holder (or Vacant).
- **Leave**: types Cuti Tahunan / Izin / Sakit; statuses Pending Approval / Disetujui / Ditolak; time-state Akan Datang / Sedang Berlangsung / Selesai;
  balance = initial + additional − used − pending, with expiry date; scorecards active / not-working (cuti, izin, sakit) / working / pending.
  V111 makes Leave↔Absensi **1-to-1**: approved leave auto-marks attendance for those days.
- **Schedule**: work calendars (work days, hours, break, tolerance), holidays (by entity/location, "Kerja Hari Libur"), rosters (Reguler / 6:2 / 8-week) with start-cycle and
  per-employee assignment, cycle preview, roster approval.
- **Attendance**: today, recap (work days / present / late / absent / total hours), shift schedule, individual detail, manual-attendance request (→ approval), per-policy & location (GPS).
- **Tasks**: hierarchy (task/subtask with inheritance), PIC assignment, scope Mine/Team/All, grouping (Unit/Project/PIC/Status), views List/Kanban/Calendar/Gantt;
  S-Curve lives in Project only.
- **KPI**: employee KPI = KPI + task completion + attendance (auto-calculated from tasks); dept KPI objective/target/actual/weight/score/status.
- **Settings**: users & permissions, workflow approval config, master data (employee status, leave types, KPI period), audit log.
- Prototype code is patch-stacked (V12…V113); **do not port code, port behaviour**. Some data is demo noise (duplicate names, "Project Project Operations").

## Architecture decisions (recommended)
- Gin (matches ayt-sales), `database/sql` or GORM per what ayt-sales uses (check `internal/database/db.go` and follow it), plain SQL migrations via `golang-migrate` (ayt-sales `migrations/` is empty → introduce versioned migrations here).
- Auth: JWT (access + refresh), bcrypt, RBAC with permission strings (`leave.approve`, `employee.read`…) mapped to roles; scope = business(es) + unit subtree.
- Generic **approval engine** (request_type, workflow steps, approver resolution by position/manager/role) reused by leave, attendance-manual, task, employee-data change, roster.
- Audit log via middleware/service hook on all writes.
- File storage behind a `storage.Provider` interface: `local` first (employee docs, project docs), `gdrive` implementation later — so Phase 8 is a swap, not a rewrite.
- Frontend: react-router layout matching prototype nav groups (Overview, Organisasi, Kehadiran, Pekerjaan, Kontrol, Pengaturan), design tokens from prototype (`--red:#d84a4a`, Inter, 12px radius cards) as Tailwind theme; global Business switcher in header (zustand).
- Gantt/Kanban: build with lightweight libs (e.g. dnd-kit for Kanban; simple custom SVG/CSS Gantt + recharts for S-Curve) — decide in Phase 5.

## Phases (fits the 1–2 month window; weekly demo per quotation T&C #3)

### Phase 0 — Foundation & scaffolding (days 1–4)
1. Restructure repo: `backend/`, `frontend/`, `docs/`, `docker-compose.yml`, `.gitignore`, README; `git init`.
2. Backend skeleton from ayt-sales pattern: config (env), DB connect, router, middleware (logger, CORS, recover, auth stub), `/api/health`, migration runner, Dockerfile.
3. Frontend skeleton (`npm create vite` React-TS, Tailwind, router, axios `services/api.ts`, `store/auth.ts`, Layout with sidebar+topbar per prototype, `components/ui` primitives: Card, Badge, Table, Modal, Tabs, Select, Pagination, StatCard).
4. Extract prototype spec to `docs/`: module↔view map, ERD draft, permission matrix draft.
- **Exit**: `docker compose up` → health OK; frontend shell renders sidebar with all 10 nav entries (placeholder pages).

### Phase 1 — Identity, multi-business, org (module 12, 13, 8, 11-part) (week 1–2)
1. Migrations: `businesses`, `users`, `roles`, `permissions`, `role_permissions`, `user_businesses`, `org_units` (level 1–10, parent), `positions`, `locations`, `audit_logs`.
2. Auth API: login, refresh, me, change password, profile; seed super-admin + 8 businesses + DEA Global org tree from prototype `orgDemoData`.
3. RBAC middleware + business-scope helper (analogue of ayt-sales `handlers/scope_sql.go` / `access.go`).
4. Org API + UI: Setup Organisasi tabs (units, positions, locations, org chart tree, placement), Business switcher (global), Login page, Profile, user & role management screens.
5. Notifications table + bell (reuse ayt-sales `notifications/NotificationContext` pattern, polling first).
- **Exit**: login, switch business, CRUD org structure, role-gated menus.

### Phase 2 — Employee Management 360 (module 2) (week 2–3)
1. Tables: `employees` (personal data, status, join date, unit, position, business, location, manager), `employment_history`, `employee_assets`, `employee_documents` (KTP/NPWP/contract; file via storage interface, local for now), `contracts` (start/end).
2. API: list/filter/search/paginate, detail 360 (tabs: personal, riwayat kerja, aset, dokumen), create/update (change → approval hook later), contract-expiry reminder endpoint (scheduler job like ayt-sales `need_response_scheduler.go`).
3. UI: Karyawan table + expandable detail, "Kontrak & Dokumen" page with checklist + expiry badges.
4. CSV import for employees (cheap helper since data migration is client-side responsibility).
- **Exit**: ~40 DEA employees manageable end-to-end; expiry alerts.

### Phase 3 — Calendar/Schedule + Attendance + Leave (modules 10, 4, 3) (week 3–5)
Build in this order because they are interdependent (V111/V112 1-to-1 rules).
1. **Schedule (10)**: `work_calendars`, `holidays`, `roster_patterns` (Reguler/6:2/8wk), `roster_assignments`; cycle-preview calculator (pure Go func + unit tests); UI Setup Waktu Kerja tabs.
2. **Attendance (4)**: `attendance_policies`, `work_locations` (lat/lng/radius), `attendance_records`, `manual_attendance_requests`; check-in/out with GPS radius validation, late calc from calendar+tolerance, today view, recap, shift view, individual detail, "kerja hari libur" flag.
3. **Leave (3)**: `leave_types`, `leave_balances` (initial/add/used/pending/expiry), `leave_requests`; request form, balance deduction on approval, pending reserve, time-state derivation; scorecards; "Saldo Cuti" tab; leave approved ⇒ attendance rows auto-generated (1-to-1).
4. Leave/manual-attendance temporarily auto-approve until Phase 4 engine lands (or build Phase 4 engine first if schedule allows).
- **Exit**: employee can check in via GPS, request leave, balance updates, recap consistent with calendar/roster.

### Phase 4 — Approval & Workflow engine (module 7) (week 4–5, overlaps Phase 3)
1. Tables: `workflows`, `workflow_steps` (level, approver type: direct manager / position / role / specific user), `approval_requests`, `approval_actions`.
2. Engine service: submit → resolve approvers → advance/reject/return; callbacks per `request_type` (leave, attendance_manual, task, employee_change, roster).
3. API + UI: Approval Saya (inbox with approve/reject + note), Riwayat Approval, workflow config in Settings; wire Leave + Attendance manual + employee data change to it; notifications on each step.
- **Exit**: multi-level approval proven on leave end-to-end.

### Phase 5 — Task & Project Management (modules 5, 6) (week 5–6)
1. Tables: `projects`, `project_stages`, `project_documents`, `tasks` (parent_id, project_id, pic, dates, progress, status, priority), `task_assignees`, `task_comments`.
2. API: scoped lists (Mine/Team/All by reporting line), grouping, filters; progress roll-up from subtasks (V18 inheritance rule); S-Curve data (planned vs actual by week).
3. UI: Task views List / Board (Kanban drag) / Calendar / Gantt; Project detail: stages, Gantt, S-Curve (recharts), tasks, documents.
- **Exit**: create project → stages → tasks → track progress; S-Curve plan vs actual.

### Phase 6 — KPI & Performance (module 14) (week 6–7)
1. Tables: `kpi_periods`, `dept_kpis` (objective, target, actual, weight, score, status), `employee_kpis`, `scorecards`.
2. Calculation service: employee KPI = weighted(KPI score, task completion % from tasks, attendance % from attendance) — weights configurable in master data; recompute job + on-demand.
3. UI: KPI Departemen, KPI Karyawan, Employee Scorecard.
- **Exit**: KPI numbers trace back to tasks/attendance data.

### Phase 7 — Dashboard, Reporting, Settings completion (modules 1, 9, 11) (week 7)
1. Dashboard aggregates endpoint (active employees, attendance today, tasks, projects, KPI, Team Performance, daily activity) with business/unit filters + recharts.
2. Reports: per employee / department(unit) / project with custom filters; export Excel (backend `excelize`) and PDF (frontend jspdf-autotable like ayt-sales `utils/export.ts`).
3. Settings: master data (employee status, leave types, KPI periods), audit log viewer, role/permission matrix editor.
- **Exit**: all 14 modules reachable and functional.

### Phase 8 — Google Drive integration (introduced later, after core UAT)
1. Implement `storage.Provider` for Google Drive (service account or OAuth, shared folder per business/employee), keep `local` as fallback.
2. Switch employee/project documents to Drive; migrate existing local files; store `drive_file_id` + metadata only in Postgres.
3. Confirm with client whether this falls under "integrasi eksternal" (extra cost per T&C #8).

### Phase 9 — QA, hardening, deployment, handover (week 8)
1. Backend unit tests for roster cycle, leave balance, late calc, KPI calc, approval engine; API integration tests against Postgres container.
2. Full UAT pass against prototype checklist (per view id), fix revisions from weekly demos.
3. Security: rate-limit login, input validation, CORS prod origin, secrets via env, DB backups.
4. Deploy to client VPS (docker-compose like ayt-sales README "Deploy ke VPS"), seed production data, go-live → 2 week free maintenance starts.
5. Docs: README, runbook, short user guide (training/docs are paid extras).

## Risks / open items to confirm with client
- Real employee/org data (prototype demo data has duplicates and 40 vs differing counts) — who provides and cleans it? (migration is client's job.)
- Approval chain rules per request type (who approves leave: direct manager → HCGA?).
- GPS rules: radius per location, spoof tolerance, mobile browser vs separate app (assume responsive web/PWA).
- Roster approval flow (V59 "rosterApproval") scope.
- Leave policy: accrual, carry-over, expiry, half-day, public-holiday exclusion.
- Hosting/domain/SSL ownership.
- Schedule is tight for 14 modules in 1–2 months — Phases 3–6 are the critical path; run Phase 4 early.

## Verification (per phase)
- Backend: `cd backend && go build ./... && go test ./...`; `docker compose up -d postgres`; run migrations; curl `/api/health` and phase endpoints.
- Frontend: `cd frontend && npm run build` (tsc + vite) and `npm run dev` against local backend; click through the prototype view equivalent for each module.
- End-to-end happy path at Phase 4 exit: employee logs in → requests leave → manager approves → balance decremented → attendance shows leave → dashboard counts update.


---
## Decisions confirmed by the client/owner (2026-10-02)
1. **Google Drive is included at no extra cost** (use a Google account). Documents, images and attachments are **saved to local storage first, then synced to Drive** by a background job. Model: `attachments(local_path, drive_file_id, drive_status = pending|synced|failed)`; local copy is kept as the source of truth for serving; failed syncs are retried. Phase 8 = implement the Drive uploader; Phase 2 already stores files locally behind a `storage.Provider` interface.
2. **Seed/sample data comes from the prototype HTML** (`orgDemoData`: 8 businesses, units L1–L3, positions with holders and reporting lines, locations) — already loaded by `backend/internal/database/seed.go`. The prototype only has ~20 named holders (the "40 karyawan" on its dashboard is demo text).
3. **Approval chain = n+1 with optional assigned approver.** Default chain: requester → direct manager (`employees.manager_id`, derived from `positions.reports_to_id`; vacant positions are skipped upward). A request can carry an **assigned approver**; if the assigned approver approves, the n+1 step is **auto-satisfied** (no second approval needed). Applies to leave, manual attendance, tasks, employee changes, roster. Implemented in Phase 4 (`approval_requests.assigned_approver_id`, step resolution in the engine).
4. Backend uses GORM AutoMigrate (same as ayt-sales) instead of golang-migrate.

5. **Employee documents (done early, 2026-10-02):** `employee_documents(label, file_name, mime_type, size, local_path, drive_file_id, drive_status)`. Upload = multipart `label` + `file` (JPG/PNG/WEBP/GIF/PDF, ≤10 MB, type sniffed server-side), stored under `UPLOAD_DIR/employees/<id>/`, `drive_status='pending'`. Phase 8 only has to add the uploader that fills `drive_file_id` and flips status.
6. **Employee status:** `Aktif | Suspend | Tidak Bekerja` (`PATCH /employees/:id/status`); non-Aktif employees' login is disabled and they are excluded from "active" stats. Hard delete (`DELETE /employees/:id`) also removes login, documents and files.
7. **Approval engine (done 2026-10-02):** `approval_requests` + `approval_steps`; `internal/approval/engine.go` (`Submit/Act/Cancel`, module `Hooks`). Chain = requester's n+1 (manager link from the position tree); an **assigned approver replaces the chain** (n+1 not needed); fallback HR admin → super admin. `Levels[type]` sets how many n+1 levels (default 1). Super admin can act on any pending step. Leave is the first consumer (`handlers/leave.go` hook applies Disetujui/Ditolak/Dibatalkan and balance). Next consumers: manual attendance, task, employee change, roster.
8. **Leave rules implemented:** working days = Mon–Fri (will use the holiday calendar in the Schedule module); balance = initial + added − used − pending; pending is reserved on submit, used on approval, released on reject/cancel; no overlap with pending/approved requests; requests can't span two years.
9. **Visibility & grants (2026-10-02):** balances/leave requests are visible to the person, to all their subordinates' superiors (every level above, via `manager_id` recursion), and to approvers; super/HR admin see the whole business scope. "Tambah Cuti" (`POST /leave/balances/:id/grant`, reason required, logged in `leave_grants` + audit) is allowed superior → any subordinate; the top of the hierarchy (no manager = L1) may grant to themselves; admins anyone.
10. **Multi-business (2026-10-02):** one employee ↔ many businesses via `employee_placements`, **one position per business** (unique `(employee_id, business_id)`; legacy duplicates are cleaned at startup). Adding a placement also grants the login access to that business; the employee then appears in that business's lists, org positions and chart.
11. **Leave attachments:** `leave_attachments` (same upload rules as employee docs; local first, Drive later). `leave_types.requires_attachment` (default on for Sakit) is enforced on submit; the approver sees the files in the approval dialog. Visible to requester, superiors, approvers, HR; add/remove only by the requester/HR while pending.
12. **Holidays (2026-10-02):** `holidays(date, name, business_id NULL=nasional, deducts_leave)`. Editable by super admin or any employee in an L1/L2 unit. `deducts_leave=false` → plain day off; `true` → "cuti bersama": deducted from every employee's annual balance (computed live as the `collective` column, from the join date), and — for both kinds — the day is **not counted again** inside a leave request. Seeded with none: enter the real national calendar in Setup Waktu Kerja.
13. **Leave actions:** Detail (with approval chain, notes, files), Setujui/Tolak inline for the current approver, Batalkan for pending or approved-not-yet-started leave (days returned).
14. **Attendance & schedule (2026-10-02):**
    - **Public tap page** `/absen` (no session): NIK **or** email + password + Tap In / Tap Out, big clock that follows *server* time (`GET /api/public/clock`), live GPS. API: `POST /api/public/attendance`. Rate limit: only *failed* logins count (5 per account / 15 min, 20 per IP / 5 min) so an office behind one NAT can tap in together. Production needs **HTTPS** (browsers only expose GPS on secure origins; `localhost` is exempt).
    - **GPS rule:** distance (haversine) from the employee's work location (or roster location; else any active location of the business) must be ≤ the location's radius; accuracy worse than 300 m is rejected; GPS can be switched off per calendar/roster. Coordinates live on `locations` (seeded with city centres, refine in Setup Organisasi → Lokasi). GPS can be spoofed by rooted/mock-location devices — treat it as a deterrent, not proof.
    - **Schedule resolution:** roster membership wins (cycle `work:off` in days or weeks from `start_cycle`, holidays do NOT stop a roster); otherwise the employee's work calendar (or the business default): holiday → *Libur*, non-work weekday → *OFF*. Tapping in on Libur/OFF is allowed and counted as **Kerja Hari Libur**.
    - **Leave ↔ attendance 1-to-1:** no attendance rows are written for leave; Cuti/Izin/Sakit are derived from approved leave, so cancelling a leave corrects attendance automatically. Tapping on a leave day is blocked.
    - Late = tap-in after `start + tolerance`; break time is excluded from worked minutes; overnight shifts supported (tap-out matches the latest open record < 20 h).
    - **Manual attendance** goes through the approval engine (`attendance_manual`); on approval it writes the record with `source = manual`.
    - NIK: `<BUSINESS CODE>-0001…`, auto-assigned, editable, unique; an edit that omits it keeps the old one.
    - Not built: roster approval flow (V59) and per-day "penugasan hari libur" assignments.
15. **Roster policy (client answers, 2026-10-02):**
    - **Off schedule per employee:** `roster_assignments.start_cycle` = the first work day of *that employee's* cycle (required when adding a member; nil falls back to the roster's default). Crews rotate by giving members different starts. Pattern is free-form: `work : off` in days or weeks (4:2 weeks, 6:4 weeks, 6:2 days…).
    - **Who sets it:** super admin / HR / L1-L2 manage rosters and all members; a **direct superior** may add/change/remove only their own direct reports (`PUT /rosters/:id/employees` is scoped to the caller's manageable members).
    - **Shifting a schedule needs approval:** `roster_adjustments` (employee / direct superior / schedule managers file; approved by n+1 or an assigned approver via the approval engine, type `roster`). Once approved the resolver overrides the pattern for those dates (`Sched.Adjusted`), pending/rejected/cancelled ones never apply.
    - **Leave for roster members:** only days the roster (incl. approved adjustments) says "kerja" are counted — OFF blocks are never deducted, weekends count if the roster works them; national holidays do not apply to rosters and *cuti bersama* does not deduct their balance (`balanceFor(..., roster=true)`).
16. **Roster annual-leave rule + reminders (2026-10-02):**
    - For roster members, *annual leave* (leave type category `cuti`) must attach **directly after an OFF block**: the first counted work day must have an OFF day right before it, and counted days must form one run. Rejected: mid-work-period, and right before an OFF block (it would cut work days). Sakit and Izin are never restricted. Enforced in `rosterLeaveError` (create) and previewed by `GET /leave/calc?type_id=`; `GET /leave/roster-window` returns the current/next OFF block and the earliest allowed start. Non-roster employees are untouched.
    - **Reminders:** `notifications` table + bell in the header (60 s poll). `RunRosterReminders` (hourly job + `POST /admin/run-reminders`) notifies roster members `reminderLeadDays = {7, 1}` days before an OFF block starts, unless they already filed annual leave for that window; idempotent via `ref_key`. Banner on Cuti & Izin for roster members only (OFF within 14 days or in progress). Notification links deep-link to `/leave?new=1&from=<first allowed day>`.
17. **Dev account picker (2026-10-04):** `DEV_LOGIN=true` (env, default false) routes `GET /api/dev/accounts` + `POST /api/dev/login {user_id}` and lets `POST /api/public/attendance` accept `dev_user_id` (all other rules — GPS, schedule — still apply). The login page and `/absen` show a click-to-pick list only when the endpoint answers; with the flag off the endpoints are 404 and the UI shows nothing. **Production deploy checklist: `DEV_LOGIN` must be unset/false.**
18. **Tasks & projects (Phase 5, 2026-10-04):**
    - **One PIC** per task + optional **members** (can work/upload) and **watchers** (read-only follow). The one who gave the instruction ("pemberi tugas") is recorded separately and may be anyone (chat/call).
    - **Progress:** leaf = 100% when done else 0%; parent = average of its children, recursively (4 sub-tasks, 1 done → 25%); a parent's status is derived and cannot be set or completed by hand. **Project progress** = weighted average of its top-level tasks when *every* one has a weight ("bobot"), otherwise a plain average. Kurva-S: each leaf's share of the project is spread evenly over its start..due (plan) and counts from its completion day (actual).
    - **Approval = approval to close a task:** per task `requires_approval` (default ON), 1–3 n+1 levels or a fixed approver (`approval.SubmitInput.Levels`), optional mandatory result files (`require_result`). Complete → status `review` → approved = `done` (+ completed_at), rejected = back to `in_progress` with the reason as a comment, PIC can withdraw. Parents need no approval of their own.
    - **Who can do what:** assign to yourself or a subordinate (admin/HR anyone); managers = admin/HR, creator, assigner, the PIC's superiors, the project owner (and their superiors) → full edit/delete/reopen; the PIC alone → description, members, watchers, status, completion. Scopes: Tugas Saya / Saya Berikan / Saya Terlibat / Saya Amati / Tugas Tim / Semua Tugas. Max depth 5; deleting a task cascades; an employee who is PIC of open tasks cannot be deleted.
    - **Projects:** owner, period, status, WBS with weights, Gantt, Kurva-S, documents (local; Drive in phase 8). Creating one needs admin/HR or a superior.
    - **Not built:** recurring ("Rutin") tasks from the prototype, deadline reminders, task-level activity history beyond comments.
19. **KPI & Scorecard (Phase 6, 2026-10-04):**
    - **Periods** are `YYYY-MM` or `YYYY-Qn`. Item score = actual/target×100, capped at 120 (inverted for "lower is better"). Employee KPI items are *manual* (actual typed in) or *auto* `tasks_on_time` (counts linked tasks — `Task.KPIID` — finished on time inside the period).
    - **Final score** = KPI / Tugas / Absensi mix, default weights 50/30/20 (Settings → KPI, must sum 100), renormalised over components that have data. Task score = done÷(due-or-done) leaf tasks in the period; attendance score = present÷(required − leave). Status: Good ≥ 90, Attention ≥ 70, else Critical (configurable).
    - **Dept KPI:** manual actual or `team_score` (average final score of the unit subtree). Company KPI = weighted average of dept scores. Created by admin/HR/L1–L2; viewable by those plus anyone with direct reports.
    - **Who assigns employee KPI:** admin/HR anyone; a superior to their subordinates (not themselves). Employees see only their own scorecard; superiors their downline; admin everyone.
    - Superseded by item 20 (recurring tasks, deadline reminders and KPI snapshots were added in Phase 6b).
20. **Phase 6b — reminders, recurring tasks, KPI snapshots (2026-10-04):**
    - **One hourly job set** (`RunAllJobs`, also `POST /admin/run-reminders` → `{jobs:{…}}`): roster reminders, recurring-task generation, deadline reminders, KPI auto-close. All idempotent.
    - **Deadline reminders:** open leaf tasks (not done, not waiting for approval) notify the PIC at H-3, H-1 and the day itself; overdue at +1, +3, +7 days notify the PIC and the assigner. Idempotent via `notifications.ref_key`.
    - **Recurring tasks ("Tugas Rutin")**: `recurring_tasks` template (daily Mon–Fri / weekly weekday / monthly day 1–28 or last day; deadline = occurrence + N days; start ≥ today, optional end; PIC, approval settings, optional `kpi_title`). The job creates one normal task per occurrence on the day (catch-up ≤ 31 days after downtime); `UNIQUE(recurring_id, occurrence_date)` prevents duplicates. `kpi_title` links the task to the PIC's auto KPI item with that title (case-insensitive) for the occurrence's month or quarter. Deleting a template keeps the generated tasks. Who: group-level, the creator, or a superior of the PIC; PIC must be self/subordinate (same rule as creating a task). Holidays are not skipped.
    - **KPI snapshots:** closing a period freezes every active employee's scorecard (+ task rows) and all dept KPIs (`kpi_snapshots`, `kpi_dept_snapshots`, `kpi_period_closes`, settings used). Scorecard, detail, KPI items and dept KPI views of a closed period read the snapshots; KPI items/dept KPIs of that period cannot be created/edited/deleted (409). **Manual:** HR/admin "Tutup Periode" any time (warns if the period has not ended) and "Buka Kembali". **Automatic:** the job closes the latest finished month and quarter once today ≥ last day + 2 (`autoCloseGraceDays = 1`, so the last day can still be filed) and notifies HR/admin. A period HR reopened is never auto-closed again (its `kpi_period_closes` row stays with status `open`); a manual close can be repeated. Trend: `GET /kpi/history/:id` (monthly compared with monthly, quarterly with quarterly) is shown as a chart in the scorecard detail.
    - **Not built:** skipping public holidays for recurring tasks, members/watchers on templates, KPI snapshots of ex-employees.
21. **Phase 7 — Dashboard, Laporan, Role & Izin (2026-10-04):**
    - **Dashboard** (`GET /dashboard`): everything is scoped by the business filter and the caller's reporting scope (group-level = all, manager = self + downline, employee = self). Cards (active staff, present/late today, overdue tasks, my tasks, KPI of the current month), attention chips, 7-day attendance, task status, created-vs-completed per week, KPI distribution, on-leave today, active projects, top/bottom KPI scores. Vacant positions and "pending leave" follow the same scope rules. A closed KPI period is read from its snapshot.
    - **Laporan** (`GET /reports/:type`, types `employees | attendance | leave | tasks | projects | kpi`; filters: unit, type, date range ≤ 1 year, status, category, period): one JSON shape feeds the on-screen table, **Excel** (`?format=xlsx`, built by excelize, needs `reports.export`, audited) and **PDF** (generated in the browser with jsPDF + autotable, gated in the UI only). Same data scope as the rest of the app; the employee report lists active employees only.
    - **Role & Izin:** `role_permissions` table (seeded with the previous behaviour the first time) + in-memory cache (`internal/perm`). Permissions: `reports.view/export`, `employees.manage`, `org.manage`, `business.manage`, `leave.admin`, `kpi.settings`, `kpi.period`, `users.manage`, `audit.view`, `roles.manage`. Defaults: super_admin all (locked, always); hr_admin all except `roles.manage`; manager reports.view + reports.export; employee none. `roles.manage` can never be granted. Routes that were in the `RequireRole(super_admin, hr_admin)` group now use `RequirePerm(...)` (only `/admin/run-reminders` keeps the role check). Permissions are returned with login/`/auth/me`; the frontend refreshes them on every page load, enforcement is live on the server. **Permissions switch features; data scope still follows the role** — granting e.g. `employees.manage` to Manager lets them edit any employee, so only do that deliberately.
    - **Not built:** per-user permission overrides, per-report column picker, scheduled/emailed reports, server-side PDF.
22. **Phase 8 — Google Drive sync (2026-10-04):**
    - **OAuth user account** (not a service account): `GDRIVE_CLIENT_ID/SECRET/REDIRECT_URL` in `.env`; an admin clicks "Hubungkan Google Drive" (Settings → Google Drive, permission `drive.manage`, default HR + Super Admin), Google redirects to `GET /api/drive/callback` (public, protected by a signed 10-minute state), the refresh token is stored **AES-GCM encrypted** (key derived from `JWT_SECRET`; changing the secret means reconnecting) in `drive_settings`. `GDRIVE_REFRESH_TOKEN` in the environment works as an alternative. Scope: `drive.file` (only what the app creates) unless `GDRIVE_ROOT_FOLDER_ID` is set, then full `drive` (needed to write into an existing folder); switching requires reconnecting.
    - **Layout:** `CORE HCIS / <Business> / <Tab> / <Year> / <name>` with Tab = `Karyawan` (employee documents), `Cuti & Izin` (leave attachments), `Tugas` (task attachments), `Proyek` (project documents), Year = upload year (Asia/Jakarta). The business is the one the record belongs to (employee's primary business, leave request, task, project). File names carry context: `Budi - KTP - ktp.png`, `Budi - Sakit - 2026-10-20 - surat.pdf`, `#7 - Rapikan stok - foto.png`, `Migrasi - Kontrak - kontrak.pdf`. Folder ids are cached in `drive_folders`; a folder deleted by hand is rebuilt automatically (one retry).
    - **Flow:** upload → local disk (source of truth, still used for downloads) with `drive_status = pending` → background job every minute (and "Sinkronkan Sekarang") → `synced` + `drive_file_id` + `drive_url`. Files uploaded before the account was connected are backfilled. Failures become `failed` with the error and exponential backoff (5 min … 6 h); "Ulangi yang Gagal" re-queues. Auth errors (revoked/invalid token) stop the run without penalising files. Deleting a file in the app never deletes the Drive copy (Drive = archive). One run at a time (mutex).
    - **UI:** Settings → Google Drive (connection, folder layout, per-tab counts, last run, failures) and a small status line under every file thumbnail ("Tersimpan di Drive / Menunggu / Gagal").
    - **Tested** against a local fake of Google OAuth + Drive v3 (folders, multipart upload, 401/404/500 paths); **not yet against real Google** — do the first connection with a test Drive and check the folders.
    - **Permission seeding** is now tracked per key (`perm_seeded`), so `drive.manage` is added to existing installs without overriding customised roles.
    - **Not built:** syncing files to Drive for deleted records, downloading from Drive when the local copy is missing, moving files when a business is renamed (the old folder name is kept).
23. **Phase 9 (part) — production hardening & deployment (2026-10-05):**
    - `APP_ENV=production` makes the server **refuse to start** with a weak/default `JWT_SECRET` (< 32 chars or containing "change"), `DEV_LOGIN=true`, or an empty/`postgres` DB password; also switches Gin to release mode. `TRUSTED_PROXIES` (default private ranges) decides whose `X-Forwarded-For` is believed, so the per-IP limits see the real client behind Caddy.
    - **Seed passwords:** the first-time seed uses `SEED_ADMIN_PASSWORD` / `SEED_EMPLOYEE_PASSWORD`; in production, empty means random (admin's is printed once in the log, employees' are unusable until HR sets them in Settings). Development keeps `admin123` / `password123`.
    - **Login brute-force limit** (shared with the public attendance page): 5 failed attempts per account / 15 min and 20 per IP / 5 min → 429; only failures count. Security headers (`nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`) on API responses; Caddy adds HSTS and `Permissions-Policy` (geolocation for `/absen`).
    - **Deployment:** `docker-compose.prod.yml` (project name `dea-core-hcis-prod`, so it never touches the dev compose volumes) = Postgres (not published) + backend (non-root, healthcheck, ca-certificates + tzdata) + Caddy (automatic HTTPS, serves the React build, `/api` → backend, 12 MB body cap). `deploy/backup.sh`, `restore.sh`, `update.sh`. The whole stack, seed passwords, HTTPS redirect, headers, dev endpoints = 404, login limit, backup and restore were verified locally with `DOMAIN=localhost`. Guides: `docs/DEPLOY.md`, `docs/TESTING.md`.
    - **Still open:** load test, ZAP/pentest, CI pipeline (GitHub Actions), forced password change on first login, 2FA, session revocation (JWT is stateless, 24 h).

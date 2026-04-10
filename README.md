# WeeklyReport

A full-stack weekly project reporting platform for engineering teams. Team members file structured weekly reports against their assigned projects, managers review and approve them, and everyone gets a live dashboard view of team health — risks, blockers, completion rates, and submission trends.

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Backend](#backend)
  - [Frontend](#frontend)
  - [Running Both Together](#running-both-together)
- [Environment Variables](#environment-variables)
- [Database](#database)
- [API Reference](#api-reference)
- [Authentication](#authentication)
- [Key Concepts](#key-concepts)
- [Roles & Permissions](#roles--permissions)
- [Development Notes](#development-notes)

---

## Overview

WeeklyReport is designed for project-driven teams (originally built for Yokogawa SCS) where each engineer works across multiple active projects simultaneously. Every week, the system auto-creates a draft report for each user. Engineers fill in their project updates — schedules, issue items, progress notes, risk levels, and completion percentages — then submit for manager approval.

**Core workflow:**

```
Auto-created Draft → Engineer edits → Submitted → Manager reviews → Approved / Rejected
```

If rejected, the engineer receives a notification with the manager's comment and can revise and resubmit.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11+, FastAPI 0.115, Uvicorn |
| Database | SQLite (WAL mode, FK enforcement) |
| Auth | JWT (HS256) via `python-jose`, bcrypt passwords via `passlib` |
| Frontend | React 18, TypeScript, Vite |
| Styling | Vanilla CSS design system (Google Workspace aesthetic) |
| State | Zustand |
| Routing | React Router v6 |
| Date utils | `isoweek` (Python), custom hooks (frontend) |

No ORM is used. All SQL is written by hand against a context-managed SQLite connection with `dict_factory` row mapping.

---

## Project Structure

```
.
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI app factory, middleware, router registration
│   │   ├── core/
│   │   │   ├── config.py            # DB path, JWT config, KST timezone, week-start helper
│   │   │   ├── security.py          # bcrypt hashing, JWT encode/decode
│   │   │   └── deps.py              # FastAPI dependency: get_current_user, require_admin
│   │   ├── db/
│   │   │   ├── session.py           # get_db() context manager, dict_factory
│   │   │   └── init.py              # DDL (CREATE TABLE IF NOT EXISTS), seed data, _ensure_current_week_reports()
│   │   └── routers/
│   │       ├── auth.py              # POST /api/auth/token, GET /api/auth/me, POST /api/users/change-password
│   │       ├── dashboard.py         # GET /api/dashboard
│   │       ├── reports.py           # CRUD for reports, project entries, comments, approval actions
│   │       ├── project_record.py    # Project-level persistent records (milestones, risk log, history)
│   │       ├── report_carry.py      # Carry-forward logic (copy last week's project data into new report)
│   │       ├── projects.py          # CRUD for projects and assignee management
│   │       ├── schedule.py          # CRUD for personal schedule entries
│   │       ├── users.py             # List users, admin update, password change
│   │       ├── notifications.py     # List, mark-read-one, mark-all-read
│   │       └── misc.py              # GET /api/search, GET /api/analytics/team-overview, GET /api/lookups
│   ├── requirements.txt
│   └── weekly_report.db             # SQLite file (auto-created on first run, gitignore this)
│
└── frontend/
    ├── index.html
    ├── package.json
    └── src/
        ├── main.tsx
        ├── App.tsx                  # Router setup, ToastProvider
        ├── index.css                # Full design system (tokens, components, responsive)
        ├── api/
        │   └── index.ts             # All API calls, axios instance, 401 interceptor
        ├── store/
        │   └── index.ts             # Zustand stores: useAuthStore, useAppStore
        ├── types/
        │   └── index.ts             # All TypeScript interfaces
        ├── hooks/
        │   ├── useDates.ts          # Week label formatting, date helpers
        │   └── useReportModal.tsx   # Shared report-open + approve modal logic
        ├── utils/
        │   └── avatar.ts            # Deterministic avatar colors, initials, page title map
        ├── components/
        │   ├── layout/
        │   │   ├── AppShell.tsx     # Auth boot, sidebar/topbar wrapper, document.title updates
        │   │   ├── Sidebar.tsx      # Navigation, mobile overlay drawer
        │   │   └── Topbar.tsx       # Search, notifications, account menu, breadcrumb
        │   └── ui/
        │       ├── index.tsx        # StatusChip, ProgressBar, BarChart, Spinner, TableSkeleton, EmptyState
        │       ├── Modal.tsx        # Base modal component
        │       ├── Toast.tsx        # Toast provider with auto-dismiss and manual dismiss
        │       ├── ReportEditor.tsx # Full report read/write editor (the heaviest component)
        │       ├── ApproveModal.tsx # Manager approval/rejection modal
        │       └── CarryForwardModal.tsx  # Copy previous week's project data
        └── pages/
            ├── Login.tsx
            ├── Dashboard.tsx        # Team overview, stat cards, blockers, submission chart
            ├── MyReport.tsx         # Current user's weekly report editor
            ├── TeamReports.tsx      # All reports by week tab
            ├── Projects.tsx         # Project list with filter + admin CRUD
            ├── ProjectRecord.tsx    # Per-project persistent history, milestones, risk log
            ├── Analytics.tsx        # 8-week trends, project activity table
            ├── Calendar.tsx         # Monthly calendar with personal schedule entries
            └── Members.tsx          # User list, admin user edit
```

---

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 18+

### Backend

```bash
cd backend

# Create and activate a virtual environment (recommended)
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start the API server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The database file (`weekly_report.db`) is created automatically on first startup. Seed data (ranks, statuses, a default admin user) is inserted by `init_db()` if the tables are empty.

**Default admin credentials (from seed data):**
> Check `backend/app/db/init.py` for the seeded email and default password. Change this immediately in any non-local environment.

The interactive API docs are available at:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

### Frontend

```bash
cd frontend

npm install
npm run dev
```

The dev server starts at `http://localhost:5173` and proxies API calls to `http://localhost:8000` (configure in `vite.config.ts` if the backend runs on a different port).

### Running Both Together

Run each in a separate terminal. The frontend dev server handles hot-reload; the backend uses `--reload` for the same effect.

For production, build the frontend and serve the static files from FastAPI's `StaticFiles` mount (already configured in `main.py` when `backend/app/static/` exists):

```bash
cd frontend
npm run build
# Output lands in frontend/dist — copy to backend/app/static/
cp -r dist/* ../backend/app/static/
```

---

## Environment Variables

All configuration is via environment variables with sensible defaults for local development.

| Variable | Default | Description |
|---|---|---|
| `SECRET_KEY` | `yokogawa-weekly-report-secret-key-2025-change-in-prod` | JWT signing secret. **Must be changed in production.** |
| `WEEKLY_REPORT_DB` | `backend/weekly_report.db` | Absolute or relative path to the SQLite database file. |

Set them in your shell, a `.env` file (with `python-dotenv` if added), or your deployment environment:

```bash
export SECRET_KEY="your-long-random-secret-here"
export WEEKLY_REPORT_DB="/data/weekly_report.db"
```

---

## Database

SQLite with WAL journal mode and foreign key enforcement enabled on every connection. The schema is applied via `CREATE TABLE IF NOT EXISTS` in `init_db()`, making it safe to call on every startup.

### Core Tables

| Table | Purpose |
|---|---|
| `users` | Team members. `is_admin=1` unlocks admin endpoints. Soft-deleted via `is_deleted`. |
| `ranks` | Seniority levels (사원, 대리, 과장, 차장, 부장…) with sort order. |
| `projects` | Registered projects. Supports `active`, `on_hold`, `completed`, `cancelled` statuses. |
| `project_assignments` | Many-to-many: which users are assigned to which projects. |
| `reports` | One row per user per week (`UNIQUE(owner_id, week_start)`). Status flows: 1=draft → 2=submitted → 3=approved / 4=rejected. |
| `report_projects` | A user's update for a specific project within a specific report. Holds `risk_level`, `completion_pct`, `remarks`. |
| `project_schedule` | Milestone/schedule rows attached to a `report_project`. |
| `issue_item` | Issues tracked within a report's project entry. |
| `issue_progress` | Sub-progress items within an issue. |
| `report_versions` | JSON snapshots saved on each submit/approve/reject event. |
| `report_comments` | Threaded comments on reports, with `@mention` support. |
| `notifications` | Fan-out notification rows per user (submit, approve, reject, mention, blocker). |
| `personal_schedule` | Individual out-of-office / travel / training entries shown on the calendar. |
| `project_milestones` | Persistent project-level milestones (not per-report). |
| `report_summaries` | Materialised view-like table: cached `total_projects`, `risk_count`, `blocker_count`, `avg_completion` per report. Updated on save. |
| `report_search` | SQLite FTS5 virtual table for full-text search across report content. |

### Week Boundary Convention

Weeks start on **Sunday**. The `sunday_of_week(d: date)` function in `config.py` returns the Sunday of any given date's week. All `week_start` columns store `YYYY-MM-DD` ISO strings.

Auto-creation of draft reports happens on startup and on each `/api/dashboard` request via `_ensure_current_week_reports()`.

---

## API Reference

All endpoints require a `Bearer` token except `POST /api/auth/token`.

### Authentication

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/token` | Login. Accepts `application/x-www-form-urlencoded` (`username`, `password`). Returns `access_token`. |
| `GET` | `/api/auth/me` | Returns the current user's full profile including department. |

### Dashboard

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/dashboard` | Current week's team reports, pending approvals, blockers, 8-week submission stats. |

### Reports

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/reports` | All reports visible to the current user. |
| `GET` | `/api/reports/{id}` | Full report with all project entries, schedules, issues, comments, history. |
| `PUT` | `/api/reports/{id}` | Save report content (project entries, issue items, schedules). Creates a version snapshot. |
| `POST` | `/api/reports/{id}/submit` | Submit for approval. Triggers notifications. |
| `POST` | `/api/reports/{id}/approve` | Approve (admin only). |
| `POST` | `/api/reports/{id}/reject` | Reject with comment (admin only). |
| `POST` | `/api/reports/{id}/comments` | Add a comment. `@name` mentions trigger notifications. |
| `POST` | `/api/reports/carry-forward` | Copy project entries from the previous week into the current draft. |

### Projects

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/projects` | List projects. Supports `?status=`, `?q=`, `?mine=true` filters. |
| `POST` | `/api/projects` | Create project (any authenticated user). |
| `PUT` | `/api/projects/{id}` | Update project + reassign members. |
| `GET` | `/api/projects/{id}/record` | Full project record: milestones, risk log, report history. |

### Users

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/users` | List all non-deleted users with rank and manager info. |
| `PUT` | `/api/users/{id}` | Update user (admin only). Can also reset password. |
| `POST` | `/api/users/change-password` | Self-service password change. |

### Schedule

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/schedule` | Current user's schedule entries. Supports `?year=&month=` filter. |
| `POST` | `/api/schedule` | Create a schedule entry. |
| `PUT` | `/api/schedule/{id}` | Update a schedule entry. |
| `DELETE` | `/api/schedule/{id}` | Delete a schedule entry. |

### Notifications

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/notifications` | Latest 50 notifications for the current user. |
| `POST` | `/api/notifications/read-all` | Mark all notifications as read. |
| `PATCH` | `/api/notifications/{id}/read` | Mark one notification as read. |

### Analytics & Lookups

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/analytics/team-overview` | 8-week submission trends, risk trends, top projects by activity. Supports `?weeks=N`. |
| `GET` | `/api/search?q=` | Full-text search across report content (FTS5). Minimum 2 characters. |
| `GET` | `/api/lookups` | Static reference data: ranks, report statuses, schedule types, tags, departments, user list. |

---

## Authentication

JWT tokens are issued on login with an 8-hour expiry. The token must be sent as `Authorization: Bearer <token>` on every protected request.

The frontend stores the token in Zustand (persisted to `localStorage`). An Axios interceptor in `api/index.ts` attaches the header automatically and redirects to `/login` on any 401 response.

On the backend, `get_current_user` (FastAPI dependency) decodes the JWT, validates the `sub` claim, and queries the user row. `require_admin` wraps it for admin-only endpoints.

---

## Key Concepts

### Report Lifecycle

1. Every Sunday, `_ensure_current_week_reports()` auto-creates a `status_id=1` (draft) report for every active user.
2. The engineer opens **My Report**, fills in project updates, and saves incrementally (no data loss on navigation).
3. On submit, `status_id` moves to `2` and a notification is sent to admins.
4. An admin opens the report from the Dashboard or Team Reports, reviews it, and approves (`status_id=3`) or rejects (`status_id=4`) with a comment.
5. On rejection, the engineer is notified and can edit and resubmit.

### Report Editor Structure

Each report contains **project entries** (`report_projects`), which themselves contain:
- **Schedules** — milestone/timeline rows (`project_schedule`)
- **Issue items** — tracked issues with status, dates, details (`issue_item`)
- **Issue progress** — sub-items within an issue (`issue_progress`)
- **Risk level** — `normal` / `risk` / `blocker`
- **Completion percentage** — 0–100

Projects are grouped by `solution_product` in the editor UI.

### Carry Forward

The carry-forward feature (`/api/reports/carry-forward`) copies the previous week's project entries (schedules, issues, risk levels) into the current week's draft as a starting point, saving repetitive data entry for long-running projects.

### Project Record

Separate from weekly reports, each project has a **persistent record** (`/api/projects/{id}/record`) that aggregates: all-time milestone table, risk level history log, and a chronological list of all report entries across weeks. This gives a project-level view independent of who was reporting in a given week.

---

## Roles & Permissions

| Capability | Regular User | Admin |
|---|---|---|
| View own report | ✅ | ✅ |
| View all team reports | ✅ | ✅ |
| Edit own report | ✅ (draft/rejected only) | ✅ |
| Submit own report | ✅ | ✅ |
| Approve / reject reports | ❌ | ✅ |
| Create / edit projects | ✅ | ✅ |
| Edit other users | ❌ | ✅ |
| Reset user passwords | ❌ | ✅ |
| View analytics | ✅ | ✅ |

---

## Development Notes

**Adding a new router:** Create `backend/app/routers/my_feature.py`, define `router = APIRouter(...)`, add it to `backend/app/routers/__init__.py`, and register it in `main.py`.

**Database migrations:** There is no migration framework. Schema changes are applied by adding `ALTER TABLE` statements to `init_db()` guarded by a `try/except` (SQLite will error if the column already exists). For breaking changes, manage schema versions manually or adopt Alembic.

**CORS:** Currently set to `allow_origins=["*"]`. Restrict to your frontend origin before deploying to production.

**Secrets:** The default `SECRET_KEY` is committed to the codebase for local convenience. **Replace it with a securely generated random value in any shared or production environment.**

**Frontend API base URL:** Configured in `frontend/src/api/index.ts`. The Vite dev server proxies `/api/*` to `localhost:8000` — adjust `vite.config.ts` if needed.

**Time zone:** All server-side timestamps use KST (`Asia/Seoul`). `last_login_at` is stored as a KST string. Week boundaries are calculated in local date (no timezone conversion), so the week-start Sunday is consistent for Korean users.

**FTS search:** The `report_search` FTS5 table is populated/updated whenever report content is saved. The search endpoint uses SQLite's `MATCH` operator and ranks by relevance.

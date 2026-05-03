# Backend File Structure

> **Stack:** Python · FastAPI · SQLite (→ PostgreSQL) · psycopg2 / sqlite3 · JWT (python-jose) · bcrypt (passlib) · openpyxl
> **Entry point:** `uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`

---

## Top-level overview

```
backend/
├── main.py               # Application factory — wires everything together
├── core/                 # Config, auth logic, shared dependencies
├── db/                   # Database connection + schema initialisation
├── routers/              # API route handlers (one file per domain)
└── static/               # Built frontend assets served by FastAPI
```

---

## `main.py`

The FastAPI application factory. Responsible for:

- Creating the `FastAPI` app instance with title, version, and description metadata
- Attaching `CORSMiddleware` (currently allows all origins — tighten for production)
- Registering all 12 routers with `app.include_router()`
- Running `init_db()` and `_ensure_current_week_reports()` on startup via `@app.on_event("startup")`

Nothing else imports from `main.py`. It is the composition root only.

---

## `core/`

Shared infrastructure used across the whole application. No route logic lives here.

```
core/
├── __init__.py
├── config.py      # Environment variables and app-wide constants
├── deps.py        # FastAPI dependency functions (auth guards)
└── security.py    # Password hashing and JWT encode/decode
```

### `core/config.py`

Centralises all configuration loaded from environment variables, with safe defaults for development. Exports:

| Name | Type | Purpose |
|------|------|---------|
| `DB_PATH` | `Path` | Absolute path to the SQLite `.db` file. Controlled by `WEEKLY_REPORT_DB` env var. **Replaced by `DATABASE_URL` after PostgreSQL migration.** |
| `SECRET_KEY` | `str` | JWT signing key. Controlled by `SECRET_KEY` env var. Change in production. |
| `ALGORITHM` | `str` | JWT algorithm — hardcoded `"HS256"` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `int` | Token lifetime — `480` minutes (8 hours) |
| `LLM_BASE_URL` | `str` | Base URL of the local LLM server (e.g. LM Studio). Controlled by `LLM_BASE_URL` env var. |
| `LLM_MODEL` | `str` | Model identifier string passed to the LLM API. Controlled by `LLM_MODEL` env var. |
| `LLM_TIMEOUT_SECONDS` | `float` | HTTP timeout for LLM requests. Controlled by `LLM_TIMEOUT_SECONDS` env var. |
| `KST` | `ZoneInfo` | Korea Standard Time zone object — used to stamp `last_login_at` |
| `sunday_of_week(d)` | `function` | Given any date, returns the Sunday that starts that ISO week. Used everywhere weekly report week-start dates are computed. |

### `core/deps.py`

FastAPI dependency injection functions. Imported by routers via `Depends(...)`.

**`get_current_user(token)`** — Validates the Bearer JWT from the `Authorization` header, decodes the `sub` claim as a user ID, and fetches the full user row from the database (joined with `ranks`). Raises `HTTP 401` if the token is invalid or the user no longer exists. Returns the full user dict so routes can read `current_user["id"]`, `current_user["is_admin"]`, etc.

**`require_admin(current_user)`** — Wraps `get_current_user` and additionally raises `HTTP 403` if `is_admin` is falsy. Used by admin-only endpoints in `users.py`, `teams.py`, `projects.py`, and `llm.py`.

### `core/security.py`

Stateless cryptography helpers. No database access.

**`verify_password(plain, hashed)`** — bcrypt verification via passlib.

**`hash_password(plain)`** — bcrypt hash generation. Used when creating or updating user passwords.

**`create_access_token(data, expires_delta)`** — Encodes a JWT with the given payload and an expiry timestamp. Forces `sub` to a string to comply with the JWT spec.

**`decode_token(token)`** — Decodes and validates a JWT. Raises `jose.JWTError` on failure; the caller (`deps.py`) catches this and returns `HTTP 401`.

---

## `db/`

Database connection management and schema lifecycle.

```
db/
├── __init__.py    # Re-exports init_db and _ensure_current_week_reports
├── session.py     # Connection context manager (get_db)
└── init.py        # Schema DDL, triggers, indexes, seed data
```

### `db/session.py`

Provides `get_db()`, a `contextlib.contextmanager` used as a context manager (`with get_db() as conn`) in every router and dependency. Current implementation:

- Opens a `sqlite3` connection to `DB_PATH`
- Sets `row_factory = dict_factory` so all fetched rows are plain dicts (accessible as `row["column_name"]`)
- Enables `PRAGMA journal_mode=WAL` for concurrent read performance
- Enables `PRAGMA foreign_keys=ON` to enforce FK constraints
- Auto-commits on clean exit, rolls back on exception

> **Migration note:** After the PostgreSQL migration, this file is replaced with a `psycopg2`-based implementation using `RealDictCursor` and a thin `_DbWrapper` class. The `with get_db() as conn` call pattern stays identical across all routers — no router changes are needed.

### `db/init.py`

Called once on startup. Idempotent — safe to re-run on a populated database.

**`init_db()`** — Executes the full schema DDL as a single `executescript()` call. Creates all tables, indexes, FTS5 virtual table (`report_search`), and all triggers if they don't already exist. After DDL, runs two data-migration statements that promote legacy free-text `schedule` and `progress` fields into the structured `project_schedule` and `issue_item` tables. Then seeds lookup tables and reference data (ranks, report_status, schedule_type, departments, LLM settings, users, teams, team roles, tags) if they are empty.

**`_ensure_current_week_reports()`** — Called on startup and on every dashboard request. Iterates every Sunday from 2025-04-06 through the current week, and for every active user, inserts a draft report row if one doesn't already exist. This guarantees every user always has a report for the current week without manual creation.

> **Migration note:** `init.py` is superseded by `init_pg.py` after the PostgreSQL migration. The PostgreSQL version splits the monolithic `executescript()` into individual statements, rewrites all triggers in PL/pgSQL, replaces the FTS5 virtual table with a `tsvector` column and GIN index, and converts all `INTEGER` boolean flags to native `BOOLEAN` columns.

---

## `routers/`

One file per feature domain. All routers are registered in `main.py` and re-exported from `routers/__init__.py`.

```
routers/
├── __init__.py        # Imports and __all__ list of all routers
├── auth.py            # Login, token refresh, current-user info
├── dashboard.py       # Dashboard data aggregation
├── reports.py         # Report CRUD, submission, approval workflow
├── projects.py        # Project master data + Excel import/export
├── project_record.py  # Project-level persistent milestones and issues
├── report_carry.py    # Carry-forward and project-issue linking
├── schedule.py        # Personal schedule (calendar) CRUD
├── users.py           # User management (admin) + self-service password change
├── teams.py           # Team and team-membership management
├── notifications.py   # In-app notification read/dismiss
├── llm.py             # LLM-powered report summary generation + settings
└── misc.py            # Search, analytics, and lookup endpoints
```

---

### `routers/auth.py`

**Prefix:** `/api/auth`

Handles authentication and session identity.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/auth/token` | None | Login with email + password. Returns JWT `access_token` and basic user info. Stamps `last_login_at` in KST. |
| `GET` | `/api/auth/me` | Required | Returns the full profile of the currently authenticated user, including rank name and team memberships. |

---

### `routers/dashboard.py`

**Prefix:** `/api`

Assembles the data payload for the dashboard page in a single request to avoid waterfall fetches on the frontend.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/dashboard` | Required | Returns `schedule` (next 14 days), `issue_updates` (last 7 days from my projects), `team_status` (all team members + their report submission status for the current week), `week_start`, and `current_user_id`. Calls `_ensure_current_week_reports()` on every request. |

---

### `routers/reports.py`

**Prefix:** `/api/reports`

The largest router. Manages the full report lifecycle from draft to approval.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/reports` | Required | List reports with optional filters: `week_start`, `owner_id`, `status_id`, `team_id`. |
| `GET` | `/api/reports/{id}` | Required | Full report detail including all `report_projects`, `project_schedules`, `issue_items`, `issue_progress`, and `report_comments`. |
| `POST` | `/api/reports` | Required | Create a new report (draft) for the current week. |
| `PUT` | `/api/reports/{id}` | Required | Full upsert of a report's project list, schedules, and issue items. Replaces all `report_projects` for the report. |
| `POST` | `/api/reports/{id}/submit` | Required | Submit a draft report for approval. Sets `status_id=2` and stamps `submitted_at`. |
| `POST` | `/api/reports/{id}/approve` | Admin | Approve a submitted report. Sets `status_id=3`, stamps `approved_at`, and records the approver. |
| `POST` | `/api/reports/{id}/reject` | Admin | Reject a submitted report with a manager comment. Sets `status_id=4`. |
| `GET` | `/api/reports/{id}/comments` | Required | List all comments on a report, threaded by `parent_comment_id`. |
| `POST` | `/api/reports/{id}/comments` | Required | Post a comment on a report. Parses `@mention` patterns in the comment body and inserts into `comment_mentions` (which triggers the notification system). |
| `DELETE` | `/api/reports/{report_id}/comments/{comment_id}` | Required | Soft-delete a comment (own comments only; admins can delete any). |

**Internal helper:** `_full_report(conn, report_id)` — builds the complete nested report dict. Shared with `llm.py` for AI summary generation.

---

### `routers/projects.py`

**Prefix:** `/api/projects`

Manages the project master data registry. Projects are shared entities referenced by all reports.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/projects` | Required | List all active projects with optional `status` filter. Includes assignee list. |
| `GET` | `/api/projects/{id}` | Required | Single project detail with full assignee list. |
| `POST` | `/api/projects` | Admin | Create a new project with optional `assignee_ids`. |
| `PUT` | `/api/projects/{id}` | Admin | Update project metadata. |
| `DELETE` | `/api/projects/{id}` | Admin | Soft-delete a project. |
| `POST` | `/api/projects/{id}/assign` | Admin | Add or update a user's assignment to a project. |
| `DELETE` | `/api/projects/{id}/assign/{user_id}` | Admin | Remove a user from a project. |
| `GET` | `/api/projects/export` | Admin | Export all project data (including milestones, issues, progress) to a formatted Excel workbook (`.xlsx`) via `openpyxl`. |
| `POST` | `/api/projects/import` | Admin | Import projects, milestones, issues, and progress from an uploaded Excel file. Returns an `ImportSummary` with created/updated counts and warnings. |

---

### `routers/project_record.py`

**Prefix:** `/api/projects`

Manages the **persistent** project-level records: milestones and issues. Unlike report project data (which is per-week), these records are shared across all reports and all team members for a given project.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/projects/{id}/milestones` | Required | List all milestones for a project. |
| `POST` | `/api/projects/{id}/milestones` | Required | Create a milestone. |
| `PUT` | `/api/projects/{id}/milestones/{mid}` | Required | Update a milestone. |
| `DELETE` | `/api/projects/{id}/milestones/{mid}` | Required | Soft-delete a milestone. |
| `GET` | `/api/projects/{id}/issues` | Required | List all persistent issues for a project, including their progress entries. |
| `POST` | `/api/projects/{id}/issues` | Required | Create a project issue. |
| `PUT` | `/api/projects/{id}/issues/{iid}` | Required | Update an issue's title, status, priority, or dates. |
| `DELETE` | `/api/projects/{id}/issues/{iid}` | Required | Soft-delete a project issue. |
| `POST` | `/api/projects/{id}/issues/{iid}/progress` | Required | Add a progress entry to a project issue. |
| `PUT` | `/api/projects/{id}/issues/{iid}/progress/{pid}` | Required | Update an issue progress entry. |
| `DELETE` | `/api/projects/{id}/issues/{iid}/progress/{pid}` | Required | Soft-delete a progress entry. |

---

### `routers/report_carry.py`

**Prefix:** `/api/reports`

Handles two related workflows that reduce data entry burden when starting a new week's report.

**Carry-forward** — lets a user pull their previous week's project list and open issues into the new report without re-entering everything manually.

**Issue linking** — lets a user link persistent `project_issues` records into a specific `report_project`, creating `issue_item` entries inside the report from the shared tracker.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/reports/{id}/carry-preview` | Required | Returns the previous week's report content (projects, open issues) so the user can choose what to carry forward. |
| `POST` | `/api/reports/{id}/carry-forward` | Required | Copies selected projects and optionally their open issues from the previous week's report into the current one. Skips projects already on the report. |
| `GET` | `/api/reports/{id}/project-issues` | Required | Lists available `project_issues` from all projects assigned to this report that can be linked. |
| `POST` | `/api/reports/{id}/link-issues` | Required | Links selected `project_issues` into a `report_project` as `issue_item` rows. |

---

### `routers/schedule.py`

**Prefix:** `/api/schedule`

Personal calendar management (vacation, business trips, remote work, etc.).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/schedule` | Required | List the current user's schedule entries, optionally filtered by `year` and `month`. |
| `POST` | `/api/schedule` | Required | Create a new schedule entry. Validates that `end_date >= start_date`. |
| `PUT` | `/api/schedule/{id}` | Required | Update a schedule entry (own entries only). |
| `DELETE` | `/api/schedule/{id}` | Required | Delete a schedule entry (own entries only). |
| `GET` | `/api/schedule/types` | Required | List all schedule type lookups (e.g. 출장, 휴가). |

---

### `routers/users.py`

**Prefix:** `/api/users`

User management split into admin operations (CRUD) and self-service (profile, password).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/users` | Required | List all non-deleted users with rank and team info. |
| `GET` | `/api/users/{id}` | Required | Single user profile with rank, manager, and team memberships. |
| `POST` | `/api/users` | Admin | Create a new user. Hashes the provided password with bcrypt. |
| `PUT` | `/api/users/{id}` | Admin | Update user profile fields. Optionally resets password if `new_password` provided. |
| `DELETE` | `/api/users/{id}` | Admin | Soft-delete a user (`is_deleted=TRUE`). |
| `POST` | `/api/users/change-password` | Required | Self-service password change. Verifies current password before accepting the new one. |

---

### `routers/teams.py`

**Prefix:** `/api/teams`

Team structure management and membership assignment. Admin-only write operations.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/teams` | Required | List all teams with department name, manager name, and member count. |
| `GET` | `/api/teams/{id}` | Required | Single team with full member list including roles and primary-team flag. |
| `POST` | `/api/teams` | Admin | Create a new team. Creates a department record if `department_id` is not provided. |
| `PUT` | `/api/teams/{id}` | Admin | Update team name, department, parent team, and manager. |
| `PUT` | `/api/teams/{id}/members` | Admin | Replace the entire member list for a team. Deletes removed members, inserts new ones. |

---

### `routers/notifications.py`

**Prefix:** `/api/notifications`

In-app notification management. Notifications are created automatically by database triggers (on `@mention` in a comment) and are consumed here.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/notifications` | Required | List the current user's last 50 non-deleted notifications, newest first. |
| `POST` | `/api/notifications/read-all` | Required | Mark all of the current user's notifications as read. |
| `PATCH` | `/api/notifications/{id}/read` | Required | Mark a single notification as read. |

---

### `routers/llm.py`

**Prefix:** `/api/llm`

LLM integration for AI-generated weekly report summaries in Korean. Connects to a local LLM server (e.g. LM Studio) configured via `llm_settings`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/llm/status` | Required | Checks whether the configured LLM server is reachable. Returns `{"available": bool}`. |
| `POST` | `/api/llm/summarize/{report_id}` | Required | Calls the LLM with the full report context (built via `_full_report()`) to generate a Korean summary and highlights array. Stores the result in `report_ai_insights`. Returns cached result if already generated. |
| `GET` | `/api/llm/settings` | Admin | Returns current LLM configuration (base_url, model, timeout, system_prompt). |
| `PUT` | `/api/llm/settings` | Admin | Update LLM configuration. Changes take effect on the next summarise call. |

The system prompt is stored in `llm_settings` and instructs the model to return a specific JSON shape: `{"summary": "...", "highlights": ["...", "...", "..."]}`. The frontend parses this structure to render the AI summary card.

---

### `routers/misc.py`

**Prefix:** `/api`

A catch-all for endpoints that don't belong to a single entity domain: search, analytics, and lookup tables.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/search` | Required | Full-text search across report content (remarks, issue items, comments) using the `report_search` FTS index. Requires `q` query param (min 2 chars). Returns up to 20 results with report week and owner name. |
| `GET` | `/api/analytics/team-overview` | Required | Aggregated weekly stats for the past N weeks (default 8): total reports, submitted, approved, total risks, total blockers, avg completion. Used by the Team View KPI bar. |
| `GET` | `/api/analytics/weekly-diff` | Required | Compares two consecutive weeks for a given report, returning field-level diffs for each project (schedule changes, issue changes, completion delta). Used to power the LLM summarise context. |
| `GET` | `/api/lookups/ranks` | Required | Returns all rank lookup rows ordered by `sort_order`. |
| `GET` | `/api/lookups/report-status` | Required | Returns all report status rows (초안, 제출, 승인, 반려). |
| `GET` | `/api/lookups/schedule-types` | Required | Returns all personal schedule type rows. |

---

## `static/`

Built frontend assets served directly by FastAPI via `StaticFiles`. This directory is populated by `npm run build` in the frontend project and copied here for single-process deployment.

```
static/
├── index.html              # SPA entry point — served for all non-API routes
└── assets/
    ├── index-*.css         # Hashed Vite bundle (styles)
    └── index-*.js          # Hashed Vite bundle (JavaScript)
```

FastAPI serves the SPA by mounting `StaticFiles` on `/` with `html=True`, so all client-side routing (React Router) is handled by returning `index.html` for unknown paths.

---

## Environment variables reference

| Variable | Default | Description |
|----------|---------|-------------|
| `WEEKLY_REPORT_DB` | `../../weekly_report.db` | Path to SQLite database file. **Removed after PostgreSQL migration.** |
| `DATABASE_URL` | — | PostgreSQL connection string. **Added for PostgreSQL migration.** |
| `SECRET_KEY` | `yokogawa-weekly-report-secret-key-2025-change-in-prod` | JWT signing secret. **Must be changed in production.** |
| `LLM_BASE_URL` | `http://127.0.0.1:1234/v1` | Base URL of the local OpenAI-compatible LLM server |
| `LLM_MODEL` | `google/gemma-4-31b:2` | Model identifier sent to the LLM API |
| `LLM_TIMEOUT_SECONDS` | `90` | Request timeout for LLM calls |

---

## Request lifecycle

```
HTTP request
    │
    ├─ FastAPI router matches path
    │
    ├─ Depends(get_current_user)       ← core/deps.py
    │       └─ decode JWT              ← core/security.py
    │       └─ SELECT user FROM db     ← db/session.py
    │
    ├─ Route handler executes
    │       └─ with get_db() as conn   ← db/session.py
    │               └─ SQL queries
    │
    └─ Response serialised as JSON
```

Every authenticated route opens its own database connection scoped to the request via the `with get_db() as conn` context manager. There is no connection pool in the current SQLite implementation — connections are opened and closed per-request. After the PostgreSQL migration, connection pooling can be added to `session.py` using `psycopg2.pool.ThreadedConnectionPool` without any changes to router code.

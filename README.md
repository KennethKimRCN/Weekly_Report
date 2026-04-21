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
- [Generate Summary — How It Works](#generate-summary--how-it-works)
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
| Local LLM | LM Studio OpenAI-compatible API (`/v1`) |

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
| `LLM_BASE_URL` | `http://127.0.0.1:1234/v1` | Default LM Studio-compatible API base URL used to seed admin LLM settings. |
| `LLM_MODEL` | `google/gemma-4-31b:2` | Default model name used to seed admin LLM settings on first startup. |
| `LLM_TIMEOUT_SECONDS` | `90` | Default timeout used to seed admin LLM settings on first startup. |

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
| `llm_settings` | Admin-managed LM Studio settings: `base_url`, `model`, `timeout_seconds`, and editable `system_prompt`. |
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

### LLM

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/llm/status` | Check whether the currently configured LM Studio endpoint is reachable. |
| `POST` | `/api/llm/reports/{report_id}/summary` | Generate a weekly comparison summary for a report using the configured local LLM. |
| `GET` | `/api/llm/settings` | Read saved LLM settings (admin only). |
| `PUT` | `/api/llm/settings` | Update `base_url`, `model`, `timeout_seconds`, and `system_prompt` (admin only). |
| `GET` | `/api/llm/models` | Fetch available models from the configured LM Studio endpoint (admin only). |

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

### Local LLM Summaries

The **My Report** page includes a `Generate Summary` action that compares the current report against the previous week's report and asks a locally hosted LLM (via LM Studio) to produce a Korean summary and bullet-point highlights.

See [Generate Summary — How It Works](#generate-summary--how-it-works) for the full technical deep-dive: data preparation, prompt construction, retry logic, and fallback behaviour.

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
| Configure LLM settings | ❌ | ✅ |

---

## Generate Summary — How It Works

This section is a full technical walkthrough of `POST /api/llm/reports/{report_id}/summary` — everything from the database query to the bytes sent to LM Studio and the fallback path taken when the model fails.

All code lives in `backend/app/routers/llm.py`.

---

### Overview

```
Request
  └─ 1. Load current report + previous report from DB
  └─ 2. Strip each report down to an LLM-friendly snapshot
  └─ 3. Wrap both snapshots into a JSON prompt payload
  └─ 4. Assemble system prompt + user message
  └─ 5. POST to LM Studio /v1/chat/completions (primary call)
         ├─ Success → parse JSON → return summary + highlights
         └─ Failure
              ├─ Non-e2b model → return fallback (no LLM)
              └─ e2b model → retry with flattened single-message format
                               ├─ Success → return summary + highlights
                               └─ Failure → return fallback (no LLM)
```

---

### Step 1 — Loading the two reports

The endpoint resolves two reports for the requesting user:

**Current report** — loaded by `report_id` using `_full_report(conn, report_id)`, the same helper used by the report viewer. This returns the complete nested structure: project entries, schedules, issue items, issue progress rows, comments, and metadata.

**Previous report** — found by querying for the most recent report owned by the same `owner_id` with a `week_start` strictly earlier than the current report's:

```sql
SELECT id FROM reports
WHERE owner_id = ? AND week_start < ? AND is_deleted = 0
ORDER BY week_start DESC
LIMIT 1
```

If no previous report exists (e.g. first week), `previous_report` is `None` and all comparison fields become empty arrays.

---

### Step 2 — Building the project snapshot (`_project_snapshot`)

Each full report is passed through `_project_snapshot()`, which strips away everything the LLM doesn't need (IDs, UI metadata, assignees, department info) and keeps only the content-bearing fields:

```python
{
  "project_name": str,
  "solution_product": str | None,
  "remarks": str | None,
  "project_status": str,
  "issues": [
    {
      "title": str,
      "status": str,
      "priority": str,            # "normal" | "high" | "critical"
      "start_date": str,
      "end_date": str | None,
      "details": str | None,
      "progresses": [
        {
          "title": str,
          "start_date": str,
          "end_date": str | None,
          "details": str | None,
          "author_name": str
        }
      ]
    }
  ]
}
```

Notably **excluded** from the snapshot: schedule items, completion percentages, risk levels, version history, comments — these are considered UI/workflow data rather than narrative content the LLM needs to summarise.

---

### Step 3 — Building the prompt payload

The two snapshots are wrapped into a single JSON object:

```json
{
  "current_week": "2026-04-14",
  "previous_week": "2026-04-07",
  "owner_name": "홍길동",
  "current_projects": [ ...snapshot of current week... ],
  "previous_projects": [ ...snapshot of previous week, or []... ]
}
```

This is serialised with `json.dumps(..., ensure_ascii=False, indent=2)` and embedded directly into the user message. The `indent=2` pretty-printing makes it easier for models with good instruction following to parse, at the cost of a larger token count.

---

### Step 4 — Assembling the messages

**System prompt** (configurable by admins via `PUT /api/llm/settings`, stored in the `llm_settings` table, defaults to):

> You are an assistant that writes concise Korean weekly project summaries for an internal report. Compare the current week against the previous week, focus on issue movement, meaningful progress, newly added work, and items that still need attention. When you mention a current-week issue, use its exact issue title verbatim so the UI can link it. Return only valid JSON with this exact shape: `{"summary":"2-4 sentence Korean summary","highlights":["bullet 1","bullet 2","bullet 3"]}`.

The instruction to use verbatim issue titles is important — the frontend uses the returned highlight strings to hyperlink issue titles in the rendered summary.

**User message:**

```
현재 주차와 지난 주차 프로젝트 이슈 및 진행내역을 비교해 주세요.
문장은 자연스러운 한국어로 작성하고, 과장 없이 사실 기반으로 요약하세요.

[full JSON payload from Step 3]
```

**Primary call parameters:**

```json
{
  "model": "<configured model ID>",
  "temperature": 0.2,
  "messages": [
    { "role": "system", "content": "<system prompt>" },
    { "role": "user",   "content": "<user message + JSON payload>" }
  ]
}
```

`temperature: 0.2` keeps the output factual and consistent across runs while leaving room for natural language variation.

---

### Step 5 — Parsing the response

`_call_llm()` reads the first choice from the `/v1/chat/completions` response and passes the `content` string to `_extract_json_block()`, which:

1. Strips any markdown code fences (` ```json ... ``` `) the model may have wrapped around the output
2. Finds the first `{` and last `}` in the string — so the model can include preamble text and it will still parse correctly
3. Calls `json.loads()` on the extracted substring
4. Validates that `summary` is a non-empty string and `highlights` is a list
5. Truncates `highlights` to a maximum of 5 items and strips whitespace from each

A valid response the model should return:

```json
{
  "summary": "이번 주는 A 프로젝트의 현장 시운전 이슈가 해소되고 B 프로젝트에 신규 이슈가 추가되었습니다. ...",
  "highlights": [
    "A 프로젝트 — 현장 시운전 완료, 이슈 종료",
    "B 프로젝트 — 신규 이슈 '네트워크 구성 오류' 등록",
    "C 프로젝트 — 진행내역 2건 업데이트, 완료율 변동 없음"
  ]
}
```

---

### Step 6 — The e2b retry path

`google/gemma-4-e2b` (and any model whose ID contains `gemma-4-e2b`) is detected by `_is_e2b_model()`. This model does not reliably support the `system` role through LM Studio's inference channel — it produces a `Channel Error` at the LM Studio layer.

When the primary call fails for an e2b model, a retry is attempted with a **single flattened user message** that concatenates the system prompt directly into the user turn:

```json
{
  "model": "<model ID>",
  "temperature": 0.0,
  "top_p": 0.9,
  "max_tokens": 500,
  "messages": [
    {
      "role": "user",
      "content": "<system prompt>\n\nBelow is the weekly report comparison data.\nWrite the answer in Korean and return only valid JSON.\n\n<user message + JSON payload>"
    }
  ]
}
```

Key differences from the primary call:
- `temperature: 0.0` — fully deterministic, reduces the chance of malformed JSON
- `top_p: 0.9` — nucleus sampling for slight diversity without instability
- `max_tokens: 500` — hard cap, since e2b has a much smaller effective generation window
- Single `user` role — avoids the system-role channel error

> **Note on e2b context limits:** Even with the retry, `google/gemma-4-e2b` can fail on large reports because `json.dumps(..., indent=2)` of a report with many projects and issues can exceed ~1500–2000 tokens, which pushes against the model's effective context. `google/gemma-4-31b` handles this reliably because of its larger context window.

---

### Step 7 — The fallback summary

If all LLM calls fail (or the model is not e2b and the primary call fails), `_build_fallback_summary()` generates a deterministic Korean summary entirely in Python with no network calls.

It computes:
- Total issue count and progress count for both weeks
- Week-over-week deltas for both
- New issue titles (in current but not previous)
- Ongoing issue titles (in both current and previous)

Example fallback output:

```json
{
  "summary": "2026-04-14 주간에는 5개 프로젝트를 기준으로 이슈 12건과 진행내역 28건을 정리했습니다.",
  "highlights": [
    "이번 주 이슈 12건, 진행내역 28건이 집계되었습니다.",
    "지난주 대비 이슈는 +2건, 진행내역은 +5건 변화했습니다.",
    "새롭게 부각된 이슈: 네트워크 구성 오류, 현장 접근 지연",
    "연속 추적 중인 이슈: FAT 준비, 케이블 트레이 설치"
  ],
  "source": "fallback",
  "model": null,
  "previous_week_start": "2026-04-07"
}
```

The `"source": "fallback"` field lets the frontend display a different indicator (e.g. a muted badge instead of the LLM model name) so users know the summary was not AI-generated.

---

### Admin Configuration

Admins can configure all LLM behaviour from the sidebar under **Admin → LLM Settings**:

| Setting | Description |
|---|---|
| `base_url` | LM Studio server root, e.g. `http://localhost:1234/v1` |
| `model` | Exact model ID as returned by `/v1/models` — must match precisely |
| `timeout_seconds` | How long to wait for LM Studio before treating the call as failed |
| `system_prompt` | The full system prompt injected on every summary request |

Settings are stored in the `llm_settings` table (single row, `id=1`). If the row doesn't exist, the backend falls back to the values in `backend/app/core/config.py` (`LLM_BASE_URL`, `LLM_MODEL`, `LLM_TIMEOUT_SECONDS`).

The `GET /api/llm/models` endpoint calls LM Studio's `/v1/models` and returns the sorted list of loaded model IDs — useful for populating the model dropdown in the admin UI without having to copy-paste from LM Studio manually.

---



**Adding a new router:** Create `backend/app/routers/my_feature.py`, define `router = APIRouter(...)`, add it to `backend/app/routers/__init__.py`, and register it in `main.py`.

**Database migrations:** There is no migration framework. Schema changes are applied by adding `ALTER TABLE` statements to `init_db()` guarded by a `try/except` (SQLite will error if the column already exists). For breaking changes, manage schema versions manually or adopt Alembic.

**CORS:** Currently set to `allow_origins=["*"]`. Restrict to your frontend origin before deploying to production.

**Secrets:** The default `SECRET_KEY` is committed to the codebase for local convenience. **Replace it with a securely generated random value in any shared or production environment.**

**Frontend API base URL:** Configured in `frontend/src/api/index.ts`. The Vite dev server proxies `/api/*` to `localhost:8000` — adjust `vite.config.ts` if needed.

**Time zone:** All server-side timestamps use KST (`Asia/Seoul`). `last_login_at` is stored as a KST string. Week boundaries are calculated in local date (no timezone conversion), so the week-start Sunday is consistent for Korean users.

**FTS search:** The `report_search` FTS5 table is populated/updated whenever report content is saved. The search endpoint uses SQLite's `MATCH` operator and ranks by relevance.

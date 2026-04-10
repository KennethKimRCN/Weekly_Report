# 주간 보고서 시스템 v6

Fully modularised FastAPI + React/TypeScript weekly reporting platform.

## Quick start

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend (dev)
```bash
cd frontend
npm install
npm run dev          # http://localhost:5173  (proxies /api → :8000)
```

### Frontend (production build)
```bash
cd frontend
npm run build        # outputs to backend/app/static/
# then just run the backend — it serves the built SPA at /
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Default credentials
All 11 team members share the default password **`password123`**.  
Admin account: `khangnyon.kim@yokogawa.com`

Change all passwords before deploying to production.

## Backend structure

```
backend/
├── requirements.txt
└── app/
    ├── main.py              ← thin app factory, mounts all routers
    ├── core/
    │   ├── config.py        ← DB_PATH, SECRET_KEY, KST, sunday_of_week()
    │   ├── security.py      ← bcrypt verify/hash, JWT create/decode
    │   └── deps.py          ← get_current_user, require_admin FastAPI deps
    ├── db/
    │   ├── session.py       ← get_db() context manager
    │   └── init.py          ← init_db() DDL + seeds + _ensure_current_week_reports()
    └── routers/
        ├── auth.py          ← POST /api/auth/token  GET /api/auth/me
        ├── dashboard.py     ← GET  /api/dashboard
        ├── reports.py       ← /api/reports/**  (CRUD, submit, approve, reject, comments)
        ├── projects.py      ← /api/projects/** (CRUD + assignees)
        ├── schedule.py      ← /api/schedule/** (personal schedule CRUD)
        ├── users.py         ← /api/users/**    (list, admin edit, password change)
        ├── notifications.py ← /api/notifications/**
        └── misc.py          ← /api/search  /api/analytics/**  /api/lookups
```

## Frontend structure

```
frontend/
├── package.json
├── vite.config.ts    ← proxies /api → :8000, builds into backend/app/static/
├── tsconfig.json
├── index.html
└── src/
    ├── main.tsx          ← React root
    ├── App.tsx           ← BrowserRouter + route table
    ├── index.css         ← complete design system (CSS variables, all components)
    ├── api/
    │   └── index.ts      ← typed axios client for every endpoint
    ├── store/
    │   └── index.ts      ← Zustand: useAuthStore, useAppStore
    ├── types/
    │   └── index.ts      ← all TypeScript interfaces
    ├── hooks/
    │   └── useDates.ts   ← date-fns helpers: sundayOfWeek, weekLabel, fmtTime…
    ├── components/
    │   ├── layout/
    │   │   ├── AppShell.tsx   ← authenticated shell (sidebar + topbar + <Outlet>)
    │   │   ├── Sidebar.tsx    ← collapsible nav
    │   │   └── Topbar.tsx     ← search, notifications, avatar
    │   └── ui/
    │       ├── index.tsx      ← StatusChip, RiskChip, ProgressBar, BarChart, Spinner…
    │       ├── Modal.tsx      ← reusable animated modal
    │       ├── Toast.tsx      ← toast context + provider
    │       └── ReportEditor.tsx ← shared report editor (editable + read-only)
    └── pages/
        ├── Login.tsx
        ├── Dashboard.tsx
        ├── MyReport.tsx
        ├── TeamReports.tsx
        ├── Calendar.tsx
        ├── Projects.tsx
        ├── Analytics.tsx
        └── Members.tsx
```

## Environment variables

| Variable            | Default                        | Description              |
|---------------------|--------------------------------|--------------------------|
| `WEEKLY_REPORT_DB`  | `backend/weekly_report.db`     | SQLite database path     |
| `SECRET_KEY`        | (dev default — change this!)   | JWT signing key          |

## Production checklist

- [ ] Set `SECRET_KEY` environment variable to a random 64-char string
- [ ] Change all default passwords
- [ ] Mount `WEEKLY_REPORT_DB` on a persistent volume
- [ ] Run behind nginx / reverse proxy with HTTPS
- [ ] Set `allow_origins` in CORS middleware to your specific domain

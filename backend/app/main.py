"""
Weekly Report System — FastAPI application factory.

Run:
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import init_db, _ensure_current_week_reports
from .routers import (
    auth_router,
    dashboard_router,
    reports_router,
    projects_router,
    project_record_router,
    report_carry_router,
    schedule_router,
    users_router,
    notifications_router,
    misc_router,
    llm_router,
    teams_router,
)

app = FastAPI(
    title="Weekly Report System",
    version="6.0",
    description="Yokogawa SCS weekly reporting platform",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],       # tighten in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register all routers
for router in (
    auth_router,
    dashboard_router,
    reports_router,
    projects_router,
    project_record_router,
    report_carry_router,
    schedule_router,
    users_router,
    notifications_router,
    misc_router,
    llm_router,
    teams_router,
):
    app.include_router(router)


@app.on_event("startup")
def startup():
    init_db()
    _ensure_current_week_reports()

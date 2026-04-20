from .auth import router as auth_router
from .dashboard import router as dashboard_router
from .reports import router as reports_router
from .projects import router as projects_router
from .project_record import router as project_record_router
from .report_carry import router as report_carry_router
from .schedule import router as schedule_router
from .users import router as users_router
from .notifications import router as notifications_router
from .misc import router as misc_router
from .llm import router as llm_router
from .teams import router as teams_router

__all__ = [
    "auth_router",
    "dashboard_router",
    "reports_router",
    "projects_router",
    "project_record_router",
    "report_carry_router",
    "schedule_router",
    "users_router",
    "notifications_router",
    "misc_router",
    "llm_router",
    "teams_router",
]

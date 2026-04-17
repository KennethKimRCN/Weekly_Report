from datetime import date, timedelta
from zoneinfo import ZoneInfo
import os
from pathlib import Path

KST = ZoneInfo("Asia/Seoul")

DB_PATH = Path(
    os.environ.get(
        "WEEKLY_REPORT_DB",
        str(Path(__file__).parent.parent.parent / "weekly_report.db"),
    )
)

SECRET_KEY = os.environ.get(
    "SECRET_KEY",
    "yokogawa-weekly-report-secret-key-2025-change-in-prod",
)
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 8
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://127.0.0.1:1234/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "google/gemma-4-31b:2")
LLM_TIMEOUT_SECONDS = float(os.environ.get("LLM_TIMEOUT_SECONDS", "90"))


def sunday_of_week(d: date) -> date:
    """Return the Sunday that starts the week containing d.
    Python weekday(): Mon=0 … Sun=6.  days_since_sunday: Sun→0, Mon→1 … Sat→6.
    """
    return d - timedelta(days=(d.weekday() + 1) % 7)

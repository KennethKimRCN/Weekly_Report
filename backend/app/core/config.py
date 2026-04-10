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


def sunday_of_week(d: date) -> date:
    """Return the Sunday that starts the week containing d.
    Python weekday(): Mon=0 … Sun=6.  days_since_sunday: Sun→0, Mon→1 … Sat→6.
    """
    return d - timedelta(days=(d.weekday() + 1) % 7)

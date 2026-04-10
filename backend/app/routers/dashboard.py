from datetime import date, timedelta
from fastapi import APIRouter, Depends

from ..core.config import sunday_of_week
from ..core.deps import get_current_user
from ..db.session import get_db
from ..db.init import _ensure_current_week_reports

router = APIRouter(prefix="/api", tags=["dashboard"])


@router.get("/dashboard")
def dashboard(current_user=Depends(get_current_user)):
    today = date.today()
    ws = sunday_of_week(today)
    week_start_str = ws.isoformat()
    _ensure_current_week_reports()

    with get_db() as conn:
        my_report = conn.execute(
            """SELECT r.*, rs.name as status_name,
                      COALESCE(rs2.total_projects,0) as total_projects,
                      COALESCE(rs2.risk_count,0) as risk_count,
                      COALESCE(rs2.blocker_count,0) as blocker_count,
                      COALESCE(rs2.avg_completion,0) as avg_completion
               FROM reports r
               JOIN report_status rs ON rs.id=r.status_id
               LEFT JOIN report_summaries rs2 ON rs2.report_id=r.id
               WHERE r.owner_id=? AND r.week_start=? AND r.is_deleted=0""",
            (current_user["id"], week_start_str),
        ).fetchone()

        team_reports = conn.execute(
            """SELECT r.*, u.name as owner_name, rs.name as status_name,
                      COALESCE(rs2.total_projects,0) as total_projects,
                      COALESCE(rs2.risk_count,0) as risk_count,
                      COALESCE(rs2.blocker_count,0) as blocker_count,
                      COALESCE(rs2.avg_completion,0) as avg_completion
               FROM reports r
               JOIN users u ON u.id=r.owner_id
               JOIN report_status rs ON rs.id=r.status_id
               LEFT JOIN report_summaries rs2 ON rs2.report_id=r.id
               WHERE r.week_start=? AND r.is_deleted=0 AND u.is_deleted=0
               ORDER BY rs.sort_order DESC, u.name""",
            (week_start_str,),
        ).fetchall()

        pending = conn.execute(
            """SELECT r.id, r.week_start, u.name as owner_name, rs.name as status_name
               FROM reports r
               JOIN users u ON u.id=r.owner_id
               JOIN report_status rs ON rs.id=r.status_id
               WHERE r.status_id=2 AND r.is_deleted=0
               ORDER BY r.submitted_at"""
        ).fetchall()

        blockers = conn.execute(
            """SELECT p.project_name, rp.remarks, u.name as reporter, r.week_start
               FROM report_projects rp
               JOIN projects p ON p.id=rp.project_id
               JOIN reports r ON r.id=rp.report_id
               JOIN users u ON u.id=r.owner_id
               WHERE rp.risk_level='blocker' AND r.is_deleted=0 AND r.week_start=?""",
            (week_start_str,),
        ).fetchall()

        notif_count = conn.execute(
            "SELECT COUNT(*) as c FROM notifications "
            "WHERE user_id=? AND is_read=0 AND is_deleted=0",
            (current_user["id"],),
        ).fetchone()["c"]

        weeks = [(ws - timedelta(weeks=i)).isoformat() for i in range(7, -1, -1)]
        submission_stats = [
            conn.execute(
                """SELECT ? as week_start,
                          COUNT(*) as total,
                          SUM(CASE WHEN status_id>=2 THEN 1 ELSE 0 END) as submitted,
                          SUM(CASE WHEN status_id=3  THEN 1 ELSE 0 END) as approved
                   FROM reports WHERE week_start=? AND is_deleted=0""",
                (w, w),
            ).fetchone()
            for w in weeks
        ]

    return {
        "week_start": week_start_str,
        "my_report": my_report,
        "team_reports": team_reports,
        "pending_approvals": pending,
        "blockers": blockers,
        "unread_notifications": notif_count,
        "submission_stats": submission_stats,
    }

from datetime import date, timedelta
from fastapi import APIRouter, Depends, Query

from ..core.config import sunday_of_week
from ..core.deps import get_current_user
from ..db.session import get_db

router = APIRouter(prefix="/api", tags=["search", "analytics", "lookups"])


@router.get("/search")
def search(
    q: str = Query(..., min_length=2),
    current_user=Depends(get_current_user),
):
    with get_db() as conn:
        return conn.execute(
            """SELECT rs.report_id, rs.source_type, rs.content,
                      r.week_start, u.name as owner_name
               FROM report_search rs
               JOIN reports r ON r.id=rs.report_id
               JOIN users u ON u.id=r.owner_id
               WHERE report_search MATCH ? AND r.is_deleted=0
               ORDER BY rank LIMIT 20""",
            (q,),
        ).fetchall()


@router.get("/analytics/team-overview")
def team_overview(
    weeks: int = 8,
    current_user=Depends(get_current_user),
):
    today = date.today()
    ws = sunday_of_week(today)
    week_list = [(ws - timedelta(weeks=i)).isoformat() for i in range(weeks - 1, -1, -1)]

    with get_db() as conn:
        weekly = [
            conn.execute(
                """SELECT ? as week_start,
                          COUNT(*) as total_reports,
                          SUM(CASE WHEN r.status_id>=2 THEN 1 ELSE 0 END) as submitted,
                          SUM(CASE WHEN r.status_id=3  THEN 1 ELSE 0 END) as approved,
                          COALESCE(SUM(rs2.risk_count),0)    as total_risks,
                          COALESCE(SUM(rs2.blocker_count),0) as total_blockers,
                          COALESCE(CAST(AVG(rs2.avg_completion) AS INTEGER),0) as avg_completion
                   FROM reports r
                   LEFT JOIN report_summaries rs2 ON rs2.report_id=r.id
                   WHERE r.week_start=? AND r.is_deleted=0""",
                (w, w),
            ).fetchone()
            for w in week_list
        ]

        risk_trend = conn.execute(
            """SELECT prl.week_start, prl.risk_level, COUNT(*) as count
               FROM project_risk_log prl
               GROUP BY prl.week_start, prl.risk_level
               ORDER BY prl.week_start DESC LIMIT 40"""
        ).fetchall()

        top_projects = conn.execute(
            """SELECT p.project_name, p.company,
                      COUNT(DISTINCT rp.report_id) as report_count,
                      CAST(AVG(rp.completion_pct) AS INTEGER) as avg_completion,
                      SUM(CASE WHEN rp.risk_level='blocker' THEN 1 ELSE 0 END) as blocker_count
               FROM report_projects rp
               JOIN projects p ON p.id=rp.project_id
               GROUP BY rp.project_id ORDER BY report_count DESC LIMIT 10"""
        ).fetchall()

    return {"weekly": weekly, "risk_trend": risk_trend, "top_projects": top_projects}


@router.get("/lookups")
def get_lookups(current_user=Depends(get_current_user)):
    with get_db() as conn:
        return {
            "ranks":          conn.execute("SELECT * FROM ranks ORDER BY sort_order").fetchall(),
            "report_status":  conn.execute("SELECT * FROM report_status ORDER BY sort_order").fetchall(),
            "schedule_types": conn.execute("SELECT * FROM schedule_type ORDER BY sort_order").fetchall(),
            "tags":           conn.execute("SELECT * FROM tags ORDER BY name").fetchall(),
            "departments":    conn.execute("SELECT * FROM departments WHERE is_deleted=0").fetchall(),
            "users_simple":   conn.execute(
                "SELECT id, name, rank_id FROM users WHERE is_deleted=0 ORDER BY name"
            ).fetchall(),
        }

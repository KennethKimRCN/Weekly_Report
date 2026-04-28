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
    week_start_str = sunday_of_week(today).isoformat()
    lookahead = (today + timedelta(days=14)).isoformat()
    today_str = today.isoformat()
    since_str = (today - timedelta(days=7)).isoformat()
    uid = current_user["id"]

    _ensure_current_week_reports()

    with get_db() as conn:
        # ── 1. Personal schedule (next 14 days) ──────────────────────────
        schedule = conn.execute(
            """SELECT ps.id, ps.start_date, ps.end_date, ps.location, ps.details,
                      st.name as type_name
               FROM personal_schedule ps
               JOIN schedule_type st ON st.id = ps.type_id
               WHERE ps.user_id = ?
                 AND ps.start_date <= ? AND ps.end_date >= ?
               ORDER BY ps.start_date""",
            (uid, lookahead, today_str),
        ).fetchall()

        # ── 2. Recent issue updates from my projects (last 7 days) ───────
        # Collect all project ids the user has ever reported on
        my_project_ids = [
            row["project_id"]
            for row in conn.execute(
                """SELECT DISTINCT rp.project_id
                   FROM report_projects rp
                   JOIN reports r ON r.id = rp.report_id
                   WHERE r.owner_id = ? AND r.is_deleted = 0""",
                (uid,),
            ).fetchall()
        ]

        issue_updates = []
        if my_project_ids:
            placeholders = ",".join("?" * len(my_project_ids))
            # Latest progress entry per issue only (no duplicate issue rows)
            issue_updates = conn.execute(
                f"""SELECT pip.id, pip.title as progress_title,
                           pip.start_date, pip.updated_at,
                           pi.title as issue_title, pi.status, pi.priority,
                           p.project_name,
                           pi.id as issue_id, p.id as project_id
                    FROM project_issue_progress pip
                    JOIN project_issues pi ON pi.id = pip.issue_id
                    JOIN projects p ON p.id = pi.project_id
                    WHERE pi.project_id IN ({placeholders})
                      AND pip.is_deleted = 0
                      AND pi.is_deleted  = 0
                      AND pip.updated_at >= ?
                      AND pip.id = (
                          SELECT id FROM project_issue_progress
                          WHERE issue_id = pip.issue_id AND is_deleted = 0
                          ORDER BY updated_at DESC LIMIT 1
                      )
                    ORDER BY pip.updated_at DESC
                    LIMIT 15""",
                (*my_project_ids, since_str),
            ).fetchall()

        # ── 3. Team status (current week report status per team member) ──
        # Find all teams the current user belongs to
        user_teams = conn.execute(
            """SELECT t.id as team_id, t.name as team_name, utr.role
               FROM user_team_roles utr
               JOIN teams t ON t.id = utr.team_id
               WHERE utr.user_id = ?
               ORDER BY utr.primary_team DESC, t.name""",
            (uid,),
        ).fetchall()

        team_status = []
        for team in user_teams:
            members = conn.execute(
                """SELECT u.id, u.name,
                          r.id        as report_id,
                          r.status_id,
                          rs.name     as status_name
                   FROM user_team_roles utr
                   JOIN users u ON u.id = utr.user_id
                   LEFT JOIN reports r
                     ON r.owner_id = u.id
                    AND r.week_start = ?
                    AND r.is_deleted = 0
                   LEFT JOIN report_status rs ON rs.id = r.status_id
                   WHERE utr.team_id = ? AND u.is_deleted = 0
                   ORDER BY u.name""",
                (week_start_str, team["team_id"]),
            ).fetchall()

            team_status.append({
                "team_id":   team["team_id"],
                "team_name": team["team_name"],
                "members":   [dict(m) for m in members],
            })

    return {
        "week_start":      week_start_str,
        "current_user_id": uid,
        "schedule":        [dict(s) for s in schedule],
        "issue_updates":   [dict(i) for i in issue_updates],
        "team_status":     team_status,
    }

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


@router.get("/analytics/available-weeks")
def available_weeks(current_user=Depends(get_current_user)):
    """Return all distinct week_starts that have at least one submitted/approved report."""
    with get_db() as conn:
        rows = conn.execute(
            """SELECT DISTINCT week_start FROM reports
               WHERE is_deleted=0
               ORDER BY week_start DESC"""
        ).fetchall()
        return {"weeks": [r["week_start"] for r in rows]}


@router.get("/analytics/weekly-diff")
def weekly_diff(week: str = None, current_user=Depends(get_current_user)):
    """Return a per-project diff between two submitted/approved weeks.
    If `week` is provided, use it as cur_week and pick the preceding available week.
    Otherwise defaults to the two most recent weeks."""
    with get_db() as conn:
        all_weeks = conn.execute(
            """SELECT DISTINCT week_start FROM reports
               WHERE is_deleted=0
               ORDER BY week_start DESC"""
        ).fetchall()
        week_list = [r["week_start"] for r in all_weeks]

        if len(week_list) < 2:
            return {"current_week": None, "prev_week": None, "projects": [], "available_weeks": week_list}

        if week and week in week_list:
            idx = week_list.index(week)
            cur_week  = week_list[idx]
            prev_week = week_list[idx + 1] if idx + 1 < len(week_list) else None
        else:
            cur_week  = week_list[0]
            prev_week = week_list[1]

        if prev_week is None:
            return {"current_week": cur_week, "prev_week": None, "projects": [], "available_weeks": week_list}

        def fetch_projects(week):
            rows = conn.execute(
                """SELECT rp.id as rp_id, rp.project_id, rp.remarks,
                          p.project_name, p.company, p.location
                   FROM report_projects rp
                   JOIN reports r ON r.id=rp.report_id
                   JOIN projects p ON p.id=rp.project_id
                   WHERE r.week_start=? AND r.is_deleted=0""",
                (week,),
            ).fetchall()
            result = {}
            for rp in rows:
                rp_id = rp["rp_id"]
                issues = conn.execute(
                    """SELECT ii.id, ii.title, ii.status, ii.start_date, ii.end_date, ii.details
                       FROM issue_item ii WHERE ii.report_project_id=? ORDER BY ii.start_date, ii.id""",
                    (rp_id,),
                ).fetchall()
                issues_with_prog = []
                for issue in issues:
                    progresses = conn.execute(
                        """SELECT ip.id, ip.title, ip.start_date, ip.end_date, ip.details
                           FROM issue_progress ip WHERE ip.issue_item_id=? ORDER BY ip.start_date, ip.id""",
                        (issue["id"],),
                    ).fetchall()
                    issues_with_prog.append({**dict(issue), "issue_progresses": [dict(p) for p in progresses]})

                schedules = conn.execute(
                    """SELECT ps.id, ps.title, ps.start_date, ps.end_date
                       FROM project_schedule ps WHERE ps.report_project_id=? ORDER BY ps.start_date, ps.id""",
                    (rp_id,),
                ).fetchall()

                result[rp["project_id"]] = {
                    "project_id":   rp["project_id"],
                    "project_name": rp["project_name"],
                    "company":      rp["company"],
                    "location":     rp["location"],
                    "remarks":      rp["remarks"],
                    "issue_items":  issues_with_prog,
                    "project_schedules": [dict(s) for s in schedules],
                }
            return result

        cur  = fetch_projects(cur_week)
        prev = fetch_projects(prev_week)

        all_project_ids = sorted(set(list(cur.keys()) + list(prev.keys())))
        projects = []

        for pid in all_project_ids:
            c = cur.get(pid)
            p = prev.get(pid)

            if c is None:
                # project dropped off this week
                continue

            base = {
                "project_id":   c["project_id"],
                "project_name": c["project_name"],
                "company":      c["company"],
                "location":     c["location"],
            }

            # ── remarks diff ──────────────────────────────────────────────
            cur_remarks  = (c["remarks"] or "").strip()
            prev_remarks = (p["remarks"] or "").strip() if p else ""
            remarks_diff = None
            if cur_remarks != prev_remarks:
                remarks_diff = {"prev": prev_remarks or None, "cur": cur_remarks or None}

            # ── schedule diff ─────────────────────────────────────────────
            prev_sched_titles = {s["title"] for s in (p["project_schedules"] if p else [])}
            cur_sched_titles  = {s["title"] for s in c["project_schedules"]}
            sched_added   = [s for s in c["project_schedules"] if s["title"] not in prev_sched_titles]
            sched_removed = [s for s in (p["project_schedules"] if p else []) if s["title"] not in cur_sched_titles]

            # ── issue diff ────────────────────────────────────────────────
            prev_issues = {ii["title"]: ii for ii in (p["issue_items"] if p else [])}
            cur_issues  = {ii["title"]: ii for ii in c["issue_items"]}

            issues_added   = []
            issues_removed = []
            issues_changed = []

            for title, ci in cur_issues.items():
                if title not in prev_issues:
                    issues_added.append(ci)
                else:
                    pi = prev_issues[title]
                    changes = {}
                    if ci["status"] != pi["status"]:
                        changes["status"] = {"prev": pi["status"], "cur": ci["status"]}
                    if (ci["details"] or "").strip() != (pi["details"] or "").strip():
                        changes["details"] = {"prev": pi["details"], "cur": ci["details"]}

                    prev_prog_titles = {pg["title"] for pg in pi["issue_progresses"]}
                    cur_prog_titles  = {pg["title"] for pg in ci["issue_progresses"]}
                    prog_added   = [pg for pg in ci["issue_progresses"] if pg["title"] not in prev_prog_titles]
                    prog_removed = [pg for pg in pi["issue_progresses"] if pg["title"] not in cur_prog_titles]

                    if changes or prog_added or prog_removed:
                        issues_changed.append({
                            "title":          title,
                            "status":         ci["status"],
                            "start_date":     ci["start_date"],
                            "changes":        changes,
                            "prog_added":     prog_added,
                            "prog_removed":   prog_removed,
                        })

            for title, pi in prev_issues.items():
                if title not in cur_issues:
                    issues_removed.append(pi)

            has_diff = (
                remarks_diff is not None
                or sched_added or sched_removed
                or issues_added or issues_removed or issues_changed
            )

            projects.append({
                **base,
                "has_diff":       has_diff,
                "remarks_diff":   remarks_diff,
                "sched_added":    sched_added,
                "sched_removed":  sched_removed,
                "issues_added":   issues_added,
                "issues_removed": issues_removed,
                "issues_changed": issues_changed,
            })

        # Sort: projects with diffs first
        projects.sort(key=lambda x: (0 if x["has_diff"] else 1, x["project_name"]))

        return {"current_week": cur_week, "prev_week": prev_week, "projects": projects, "available_weeks": week_list}


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

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
    Uses report_versions snapshots so diffs reflect what was actually submitted,
    not the current (potentially edited) live state of the DB.
    If `week` is provided, use it as cur_week and pick the preceding available week.
    Otherwise defaults to the two most recent weeks."""
    import json as _json

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

        def fetch_projects_from_snapshot(w: str) -> dict:
            """Read the latest report_version snapshot for every report in week w.
            Returns a dict keyed by project_id with the merged project data."""
            # Get latest snapshot per report for this week
            rows = conn.execute(
                """SELECT rv.snapshot_json
                   FROM report_versions rv
                   JOIN reports r ON r.id = rv.report_id
                   WHERE r.week_start = ? AND r.is_deleted = 0
                     AND rv.version_number = (
                         SELECT MAX(rv2.version_number)
                         FROM report_versions rv2
                         WHERE rv2.report_id = rv.report_id
                     )""",
                (w,),
            ).fetchall()

            result = {}
            for row in rows:
                try:
                    snap = _json.loads(row["snapshot_json"])
                except Exception:
                    continue
                for proj in snap.get("projects", []):
                    pid = proj.get("project_id")
                    if pid is None:
                        continue
                    # Last snapshot for this project wins (multiple reporters edge case)
                    result[pid] = {
                        "project_id":        pid,
                        "project_name":      proj.get("project_name", ""),
                        "company":           proj.get("company", ""),
                        "location":          proj.get("location", ""),
                        "remarks":           proj.get("remarks") or "",
                        # project_schedules in snapshot = milestones (see _full_report)
                        "milestones":        proj.get("project_schedules") or [],
                        "issue_items":       proj.get("issue_items") or [],
                    }
            return result

        cur  = fetch_projects_from_snapshot(cur_week)
        prev = fetch_projects_from_snapshot(prev_week)

        all_project_ids = sorted(set(list(cur.keys()) + list(prev.keys())))
        projects = []

        def _str(v):
            return (v or "").strip()

        def _field_diff(prev_val, cur_val):
            p, c = _str(prev_val), _str(cur_val)
            return {"prev": prev_val, "cur": cur_val} if p != c else None

        for pid in all_project_ids:
            c = cur.get(pid)
            p = prev.get(pid)

            if c is None:
                # project dropped off this week — skip
                continue

            base = {
                "project_id":   c["project_id"],
                "project_name": c["project_name"],
                "company":      c["company"],
                "location":     c["location"],
            }

            # ── remarks diff ──────────────────────────────────────────────
            remarks_diff = _field_diff(
                p["remarks"] if p else "",
                c["remarks"],
            )

            # ── milestone diff (keyed by title) ───────────────────────────
            prev_ms = {m["title"]: m for m in (p["milestones"] if p else [])}
            cur_ms  = {m["title"]: m for m in c["milestones"]}

            ms_added   = [m for t, m in cur_ms.items()  if t not in prev_ms]
            ms_removed = [m for t, m in prev_ms.items() if t not in cur_ms]
            ms_changed = []
            for title, cm in cur_ms.items():
                if title not in prev_ms:
                    continue
                pm = prev_ms[title]
                changes = {}
                d = _field_diff(pm.get("status"),     cm.get("status"))
                if d: changes["status"] = d
                d = _field_diff(pm.get("start_date"), cm.get("start_date"))
                if d: changes["planned_date"] = d
                d = _field_diff(pm.get("end_date"),   cm.get("end_date"))
                if d: changes["actual_date"] = d
                if changes:
                    ms_changed.append({
                        "title":   title,
                        "status":  cm.get("status"),
                        "start_date": cm.get("start_date"),
                        "end_date":   cm.get("end_date"),
                        "changes": changes,
                    })

            # ── issue diff (keyed by title) ───────────────────────────────
            prev_issues = {ii["title"]: ii for ii in (p["issue_items"] if p else [])}
            cur_issues  = {ii["title"]: ii for ii in c["issue_items"]}

            issues_added   = []
            issues_removed = []
            issues_changed = []

            for title, ci in cur_issues.items():
                if title not in prev_issues:
                    issues_added.append(ci)
                    continue

                pi = prev_issues[title]
                changes = {}
                for field in ("status", "details", "start_date", "end_date"):
                    d = _field_diff(pi.get(field), ci.get(field))
                    if d:
                        changes[field] = d

                # progress diff keyed by title
                prev_prog = {pg["title"]: pg for pg in (pi.get("issue_progresses") or [])}
                cur_prog  = {pg["title"]: pg for pg in (ci.get("issue_progresses") or [])}

                prog_added   = [pg for t, pg in cur_prog.items()  if t not in prev_prog]
                prog_removed = [pg for t, pg in prev_prog.items() if t not in cur_prog]
                prog_changed = []
                for ptitle, cpg in cur_prog.items():
                    if ptitle not in prev_prog:
                        continue
                    ppg = prev_prog[ptitle]
                    pchanges = {}
                    for field in ("details", "start_date", "end_date"):
                        d = _field_diff(ppg.get(field), cpg.get(field))
                        if d:
                            pchanges[field] = d
                    if pchanges:
                        prog_changed.append({
                            "title":      ptitle,
                            "start_date": cpg.get("start_date"),
                            "end_date":   cpg.get("end_date"),
                            "details":    cpg.get("details"),
                            "changes":    pchanges,
                        })

                if changes or prog_added or prog_removed or prog_changed:
                    issues_changed.append({
                        "title":        title,
                        "status":       ci.get("status"),
                        "start_date":   ci.get("start_date"),
                        "end_date":     ci.get("end_date"),
                        "changes":      changes,
                        "prog_added":   prog_added,
                        "prog_removed": prog_removed,
                        "prog_changed": prog_changed,
                    })

            for title, pi in prev_issues.items():
                if title not in cur_issues:
                    issues_removed.append(pi)

            has_diff = bool(
                remarks_diff
                or ms_added or ms_removed or ms_changed
                or issues_added or issues_removed or issues_changed
            )

            projects.append({
                **base,
                "has_diff":       has_diff,
                "remarks_diff":   remarks_diff,
                "ms_added":       ms_added,
                "ms_removed":     ms_removed,
                "ms_changed":     ms_changed,
                "issues_added":   issues_added,
                "issues_removed": issues_removed,
                "issues_changed": issues_changed,
            })

        # Sort: projects with diffs first, then alphabetically
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
